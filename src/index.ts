// Silencia output do dotenv antes de qualquer import
process.env.DOTENV_CONFIG_QUIET = 'true';

import { Bot } from 'grammy';
import * as dotenv from 'dotenv';
import * as path from 'path';
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

dotenv.config({ debug: false });

// ── Banner de inicialização ──────────────────────────────────────────────────
{
    const RESET = '\x1b[0m';
    const CYAN = '\x1b[36m';
    const GREEN = '\x1b[32m';
    const DIM = '\x1b[2m';

    const pkg = require('../package.json');
    const version = pkg.version || '0.0.0';
    const logLevel = (process.env.LOG_LEVEL || 'info').toLowerCase();
    const mode = logLevel === 'debug' ? 'dev:debug' : 'dev';
    const channel = process.env.TELEGRAM_BOT_TOKEN && process.env.TELEGRAM_BOT_TOKEN !== 'your_bot_token_here'
        ? 'telegram + web'
        : 'web only';
    const model = process.env.OLLAMA_MODEL || process.env.MODEL || 'llama3.2';

    console.log('');
    console.log(`${CYAN}  🐙 IALCLAW${RESET} ${DIM}v${version}${RESET}`);
    console.log(`${DIM}  ─────────────────────────────────${RESET}`);
    console.log(`  modo:    ${GREEN}${mode}${RESET}`);
    console.log(`  canal:   ${GREEN}${channel}${RESET}`);
    console.log(`  modelo:  ${GREEN}${model}${RESET}`);
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

const dbManager = new DatabaseManager('db.sqlite');
logger.info('database_initialized', 'Banco de dados inicializado com sucesso.');
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
    description: "Lista todas as skills (habilidades/capacidades) instaladas e disponíveis no agente. Use quando o usuário perguntar quais skills, capacidades ou habilidades estão disponíveis.",
    parameters: { type: "object", properties: {}, required: [] }
}, {
    execute: async () => {
        const skills = skillLoader.getAll();
        if (skills.length === 0) {
            return "Nenhuma skill instalada no momento.";
        }
        const lines = skills.map(s => {
            const origin = s.origin === 'internal' ? 'interna' : 'pública';
            return `• ${s.name} (${origin}) — ${s.description || 'sem descrição'}`;
        });
        return `Skills instaladas (${skills.length}):\n${lines.join('\n')}`;
    }
});

// Tool para recarregar skills após instalação (hot-reload)
registry.register({
    name: "reload_skills",
    description: "Recarrega as skills do disco após uma nova instalação. Use após write_skill_file e run_skill_auditor para ativar a skill sem reiniciar o agente.",
    parameters: { type: "object", properties: {}, required: [] }
}, {
    execute: async () => {
        auditLog.reload();
        const skills = skillLoader.load();
        return `Skills recarregadas com sucesso. ${skills.length} skill(s) ativa(s): ${skills.map(s => s.name).join(', ')}`;
    }
});

const loop = new AgentLoop(provider, registry);
const inputHandler = new TelegramInputHandler();
const outputHandler = new TelegramOutputHandler();

const controller = new AgentController(
    memory,
    contextBuilder,
    loop,
    inputHandler,
    outputHandler,
    skillResolver
);

bootstrapCapabilities(capabilityRegistry, skillManager).catch((error) => {
    logger.error('capabilities_bootstrap_failed', error, 'Falha ao fazer bootstrap de capabilities.');
});

dashboard.setController(controller);
dashboard.start();

let bot: Bot | undefined;

if (hasTelegramBotToken) {
    bot = new Bot(BOT_TOKEN!);

    bot.command('start', async (ctx) => {
        await ctx.reply("🧠 *Olá! Eu sou o IalClaw*, seu Agente Cognitivo com memória persistente.\n\nPara que eu crie o seu _Núcleo Principal de Identidade_ e lembre de você em nossas sessões, **qual o seu nome e como gostaria de ser chamado?**", { parse_mode: 'Markdown' });
    });

    bot.on('message', async (ctx) => {
        if (ctx.message?.text === '/start') return;
        await controller.handleMessage(ctx);
    });

    bot.catch((err) => {
        logger.error('telegram_update_failed', err.error, 'Erro ao processar update do Telegram.', {
            update_id: err.ctx.update.update_id
        });
    });

    logger.info('bot_starting', 'Iniciando IalClaw Cognitive Agent (Polling).');
    bot.start();
} else {
    logger.warn('telegram_disabled', 'TELEGRAM_BOT_TOKEN ausente. Iniciando em modo local via dashboard/web chat.', {
        dashboard_url: 'http://localhost:3000',
        web_chat_enabled: true
    });
}

process.once('SIGINT', () => {
    bot?.stop();
    dbManager.close();
});
process.once('SIGTERM', () => {
    bot?.stop();
    dbManager.close();
});
