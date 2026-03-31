// ── TaskContextManager: Estado Contínuo de Tarefa ─────────────────────────────
// Mantém contexto entre mensagens, evitando perda de tipo e interrupção.
// "O agente não está pensando em continuidade, está reagindo por mensagem."
//
// VERSÃO GENÉRICA: Não depende de frases específicas.
// Regra simples: tarefa ativa + (mensagem curta OU referência à tarefa)

import { TaskType } from '../agent/TaskClassifier';
import { createLogger } from '../../shared/AppLogger';
import { t } from '../../i18n';
import { SessionManager } from '../../shared/SessionManager';
import * as fs from 'fs';

export interface ContextFile {
    type: 'audio' | 'image' | 'document';
    path: string;
    filename: string;
    createdAt: number;
    sequence: number;
    source: string;
}
export interface TaskContext {
    type: TaskType;
    data: {
        task?: string;
        source?: string;
        goal?: string;
    };
    inProgress: boolean;
    lastUpdated: number;
    createdAt: number;
    files: ContextFile[];
    fileSequence: number;
}

export interface AskResult {
    type: 'ask';
    key: string;
    params?: Record<string, string>;
    message: string;
}

export class TaskContextManager {
    private contexts = new Map<string, TaskContext>();
    private logger = createLogger('TaskContextManager');

    // Tempo de inatividade antes de considerar nova tarefa (5 minutos para continuidade)
    private readonly CONTEXT_TTL_MS = 5 * 60 * 1000;  // 5 minutos
    private readonly INACTIVITY_TIMEOUT_MS = 15 * 60 * 1000;  // 15 minutos

    // ═══════════════════════════════════════════════════════════════════════
    // GESTÃO DE ESTADO
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Retorna o contexto para um chat específico.
     * Retorna null se não existir contexto (sem criação automática).
     */
    get(chatId: string): TaskContext | null {
        return this.contexts.get(chatId) ?? null;
    }

    /**
     * Cria um novo contexto para um chat.
     */
    create(chatId: string, type: TaskType = 'unknown'): TaskContext {
        const ctx: TaskContext = {
            type,
            data: {},
            inProgress: false,
            lastUpdated: Date.now(),
            createdAt: Date.now(),
            files: [],
            fileSequence: 0
        };
        this.contexts.set(chatId, ctx);
        return ctx;
    }

    /**
     * Verifica se há uma tarefa ativa em andamento.
     */
    hasActiveTask(chatId: string): boolean {
        const ctx = this.get(chatId);
        if (!ctx) return false;
        return ctx.type !== 'unknown' && ctx.inProgress === true;
    }

    /**
     * Verifica se há execução em andamento.
     */
    isInProgress(chatId: string): boolean {
        const ctx = this.get(chatId);
        return ctx?.inProgress ?? false;
    }

    /**
     * Verifica se o contexto ainda é válido (recente + relevante).
     * Combina tempo e heurística de relevância.
     */
    isContextValid(chatId: string, input: string): boolean {
        const ctx = this.get(chatId);

        // Sem contexto → inválido
        if (!ctx) {
            return false;
        }

        // Sem tipo → contexto inválido
        if (ctx.type === 'unknown') {
            return false;
        }

        const now = Date.now();
        const timeSinceLast = now - ctx.lastUpdated;
        const isRecent = timeSinceLast < this.CONTEXT_TTL_MS;

        // Se não é recente, contexto inválido
        if (!isRecent) {
            this.logger.info('context_expired', '[CONTEXT] Contexto expirado por tempo', {
                timeSinceLast,
                ttlMs: this.CONTEXT_TTL_MS
            });
            return false;
        }

        // Execution continuity: se uma ação foi completada recentemente, forçar contexto válido
        const currentSession = SessionManager.getCurrentSession();
        if (currentSession?.lastCompletedAction) {
            const completionAge = now - currentSession.lastCompletedAction.completedAt;
            if (completionAge < 30000) {
                this.logger.info('continuation_from_completed_action', '[CONTEXT] Contexto válido por continuidade de execução', {
                    originalRequest: currentSession.lastCompletedAction.originalRequest,
                    completionAgeMs: completionAge,
                    actionType: currentSession.lastCompletedAction.type
                });
                return true;
            }
        }

        // Verificar relevância do input
        const isRelevant = this.isRelevantToContext(input, ctx);

        if (!isRelevant) {
            this.logger.info('context_not_relevant', '[CONTEXT] Input não é relevante para o contexto', {
                inputPreview: input.slice(0, 50),
                contextType: ctx.type
            });
            return false;
        }

        return true;
    }

    /**
     * Verifica se o input é relevante para o contexto atual.
     * Heurística simples (sem embeddings).
     */
    private isRelevantToContext(input: string, ctx: TaskContext): boolean {
        const text = input.toLowerCase().trim();

        // Input curto = provável follow-up
        const isShortInput = text.length < 20;

        // Pistas de continuação
        const continuationHints = [
            '?', 'deu certo', 'funcionou', 'e agora', 'próximo',
            'ok', 'certo', 'sim', 'não', 'pronto', 'resultado',
            'teste', 'testar', 'melhorar', 'ajustar', 'finalizar',
            'continua', 'continuar', 'ainda', 'mais'
        ];

        const hasHint = continuationHints.some(h => text.includes(h));

        // Referência à tarefa atual
        const taskKeywords = this.getTaskKeywords(ctx.type);
        const hasTaskReference = taskKeywords.some(kw => text.includes(kw));

        // Regra: curto OU tem pista OU tem referência à tarefa
        return isShortInput || hasHint || hasTaskReference;
    }

    /**
     * Retorna palavras-chave relacionadas ao tipo de tarefa.
     */
    private getTaskKeywords(type: TaskType): string[] {
        const keywordMap: Record<string, string[]> = {
            'content_generation': ['slide', 'slides', 'aula', 'conteúdo', 'texto', 'artigo', 'resumo'],
            'file_conversion': ['arquivo', 'converter', 'formato', 'pdf', 'html', 'md'],
            'file_search': ['arquivo', 'buscar', 'encontrar', 'procurar', 'pasta'],
            'system_operation': ['comando', 'executar', 'rodar', 'instalar', 'configurar'],
            'skill_installation': ['skill', 'instalar', 'adicionar', 'módulo'],
            'information_request': ['qual', 'como', 'quando', 'onde', 'por que', 'o que']
        };

        return keywordMap[type] || [];
    }

    /**
     * Define status de execução.
     */
    setInProgress(chatId: string, value: boolean): void {
        let ctx = this.get(chatId);
        if (!ctx) {
            ctx = this.create(chatId, 'unknown');
        }
        ctx.inProgress = value;
        ctx.lastUpdated = Date.now();

        this.logger.debug('in_progress_set', '[CONTEXT] Status de execução', {
            chatId,
            inProgress: value,
            type: ctx.type
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // DETECÇÃO DE CONTINUIDADE (GENÉRICA)
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Detecção de continuidade GENÉRICA (sem frases específicas).
     * 
     * Regra simples e robusta:
     * → tarefa ativa + (mensagem curta OU menciona algo da tarefa)
     */
    private isRealContinuation(ctx: TaskContext, input: string): boolean {
        // Sem tarefa ativa → não é continuação
        if (ctx.type === 'unknown') {
            return false;
        }

        // Timeout de inatividade (15 minutos = nova tarefa)
        const timeSinceLast = Date.now() - ctx.lastUpdated;
        if (timeSinceLast > this.INACTIVITY_TIMEOUT_MS) {
            this.logger.info('continuation_timeout', '[CONTEXT] Timeout de inatividade, iniciando nova tarefa', {
                timeSinceLast,
                timeoutMs: this.INACTIVITY_TIMEOUT_MS
            });
            return false;
        }

        const text = input.toLowerCase().trim();

        // Mensagem curta = provável follow-up
        const isShortMessage = text.length < 80;

        // Referências comuns à tarefa atual
        const taskReferencePattern = /\b(slide|slides|aula|arquivo|conteúdo|html|esse|isso|ele|ela|ok|certo|sim|não|pronto|agora|resultado|teste|testar|melhorar|ajustar|finalizar)\b/i;
        const hasTaskReference = taskReferencePattern.test(text);

        // Regra: tarefa ativa + (mensagem curta OU referência à tarefa)
        const isContinuation = isShortMessage || hasTaskReference;

        this.logger.debug('continuation_check', '[CONTEXT] Verificação de continuidade', {
            type: ctx.type,
            isShortMessage,
            hasTaskReference,
            isContinuation,
            inputLength: text.length
        });

        return isContinuation;
    }

    // ═══════════════════════════════════════════════════════════════════════
    // ATUALIZAÇÃO DE CONTEXTO
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Atualiza contexto com base no input e tipo classificado.
     * IMPORTANTE: Se for continuação, MANTÉM o tipo anterior.
     */
    update(chatId: string, input: string, classifiedType: TaskType): TaskContext {
        let ctx = this.get(chatId);

        // Se não existe contexto, verificar se é continuação ou nova tarefa
        if (!ctx) {
            // Sem contexto anterior = nova tarefa
            ctx = this.create(chatId, classifiedType);
            ctx.data.task = input;
            this.logger.info('new_task_created', '[CONTEXT] Contexto criado para nova tarefa', {
                type: classifiedType,
                inputPreview: input.slice(0, 50)
            });
            return ctx;
        }

        const isCont = this.isRealContinuation(ctx, input);

        if (isCont) {
            // 🔥 Continuação: mantém tipo anterior + adiciona informações novas
            const sourceMatch = input.match(/(\/[^\s,]+)/);
            if (sourceMatch) {
                ctx.data.source = sourceMatch[1];
            }

            // Adiciona goal se mencionado
            const goalMatch = input.match(/(?:para|com|usando)\s+(.+)/i);
            if (goalMatch) {
                ctx.data.goal = goalMatch[1];
            }

            this.logger.info('continuation_detected', '[CONTEXT] Continuação detectada - mantendo tipo', {
                type: ctx.type,
                hasSource: !!ctx.data.source,
                inputPreview: input.slice(0, 50)
            });
        } else {
            // Nova tarefa de verdade
            ctx.type = classifiedType;
            ctx.data = { task: input };
            ctx.createdAt = Date.now();

            this.logger.info('new_task_detected', '[CONTEXT] Nova tarefa detectada', {
                type: classifiedType,
                inputPreview: input.slice(0, 50)
            });
        }

        ctx.lastUpdated = Date.now();
        return ctx;
    }

    /**
     * Define explicitamente a fonte de conteúdo.
     */
    setSource(chatId: string, source: string): void {
        let ctx = this.get(chatId);
        if (!ctx) {
            ctx = this.create(chatId, 'unknown');
        }
        ctx.data.source = source;
        ctx.lastUpdated = Date.now();

        this.logger.info('source_set', '[CONTEXT] Fonte definida', {
            source,
            type: ctx.type
        });
    }

    /**
     * Limpa o contexto (reset completo).
     */
    clearContext(chatId: string): void {
        const ctx = this.get(chatId);
        this.logger.info('context_cleared', '[CONTEXT] Contexto limpo', {
            type: ctx?.type ?? 'none'
        });

        this.contexts.set(chatId, {
            type: 'unknown',
            data: {},
            inProgress: false,
            lastUpdated: Date.now(),
            createdAt: Date.now(),
            files: [],
            fileSequence: 0
        });
    }

    /**
     * Adiciona um arquivo ao contexto da tarefa.
     * Implementa limite de 20 arquivos (janela deslizante) com limpeza de disco.
     */
    addFile(chatId: string, fileData: Omit<ContextFile, 'sequence'>): void {
        let ctx = this.get(chatId);
        if (!ctx) {
            ctx = this.create(chatId, 'unknown');
        }

        const MAX_FILES = 20;
        const sequence = ++ctx.fileSequence;
        const file: ContextFile = { ...fileData, sequence };

        if (ctx.files.length >= MAX_FILES) {
            const dumped = ctx.files.shift();
            if (dumped && dumped.path) {
                try {
                    if (fs.existsSync(dumped.path)) {
                        fs.unlinkSync(dumped.path);
                        this.logger.info('file_evicted_cleanup', '[CONTEXT] Arquivo antigo removido do disco para liberar espaço', {
                            path: dumped.path,
                            sequence: dumped.sequence
                        });
                    }
                } catch (err: any) {
                    this.logger.error('file_evicted_cleanup_failed', err, '[CONTEXT] Falha ao remover arquivo do disco durante limpeza automática', {
                        path: dumped.path
                    });
                }
            }
        }

        ctx.files.push(file);
        ctx.lastUpdated = Date.now();

        this.logger.info('file_added_to_context', '[CONTEXT] Arquivo anexado ao contexto', {
            chatId,
            type: file.type,
            filename: file.filename,
            sequence: file.sequence,
            totalFiles: ctx.files.length
        });
    }

    // ═══════════════════════════════════════════════════════════════════════
    // PERGUNTAS USANDO i18n
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Verifica se precisa perguntar sobre fonte.
     */
    checkNeedsSource(chatId: string): AskResult | null {
        const ctx = this.get(chatId);

        // Sem contexto → não precisa perguntar
        if (!ctx) {
            return null;
        }

        // Se já tem fonte, não precisa perguntar
        if (ctx.data.source) {
            return null;
        }

        // Se é tarefa que precisa de fonte
        const needsSourceTypes: TaskType[] = ['content_generation', 'file_conversion'];
        if (needsSourceTypes.includes(ctx.type)) {
            return {
                type: 'ask',
                key: 'content.ask_for_source',
                message: t('content.ask_for_source')
            };
        }

        return null;
    }

    /**
     * Retorna snapshot para debug.
     */
    getSnapshot(chatId: string): TaskContext | null {
        const ctx = this.get(chatId);
        return ctx ? { ...ctx } : null;
    }

    /**
     * Estatísticas do contexto.
     */
    getStats(chatId: string): { type: TaskType; hasSource: boolean; age: number } | null {
        const ctx = this.get(chatId);
        if (!ctx) {
            return null;
        }
        return {
            type: ctx.type,
            hasSource: !!ctx.data.source,
            age: Date.now() - ctx.createdAt
        };
    }
}

// ═══════════════════════════════════════════════════════════════════════
// SINGLETON THREAD-SAFE
// Evita race conditions na inicialização do singleton
// ═══════════════════════════════════════════════════════════════════════

let taskContextManagerInstance: TaskContextManager | null = null;
let initializationLock = false;

/**
 * Obtém a instância singleton do TaskContextManager.
 * Thread-safe: garante inicialização única mesmo com chamadas concorrentes.
 * 
 * IMPORTANTE: Usa double-check locking para evitar race conditions.
 */
export function getTaskContextManager(): TaskContextManager {
    // Fast path: já inicializado
    if (taskContextManagerInstance) {
        return taskContextManagerInstance;
    }

    // Double-check locking para thread-safety
    if (!initializationLock) {
        initializationLock = true;
        try {
            if (!taskContextManagerInstance) {
                taskContextManagerInstance = new TaskContextManager();
            }
        } finally {
            initializationLock = false;
        }
    }

    // Garantir retorno mesmo em edge cases
    if (!taskContextManagerInstance) {
        taskContextManagerInstance = new TaskContextManager();
    }

    return taskContextManagerInstance;
}

/**
 * Reseta o singleton (USAR APENAS EM TESTES).
 * CUIDADO: Pode causar inconsistência se usado em produção.
 */
export function resetTaskContextManager(): void {
    taskContextManagerInstance = null;
    initializationLock = false;
}