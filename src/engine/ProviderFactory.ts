import { Ollama } from 'ollama';
import { createLogger } from '../shared/AppLogger';

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
    private static providerInstance: LLMProvider | null = null;

    static getProvider(): LLMProvider {
        if (this.providerInstance) {
            return this.providerInstance;
        }

        const providerName = process.env.LLM_PROVIDER || 'ollama';

        if (providerName === 'ollama') {
            this.providerInstance = new OllamaProvider();
            return this.providerInstance;
        }

        this.providerInstance = new DummyProvider();
        return this.providerInstance;
    }
}

class OllamaProvider implements LLMProvider {
    private client: Ollama;
    private embeddingsUnavailable = false;
    private warnedEmbeddingsUnavailable = false;
    private logger = createLogger('OllamaProvider');
    private host: string;

    constructor() {
        const host = process.env.OLLAMA_HOST || 'http://localhost:11434';
        this.host = host;
        const apiKey = process.env.OLLAMA_API_KEY;
        const normalizedHost = host.toLowerCase();
        const isLocalHost = normalizedHost.includes('localhost')
            || normalizedHost.includes('127.0.0.1')
            || normalizedHost.includes('0.0.0.0');

        let fetchParams: RequestInit | undefined = undefined;
        if (apiKey && !isLocalHost) {
            fetchParams = {
                headers: { Authorization: `Bearer ${apiKey}` }
            };
        }

        this.client = new Ollama({
            host,
            fetch: fetchParams ? (input, init) => fetch(input, { ...init, ...fetchParams }) : undefined
        });

        this.logger.info('provider_initialized', 'Provider Ollama inicializado.', {
            host,
            uses_api_key: Boolean(apiKey)
        });
    }

    async generate(messages: MessagePayload[], tools?: any[]): Promise<ProviderResponse> {
        const ollamaModel = process.env.OLLAMA_MODEL || process.env.MODEL || 'llama3.2';
        const startedAt = Date.now();

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
            this.logger.info('chat_request_started', 'Enviando requisicao de chat ao Ollama.', {
                cognitive_stage: 'execution',
                execution: 'LLM_CHAT',
                route: 'provider',
                model: ollamaModel,
                messages_count: ollamaMessages.length,
                tools_count: ollamaTools?.length || 0
            });
            const response = await this.client.chat({
                model: ollamaModel,
                messages: ollamaMessages as any,
                tools: ollamaTools
            });

            this.logger.info('chat_request_completed', 'Resposta recebida do Ollama.', {
                cognitive_stage: 'execution',
                execution: 'LLM_CHAT_COMPLETED',
                route: 'provider',
                model: ollamaModel,
                duration_ms: Date.now() - startedAt,
                has_tool_calls: Boolean(response.message?.tool_calls?.length),
                response_length: response.message?.content?.length || 0
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
            const diagnostic = this.describeProviderError(error, 'chat', ollamaModel);
            this.logger.error('chat_request_failed', error, diagnostic.log_message, {
                cognitive_stage: 'result',
                result: 'FAILED',
                route: 'provider',
                model: ollamaModel,
                duration_ms: Date.now() - startedAt,
                host: this.host,
                diagnostic_code: diagnostic.code
            });
            return {
                final_answer: diagnostic.user_message
            };
        }
    }

    async embed(text: string): Promise<number[]> {
        if (this.embeddingsUnavailable) {
            return [];
        }

        const ollamaModel = process.env.OLLAMA_MODEL || process.env.MODEL || 'llama3.2';
        const startedAt = Date.now();

        try {
            const modernClient = this.client as any;

            if (typeof modernClient.embed === 'function') {
                const response = await modernClient.embed({
                    model: ollamaModel,
                    input: text
                });

                if (Array.isArray(response?.embeddings) && Array.isArray(response.embeddings[0])) {
                    this.logger.debug('embedding_request_completed', 'Embedding retornado pela API /embed.', {
                        model: ollamaModel,
                        duration_ms: Date.now() - startedAt,
                        embedding_dimensions: response.embeddings[0].length
                    });
                    return response.embeddings[0];
                }

                if (Array.isArray(response?.embedding)) {
                    this.logger.debug('embedding_request_completed', 'Embedding retornado pela API /embed.', {
                        model: ollamaModel,
                        duration_ms: Date.now() - startedAt,
                        embedding_dimensions: response.embedding.length
                    });
                    return response.embedding;
                }
            }

            if (typeof modernClient.embeddings === 'function') {
                const response = await modernClient.embeddings({
                    model: ollamaModel,
                    prompt: text
                });

                if (Array.isArray(response?.embedding)) {
                    this.logger.debug('embedding_request_completed', 'Embedding retornado pela API /embeddings.', {
                        model: ollamaModel,
                        duration_ms: Date.now() - startedAt,
                        embedding_dimensions: response.embedding.length
                    });
                    return response.embedding;
                }
            }

            this.embeddingsUnavailable = true;
            this.warnEmbeddingsUnavailable(ollamaModel, Date.now() - startedAt, 'client_without_embeddings_api');
            return [];
        } catch (error: any) {
            const errorMessage = String(error?.message || '').toLowerCase();

            if (
                error?.status_code === 404
                || error?.status_code === 401
                || errorMessage.includes('/api/embeddings')
                || errorMessage.includes('unauthorized')
            ) {
                this.embeddingsUnavailable = true;
                this.warnEmbeddingsUnavailable(ollamaModel, Date.now() - startedAt, 'api_unavailable_or_unauthorized');
                return [];
            }

            const diagnostic = this.describeProviderError(error, 'embed', ollamaModel);
            this.logger.error('embedding_request_failed', error, diagnostic.log_message, {
                model: ollamaModel,
                duration_ms: Date.now() - startedAt,
                host: this.host,
                diagnostic_code: diagnostic.code
            });
            return [];
        }
    }

    private describeProviderError(error: any, operation: 'chat' | 'embed', model: string): {
        code: string;
        log_message: string;
        user_message: string;
    } {
        const message = String(error?.message || '').toLowerCase();
        const causeCode = String(error?.cause?.code || error?.code || '').toUpperCase();
        const statusCode = error?.status_code || error?.status || error?.response?.status;

        if (message.includes('fetch failed') || causeCode === 'ECONNREFUSED' || causeCode === 'ENOTFOUND') {
            return {
                code: 'ollama_unreachable',
                log_message: `Falha de rede ao chamar o Ollama (${operation}). Verifique conectividade com ${this.host}.`,
                user_message: `O IalClaw nao conseguiu falar com o Ollama em ${this.host}. Verifique se o servico esta ativo, acessivel e se o modelo ${model} esta disponivel.`
            };
        }

        if (message.includes('timeout') || error?.name === 'AbortError') {
            return {
                code: 'ollama_timeout',
                log_message: `Timeout ao chamar o Ollama (${operation}).`,
                user_message: `O Ollama demorou demais para responder durante ${operation}. Verifique carga da maquina, disponibilidade do modelo ${model} e latencia do host ${this.host}.`
            };
        }

        if (statusCode === 404 || message.includes('model') && message.includes('not found')) {
            return {
                code: 'ollama_model_not_found',
                log_message: `Modelo Ollama nao encontrado para ${operation}.`,
                user_message: `O modelo ${model} nao foi encontrado no Ollama configurado. Ajuste OLLAMA_MODEL/MODEL ou faca o pull do modelo antes de tentar novamente.`
            };
        }

        if (statusCode === 401 || statusCode === 403 || message.includes('unauthorized')) {
            return {
                code: 'ollama_unauthorized',
                log_message: `Acesso negado ao Ollama durante ${operation}.`,
                user_message: 'O provedor Ollama recusou autenticacao. Verifique OLLAMA_API_KEY e as permissoes do endpoint configurado.'
            };
        }

        return {
            code: 'ollama_unknown_error',
            log_message: `Falha inesperada ao chamar o Ollama durante ${operation}.`,
            user_message: 'Ocorreu um erro inesperado de comunicacao com o Ollama. Consulte os logs estruturados para detalhes do host, operacao e stack.'
        };
    }

    private warnEmbeddingsUnavailable(model: string, durationMs: number, reason: string) {
        if (this.warnedEmbeddingsUnavailable) {
            return;
        }

        this.warnedEmbeddingsUnavailable = true;
        this.logger.warn('embedding_disabled', 'Embeddings indisponiveis; seguindo sem embeddings.', {
            host: this.host,
            model,
            duration_ms: durationMs,
            reason
        });
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
