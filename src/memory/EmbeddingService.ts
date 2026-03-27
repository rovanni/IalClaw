import { LLMProvider } from '../engine/ProviderFactory';
import { createLogger } from '../shared/AppLogger';

export interface EmbeddingService {
    generate(text: string): Promise<number[]>;
}

export class ProviderEmbeddingService implements EmbeddingService {
    private provider: LLMProvider;

    constructor(provider: LLMProvider) {
        this.provider = provider;
    }

    async generate(text: string): Promise<number[]> {
        return this.provider.embed(text);
    }
}

export class OllamaEmbeddingService implements EmbeddingService {
    private host: string;
    private model: string;
    private logger = createLogger('OllamaEmbeddingService');

    constructor(host?: string, model?: string) {
        this.host = host || process.env.OLLAMA_HOST || 'http://localhost:11434';
        this.model = model || process.env.OLLAMA_MODEL || process.env.MODEL || 'llama3.2';
    }

    async generate(text: string): Promise<number[]> {
        const response = await fetch(`${this.host}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: this.model,
                input: text
            })
        });

        if (!response.ok) {
            const body = await response.text();
            this.logger.warn('embedding_request_failed', 'Falha ao gerar embedding via Ollama.', {
                status: response.status,
                body: body.slice(0, 400)
            });
            return [];
        }

        const data = await response.json() as {
            embeddings?: number[][];
            embedding?: number[];
        };

        if (Array.isArray(data.embeddings) && Array.isArray(data.embeddings[0])) {
            return data.embeddings[0];
        }
        if (Array.isArray(data.embedding)) {
            return data.embedding;
        }
        return [];
    }
}
