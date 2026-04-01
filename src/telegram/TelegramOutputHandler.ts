import fs from 'fs';
import path from 'path';
import { execSync } from 'child_process';
import { Context, InputFile } from 'grammy';
import { SessionManager } from '../shared/SessionManager';
import { workspaceService } from '../services/WorkspaceService';
import { createLogger } from '../shared/AppLogger';
import { t } from '../i18n';
import { capabilityRegistry } from '../capabilities';
import { findBinary } from '../shared/BinaryUtils';

export class TelegramOutputHandler {
    private logger = createLogger('TelegramOutputHandler');
    private readonly MAX_RETRIES = 3;
    private readonly REPLY_TIMEOUT_MS = 10000; // 10 segundos

    private sanitizeOutput(text: string): string {
        if (!text) return text;
        return text
            .replace(/capabilitygapdetected/gi, "Ainda não tenho suporte completo para essa ação, mas posso tentar uma alternativa.")
            .replace(/fallback/gi, "")
            .replace(/Sem resposta do Ollama\.?/gi, "Tive um problema ao processar. Deseja que eu continue?");
    }

    public async sendResponse(ctx: Context, response: string, requiresAudio: boolean = false) {
        response = this.sanitizeOutput(response);

        if (requiresAudio) {
            if (!capabilityRegistry.isAvailable('tts_generation')) {
                this.logger.warn('tts_missing', 'TTS generation capability is not available');
                await this.sendTextChunks(ctx, `${t('telegram.output.audio_fallback_prefix')}\n${response}`);
                return;
            }

            try {
                const audiosDir = path.join(process.cwd(), 'workspace', 'audios', 'outputs');
                if (!fs.existsSync(audiosDir)) {
                    fs.mkdirSync(audiosDir, { recursive: true });
                }

                const mp3Path = path.join(audiosDir, 'output.mp3');
                const oggPath = path.join(audiosDir, 'output.ogg');

                // Cleanup previous files
                if (fs.existsSync(mp3Path)) fs.unlinkSync(mp3Path);
                if (fs.existsSync(oggPath)) fs.unlinkSync(oggPath);

                // 0. Resolve Tools & Paths
                const ffmpeg = findBinary('ffmpeg') || 'ffmpeg';
                let ttsScript = process.env.TTS_SCRIPT_PATH || '';
                if (!ttsScript || !fs.existsSync(ttsScript)) {
                    const workspaceScript = path.join(process.cwd(), "workspace", "scripts", "tts.sh");
                    const scriptsFolderScript = path.join(process.cwd(), "scripts", "tts.sh");
                    ttsScript = fs.existsSync(workspaceScript) ? workspaceScript : scriptsFolderScript;
                }

                this.logger.debug('generating_tts', 'Generating TTS...', { script: ttsScript });

                // 1. Generate Speech
                const escapedResponse = response.replace(/"/g, '\\"').replace(/\n/g, ' ');
                execSync(`bash "${ttsScript}" "${escapedResponse}" "${mp3Path}"`, { stdio: 'ignore' });

                if (!fs.existsSync(mp3Path)) {
                    throw new Error('TTS script failed to generate MP3 file');
                }

                // 2. Convert to OGG Opus (Telegram Voice format)
                execSync(`"${ffmpeg}" -y -i "${mp3Path}" -c:a libopus "${oggPath}"`, { stdio: 'ignore' });

                if (!fs.existsSync(oggPath)) {
                    throw new Error('FFmpeg failed to convert MP3 to OGG');
                }

                // 3. Send as Voice
                await ctx.replyWithVoice(new InputFile(oggPath));

                this.logger.info('voice_sent', 'Voice response sent successfully');
                return;
            } catch (err: any) {
                this.logger.error('voice_generation_failed', err, 'Failed to generate or send voice response');
                // Fallback to text
                await this.sendTextChunks(ctx, `${t('telegram.output.audio_fallback_prefix')}\n${response}`);
                return;
            }
        }

        const attachment = this.resolveArtifactAttachment();
        const finalResponse = attachment
            ? `${response}\n\n${t('telegram.output.attachment_notice', { filename: attachment.filename })}`
            : response;

        // Detecting huge Markdown outputs to send as files
        if (finalResponse.length > 2000 && finalResponse.includes('```')) {
            // Simplifying: just send as chunked text instead of creating a file to avoid disk IO overhead unless needed
            await this.sendTextChunks(ctx, finalResponse);
            if (attachment) {
                await this.sendAttachment(ctx, attachment.filePath, attachment.filename);
            }
            return;
        }

        await this.sendTextChunks(ctx, finalResponse);

        if (attachment) {
            await this.sendAttachment(ctx, attachment.filePath, attachment.filename);
        }
    }

    private async sendTextChunks(ctx: Context, text: string) {
        const CHUNK_SIZE = 4000;
        for (let i = 0; i < text.length; i += CHUNK_SIZE) {
            const chunk = text.substring(i, i + CHUNK_SIZE);
            const chunkIndex = Math.floor(i / CHUNK_SIZE);

            // Retry automático com backoff
            let lastError: Error | null = null;
            for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
                try {
                    await Promise.race([
                        ctx.reply(chunk, { parse_mode: 'Markdown' }),
                        this.createTimeoutPromise(this.REPLY_TIMEOUT_MS)
                    ]);
                    this.logger.debug('chunk_sent', t('log.telegram.output.chunk_sent'), {
                        chunk_index: chunkIndex,
                        chunk_size: chunk.length,
                        attempt: attempt + 1
                    });
                    break; // Sucesso, sair do retry loop do attempt
                } catch (err: any) {
                    lastError = err;

                    // Se for erro de parse do Telegram (Markdown), tentar novamente IMEDIATAMENTE sem Markdown
                    if (err.message?.includes('can\'t parse entities') || err.message?.includes('bad request')) {
                        this.logger.warn('markdown_parse_failed_instant_fallback', 'Markdown parse failed, falling back to plain text', { error: err.message });
                        try {
                            await Promise.race([
                                ctx.reply(chunk),
                                this.createTimeoutPromise(this.REPLY_TIMEOUT_MS)
                            ]);
                            break; // Sucesso no fallback, sai do retry loop do chunk
                        } catch (fallbackErr: any) {
                            this.logger.error('instant_fallback_failed', fallbackErr);
                        }
                    }

                    this.logger.warn('chunk_send_retry', t('log.telegram.output.chunk_retry'), {
                        chunk_index: chunkIndex,
                        attempt: attempt + 1,
                        max_retries: this.MAX_RETRIES,
                        error_message: err.message
                    });

                    if (attempt === this.MAX_RETRIES - 1) {
                        this.logger.error('chunk_send_failed', err, t('log.telegram.output.chunk_failed'), {
                            chunk_index: chunkIndex,
                            chunk_preview: chunk.substring(0, 100),
                            total_attempts: this.MAX_RETRIES
                        });

                        // Fallback final: tentar enviar sem Markdown (se ainda não tentou)
                        try {
                            await Promise.race([
                                ctx.reply(chunk),
                                this.createTimeoutPromise(this.REPLY_TIMEOUT_MS)
                            ]);
                            this.logger.info('chunk_sent_fallback', t('log.telegram.output.chunk_fallback_sent'));
                            break;
                        } catch (fallbackErr: any) {
                            this.logger.error('chunk_fallback_failed', fallbackErr, t('log.telegram.output.chunk_fallback_failed'));
                            await this.saveResponseToFallbackFile(chunk, ctx.chat?.id.toString());
                            throw new Error(t('telegram.output.error.critical_send_failed', { message: lastError?.message }));
                        }
                    }

                    // Backoff exponencial: 1s, 2s, 4s
                    await this.sleep(Math.pow(2, attempt) * 1000);
                }
            }
        }
    }

    private resolveArtifactAttachment(): { filePath: string; filename: string } | null {
        const session = SessionManager.getCurrentSession();
        const projectId = session?.current_project_id;
        const artifacts = session?.last_artifacts || [];

        if (!projectId || artifacts.length === 0) {
            return null;
        }

        const metadata = workspaceService.readProjectMetadata(projectId);
        if (!metadata || (metadata.type !== 'slides' && metadata.type !== 'document')) {
            return null;
        }

        const preferredArtifact = [...artifacts].reverse().find(filename => /\.(html?|pdf|md)$/i.test(filename)) || artifacts[artifacts.length - 1];
        if (!preferredArtifact) {
            return null;
        }

        const filePath = path.join(workspaceService.getProjectOutputPath(projectId), preferredArtifact);
        if (!fs.existsSync(filePath)) {
            return null;
        }

        return {
            filePath,
            filename: path.basename(preferredArtifact)
        };
    }

    private async sendAttachment(ctx: Context, filePath: string, filename: string) {
        // Retry automático para anexos
        let lastError: Error | null = null;
        for (let attempt = 0; attempt < this.MAX_RETRIES; attempt++) {
            try {
                await Promise.race([
                    (ctx as any).replyWithDocument(new InputFile(filePath, filename), {
                        caption: t('telegram.output.attachment_caption', { filename })
                    }),
                    this.createTimeoutPromise(this.REPLY_TIMEOUT_MS * 2) // Dobro do timeout para arquivos
                ]);
                this.logger.info('attachment_sent', t('log.telegram.output.attachment_sent'), {
                    filename,
                    attempt: attempt + 1
                });
                return; // Sucesso
            } catch (err: any) {
                lastError = err;
                this.logger.warn('attachment_send_retry', t('log.telegram.output.attachment_retry'), {
                    filename,
                    attempt: attempt + 1,
                    max_retries: this.MAX_RETRIES,
                    error_message: err.message
                });

                if (attempt === this.MAX_RETRIES - 1) {
                    this.logger.error('attachment_send_failed', err, t('log.telegram.output.attachment_failed'), {
                        filename,
                        total_attempts: this.MAX_RETRIES
                    });
                    // Não lançar erro, apenas logar - o texto principal já foi enviado
                    return;
                }

                // Backoff exponencial
                await this.sleep(Math.pow(2, attempt) * 1000);
            }
        }
    }

    private createTimeoutPromise(ms: number): Promise<never> {
        return new Promise((_, reject) => {
            setTimeout(() => reject(new Error(t('telegram.output.error.timeout_exceeded', { ms }))), ms);
        });
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    private async saveResponseToFallbackFile(response: string, chatId?: string): Promise<void> {
        try {
            const logsDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) {
                fs.mkdirSync(logsDir, { recursive: true });
            }

            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const filename = `failed-response-${chatId || 'unknown'}-${timestamp}.txt`;
            const filepath = path.join(logsDir, filename);

            const content = `[IALCLAW] RESPOSTA NÃO ENTREGUE\nData: ${new Date().toISOString()}\nChat ID: ${chatId || 'desconhecido'}\n\n${response}`;

            fs.writeFileSync(filepath, content, 'utf-8');

            this.logger.error('response_saved_to_file', null, t('log.telegram.output.response_saved_to_file'), {
                filepath,
                chat_id: chatId,
                response_length: response.length
            });

            console.error(`\n[IALCLAW] ⚠️  FALHA CRÍTICA: Impossível enviar resposta ao usuário.`);
            console.error(`[IALCLAW] 💾 Resposta salva em: ${filepath}`);
            console.error(`[IALCLAW] 📝 Comprimento: ${response.length} caracteres\n`);
        } catch (err: any) {
            this.logger.error('fallback_file_save_failed', err, t('log.telegram.output.fallback_file_save_failed'));
            console.error(t('telegram.output.error.catastrophic_save_failed'));
        }
    }
}
