import { Ollama } from 'ollama';

export interface MessagePayload {
    role: 'system' | 'user' | 'assistant' | 'tool';
    content: string;
    tool_name?: string;
    tool_args?: any;
}

export interface ProviderResponse {
    final_answer?: string;
    tool_call?: {
        name: string;
        args: any;
    };
}

export interface LLMProvider {
    generate(messages: MessagePayload[], tools?: any[]): Promise<ProviderResponse>;
    embed(text: string): Promise<number[]>;
}

export class ProviderFactory {
    static getProvider(): LLMProvider {
        const providerName = process.env.LLM_PROVIDER || 'ollama';

        if (providerName === 'ollama') {
            return new OllamaProvider();
        }

        return new DummyProvider();
    }
}

class OllamaProvider implements LLMProvider {
    private client: Ollama;
    private embeddingsUnavailable = false;

    constructor() {
        const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
        const apiKey = process.env.OLLAMA_API_KEY;

        let fetchParams: RequestInit | undefined = undefined;
        if (apiKey) {
            fetchParams = {
                headers: { Authorization: `Bearer ${apiKey}` }
            };
        }

        this.client = new Ollama({
            host,
            fetch: fetchParams ? (input, init) => fetch(input, { ...init, ...fetchParams }) : undefined
        });
    }

    async generate(messages: MessagePayload[], tools?: any[]): Promise<ProviderResponse> {
        const ollamaModel = process.env.OLLAMA_MODEL || process.env.MODEL || 'llama3.2';

        const ollamaMessages = messages.map(message => ({
            role: message.role,
            content: message.content
        }));

        const ollamaTools = tools
            ? tools.map(tool => ({
                type: 'function',
                function: {
                    name: tool.name,
                    description: tool.description,
                    parameters: tool.parameters
                }
            }))
            : undefined;

        try {
            const response = await this.client.chat({
                model: ollamaModel,
                messages: ollamaMessages as any,
                tools: ollamaTools
            });

            if (response.message?.tool_calls && response.message.tool_calls.length > 0) {
                const call = response.message.tool_calls[0].function;
                return {
                    tool_call: {
                        name: call.name,
                        args: call.arguments
                    }
                };
            }

            return {
                final_answer: response.message?.content || 'Sem resposta do Ollama.'
            };
        } catch (error: any) {
            console.error('[OllamaProvider] Error calling Ollama:', error);
            return {
                final_answer: 'Ocorreu um erro de comunicacao com o Ollama local/cloud. Verifique se o servico esta rodando.'
            };
        }
    }

    async embed(text: string): Promise<number[]> {
        if (this.embeddingsUnavailable) {
            return [];
        }

        const ollamaModel = process.env.OLLAMA_MODEL || process.env.MODEL || 'llama3.2';

        try {
            const modernClient = this.client as any;

            if (typeof modernClient.embed === 'function') {
                const response = await modernClient.embed({
                    model: ollamaModel,
                    input: text
                });

                if (Array.isArray(response?.embeddings) && Array.isArray(response.embeddings[0])) {
                    return response.embeddings[0];
                }

                if (Array.isArray(response?.embedding)) {
                    return response.embedding;
                }
            }

            if (typeof modernClient.embeddings === 'function') {
                const response = await modernClient.embeddings({
                    model: ollamaModel,
                    prompt: text
                });

                if (Array.isArray(response?.embedding)) {
                    return response.embedding;
                }
            }

            this.embeddingsUnavailable = true;
            console.warn('[OllamaProvider] Embeddings API not available in this Ollama client/runtime. Falling back without embeddings.');
            return [];
        } catch (error: any) {
            if (error?.status_code === 404 || String(error?.message || '').includes('/api/embeddings')) {
                this.embeddingsUnavailable = true;
                console.warn('[OllamaProvider] Embeddings endpoint unavailable. Continuing without embeddings.');
                return [];
            }

            console.error('[OllamaProvider] Error generation embeddings:', error);
            return [];
        }
    }
}

class DummyProvider implements LLMProvider {
    async generate(messages: MessagePayload[], tools?: any[]): Promise<ProviderResponse> {
        const lastUserMsg = messages.filter(message => message.role === 'user').pop();
        if (lastUserMsg && lastUserMsg.content.includes('ajuda')) {
            return { final_answer: 'Como posso ajudar voce usando o meu sistema cognitivo local?' };
        }

        return {
            final_answer: 'Eu sou o IalClaw. Recebi sua mensagem: ' + (lastUserMsg?.content || 'Vazio')
        };
    }

    async embed(text: string): Promise<number[]> {
        return [0.1, 0.2, 0.3];
    }
}
