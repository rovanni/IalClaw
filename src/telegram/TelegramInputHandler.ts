import { Context } from 'grammy';
import * as fs from 'fs';
import * as path from 'path';
import { createLogger } from '../shared/AppLogger';
import { t } from '../i18n';
import { OnboardingService } from '../services/OnboardingService';

export type CognitiveInputPayload = {
    text: string;
    source_type: 'text' | 'document' | 'audio';
    requires_audio_reply: boolean;
};

export type OnboardingPayload = {
    isOnboarding: boolean;
    question?: string;
    parseMode?: 'Markdown' | 'HTML';
    completed?: boolean;
    welcomeMessage?: string;
};

export class TelegramInputHandler {
    private allowedUsers: Set<number>;
    private logger = createLogger('TelegramInputHandler');
    private onboardingService: OnboardingService | null = null;

    constructor(onboardingService?: OnboardingService) {
        const ids = process.env.TELEGRAM_ALLOWED_USER_IDS || '';
        this.allowedUsers = new Set(ids.split(',').map(id => parseInt(id.trim())));
        this.onboardingService = onboardingService || null;
        this.logger.info('configured', t('log.telegram.input.configured'), {
            allowed_users_count: Array.from(this.allowedUsers).filter((id) => !Number.isNaN(id)).length
        });
    }

    public isUserAllowed(ctx: Context): boolean {
        if (!ctx.from) return false;
        return this.allowedUsers.has(ctx.from.id);
    }

    public checkOnboarding(userId: string | number): OnboardingPayload | null {
        if (!this.onboardingService) return null;

        const uid = String(userId);
        const state = this.onboardingService.getOnboardingState(uid);

        if (state) {
            return { isOnboarding: true };
        }

        if (!this.onboardingService.isOnboardingCompleted(uid)) {
            const result = this.onboardingService.startOnboarding(uid);
            if (result) {
                return {
                    isOnboarding: true,
                    question: result.question,
                    parseMode: result.parseMode
                };
            }
        }

        return null;
    }

    public processOnboardingAnswer(userId: string | number, answer: string): OnboardingPayload | null {
        if (!this.onboardingService) return null;

        const uid = String(userId);
        const result = this.onboardingService.processOnboardingAnswer(uid, answer);

        if (!result) return null;

        if (result.completed) {
            return {
                isOnboarding: false,
                completed: true,
                welcomeMessage: result.welcomeMessage
            };
        }

        return {
            isOnboarding: true,
            question: result.question,
            parseMode: result.parseMode
        };
    }

    public async processUpdate(ctx: Context): Promise<CognitiveInputPayload | null> {
        const userId = ctx.from?.id;
        const chatId = ctx.chat?.id;

        if (!this.isUserAllowed(ctx)) {
            this.logger.warn('unauthorized_user', t('log.telegram.input.unauthorized_user'), {
                telegram_user_id: userId,
                telegram_chat_id: chatId
            });
            return null;
        }

        // Handing text messages
        if (ctx.message?.text) {
            this.logger.info('text_message_received', t('log.telegram.input.text_received'), {
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
            this.logger.info('document_received', t('log.telegram.input.document_received'), {
                telegram_user_id: userId,
                telegram_chat_id: chatId,
                file_name: doc.file_name,
                mime_type: doc.mime_type,
                file_size: doc.file_size
            });
            await ctx.reply(t('telegram.input.document_received_reply'));

            return {
                text: t('telegram.input.process_document', { filename: doc.file_name }),
                source_type: 'document',
                requires_audio_reply: false
            };
        }

        // Handling audio/voice
        if (ctx.message?.voice || ctx.message?.audio) {
            this.logger.info('audio_received', t('log.telegram.input.audio_received'), {
                telegram_user_id: userId,
                telegram_chat_id: chatId,
                kind: ctx.message.voice ? 'voice' : 'audio'
            });
            await ctx.replyWithChatAction('record_voice');
            return {
                text: t('telegram.input.process_voice_placeholder'),
                source_type: 'audio',
                requires_audio_reply: true
            };
        }

        this.logger.warn('unsupported_message', t('log.telegram.input.unsupported_message'), {
            telegram_user_id: userId,
            telegram_chat_id: chatId,
            has_text: Boolean(ctx.message?.text),
            has_document: Boolean(ctx.message?.document),
            has_voice: Boolean(ctx.message?.voice),
            has_audio: Boolean(ctx.message?.audio)
        });
        await ctx.reply(t('telegram.input.unsupported_reply'));
        return null;
    }
}
