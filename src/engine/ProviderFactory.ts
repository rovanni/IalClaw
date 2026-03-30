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

    // Configuração de timeout e retry
    private readonly timeoutMs: number;
    private readonly maxRetries: number;
    private readonly baseDelayMs: number;
    private readonly maxTotalMs: number;

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

        // Timeout configurável via env (padrão: 4 minutos)
        this.timeoutMs = parseInt(process.env.OLLAMA_TIMEOUT_MS || '240000');
        // Retry configurável via env (padrão: 3 tentativas)
        this.maxRetries = parseInt(process.env.OLLAMA_MAX_RETRIES || '3');
        // Backoff base (padrão: 1 segundo)
        this.baseDelayMs = parseInt(process.env.OLLAMA_RETRY_BASE_DELAY_MS || '1000');
        // Limite total de tempo (padrão: 6 minutos)
        this.maxTotalMs = parseInt(process.env.OLLAMA_MAX_TOTAL_MS || '360000');

        this.logger.info('provider_initialized', 'Provider Ollama inicializado.', {
            host,
            uses_api_key: Boolean(apiKey),
            timeout_ms: this.timeoutMs,
            max_retries: this.maxRetries,
            max_total_ms: this.maxTotalMs
        });
    }

    /**
     * Método público - wrapper que retorna UMA resposta final.
     * Retry é interno, invisível para o AgentLoop.
     */
    async generate(messages: MessagePayload[], tools?: any[]): Promise<ProviderResponse> {
        return this.generateWithRetry(messages, tools);
    }

    /**
     * Retry com backoff exponencial.
     * Só retenta erros de infra (timeout, network, 5xx).
     * NÃO retenta resposta válida ou tool_call já retornado.
     * Respeita limite total de tempo (maxTotalMs).
     */
    private async generateWithRetry(
        messages: MessagePayload[],
        tools?: any[],
        retries?: number
    ): Promise<ProviderResponse> {
        const maxAttempts = retries ?? this.maxRetries;
        const startedAt = Date.now();
        let lastError: Error | null = null;

        for (let attempt = 0; attempt < maxAttempts; attempt++) {
            // Verifica se ainda temos tempo dentro do limite total
            const elapsed = Date.now() - startedAt;
            if (elapsed >= this.maxTotalMs) {
                const diagnostic = this.describeProviderError(
                    new Error(`Tempo total excedido: ${elapsed}ms >= ${this.maxTotalMs}ms`),
                    'chat',
                    this.getModel()
                );
                this.logger.error('chat_request_timeout_total', new Error('Max total time exceeded'), diagnostic.log_message, {
                    cognitive_stage: 'result',
                    result: 'FAILED',
                    route: 'provider',
                    model: this.getModel(),
                    elapsed_ms: elapsed,
                    max_total_ms: this.maxTotalMs,
                    attempt: attempt + 1
                });
                return {
                    final_answer: diagnostic.user_message
                };
            }

            try {
                const response = await this.generateOnce(messages, tools);
                // Resposta válida (tool_call ou final_answer) - retorna imediatamente
                return response;
            } catch (error: any) {
                lastError = error;

                // Verifica se é erro recuperável (infra)
                const isRetryable = this.isRetryableError(error);

                // Verifica se ainda temos tempo para retry
                const remainingTime = this.maxTotalMs - (Date.now() - startedAt);

                // Se não for recuperável OU última tentativa OU sem tempo -> propaga erro
                if (!isRetryable || attempt === maxAttempts - 1 || remainingTime < this.baseDelayMs) {
                    const diagnostic = this.describeProviderError(error, 'chat', this.getModel());
                    this.logger.error('chat_request_failed', error, diagnostic.log_message, {
                        cognitive_stage: 'result',
                        result: 'FAILED',
                        route: 'provider',
                        model: this.getModel(),
                        duration_ms: Date.now() - startedAt,
                        host: this.host,
                        diagnostic_code: diagnostic.code,
                        attempt: attempt + 1,
                        max_attempts: maxAttempts,
                        is_retryable: isRetryable,
                        remaining_time_ms: remainingTime
                    });
                    return {
                        final_answer: diagnostic.user_message
                    };
                }

                // Backoff exponencial: 1s, 2s, 4s
                const delayMs = this.baseDelayMs * Math.pow(2, attempt);
                this.logger.warn('chat_request_retry', 'Erro recuperável, tentando novamente...', {
                    attempt: attempt + 1,
                    max_attempts: maxAttempts,
                    delay_ms: delayMs,
                    error_name: error.name,
                    error_message: error.message?.substring(0, 100),
                    remaining_time_ms: remainingTime
                });

                await this.sleep(delayMs);
            }
        }

        // Não deve chegar aqui, mas garante retorno
        const diagnostic = this.describeProviderError(lastError || new Error('Unknown error'), 'chat', this.getModel());
        return {
            final_answer: diagnostic.user_message
        };
    }

    /**
     * Chamada única ao Ollama com timeout via Promise.race.
     * Timeout aplicado ao request HTTP, não à lógica do AgentLoop.
     */
    private async generateOnce(messages: MessagePayload[], tools?: any[]): Promise<ProviderResponse> {
        const ollamaModel = this.getModel();
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

        this.logger.info('chat_request_started', 'Enviando requisicao de chat ao Ollama.', {
            cognitive_stage: 'execution',
            execution: 'LLM_CHAT',
            route: 'provider',
            model: ollamaModel,
            messages_count: ollamaMessages.length,
            tools_count: ollamaTools?.length || 0,
            timeout_ms: this.timeoutMs
        });

        // Promise.race para timeout - não afeta a lógica do AgentLoop
        const timeoutPromise = new Promise<never>((_, reject) => {
            setTimeout(() => {
                const error = new Error(`Timeout de ${this.timeoutMs}ms excedido ao chamar Ollama`);
                error.name = 'TimeoutError';
                reject(error);
            }, this.timeoutMs);
        });

        const chatPromise = this.client.chat({
            model: ollamaModel,
            messages: ollamaMessages as any,
            tools: ollamaTools
        });

        const response = await Promise.race([chatPromise, timeoutPromise]);

        this.logger.info('chat_request_completed', 'Resposta recebida do Ollama.', {
            cognitive_stage: 'execution',
            execution: 'LLM_CHAT_COMPLETED',
            route: 'provider',
            model: ollamaModel,
            duration_ms: Date.now() - startedAt,
            has_tool_calls: Boolean(response.message?.tool_calls?.length),
            response_length: response.message?.content?.length || 0
        });

        // Tool call retornado - não há retry para isso
        if (response.message?.tool_calls && response.message.tool_calls.length > 0) {
            const call = response.message.tool_calls[0].function;
            return {
                tool_call: {
                    name: call.name,
                    args: call.arguments
                }
            };
        }

        // Resposta final - não há retry para isso
        return {
            final_answer: response.message?.content || 'Sem resposta do Ollama.'
        };
    }

    /**
     * Verifica se o erro é recuperável (infra).
     * Só retry para: timeout, network, 5xx
     * NÃO retry para: resposta válida, tool_call, 4xx
     */
    private isRetryableError(error: any): boolean {
        const errorName = error?.name || '';
        const errorMessage = String(error?.message || '').toLowerCase();
        const statusCode = error?.status_code || error?.status || error?.response?.status;

        // Timeout errors (incluindo nosso TimeoutError)
        if (errorName === 'AbortError' || errorName === 'HeadersTimeoutError' || errorName === 'TimeoutError' || errorMessage.includes('timeout')) {
            return true;
        }

        // Network errors
        if (errorMessage.includes('fetch failed') || errorMessage.includes('econnrefused') || errorMessage.includes('enotfound')) {
            return true;
        }

        // Server errors (5xx)
        if (statusCode >= 500 && statusCode < 600) {
            return true;
        }

        // Erros de cliente (4xx) - não tentar retry
        if (statusCode >= 400 && statusCode < 500) {
            return false;
        }

        // Resposta já recebida - não retry
        if (errorName === 'SyntaxError' || errorMessage.includes('json')) {
            return false;
        }

        // Por padrão, não retry para erros desconhecidos
        return false;
    }

    private getModel(): string {
        return process.env.OLLAMA_MODEL || process.env.MODEL || 'llama3.2';
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
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

        if (message.includes('tempo total excedido') || message.includes('max total time')) {
            return {
                code: 'ollama_total_timeout',
                log_message: `Tempo total excedido ao chamar o Ollama (${operation}).`,
                user_message: `O tempo total de comunicacao com o Ollama excedeu o limite. Verifique a conexao, o modelo ${model} e tente novamente.`
            };
        }

        if (message.includes('timeout') || error?.name === 'AbortError' || error?.name === 'TimeoutError' || error?.name === 'HeadersTimeoutError') {
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
