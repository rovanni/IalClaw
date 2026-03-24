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

    constructor() {
        const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
        const apiKey = process.env.OLLAMA_API_KEY;

        let fetchParams: RequestInit | undefined = undefined;
        if (apiKey) {
            fetchParams = {
                headers: { 'Authorization': `Bearer ${apiKey}` }
            };
        }

        this.client = new Ollama({
            host,
            fetch: fetchParams ? (input, init) => fetch(input, { ...init, ...fetchParams }) : undefined
        });
    }

    async generate(messages: MessagePayload[], tools?: any[]): Promise<ProviderResponse> {
        const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';

        const ollamaMessages = messages.map(m => {
            return {
                role: m.role,
                content: m.content
            };
        });

        const ollamaTools = tools ? tools.map(t => ({
            type: 'function',
            function: {
                name: t.name,
                description: t.description,
                parameters: t.parameters
            }
        })) : undefined;

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
                final_answer: response.message?.content || "Sem resposta do Ollama."
            };
        } catch (e: any) {
            console.error("[OllamaProvider] Error calling Ollama:", e);
            return {
                final_answer: "Ocorreu um erro de comunicação com o Ollama local/Cloud. Verifique se o serviço está rodando."
            };
        }
    }

    async embed(text: string): Promise<number[]> {
        // Para RAG rápido em PT-BR sugerimos nomic-embed-text ou o próprio modelo que suporte embeddings
        const ollamaModel = process.env.OLLAMA_MODEL || 'llama3.2';
        try {
            const response = await this.client.embeddings({
                model: ollamaModel,
                prompt: text
            });
            return response.embedding;
        } catch (e: any) {
            console.error("[OllamaProvider] Error generation embeddings:", e);
            return [];
        }
    }
}

class DummyProvider implements LLMProvider {
    async generate(messages: MessagePayload[], tools?: any[]): Promise<ProviderResponse> {
        const lastUserMsg = messages.filter(m => m.role === 'user').pop();
        if (lastUserMsg && lastUserMsg.content.includes("ajuda")) {
            return { final_answer: "Como posso ajudar você usando o meu sistema cognitivo local?" };
        }
        return {
            final_answer: "Eu sou o IalClaw. Recebi sua mensagem: " + (lastUserMsg?.content || "Vazio")
        };
    }

    async embed(text: string): Promise<number[]> {
        return [0.1, 0.2, 0.3];
    }
}
