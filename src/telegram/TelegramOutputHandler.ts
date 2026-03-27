import fs from 'fs';
import path from 'path';
import { Context, InputFile } from 'grammy';
import { SessionManager } from '../shared/SessionManager';
import { workspaceService } from '../services/WorkspaceService';
import { createLogger } from '../shared/AppLogger';

export class TelegramOutputHandler {
    private logger = createLogger('TelegramOutputHandler');
    private readonly MAX_RETRIES = 3;
    private readonly REPLY_TIMEOUT_MS = 10000; // 10 segundos

    public async sendResponse(ctx: Context, response: string, requiresAudio: boolean = false) {
        if (requiresAudio) {
            // Logic for Edge-TTS generation could go here. 
            // Fallback to text:
            await this.sendTextChunks(ctx, `[Áudio Fallback]\n${response}`);
            return;
        }

        const attachment = this.resolveArtifactAttachment();
        const finalResponse = attachment
            ? `${response}\n\nArquivo gerado anexado nesta conversa: ${attachment.filename}`
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
                    this.logger.debug('chunk_sent', 'Chunk enviado com sucesso.', {
                        chunk_index: chunkIndex,
                        chunk_size: chunk.length,
                        attempt: attempt + 1
                    });
                    break; // Sucesso, sair do retry loop
                } catch (err: any) {
                    lastError = err;
                    this.logger.warn('chunk_send_retry', 'Falha ao enviar chunk, tentando novamente.', {
                        chunk_index: chunkIndex,
                        attempt: attempt + 1,
                        max_retries: this.MAX_RETRIES,
                        error_message: err.message
                    });
                    
                    if (attempt === this.MAX_RETRIES - 1) {
                        // Última tentativa falhou
                        this.logger.error('chunk_send_failed', err, '[IALCLAW] ERRO CRÍTICO: Falha ao enviar chunk após todas as tentativas.', {
                            chunk_index: chunkIndex,
                            chunk_preview: chunk.substring(0, 100),
                            total_attempts: this.MAX_RETRIES
                        });
                        
                        // Fallback: tentar enviar sem Markdown
                        try {
                            await Promise.race([
                                ctx.reply(chunk),
                                this.createTimeoutPromise(this.REPLY_TIMEOUT_MS)
                            ]);
                            this.logger.info('chunk_sent_fallback', 'Chunk enviado via fallback (sem Markdown).');
                            break;
                        } catch (fallbackErr: any) {
                            this.logger.error('chunk_fallback_failed', fallbackErr, '[IALCLAW] FALHA CRÍTICA: Impossível enviar chunk mesmo via fallback.');
                            // Salvar em arquivo como último recurso
                            await this.saveResponseToFallbackFile(chunk, ctx.chat?.id.toString());
                            throw new Error(`Falha crítica ao enviar mensagem: ${lastError?.message}`);
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
                        caption: `Artefato gerado: ${filename}`
                    }),
                    this.createTimeoutPromise(this.REPLY_TIMEOUT_MS * 2) // Dobro do timeout para arquivos
                ]);
                this.logger.info('attachment_sent', 'Anexo enviado com sucesso.', {
                    filename,
                    attempt: attempt + 1
                });
                return; // Sucesso
            } catch (err: any) {
                lastError = err;
                this.logger.warn('attachment_send_retry', 'Falha ao enviar anexo, tentando novamente.', {
                    filename,
                    attempt: attempt + 1,
                    max_retries: this.MAX_RETRIES,
                    error_message: err.message
                });
                
                if (attempt === this.MAX_RETRIES - 1) {
                    this.logger.error('attachment_send_failed', err, '[IALCLAW] ERRO CRÍTICO: Falha ao enviar anexo após todas as tentativas.', {
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
            setTimeout(() => reject(new Error(`Timeout de ${ms}ms excedido`)), ms);
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
            
            this.logger.error('response_saved_to_file', null, '[IALCLAW] Resposta salva em arquivo de fallback.', {
                filepath,
                chat_id: chatId,
                response_length: response.length
            });
            
            console.error(`\n[IALCLAW] ⚠️  FALHA CRÍTICA: Impossível enviar resposta ao usuário.`);
            console.error(`[IALCLAW] 💾 Resposta salva em: ${filepath}`);
            console.error(`[IALCLAW] 📝 Comprimento: ${response.length} caracteres\n`);
        } catch (err: any) {
            this.logger.error('fallback_file_save_failed', err, '[IALCLAW] Falha ao salvar resposta em arquivo de fallback.');
            console.error('[IALCLAW] FALHA CATASTRÓFICA: Não foi possível nem salvar a resposta em arquivo.');
        }
    }
}
