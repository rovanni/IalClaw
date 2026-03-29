import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { ToolDefinition } from '../core/tools/types';
import { getContext } from '../shared/TraceContext';
import { debugBus } from '../shared/DebugBus';
import { t } from '../i18n';

const execFileAsync = promisify(execFile);

type RunProjectResult = {
    success: boolean;
    stdout?: string;
    stderr?: string;
    runtime_errors?: string[];
    error_hash?: string;
};

type PageLike = {
    on(event: string, listener: (...args: any[]) => void): void;
    goto(url: string, options?: Record<string, any>): Promise<void>;
    waitForTimeout?: (ms: number) => Promise<void>;
    waitForFunction?: (fn: string | Function, options?: Record<string, any>) => Promise<void>;
};

type BrowserLike = {
    newPage(): Promise<PageLike>;
    close(): Promise<void>;
};

type PuppeteerLike = {
    launch(options?: Record<string, any>): Promise<BrowserLike>;
};

function hash(input: string): string {
    return crypto.createHash('md5').update(input).digest('hex');
}

function fail(error: string): RunProjectResult {
    return {
        success: false,
        stderr: error,
        error_hash: hash(error)
    };
}

function ok(stdout: string, runtime_errors?: string[]): RunProjectResult {
    return {
        success: true,
        stdout,
        runtime_errors
    };
}

function getOutputPath(projectId: string): string {
    return path.join(process.cwd(), 'workspace', 'projects', projectId, 'output');
}

async function runNodeProject(projectPath: string, timeoutMs: number = 10000): Promise<RunProjectResult> {
    try {
        const { stdout, stderr } = await execFileAsync('node', ['index.js'], {
            cwd: projectPath,
            timeout: timeoutMs
        });

        if (stderr && stderr.trim()) {
            return fail(stderr);
        }

        return ok(stdout || t('tool.run.node_success'));
    } catch (err: any) {
        return fail(err.stderr || err.message || t('tool.run.node_failed'));
    }
}

function loadPuppeteer(): PuppeteerLike | null {
    try {
        return require('puppeteer') as PuppeteerLike;
    } catch {
        return null;
    }
}

async function runHtmlProject(projectPath: string, timeoutMs: number = 10000): Promise<RunProjectResult> {
    const puppeteer = loadPuppeteer();
    if (!puppeteer) {
        return fail('Puppeteer não instalado. Execute: npm install puppeteer');
    }

    let browser;
    try {
        browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox']
        });

        const page = await browser.newPage();
        const runtimeErrors: string[] = [];

        page.on('console', (msg: any) => {
            if (typeof msg?.type === 'function' && msg.type() === 'error') {
                runtimeErrors.push(msg.text());
            }
        });

        page.on('pageerror', (err: any) => {
            runtimeErrors.push(err.message || String(err));
        });

        const fileUrl = 'file://' + path.join(projectPath, 'index.html');
        await page.goto(fileUrl, { waitUntil: 'load', timeout: timeoutMs });

        if (page.waitForTimeout) {
            await page.waitForTimeout(1000);
        } else if (page.waitForFunction) {
            await page.waitForFunction(() => true, { timeout: 1000 });
        }

        if (runtimeErrors.length > 0) {
            return fail(runtimeErrors.join('\n'));
        }

        return ok(t('tool.run.html_success'));
    } catch (err: any) {
        return fail(err.message || t('tool.run.html_failed'));
    } finally {
        if (browser) {
            await browser.close();
        }
    }
}

async function runProject(projectId: string, timeoutMs: number = 10000): Promise<RunProjectResult> {
    const projectPath = getOutputPath(projectId);

    if (!fs.existsSync(projectPath)) {
        return fail(t('tool.run.output_path_not_found'));
    }

    const files = fs.readdirSync(projectPath);

    if (files.includes('index.js')) {
        return runNodeProject(projectPath, timeoutMs);
    }

    if (files.includes('index.html')) {
        return runHtmlProject(projectPath, timeoutMs);
    }

    return fail(t('tool.run.no_runnable_entry'));
}

export const workspaceRunProjectTool: ToolDefinition = {
    name: 'workspace_run_project',
    description: 'Executa um projeto do workspace e retorna erros reais de runtime quando existirem.',
    input_schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string' },
            timeout: { type: 'number', description: 'Timeout em milissegundos (padrão: 10000)' }
        },
        required: ['project_id']
    },
    async execute(input, context) {
        const ctx = context ?? getContext();

        debugBus.emit('tool:run:start', {
            trace_id: ctx.trace_id,
            project_id: input.project_id
        });

        const timeoutMs = input.timeout || 10000;
        const result = await runProject(input.project_id, timeoutMs);

        if (!result.success) {
            debugBus.emit('tool:run:error', {
                trace_id: ctx.trace_id,
                project_id: input.project_id,
                error: result.stderr,
                error_hash: result.error_hash
            });

            return {
                success: false,
                error: result.stderr || t('tool.run.project_execution_failed'),
                data: result
            };
        }

        debugBus.emit('tool:run:result', {
            trace_id: ctx.trace_id,
            project_id: input.project_id,
            stdout: result.stdout
        });

        return {
            success: true,
            data: result
        };
    }
};
