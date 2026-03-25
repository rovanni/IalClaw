import fs from 'fs';
import path from 'path';
import { Context, InputFile } from 'grammy';
import { SessionManager } from '../shared/SessionManager';
import { workspaceService } from '../services/WorkspaceService';

export class TelegramOutputHandler {

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
            await ctx.reply(chunk, { parse_mode: 'Markdown' }).catch((err) => {
                // Fallback simple message without parse mode in case of unclosed tags
                ctx.reply(chunk);
            });
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
        await (ctx as any).replyWithDocument(new InputFile(filePath, filename), {
            caption: `Artefato gerado: ${filename}`
        });
    }
}
