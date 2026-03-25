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

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN || BOT_TOKEN === 'your_bot_token_here') {
    console.error('[Startup] ERRO: Token do Telegram não configurado no .env!');
    process.exit(1);
}

const dbManager = new DatabaseManager('db.sqlite');
console.log('[Startup] Banco de dados inicializado com sucesso.');
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
    console.error('[Startup] Falha ao fazer bootstrap de capabilities:', error.message);
});

dashboard.setController(controller);
dashboard.start();

const bot = new Bot(BOT_TOKEN);

bot.command('start', async (ctx) => {
    await ctx.reply("🧠 *Olá! Eu sou o IalClaw*, seu Agente Cognitivo com memória persistente.\n\nPara que eu crie o seu _Núcleo Principal de Identidade_ e lembre de você em nossas sessões, **qual o seu nome e como gostaria de ser chamado?**", { parse_mode: 'Markdown' });
});

bot.on('message', async (ctx) => {
    // /start já é tratado por bot.command acima.
    // Slash commands de skills (ex: /sandeco-maestro args) devem passar.
    if (ctx.message?.text === '/start') return;
    await controller.handleMessage(ctx);
});

bot.catch((err) => {
    console.error(`[Telegram] Error while handling update ${err.ctx.update.update_id}:`);
    console.error(err.error);
});

console.log('[Startup] Iniciando IalClaw Cognitive Agent v2.0 (Polling)...');
bot.start();

process.once('SIGINT', () => { bot.stop(); dbManager.close(); });
process.once('SIGTERM', () => { bot.stop(); dbManager.close(); });
