import { Bot } from 'grammy';
import * as dotenv from 'dotenv';
import { DatabaseManager } from './db/DatabaseManager';
import { CognitiveMemory } from './memory/CognitiveMemory';
import { ContextBuilder } from './memory/ContextBuilder';
import { AgentLoop } from './engine/AgentLoop';
import { ProviderFactory } from './engine/ProviderFactory';
import { SkillRegistry } from './engine/SkillRegistry';
import { TelegramInputHandler } from './telegram/TelegramInputHandler';
import { TelegramOutputHandler } from './telegram/TelegramOutputHandler';
import { AgentController } from './core/AgentController';

dotenv.config();

const BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;

if (!BOT_TOKEN || BOT_TOKEN === 'your_bot_token_here') {
    console.error('[Startup] ERRO: Token do Telegram não configurado no .env!');
    process.exit(1);
}

const dbManager = new DatabaseManager('db.sqlite');
console.log('[Startup] Banco de dados inicializado com sucesso.');

// Iniciar Sonho/Consolidação
import { MemoryDreamer } from './memory/MemoryDreamer';
const dreamer = new MemoryDreamer(dbManager.getDb());
dreamer.dream();
setInterval(() => dreamer.dream(), 1000 * 60 * 60 * 24);

// Iniciar Dashboard Web
import { DashboardServer } from './dashboard/DashboardServer';
const dashboard = new DashboardServer(dbManager.getDb());
dashboard.start();

const provider = ProviderFactory.getProvider();
const memory = new CognitiveMemory(dbManager.getDb(), provider);
const contextBuilder = new ContextBuilder();
const registry = new SkillRegistry();

const loop = new AgentLoop(provider, registry);
const inputHandler = new TelegramInputHandler();
const outputHandler = new TelegramOutputHandler();

const controller = new AgentController(
    memory,
    contextBuilder,
    loop,
    inputHandler,
    outputHandler
);

const bot = new Bot(BOT_TOKEN);

bot.on('message', async (ctx) => {
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
