import { Context } from 'grammy';
import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import { createLogger } from '../shared/AppLogger';
import { t } from '../i18n';
import { OnboardingService } from '../services/OnboardingService';
import { capabilityRegistry } from '../capabilities';

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
    private allowedUsers: Set<string>;
    private logger = createLogger('TelegramInputHandler');
    private onboardingService: OnboardingService | null = null;

    constructor(onboardingService?: OnboardingService) {
        const ids = process.env.TELEGRAM_ALLOWED_USER_IDS || '';
        this.allowedUsers = new Set(ids.split(',').map(id => id.trim()).filter(Boolean));
        this.onboardingService = onboardingService || null;
        this.logger.info('configured', t('log.telegram.input.configured'), {
            allowed_users: Array.from(this.allowedUsers),
            allowed_users_count: this.allowedUsers.size
        });
    }

    public isUserAllowed(ctx: Context): boolean {
        if (!ctx.from) return false;
        return this.allowedUsers.has(String(ctx.from.id));
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

        // Handling text messages
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
            const audioData = ctx.message.voice || ctx.message.audio;
            if (audioData) {
                this.logger.info('audio_received', t('log.telegram.input.audio_received'), {
                    telegram_user_id: userId,
                    telegram_chat_id: chatId,
                    kind: ctx.message.voice ? 'voice' : 'audio',
                    file_id: audioData.file_id
                });

                await ctx.replyWithChatAction('record_voice');

                if (!capabilityRegistry.isAvailable('whisper_transcription')) {
                    this.logger.warn('whisper_missing', 'Whisper transcription capability is not available');

                    const missingMessage = `
🧠 **Capability Gap Detected**: Audio Transcription

I understand you sent an audio message, but I currently cannot process it because required dependencies are missing.

**Missing:**
- **Whisper** (speech-to-text)
- **FFmpeg** (audio processing)

You can fix this by running:
\`\`\`bash
pip install openai-whisper
sudo apt install ffmpeg
\`\`\`

Or just say: "**install audio support**" and I will try to handle it for you.
`;
                    return {
                        text: missingMessage,
                        source_type: 'audio',
                        requires_audio_reply: false
                    };
                }

                try {
                    const fileName = ctx.message.voice ? 'voice_input.ogg' : 'audio_input.ogg';
                    const destPath = path.join(process.cwd(), 'workspace', 'audios', 'inputs', fileName);
                    await this.downloadTelegramFile(ctx, audioData.file_id, destPath);

                    this.logger.info('audio_downloaded', 'Audio downloaded successfully', { path: destPath });

                    return {
                        text: `Process please user voice message at workspace/audios/inputs/${fileName}`,
                        source_type: 'audio',
                        requires_audio_reply: true
                    };
                } catch (err: any) {
                    this.logger.error('audio_download_failed', err, 'Failed to download telegram audio');
                    // Fallback to placeholder if download fails
                    return {
                        text: t('telegram.input.process_voice_placeholder'),
                        source_type: 'audio',
                        requires_audio_reply: true
                    };
                }
            }
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

    private async downloadTelegramFile(ctx: Context, fileId: string, destPath: string): Promise<void> {
        const file = await ctx.api.getFile(fileId);
        const token = process.env.TELEGRAM_BOT_TOKEN;
        const url = `https://api.telegram.org/file/bot${token}/${file.file_path}`;

        const dir = path.dirname(destPath);
        if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
        }

        return new Promise((resolve, reject) => {
            const fileStream = fs.createWriteStream(destPath);
            https.get(url, response => {
                if (response.statusCode !== 200) {
                    reject(new Error(`Failed to download file: ${response.statusCode}`));
                    fileStream.close();
                    return;
                }
                response.pipe(fileStream);
                fileStream.on('finish', () => {
                    fileStream.close();
                    resolve();
                });
            }).on('error', err => {
                fileStream.close();
                fs.unlink(destPath, () => { });
                reject(err);
            });
        });
    }
}
