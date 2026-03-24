import { Context } from 'grammy';

export class TelegramOutputHandler {

    public async sendResponse(ctx: Context, response: string, requiresAudio: boolean = false) {
        if (requiresAudio) {
            // Logic for Edge-TTS generation could go here. 
            // Fallback to text:
            await this.sendTextChunks(ctx, `[Áudio Fallback]\n${response}`);
            return;
        }

        // Detecting huge Markdown outputs to send as files
        if (response.length > 2000 && response.includes('```')) {
            // Simplifying: just send as chunked text instead of creating a file to avoid disk IO overhead unless needed
            return this.sendTextChunks(ctx, response);
        }

        return this.sendTextChunks(ctx, response);
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
}
