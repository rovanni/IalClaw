import { Context } from 'grammy';
import * as fs from 'fs';
import * as path from 'path';

export type CognitiveInputPayload = {
    text: string;
    source_type: 'text' | 'document' | 'audio';
    requires_audio_reply: boolean;
};

export class TelegramInputHandler {
    private allowedUsers: Set<number>;

    constructor() {
        const ids = process.env.TELEGRAM_ALLOWED_USER_IDS || '';
        this.allowedUsers = new Set(ids.split(',').map(id => parseInt(id.trim())));
    }

    public isUserAllowed(ctx: Context): boolean {
        if (!ctx.from) return false;
        return this.allowedUsers.has(ctx.from.id);
    }

    public async processUpdate(ctx: Context): Promise<CognitiveInputPayload | null> {
        if (!this.isUserAllowed(ctx)) {
            console.log(`[InputHandler] Unauthorized access attempt from user ${ctx.from?.id}`);
            return null;
        }

        // Handing text messages
        if (ctx.message?.text) {
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
            await ctx.reply("Documento recebido. O IalClaw em breve irá indexá-lo na memória semântica.");

            return {
                text: `Process please document: ${doc.file_name}`,
                source_type: 'document',
                requires_audio_reply: false
            };
        }

        // Handling audio/voice
        if (ctx.message?.voice || ctx.message?.audio) {
            await ctx.replyWithChatAction('record_voice');
            return {
                text: "Process please user voice message (transcription placeholder)",
                source_type: 'audio',
                requires_audio_reply: true
            };
        }

        await ctx.reply("Formato não suportado.");
        return null;
    }
}
