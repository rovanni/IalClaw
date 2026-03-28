// ── TaskContextManager: Estado Contínuo de Tarefa ─────────────────────────────
// Mantém contexto entre mensagens, evitando perda de tipo e interrupção.
// "O agente não está pensando em continuidade, está reagindo por mensagem."

import { TaskType } from '../agent/TaskClassifier';
import { createLogger } from '../../shared/AppLogger';
import { t } from '../../i18n';

export interface TaskContext {
    type: TaskType;
    userInput: string;
    source?: string;           // Arquivo/fonte de conteúdo
    goal?: string;             // Objetivo da tarefa
    createdAt: number;
    lastUpdated: number;
    messageCount: number;      // Quantas mensagens na conversa
    isComplete: boolean;
}

export interface AskResult {
    type: 'ask';
    key: string;
    params?: Record<string, string>;
    message: string;
}

export class TaskContextManager {
    private context: TaskContext | null = null;
    private logger = createLogger('TaskContextManager');
    
    // ═══════════════════════════════════════════════════════════════════════
    // GESTÃO DE ESTADO
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Retorna o contexto atual (ou null se não houver).
     */
    getContext(): TaskContext | null {
        return this.context;
    }
    
    /**
     * Verifica se há uma tarefa ativa em andamento.
     */
    hasActiveTask(): boolean {
        return this.context !== null && !this.context.isComplete;
    }
    
    /**
     * Cria novo contexto de tarefa.
     */
    startTask(type: TaskType, userInput: string): TaskContext {
        this.context = {
            type,
            userInput,
            createdAt: Date.now(),
            lastUpdated: Date.now(),
            messageCount: 1,
            isComplete: false
        };
        
        this.logger.info('task_started', '[CONTEXT] Nova tarefa iniciada', {
            type,
            input_preview: userInput.slice(0, 100)
        });
        
        return this.context;
    }
    
    /**
     * Atualiza contexto existente com nova informação.
     * Se for continuação, mantém o tipo e mergeia informações.
     */
    updateContext(newInput: string, newType?: TaskType, newInfo?: Partial<TaskContext>): TaskContext | null {
        if (!this.context) {
            // Sem contexto anterior, criar novo
            if (newType) {
                return this.startTask(newType, newInput);
            }
            return null;
        }
        
        // Continuação: manter tipo, adicionar informações
        this.context = {
            ...this.context,
            userInput: newInput,
            lastUpdated: Date.now(),
            messageCount: this.context.messageCount + 1,
            ...newInfo
        };
        
        // IMPORTANTE: NÃO mudar o tipo em continuação
        // Se newType for diferente, ignorar (continuidade prevalece)
        
        this.logger.info('task_updated', '[CONTEXT] Contexto atualizado', {
            type: this.context.type,
            messageCount: this.context.messageCount,
            hasSource: !!this.context.source
        });
        
        return this.context;
    }
    
    /**
     * Adiciona fonte de conteúdo ao contexto.
     */
    setSource(source: string): void {
        if (!this.context) {
            this.logger.warn('no_context', '[CONTEXT] Tentativa de setSource sem contexto ativo');
            return;
        }
        
        this.context.source = source;
        this.context.lastUpdated = Date.now();
        
        this.logger.info('source_set', '[CONTEXT] Fonte de conteúdo definida', {
            source,
            type: this.context.type
        });
    }
    
    /**
     * Marca tarefa como completa.
     */
    completeTask(): void {
        if (!this.context) return;
        
        this.context.isComplete = true;
        this.context.lastUpdated = Date.now();
        
        this.logger.info('task_completed', '[CONTEXT] Tarefa marcada como completa', {
            type: this.context.type,
            messageCount: this.context.messageCount
        });
    }
    
    /**
     * Limpa o contexto (reset completo).
     */
    clearContext(): void {
        if (this.context) {
            this.logger.info('context_cleared', '[CONTEXT] Contexto limpo', {
                type: this.context.type,
                messageCount: this.context.messageCount
            });
        }
        this.context = null;
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // DETECÇÃO DE CONTINUIDADE
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Verifica se o input é continuação da tarefa atual.
     */
    isContinuation(input: string): boolean {
        if (!this.context) return false;
        
        const continuationIndicators = [
            /^e\s+/i,
            /^e\s+para/i,
            /^usar\s+/i,
            /^utilizar\s+/i,
            /^com\s+esse/i,
            /^agora\s+com/i,
            /^usando\s+/i,
            /^aplicar\s+/i,
            /^nesse\s+/i
        ];
        
        const normalized = input.toLowerCase().trim();
        return continuationIndicators.some(p => p.test(normalized));
    }
    
    /**
     * Detecta fonte de conteúdo no input.
     */
    detectSource(input: string): string | null {
        // Caminho de arquivo
        const filePathMatch = input.match(/\/[\w\-\.\/]+\.\w+/i);
        if (filePathMatch) {
            return filePathMatch[0];
        }
        
        // "usar arquivo X"
        const usarMatch = input.match(/usar\s+(?:o\s+)?(?:arquivo\s+)?([^\s,;.]+)/i);
        if (usarMatch) {
            return usarMatch[1];
        }
        
        // "utilizar X"
        const utilizarMatch = input.match(/utilizar\s+(?:o\s+)?([^\s,;.]+)/i);
        if (utilizarMatch) {
            return utilizarMatch[1];
        }
        
        return null;
    }
    
    /**
     * Mergeia contexto antigo com novo input.
     * Se input menciona arquivo, adiciona ao contexto.
     */
    mergeContext(input: string, detectedType?: TaskType): TaskContext | null {
        if (!this.context) {
            // Sem contexto anterior, criar novo se tiver tipo
            if (detectedType) {
                return this.startTask(detectedType, input);
            }
            return null;
        }
        
        // Detectar fonte de conteúdo no input
        const source = this.detectSource(input);
        
        // Atualizar contexto
        return this.updateContext(input, undefined, source ? { source } : undefined);
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PERSISTÊNCIA (para debug)
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Retorna snapshot do contexto para debug.
     */
    getSnapshot(): TaskContext | null {
        return this.context ? { ...this.context } : null;
    }
    
    /**
     * Estatísticas do contexto.
     */
    getStats(): { hasContext: boolean; type?: TaskType; messageCount?: number; age?: number } {
        if (!this.context) {
            return { hasContext: false };
        }
        
        return {
            hasContext: true,
            type: this.context.type,
            messageCount: this.context.messageCount,
            age: Date.now() - this.context.createdAt
        };
    }
    
    // ═══════════════════════════════════════════════════════════════════════
    // PERGUNTAS USANDO i18n
    // ═══════════════════════════════════════════════════════════════════════
    
    /**
     * Gera pergunta para fonte de conteúdo usando i18n.
     * NÃO usa texto hardcoded - delega para t()
     */
    askForSource(): AskResult {
        // Se tem contexto com tipo específico, usar mensagem específica
        if (this.context?.type === 'content_generation') {
            return {
                type: 'ask',
                key: 'content.ask_for_source',
                message: t('content.ask_for_source')
            };
        }
        
        if (this.context?.type === 'file_conversion') {
            return {
                type: 'ask',
                key: 'file.ask_for_source',
                message: t('file.ask_for_source')
            };
        }
        
        // Fallback genérico
        return {
            type: 'ask',
            key: 'agent.ask.source_file',
            message: t('agent.ask.source_file')
        };
    }
    
    /**
     * Gera pergunta com exemplo usando i18n.
     */
    askForSourceWithExample(example: string): AskResult {
        return {
            type: 'ask',
            key: 'agent.ask.source_file_with_hint',
            params: { example },
            message: t('agent.ask.source_file_with_hint', { example })
        };
    }
    
    /**
     * Verifica se precisa perguntar sobre fonte.
     * Retorna pergunta se necessário, null se tem fonte.
     */
    checkNeedsSource(): AskResult | null {
        // Se já tem fonte, não precisa perguntar
        if (this.context?.source) {
            return null;
        }
        
        // Se é tarefa que precisa de fonte, perguntar
        const needsSourceTypes: TaskType[] = ['content_generation', 'file_conversion'];
        if (this.context && needsSourceTypes.includes(this.context.type)) {
            return this.askForSource();
        }
        
        return null;
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