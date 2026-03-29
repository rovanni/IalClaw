// Silencia output do dotenv antes de qualquer import
process.env.DOTENV_CONFIG_QUIET = 'true';

import { Bot } from 'grammy';
import * as dotenv from 'dotenv';
import * as path from 'path';
import * as fs from 'fs';
import { execSync } from 'child_process';
import { isOllamaEnabled, isOllamaRunning, startOllama } from './utils/ollamaCheck';
import { DatabaseManager } from './db/DatabaseManager';
import { CognitiveMemory } from './memory/CognitiveMemory';
import { ContextBuilder } from './memory/ContextBuilder';
import { AgentLoop } from './engine/AgentLoop';
import { ProviderFactory } from './engine/ProviderFactory';
import { SkillRegistry } from './engine/SkillRegistry';
import { TelegramInputHandler } from './telegram/TelegramInputHandler';
import { TelegramOutputHandler } from './telegram/TelegramOutputHandler';
import { AgentController } from './core/AgentController';
import { startTraceRecorder } from './shared/TraceRecorder';
import { bootstrapCapabilities } from './capabilities/bootstrapCapabilities';
import { capabilityRegistry, skillManager } from './capabilities';
import { SkillLoader } from './skills/SkillLoader';
import { SkillResolver } from './skills/SkillResolver';
import { createAuditLog } from './skills/AuditLog';
import { createLogger } from './shared/AppLogger';
import { debugBus } from './shared/DebugBus';
import { ProviderEmbeddingService } from './memory/EmbeddingService';
import { MemoryService } from './memory/MemoryService';
import { MemoryLifecycleManager } from './memory/MemoryLifecycleManager';
import { MemoryType } from './memory/MemoryTypes';
import { DecisionMemory } from './memory/DecisionMemory';
import { setLanguage, t } from './i18n';
import { resolveAppLanguage } from './config/languageConfig';
import { OnboardingService } from './services/OnboardingService';


function parseEnvFile(envPath: string): Record<string, string> {
    if (!fs.existsSync(envPath)) return {};
    const lines = fs.readFileSync(envPath, 'utf8').split(/\r?\n/);
    const env: Record<string, string> = {};
    for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#') || !trimmed.includes('=')) continue;
        const [key, ...rest] = trimmed.split('=');
        env[key.trim()] = rest.join('=').trim();
    }
    return env;
}

function checkAndRunSetup(): void {
    const envPath = path.resolve('.env');
    const envVars = parseEnvFile(envPath);
    
    const requiredVars = ['MODEL', 'USE_OLLAMA'];
    const missing = requiredVars.filter(v => !envVars[v] || envVars[v] === 'your_bot_token_here');
    
    if (missing.length > 0 || !fs.existsSync(envPath)) {
        const envLang = parseEnvFile(envPath).APP_LANG || 'pt-BR';
        const isEnglish = envLang.includes('en');
        
        console.log('');
        console.log('\x1b[33m' + (isEnglish ? '⚠️  Incomplete configuration or .env not found!' : '⚠️  Configuração incompleta ou .env não encontrado!') + '\x1b[0m');
        console.log('');
        
        const readline = require('readline').createInterface({
            input: process.stdin,
            output: process.stdout
        });

        const prompt = isEnglish ? 'Do you want to run interactive setup? (y/n): ' : 'Deseja executar o setup interativo? (s/n): ';
        
        readline.question(prompt, (answer: string) => {
            readline.close();

            if (answer.toLowerCase() === 's' || answer.toLowerCase() === 'sim' || answer.toLowerCase() === 'y' || answer.toLowerCase() === 'yes') {
                console.log(isEnglish ? '\n▶️  Running setup...\n' : '\n▶️  Executando setup...\n');
                const { execSync } = require('child_process');
                try {
                    execSync('npx ts-node src/scripts/setup.ts', { stdio: 'inherit', cwd: process.cwd() });
                } catch {
                    console.log(isEnglish ? '❌ Error running setup. Run manually: npx ts-node src/scripts/setup.ts' : '❌ Erro ao executar setup. Execute manualmente: npx ts-node src/scripts/setup.ts');
                }
                process.exit(0);
            } else {
                console.log(isEnglish ? '❌ Exiting. Run "npx ts-node src/scripts/setup.ts" to configure.' : '❌ Encerrando. Execute "npx ts-node src/scripts/setup.ts" para configurar.');
                process.exit(0);
            }
        });
        return;
        return;
    }
}

checkAndRunSetup();

dotenv.config({ debug: false });
setLanguage(resolveAppLanguage());

// ── Checagem e inicialização automática do Ollama ──────────────────────────
(async () => {
    if (await isOllamaEnabled()) {
        if (!(await isOllamaRunning())) {
            console.log('⚠️ Ollama não detectado, iniciando...');
            if (await startOllama()) {
                console.log('✅ Ollama iniciado com sucesso');
            } else {
                console.error('❌ Falha ao iniciar Ollama');
                process.exit(1);
            }
        } else {
            console.log('✅ Ollama já está rodando');
        }
    }
})();

function getDisplayVersion(): string {
    const pkg = require('../package.json');
    const baseVersion = pkg.version || '0.0.0';

    try {
        const root = path.join(__dirname, '..');
        const gitHash = execSync('git rev-parse --short HEAD', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim();
        const isDirty = execSync('git status --porcelain', { cwd: root, stdio: ['ignore', 'pipe', 'ignore'] })
            .toString()
            .trim().length > 0;

        if (!gitHash) {
            return baseVersion;
        }

        return `${baseVersion}+${gitHash}${isDirty ? '-dirty' : ''}`;
    } catch {
        return baseVersion;
    }
}

// ── Banner de inicialização ──────────────────────────────────────────────────
{
    const RESET = '\x1b[0m';
    const CYAN = '\x1b[36m';
    const GREEN = '\x1b[32m';
    const DIM = '\x1b[2m';

    const version = getDisplayVersion();
    const logLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
    const mode = logLevel === 'debug' ? 'dev:debug' : 'dev';
    const channel = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_bot_token_here'
        ? 'telegram + web'
        : 'web only';
    const model = process.env.OLLAMA_MODEL || process.env.MODEL || 'llama3.2';

    console.log('');
    console.log('========================================================');
    console.log(`${CYAN}  🐙 IALCLAW${RESET} ${DIM}v${version}${RESET}`);
    console.log(`${DIM}  ─────────────────────────────────${RESET}`);
    console.log(`  modo:    ${GREEN}${mode}${RESET}`);
    console.log(`  canal:   ${GREEN}${channel}${RESET}`);
    console.log(`  modelo:  ${GREEN}${model}${RESET}`);
    console.log('========================================================');
    console.log('');
}

const logger = createLogger('Startup');
const busLogger = createLogger('DebugBus');

// ── DebugBus → Logger bridge ────────────────────────────────────────────────
debugBus.on('agent:step', (data: any) => busLogger.debug('agent_step', data?.summary || data?.type));
debugBus.on('agent:error', (data: any) => busLogger.error('agent_error', data?.error || data, data?.message));
debugBus.on('tool:call', (data: any) => busLogger.debug('tool_call', `${data?.tool || 'unknown'}`));

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const hasTelegramBotToken = Boolean(BOT_TOKEN && BOT_TOKEN !== 'your_bot_token_here');

function checkAndPromptDatabase(): void {
    const DB_PATH = path.resolve('db.sqlite');
    const readlineSync = require('readline-sync');

    // Verifica se banco existe e é válido
    if (fs.existsSync(DB_PATH)) {
        const stats = fs.statSync(DB_PATH);
        if (stats.size > 0) {
            // Banco existe, verifica se pode abrir
            try {
                const testDb = require('better-sqlite3')(DB_PATH);
                testDb.prepare('SELECT 1').get();
                testDb.close();
                return; // Banco OK
            } catch (err: unknown) {
                // Banco corrompido - AVISA O USUÁRIO PRIMEIRO
                console.log('');
                console.log('\x1b[31m═══════════════════════════════════════════════════════════════\x1b[0m');
                console.log('\x1b[31m  ' + t('database.corrupted_title') + '\x1b[0m');
                console.log('\x1b[31m═══════════════════════════════════════════════════════════════\x1b[0m');
                console.log('');
                console.log(`  ${t('database.file')}: ${DB_PATH}`);
                console.log(`  ${t('database.size')}: ${(stats.size / 1024).toFixed(2)} KB`);
                console.log(`  ${t('database.error')}: ${err instanceof Error ? err.message : 'Não foi possível abrir o banco'}`);
                console.log('');
                console.log('\x1b[33m  ' + t('database.corrupted_info') + '\x1b[0m');
                console.log('');
                console.log('  ' + t('database.options') + ':');
                console.log('    [1] ' + t('database.corrupted_option1'));
                console.log('    [2] ' + t('database.corrupted_option2'));
                console.log('    [3] ' + t('database.corrupted_option3'));
                console.log('    [4] ' + t('database.corrupted_option4'));
                console.log('');

                const choice = readlineSync.question('  ' + t('database.option')).trim() || '1';

                if (choice === '4' || choice.toLowerCase() === 'sair' || choice.toLowerCase() === 'exit') {
                    console.log('\n  ' + t('database.canceled'));
                    process.exit(0);
                }

                if (choice === '2') {
                    // Backup primeiro
                    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                    const backupPath = `${DB_PATH}.corrompido.${timestamp}`;
                    try {
                        fs.copyFileSync(DB_PATH, backupPath);
                        console.log(`\n  ${t('database.corrupted_backup_created', { path: backupPath })}`);
                    } catch (backupErr: unknown) {
                        console.log(`\n  ${t('database.corrupted_backup_error', { error: backupErr instanceof Error ? backupErr.message : 'Erro desconhecido' })}`);
                        const confirm = readlineSync.question('  ' + t('database.corrupted_backup_confirm')).toLowerCase();
                        if (confirm !== 's' && confirm !== 'sim' && confirm !== 'y' && confirm !== 'yes') {
                            process.exit(0);
                        }
                    }
                }

                if (choice === '3') {
                    // Tentar reparar
                    console.log('\n  ' + t('database.corrupted_repairing'));
                    try {
                        const repairDb = require('better-sqlite3')(DB_PATH);
                        repairDb.pragma('integrity_check');
                        repairDb.close();
                        console.log('  ' + t('database.corrupted_repair_success'));
                        return;
                    } catch (repairErr: unknown) {
                        console.log(`  ${t('database.corrupted_repair_failed', { error: repairErr instanceof Error ? repairErr.message : 'Erro desconhecido' })}`);
                        console.log('  ' + t('database.creating_new'));
                    }
                }

                // choice 1 ou 2 ou reparo falhou - remove banco corrompido
                try {
                    fs.unlinkSync(DB_PATH);
                    // Remove arquivos auxiliares
                    const auxFiles = [`${DB_PATH}-journal`, `${DB_PATH}-wal`, `${DB_PATH}-shm`];
                    for (const f of auxFiles) {
                        if (fs.existsSync(f)) fs.unlinkSync(f);
                    }
                    console.log('  ' + t('database.corrupted_removed') + '\n');
                } catch (removeErr: unknown) {
                    console.log(`  ${t('database.corrupted_remove_error', { error: removeErr instanceof Error ? removeErr.message : 'Erro desconhecido' })}`);
                    process.exit(1);
                }
            }
        } else {
            // Arquivo vazio
            try { fs.unlinkSync(DB_PATH); } catch { /* ignore */ }
        }
    }

    // Banco não existe ou foi removido - pergunta
    console.log('');
    console.log('\x1b[33m' + t('database.not_found') + '\x1b[0m');
    console.log('');
    
    const answer = readlineSync.question(t('database.create_prompt'));
    
    if (answer.toLowerCase() !== 's' && answer.toLowerCase() !== 'sim' && answer.toLowerCase() !== 'y' && answer.toLowerCase() !== 'yes') {
        console.log(t('database.skip_start'));
        process.exit(0);
    }
    
    console.log(t('database.creating'));
    console.log('');
}

checkAndPromptDatabase();

const dbManager = DatabaseManager.getInstance('db.sqlite');
logger.info('database_initialized', t('log.index.database_initialized'));
startTraceRecorder();

// Iniciar Sonho/Consolidação
import { MemoryDreamer } from './memory/MemoryDreamer';
const dreamer = new MemoryDreamer(dbManager.getDb());
dreamer.dream();
setInterval(() => dreamer.dream(), 1000 * 60 * 60 * 24);

// Iniciar Dashboard Web
import { DashboardServer } from './dashboard/DashboardServer';
const dashboard = new DashboardServer(dbManager.getDb());

const provider = ProviderFactory.getProvider();
const memory = new CognitiveMemory(dbManager.getDb(), provider);
const contextBuilder = new ContextBuilder();
const registry = new SkillRegistry();
const embeddingService = new ProviderEmbeddingService(provider);
const memoryService = new MemoryService(dbManager.getDb(), embeddingService);
const memoryLifecycle = new MemoryLifecycleManager(memoryService);
const decisionMemory = new DecisionMemory(dbManager.getDb(), provider);

// Carrega skills: internas direto, públicas somente após auditoria aprovada
const skillsRoot = path.join(__dirname, '..', 'skills');
const projectRoot = path.join(__dirname, '..');
const auditLog = createAuditLog(projectRoot);
const skillLoader = new SkillLoader(skillsRoot, auditLog);
skillLoader.load();
const skillResolver = new SkillResolver(skillLoader);

// Tool que o LLM pode chamar quando o usuário perguntar sobre skills disponíveis
registry.register({
    name: "list_installed_skills",
    description: "Lista apenas skills instaladas via SkillLoader (internas/públicas). Nao lista tools nativas do sistema. Use quando o usuario perguntar especificamente sobre skills.",
    parameters: { type: "object", properties: {}, required: [] }
}, {
    execute: async () => {
        const skills = skillLoader.getAll();
        if (skills.length === 0) {
            return t('index.skills.none');
        }
        const lines = skills.map(s => {
            const origin = s.origin === 'internal' ? 'interna' : 'pública';
            return `• ${s.name} (${origin}) — ${s.description || 'sem descrição'}`;
        });
        return `Skills instaladas (${skills.length}):\n${lines.join('\n')}\n\nObservacao: esta listagem mostra skills carregadas. Tools nativas (ex.: read_local_file, list_directory, write_file) sao listadas em list_available_tools.`;
    }
});

// Tool para listar todas as tools disponíveis no registry (inclui nativas e registradas em runtime)
registry.register({
    name: "list_available_tools",
    description: "Lista todas as tools disponiveis para chamada do LLM no momento atual, incluindo tools nativas e tools registradas em runtime.",
    parameters: { type: "object", properties: {}, required: [] }
}, {
    execute: async () => {
        const defs = registry.getDefinitions();
        if (!defs.length) {
            return t('index.tools.none');
        }
        const lines = defs
            .map(d => `• ${d.name} — ${d.description || 'sem descricao'}`)
            .sort((a, b) => a.localeCompare(b, 'pt-BR'));
        return `Tools disponiveis (${defs.length}):\n${lines.join('\n')}`;
    }
});

// Tool para recarregar skills após instalação (hot-reload)
registry.register({
    name: "memory.store",
    description: "Armazena memoria persistente de forma explicita no grafo cognitivo + embeddings.",
    parameters: {
        type: "object",
        properties: {
            content: { type: "string", description: "Conteudo textual da memoria." },
            session_id: { type: "string", description: "Sessao associada a memoria." },
            project_id: { type: "string", description: "Projeto associado (opcional)." },
            type: {
                type: "string",
                enum: ["user_profile", "project", "decision", "episodic", "semantic", "error_fix", "skill_usage"],
                description: "Tipo da memoria."
            }
        },
        required: ["content"]
    }
}, {
    execute: async (args: any) => {
        const type = args?.type as MemoryType | undefined;
        const result = await memoryLifecycle.storeExplicit(
            String(args?.content || ''),
            {
                sessionId: String(args?.session_id || 'tool:memory.store'),
                role: 'assistant',
                projectId: args?.project_id ? String(args.project_id) : undefined
            },
            type
        );

        if (!result.stored) {
            return t('index.memory.not_stored', { reason: result.reason });
        }

        return t('index.memory.stored', {
            action: result.action,
            id: result.memoryId,
            type: result.type,
            score: result.score.toFixed(2)
        });
    }
});

registry.register({
    name: "memory.query",
    description: "Consulta memoria semantica usando busca hibrida vetorial + grafo.",
    parameters: {
        type: "object",
        properties: {
            query: { type: "string", description: "Pergunta ou termo de busca." },
            limit: { type: "number", description: "Quantidade maxima de memorias no retorno." }
        },
        required: ["query"]
    }
}, {
    execute: async (args: any) => {
        const limit = Number(args?.limit || 5);
        const memories = await memoryLifecycle.queryMemory(String(args?.query || ''), { limit });
        if (!memories.length) {
            return t('index.memory.none');
        }

        const lines = memories.map((memoryItem, index) =>
            `${index + 1}. [${memoryItem.type}] score=${memoryItem.finalScore.toFixed(3)} :: ${memoryItem.content.slice(0, 220)}`
        );
        return t('index.memory.found', { count: memories.length, lines: lines.join('\n') });
    }
});

registry.register({
    name: "reload_skills",
    description: "Recarrega as skills do disco após uma nova instalação. Use após write_skill_file e run_skill_auditor para ativar a skill sem reiniciar o agente.",
    parameters: { type: "object", properties: {}, required: [] }
}, {
    execute: async () => {
        auditLog.reload();
        const skills = skillLoader.load();
        return t('index.reload.success', {
            count: skills.length,
            names: skills.map(s => s.name).join(', ')
        });
    }
});

registry.register({
    name: "finalize_public_skill_install",
    description: "Finaliza instalacao de skill publica auditada: valida auditoria em temp, promove para public, recarrega runtime e indexa no grafo cognitivo.",
    parameters: {
        type: "object",
        properties: {
            skill_name: { type: "string", description: "Nome da skill publica em skills/temp/<skill_name>" },
            source: { type: "string", description: "Origem da skill (skills.sh, GitHub, etc)" },
            description: { type: "string", description: "Descricao resumida para indexacao cognitiva" },
            allow_warning: { type: "boolean", description: "Quando true, permite finalizar instalacao com auditoria em status warning" }
        },
        required: ["skill_name"]
    }
}, {
    execute: async (args: any) => {
        const safeName = String(args.skill_name || '').trim().toLowerCase().replace(/[^a-z0-9\-_]/g, '');
        if (!safeName) {
            return t('index.skill.invalid_name');
        }

        const tempDir = path.join(projectRoot, 'skills', 'temp', safeName);
        const publicDir = path.join(projectRoot, 'skills', 'public', safeName);
        if (!fs.existsSync(tempDir)) {
            return t('index.skill.temp_not_found', { name: safeName });
        }

        const logPath = path.join(projectRoot, 'data', 'skill-audit-log.json');
        if (!fs.existsSync(logPath)) {
            return t('index.skill.audit_missing', { name: safeName });
        }

        const lines = fs.readFileSync(logPath, 'utf8').split('\n').map(l => l.trim()).filter(Boolean);
        let lastEntry: any = null;
        for (const line of lines) {
            try {
                const entry = JSON.parse(line);
                if (entry.skill === safeName) {
                    lastEntry = entry;
                }
            } catch {
                // ignore malformed lines
            }
        }

        if (!lastEntry) {
            return t('index.skill.audit_not_found', { name: safeName });
        }

        const lifecycleStatus = String(lastEntry.lifecycle_status || '').toLowerCase();
        if (lifecycleStatus === 'blocked' || lifecycleStatus === 'review') {
            fs.rmSync(tempDir, { recursive: true, force: true });
            return t('index.skill.install_aborted', { name: safeName, status: lifecycleStatus });
        }
        if (lifecycleStatus === 'warning' && args.allow_warning !== true) {
            return t('index.skill.warning_requires_allow', { name: safeName });
        }

        if (fs.existsSync(publicDir)) {
            fs.rmSync(publicDir, { recursive: true, force: true });
        }
        fs.renameSync(tempDir, publicDir);

        auditLog.reload();
        const loaded = skillLoader.load();

        const skillJsonPath = path.join(publicDir, 'skill.json');
        let capabilities: string[] = [];
        let tools: string[] = [];
        if (fs.existsSync(skillJsonPath)) {
            try {
                const meta = JSON.parse(fs.readFileSync(skillJsonPath, 'utf8'));
                capabilities = Array.isArray(meta.capabilities) ? meta.capabilities : [];
                tools = Array.isArray(meta.requiredTools) ? meta.requiredTools : [];
            } catch {
                // ignore metadata parse failure
            }
        }

        await memory.upsertSkillGraph({
            skill_name: safeName,
            description: String(args.description || ''),
            capabilities,
            tools,
            source: String(args.source || lastEntry.source_dir || 'public-marketplace')
        });

        const active = loaded.some(s => s.name.toLowerCase() === safeName);
        return active
            ? t('index.skill.install_success', { name: safeName })
            : t('index.skill.promoted_not_active', { name: safeName });
    }
});

registry.register({
    name: "uninstall_public_skill",
    description: "Remove completamente uma skill publica: runtime, grafo cognitivo e filesystem, depois recarrega as skills.",
    parameters: {
        type: "object",
        properties: {
            skill_name: { type: "string", description: "Nome da skill publica a remover" }
        },
        required: ["skill_name"]
    }
}, {
    execute: async (args: any) => {
        const safeName = String(args.skill_name || '').trim().toLowerCase().replace(/[^a-z0-9\-_]/g, '');
        if (!safeName) {
            return t('index.skill.invalid_name');
        }

        const publicDir = path.join(projectRoot, 'skills', 'public', safeName);
        const tempDir = path.join(projectRoot, 'skills', 'temp', safeName);

        if (fs.existsSync(publicDir)) {
            fs.rmSync(publicDir, { recursive: true, force: true });
        }
        if (fs.existsSync(tempDir)) {
            fs.rmSync(tempDir, { recursive: true, force: true });
        }

        memory.removeSkillGraph(safeName);
        const removedOrphans = memory.cleanupOrphanSkillNodes();

        auditLog.reload();
        skillLoader.load();

        return t('index.skill.uninstalled', { name: safeName, count: removedOrphans });
    }
});

const onboardingService = new OnboardingService(dbManager.getDb());
const loop = new AgentLoop(provider, registry, decisionMemory);
const inputHandler = new TelegramInputHandler(onboardingService);
const outputHandler = new TelegramOutputHandler();

const controller = new AgentController(
    memory,
    contextBuilder,
    loop,
    inputHandler,
    outputHandler,
    skillResolver,
    memoryLifecycle
);

bootstrapCapabilities(capabilityRegistry, skillManager).catch((error) => {
    logger.error('capabilities_bootstrap_failed', error, t('log.index.capabilities_bootstrap_failed'));
});

dashboard.setController(controller);
dashboard.start();

let bot: Bot | undefined;

if (hasTelegramBotToken) {
    bot = new Bot(BOT_TOKEN!);

    bot.command('start', async (ctx) => {
        if (!ctx.from) return;
        const userId = ctx.from.id;

        const onboardingResult = inputHandler.checkOnboarding(userId);
        if (onboardingResult?.isOnboarding && onboardingResult.question) {
            await ctx.reply(onboardingResult.question, { parse_mode: onboardingResult.parseMode });
        } else if (onboardingResult?.isOnboarding) {
            await ctx.reply("🧠 *Olá! Eu sou o IalClaw*, seu Agente Cognitivo com memória persistente.\n\nVamos começar o onboarding! Qual o seu nome?", { parse_mode: 'Markdown' });
        } else {
            await ctx.reply("🧠 *Olá! Eu sou o IalClaw*, seu Agente Cognitivo com memória persistente.\n\nBem-vindo de volta! Como posso ajudar?", { parse_mode: 'Markdown' });
        }
    });

    bot.command('profile', async (ctx) => {
        if (!ctx.from) return;
        const profile = onboardingService.getUserProfile(String(ctx.from.id));
        
        if (profile?.onboarding_completed) {
            await ctx.reply(
                `👤 *Seu Perfil*\n\n` +
                `• Nome: ${profile.name || 'Não definido'}\n` +
                `• Área: ${profile.expertise || 'Não informada'}\n` +
                `• Estilo: ${profile.response_style}\n` +
                `• Aprendizado: ${profile.learning_mode}\n` +
                `• Autonomia: ${profile.autonomy_level}\n\n` +
                `_Digite /reset-onboarding para reconfigurar_`,
                { parse_mode: 'Markdown' }
            );
        } else {
            await ctx.reply("Onboarding não completado. Digite /start para começar!");
        }
    });

    bot.command('reset-onboarding', async (ctx) => {
        if (!ctx.from) return;
        onboardingService.resetOnboarding(String(ctx.from.id));
        const result = inputHandler.checkOnboarding(ctx.from.id);
        if (result?.isOnboarding && result.question) {
            await ctx.reply("🔄 *Onboarding resetado!*\n\n" + result.question, { parse_mode: result.parseMode });
        }
    });

    bot.on('message', async (ctx) => {
        if (ctx.message?.text === '/start' || ctx.message?.text === '/profile' || ctx.message?.text === '/reset-onboarding') return;
        if (!ctx.from) return;

        const userId = ctx.from.id;
        const onboardingState = onboardingService.getOnboardingState(String(userId));

        if (onboardingState || !onboardingService.isOnboardingCompleted(String(userId))) {
            const result = inputHandler.processOnboardingAnswer(userId, ctx.message?.text || '');
            
            if (result?.isOnboarding && result.question) {
                await ctx.reply(result.question, { parse_mode: result.parseMode });
            } else if (result?.completed && result.welcomeMessage) {
                await ctx.reply(result.welcomeMessage, { parse_mode: 'Markdown' });
            }
            return;
        }

        await controller.handleMessage(ctx);
    });

    bot.catch((err) => {
        logger.error('telegram_update_failed', err.error, t('log.index.telegram_update_failed'), {
            update_id: err.ctx.update.update_id
        });
    });

    // Registrar comandos no menu do Telegram (BotFather)
    bot.api.setMyCommands([
        { command: 'new', description: 'Iniciar nova conversa' },
        { command: 'help', description: 'Ver comandos disponíveis' },
        { command: 'status', description: 'Ver estado da sessão atual' },
        { command: 'start', description: 'Mensagem de boas-vindas' },
        { command: 'profile', description: 'Ver seu perfil' },
        { command: 'reset-onboarding', description: 'Refazer o onboarding' },
    ]).catch((err) => {
        logger.warn('set_commands_failed', t('log.index.set_commands_failed'), { error: String(err) });
    });

    logger.info('bot_starting', t('log.index.bot_starting'));
    bot.start();
} else {
    logger.warn('telegram_disabled', t('log.index.telegram_disabled'), {
        dashboard_url: 'http://localhost:3000',
        web_chat_enabled: true
    });
}

let shutdownInFlight = false;

async function shutdown(signal: 'SIGINT' | 'SIGTERM') {
    if (shutdownInFlight) {
        return;
    }

    shutdownInFlight = true;
    logger.info('shutdown_started', `Recebido ${signal}. Encerrando servicos...`);

    try {
        bot?.stop();
        await dashboard.stop();
    } catch (error: any) {
        logger.warn('shutdown_partial_failure', `Falha ao encerrar servicos: ${String(error?.message || error)}`);
    } finally {
        dbManager.close();
        process.exit(0);
    }
}

process.once('SIGINT', () => {
    void shutdown('SIGINT');
});
process.once('SIGTERM', () => {
    void shutdown('SIGTERM');
});
