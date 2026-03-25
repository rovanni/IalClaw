import { Context } from 'grammy';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../shared/AppLogger';

export type CognitiveInputPayload = {
    text: string;
    source_type: 'text' | 'document' | 'audio';
    requires_audio_reply: boolean;
};

export class TelegramInputHandler {
    private allowedUsers: Set<number>;
    private logger = createLogger('TelegramInputHandler');

    constructor() {
        const ids = process.env.TELEGRAM_ALLOWED_USER_IDS || '';
        this.allowedUsers = new Set(ids.split(',').map(id => parseInt(id.trim())));
        this.logger.info('configured', 'Whitelist de usuarios do Telegram carregada.', {
            allowed_users_count: Array.from(this.allowedUsers).filter((id) => !Number.isNaN(id)).length
        });
    }

    public isUserAllowed(ctx: Context): boolean {
        if (!ctx.from) return false;
        return this.allowedUsers.has(ctx.from.id);
    }

    public async processUpdate(ctx: Context): Promise<CognitiveInputPayload | null> {
        const userId = ctx.from?.id;
        const chatId = ctx.chat?.id;

        if (!this.isUserAllowed(ctx)) {
            this.logger.warn('unauthorized_user', 'Tentativa de acesso nao autorizada no Telegram.', {
                telegram_user_id: userId,
                telegram_chat_id: chatId
            });
            return null;
        }

        // Handing text messages
        if (ctx.message?.text) {
            this.logger.info('text_message_received', 'Mensagem de texto recebida do Telegram.', {
                telegram_user_id: userId,
                telegram_chat_id: chatId,
                text_length: ctx.message.text.length
            });
            await ctx.replyWithChatAction('typing');
            return {
                text: ctx.message.text,
                source_type: 'text',
                requires_audio_reply: false
            };
        }

        // Handling documents (e.g. .md uploads)
        // Note: The download logic requires grammy's files plugin or raw bot.getFile logic.
        // Simplifying for this foundational spec:
        if (ctx.message?.document) {
            const doc = ctx.message.document;
            this.logger.info('document_received', 'Documento recebido do Telegram.', {
                telegram_user_id: userId,
                telegram_chat_id: chatId,
                file_name: doc.file_name,
                mime_type: doc.mime_type,
                file_size: doc.file_size
            });
            await ctx.reply("Documento recebido. O IalClaw em breve irá indexá-lo na memória semântica.");

            return {
                text: `Process please document: ${doc.file_name}`,
                source_type: 'document',
                requires_audio_reply: false
            };
        }

        // Handling audio/voice
        if (ctx.message?.voice || ctx.message?.audio) {
            this.logger.info('audio_received', 'Mensagem de audio recebida do Telegram.', {
                telegram_user_id: userId,
                telegram_chat_id: chatId,
                kind: ctx.message.voice ? 'voice' : 'audio'
            });
            await ctx.replyWithChatAction('record_voice');
            return {
                text: "Process please user voice message (transcription placeholder)",
                source_type: 'audio',
                requires_audio_reply: true
            };
        }

        this.logger.warn('unsupported_message', 'Formato de mensagem nao suportado no Telegram.', {
            telegram_user_id: userId,
            telegram_chat_id: chatId,
            has_text: Boolean(ctx.message?.text),
            has_document: Boolean(ctx.message?.document),
            has_voice: Boolean(ctx.message?.voice),
            has_audio: Boolean(ctx.message?.audio)
        });
        await ctx.reply("Formato não suportado.");
        return null;
    }
}
