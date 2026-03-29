// ── TaskContextManager: Estado Contínuo de Tarefa ─────────────────────────────
// Mantém contexto entre mensagens, evitando perda de tipo e interrupção.
// "O agente não está pensando em continuidade, está reagindo por mensagem."
//
// VERSÃO GENÉRICA: Não depende de frases específicas.
// Regra simples: tarefa ativa + (mensagem curta OU referência à tarefa)

import { TaskType } from '../agent/TaskClassifier';
import { createLogger } from '../../shared/AppLogger';
import { t } from '../../i18n';

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
     */
    get(chatId: string): TaskContext {
        if (!this.contexts.has(chatId)) {
            this.contexts.set(chatId, {
                type: 'unknown',
                data: {},
                inProgress: false,
                lastUpdated: Date.now(),
                createdAt: Date.now()
            });
        }
        return this.contexts.get(chatId)!;
    }
    
    /**
     * Verifica se há uma tarefa ativa em andamento.
     */
    hasActiveTask(chatId: string): boolean {
        const ctx = this.get(chatId);
        return ctx.type !== 'unknown' && ctx.inProgress === false;
    }
    
    /**
     * Verifica se há execução em andamento.
     */
    isInProgress(chatId: string): boolean {
        return this.get(chatId).inProgress;
    }
    
    /**
     * Verifica se o contexto ainda é válido (recente + relevante).
     * Combina tempo e heurística de relevância.
     */
    isContextValid(chatId: string, input: string): boolean {
        const ctx = this.get(chatId);
        
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
        const ctx = this.get(chatId);
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
        const ctx = this.get(chatId);
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
        const ctx = this.get(chatId);
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
            type: ctx.type
        });
        
        this.contexts.set(chatId, {
            type: 'unknown',
            data: {},
            inProgress: false,
            lastUpdated: Date.now(),
            createdAt: Date.now()
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
    getSnapshot(chatId: string): TaskContext {
        return { ...this.get(chatId) };
    }
    
    /**
     * Estatísticas do contexto.
     */
    getStats(chatId: string): { type: TaskType; hasSource: boolean; age: number } {
        const ctx = this.get(chatId);
        return {
            type: ctx.type,
            hasSource: !!ctx.data.source,
            age: Date.now() - ctx.createdAt
        };
    }
}

// Singleton para uso global
let taskContextManagerInstance: TaskContextManager | null = null;

export function getTaskContextManager(): TaskContextManager {
    if (!taskContextManagerInstance) {
        taskContextManagerInstance = new TaskContextManager();
    }
    return taskContextManagerInstance;
}