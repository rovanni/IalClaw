import fs from 'fs';
import path from 'path';
import { ToolDefinition } from '../core/tools/types';
import { getContext } from '../shared/TraceContext';
import { debugBus } from '../shared/DebugBus';

function walk(dir: string): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);

    list.forEach(file => {
        const filePath = path.join(dir, file);
        const stat = fs.statSync(filePath);

        if (stat.isDirectory()) {
            results = results.concat(walk(filePath));
            return;
        }

        results.push(filePath);
    });

    return results;
}

function runValidationRules(files: string[]) {
    const errors: string[] = [];
    const hasHTML = files.some(file => file.endsWith('.html'));
    const hasFrontendAssets = files.some(file => file.endsWith('.css') || file.endsWith('.js'));

    if (!hasHTML && hasFrontendAssets) {
        errors.push('Nenhum arquivo HTML encontrado');
    }

    files.forEach(file => {
        const content = fs.readFileSync(file, 'utf-8');

        if (content.trim().length < 20) {
            errors.push(`Arquivo muito pequeno: ${path.basename(file)}`);
        }

        if (file.endsWith('.html') && !content.toLowerCase().includes('<html')) {
            errors.push(`HTML invalido em ${path.basename(file)}`);
        }

        if (file.endsWith('.js')) {
            const hasJsStructure = content.includes('function')
                || content.includes('=>')
                || content.includes('class')
                || content.includes('const ')
                || content.includes('let ');

            if (!hasJsStructure) {
                errors.push(`JS suspeito ou vazio em ${path.basename(file)}`);
            }
        }
    });

    return {
        valid: errors.length === 0,
        errors,
        files_count: files.length
    };
}

export const workspaceValidateProjectTool: ToolDefinition = {
    name: 'workspace_validate_project',
    description: 'Valida a integridade estrutural de um projeto no workspace.',
    input_schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string' }
        },
        required: ['project_id']
    },
    async execute(input, context) {
        const ctx = context ?? getContext();
        const { project_id } = input;
        const basePath = path.join(process.cwd(), 'workspace', 'projects', project_id);

        debugBus.emit('tool:validate:start', {
            trace_id: ctx.trace_id,
            project_id
        });

        try {
            if (!fs.existsSync(basePath)) {
                throw new Error('Projeto nao existe');
            }

            const outputPath = path.join(basePath, 'output');

            if (!fs.existsSync(outputPath)) {
                throw new Error('Pasta output nao encontrada');
            }

            const files = walk(outputPath);

            if (files.length === 0) {
                throw new Error('Nenhum arquivo gerado');
            }

            const validation = runValidationRules(files);

            debugBus.emit('tool:validate:result', {
                trace_id: ctx.trace_id,
                validation
            });

            return {
                success: validation.valid,
                data: validation
            };
        } catch (err: any) {
            debugBus.emit('tool:validate:error', {
                trace_id: ctx.trace_id,
                error: err.message
            });

            return {
                success: false,
                error: err.message
            };
        }
    }
};
