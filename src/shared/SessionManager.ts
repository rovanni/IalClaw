import { AsyncLocalStorage } from 'async_hooks';
import { Lang } from '../i18n/types';
import { getPendingAction } from '../core/agent/PendingActionTracker';
import { FlowState } from '../core/flow/types';

export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface PendingAction {
    id: string;
    type: 'install_skill' | 'install_capability';
    status: 'awaiting_confirmation' | 'executing' | 'completed';
    payload: {
        skillName?: string;
        capability?: string;
        originalQuery?: string;
        context?: Record<string, any>;
    };
    timestamp: number;
    expires_at: number;
    createdAt: number;
    completedAt?: number;
}

export interface ContextFile {
    type: 'audio' | 'image' | 'document';
    path: string;
    filename: string;
    createdAt: number;
    sequence: number;
    source: string;
}

export interface TaskContextData {
    active: boolean;
    type: string;
    data: {
        task?: string;
        source?: string;
        goal?: string;
    };
    lastUpdated: number;
    createdAt: number;
    files: ContextFile[];
    fileSequence: number;
}

export interface SessionDeltaState {
    previousConfidence: number | null;
    lowImprovementCount: number;
    updatedAt: number;
}

export interface SessionExecutionMemoryEntry {
    stepType: string;
    tool: string;
    success: boolean;
    context: string;
    timestamp: number;
}

export interface SessionExecutionMemoryState {
    entries: SessionExecutionMemoryEntry[];
    updatedAt: number;
}

export interface SessionExecutionMemoryToolScore {
    tool: string;
    score: number;
    successes: number;
    failures: number;
}

export interface SessionExecutionMemoryToolConfidence {
    confidence: number;
    isContextual: boolean;
}

export interface SessionExecutionMemorySelectionSnapshot {
    stepType: string;
    candidateTools: string[];
    scores: SessionExecutionMemoryToolScore[];
    contextualConfidenceByTool: Record<string, number>;
    bestConfidence: number;
    decisionConfidence: number;
    updatedAt: number;
}

/**
 * KB-027 FASE 3: Cache centralizado para Search
 * Substitui 9 Maps desacopladas em SearchEngine, InvertedIndex, SemanticGraphBridge e AutoTagger
 */
export interface SearchCache {
    documentCache: Map<string, any>;
    invertedIndexes: {
        termIndex: Map<string, Set<string>>;
        titleIndex: Map<string, Set<string>>;
        tagIndex: Map<string, Set<string>>;
        categoryIndex: Map<string, Set<string>>;
        termFrequency: Map<string, Map<string, number>>;
        documents: Map<string, any>;
    };
    semanticCache: {
        expansionCache: Map<string, string[]>;
        enrichmentCache: Map<string, any>;
    };
    autoTaggerCache: Map<string, any>;
}

const STM_MAX_MESSAGES = 10; // 5 exchanges

export interface SessionContext {
    conversation_id: string;
    language?: Lang;
    current_goal?: string;
    current_project_id?: string;
    continue_project_only?: boolean;
    capability_policy_overrides?: Record<string, 'auto-install' | 'ask-user' | 'strict-no-install'>;
    last_error?: string;
    last_error_type?: string;
    last_error_hash?: string;
    last_error_fingerprint?: string;
    _tool_input_attempts?: number;
    _input_history?: string[];
    last_artifacts: string[];
    last_action?: string;
    conversation_history: ConversationMessage[];
    pending_actions: PendingAction[];
    task_type?: string;
    task_confidence?: number;
    retry_count?: number;
    lastAccessedAt?: number;
    lastCompletedAction?: {
        type: string;
        originalRequest: string;
        completedAt: number;
    };
    last_input_gap?: {
        capability: string;
        reason: string;
    };
    reactive_state?: any; // Estado de recuperação de falhas (ReactiveState)
    flow_state?: FlowState;
    task_context?: TaskContextData; // Estado operacional contínuo da tarefa
    delta_state?: SessionDeltaState;
    execution_memory_state?: SessionExecutionMemoryState;
    search_cache?: SearchCache; // KB-027 FASE 3: Cache centralizado para Search
}

export type Session = SessionContext;

// Mutex para operações atômicas no sessionStore
class SessionMutex {
    private locked = false;
    private queue: Array<() => void> = [];

    async acquire(): Promise<void> {
        if (!this.locked) {
            this.locked = true;
            return;
        }
        return new Promise<void>((resolve) => {
            this.queue.push(resolve);
        });
    }

    release(): void {
        const next = this.queue.shift();
        if (next) {
            next();
        } else {
            this.locked = false;
        }
    }

    // Executa operação com lock automático
    async withLock<T>(fn: () => T | Promise<T>): Promise<T> {
        await this.acquire();
        try {
            return await fn();
        } finally {
            this.release();
        }
    }
}

const sessionStore = new Map<string, SessionContext>();
const sessionMutex = new SessionMutex();
export const sessionAsyncStorage = new AsyncLocalStorage<SessionContext>();

export class SessionManager {
    /**
     * Obtém sessão de forma thread-safe usando mutex.
     * Evita TOCTOU e condições de corrida.
     */
    static getSession(conversationId: string): SessionContext {
        // Operação síncrona segura: melhor-sqlite3 é síncrono por design
        // O Map em JavaScript é atomic para operações básicas
        const existing = sessionStore.get(conversationId);
        if (existing) {
            existing.lastAccessedAt = Date.now();
            return existing;
        }

        const newSession: SessionContext = {
            conversation_id: conversationId,
            language: 'pt-BR',
            last_artifacts: [],
            conversation_history: [],
            pending_actions: [],
            lastAccessedAt: Date.now()
        };
        sessionStore.set(conversationId, newSession);
        return newSession;
    }

    /**
     * Versão assíncrona para operações que precisam de garantia de atomicidade.
     * Usa mutex para evitar race conditions em cenários de alta concorrência.
     */
    static async getSessionAsync(conversationId: string): Promise<SessionContext> {
        return sessionMutex.withLock(() => {
            const existing = sessionStore.get(conversationId);
            if (existing) {
                existing.lastAccessedAt = Date.now();
                return existing;
            }

            const newSession: SessionContext = {
                conversation_id: conversationId,
                language: 'pt-BR',
                last_artifacts: [],
                conversation_history: [],
                pending_actions: [],
                lastAccessedAt: Date.now()
            };
            sessionStore.set(conversationId, newSession);
            return newSession;
        });
    }

    static runWithSession<T>(conversationId: string, callback: () => T | Promise<T>): T | Promise<T> {
        const session = this.getSession(conversationId);
        return sessionAsyncStorage.run(session, callback);
    }

    static getCurrentSession(): SessionContext | undefined {
        return sessionAsyncStorage.getStore();
    }

    /**
     * Adiciona mensagem ao histórico de forma atômica.
     * Usa mutex para garantir consistência em cenários concorrentes.
     */
    static addToHistory(conversationId: string, role: 'user' | 'assistant', content: string): void {
        const session = this.getSession(conversationId);

        // Operação atômica: push + trim em sequência
        session.conversation_history.push({ role, content });

        // Trim síncrono imediato para limitar tamanho
        if (session.conversation_history.length > STM_MAX_MESSAGES) {
            session.conversation_history = session.conversation_history.slice(-STM_MAX_MESSAGES);
        }
    }

    /**
     * Versão assíncrona para operações de alta concorrência.
     */
    static async addToHistoryAsync(
        conversationId: string,
        role: 'user' | 'assistant',
        content: string
    ): Promise<void> {
        await sessionMutex.withLock(() => {
            const session = sessionStore.get(conversationId);
            if (!session) return;

            session.conversation_history.push({ role, content });
            if (session.conversation_history.length > STM_MAX_MESSAGES) {
                session.conversation_history = session.conversation_history.slice(-STM_MAX_MESSAGES);
            }
        });
    }

    /**
     * Reseta estado volátil de forma atômica.
     */
    static resetVolatileState(conversationId: string): SessionContext {
        const session = this.getSession(conversationId);

        // Reset atômico
        session.last_error = undefined;
        session.last_error_type = undefined;
        session.last_error_hash = undefined;
        session.last_error_fingerprint = undefined;
        session._tool_input_attempts = 0;
        session._input_history = [];

        // Filtrar ações expiradas
        const now = Date.now();
        session.pending_actions = session.pending_actions.filter(
            action => action.expires_at > now
        );

        // Expirar lastCompletedAction stale (>30s)
        if (session.lastCompletedAction) {
            if (now - session.lastCompletedAction.completedAt > 30000) {
                session.lastCompletedAction = undefined;
            }
        }

        // REGRAS DE FLOW: Só limpa se houver falha reativa crítica
        if (session.reactive_state?.hasFailure) {
            session.flow_state = undefined;
        }

        return session;
    }

    /**
     * Atualiza o TaskContext com informações puramente operacionais.
     */
    static updateTaskContext(session: SessionContext, updateData: Partial<TaskContextData>): void {
        if (!session.task_context) {
            session.task_context = {
                active: false,
                type: 'unknown',
                data: {},
                lastUpdated: Date.now(),
                createdAt: Date.now(),
                files: [],
                fileSequence: 0
            };
        }

        // Atualiza campos
        Object.assign(session.task_context, updateData);
        session.task_context.lastUpdated = Date.now();

        // Sincroniza estado de atividade com pending_actions e ações explícitas
        // Se a tarefa foi marcada como ativa OU se há ações pendentes, ela está ativa
        const hasPending = session.pending_actions.length > 0;
        session.task_context.active = session.task_context.active || hasPending;
    }

    /**
     * Adiciona um arquivo ao contexto da tarefa (limita a 20 arquivos).
     * O cleanup de disco deve ser feto externamente para evitar lock no SessionManager.
     */
    static addTaskFile(session: SessionContext, fileData: Omit<ContextFile, 'sequence'>): ContextFile | null {
        if (!session.task_context) {
            this.updateTaskContext(session, { active: true });
        }

        const ctx = session.task_context!;
        const sequence = ++ctx.fileSequence;
        const file: ContextFile = { ...fileData, sequence };

        let removedFile: ContextFile | null = null;
        if (ctx.files.length >= 20) {
            removedFile = ctx.files.shift() || null;
        }

        ctx.files.push(file);
        ctx.lastUpdated = Date.now();

        return removedFile; // Retorna para que o chamador apague do disco
    }

    /**
     * Limpa o TaskContext. 
     * Deve ser chamado em: sucesso final, falha crítica, ou reset forçado.
     */
    static clearTaskContext(session: SessionContext): void {
        if (session.task_context) {
            session.task_context.active = false;
            session.task_context.files = [];
            session.task_context.data = {};
            session.task_context.type = 'unknown';
            session.task_context.lastUpdated = Date.now();
        }
    }

    static getDeltaState(session: SessionContext): SessionDeltaState {
        if (!session.delta_state) {
            session.delta_state = {
                previousConfidence: null,
                lowImprovementCount: 0,
                updatedAt: Date.now()
            };
        }

        return session.delta_state;
    }

    static setDeltaState(session: SessionContext, update: {
        previousConfidence: number | null;
        lowImprovementCount: number;
    }): SessionDeltaState {
        const current = this.getDeltaState(session);
        current.previousConfidence = update.previousConfidence;
        current.lowImprovementCount = update.lowImprovementCount;
        current.updatedAt = Date.now();
        return current;
    }

    static resetDeltaState(session: SessionContext): SessionDeltaState {
        session.delta_state = {
            previousConfidence: null,
            lowImprovementCount: 0,
            updatedAt: Date.now()
        };
        return session.delta_state;
    }

    static getExecutionMemoryState(session: SessionContext): SessionExecutionMemoryState {
        if (!session.execution_memory_state) {
            session.execution_memory_state = {
                entries: [],
                updatedAt: Date.now()
            };
        }

        return session.execution_memory_state;
    }

    static setExecutionMemoryState(
        session: SessionContext,
        entries: SessionExecutionMemoryEntry[]
    ): SessionExecutionMemoryState {
        const state = this.getExecutionMemoryState(session);
        state.entries = entries;
        state.updatedAt = Date.now();
        return state;
    }

    static appendExecutionMemoryEntry(
        session: SessionContext,
        entry: SessionExecutionMemoryEntry,
        maxEntries: number
    ): SessionExecutionMemoryState {
        const state = this.getExecutionMemoryState(session);
        state.entries.push(entry);

        if (state.entries.length > maxEntries) {
            state.entries = state.entries.slice(-maxEntries);
        }

        state.updatedAt = Date.now();
        return state;
    }

    static resetExecutionMemoryState(session: SessionContext): SessionExecutionMemoryState {
        session.execution_memory_state = {
            entries: [],
            updatedAt: Date.now()
        };
        return session.execution_memory_state;
    }

    static getExecutionMemoryToolScores(
        session: SessionContext,
        stepType: string,
        maxAgeMs: number
    ): SessionExecutionMemoryToolScore[] {
        const state = this.getExecutionMemoryState(session);
        const now = Date.now();
        const recentMemory = state.entries.filter(
            (entry) => entry.stepType === stepType && now - entry.timestamp < maxAgeMs
        );

        const toolStats = new Map<string, { success: number; failure: number }>();

        for (const entry of recentMemory) {
            const stats = toolStats.get(entry.tool) || { success: 0, failure: 0 };
            if (entry.success) {
                stats.success++;
            } else {
                stats.failure++;
            }
            toolStats.set(entry.tool, stats);
        }

        const scores: SessionExecutionMemoryToolScore[] = [];
        toolStats.forEach((stats, tool) => {
            scores.push({
                tool,
                score: stats.success - stats.failure,
                successes: stats.success,
                failures: stats.failure
            });
        });

        return scores.sort((a, b) => b.score - a.score);
    }

    static getExecutionMemoryToolConfidence(
        session: SessionContext,
        stepType: string,
        tool: string,
        maxAgeMs: number,
        minSamples: number
    ): SessionExecutionMemoryToolConfidence {
        const state = this.getExecutionMemoryState(session);
        const now = Date.now();
        const recentMemory = state.entries.filter(
            (entry) => entry.stepType === stepType && entry.tool === tool && now - entry.timestamp < maxAgeMs
        );

        if (recentMemory.length >= minSamples) {
            const successes = recentMemory.filter((entry) => entry.success).length;
            return {
                confidence: successes / recentMemory.length,
                isContextual: true
            };
        }

        const globalMemory = state.entries.filter(
            (entry) => entry.tool === tool && now - entry.timestamp < maxAgeMs
        );

        if (globalMemory.length >= minSamples) {
            const successes = globalMemory.filter((entry) => entry.success).length;
            return {
                confidence: successes / globalMemory.length,
                isContextual: false
            };
        }

        return {
            confidence: 0,
            isContextual: false
        };
    }

    static getExecutionMemoryDecisionConfidence(
        session: SessionContext,
        stepType: string,
        scores: Array<{
            tool: string;
            successes: number;
            failures: number;
        }>,
        maxAgeMs: number,
        minSamples: number
    ): number {
        if (scores.length === 0) {
            return 0;
        }

        const bestScore = scores[0];
        if (!bestScore) {
            return 0;
        }

        const { confidence } = this.getExecutionMemoryToolConfidence(
            session,
            stepType,
            bestScore.tool,
            maxAgeMs,
            minSamples
        );

        if (confidence > 0) {
            return confidence;
        }

        const totalAttempts = bestScore.successes + bestScore.failures;
        if (totalAttempts === 0) {
            return 0;
        }

        return bestScore.successes / totalAttempts;
    }

    static getExecutionMemorySelectionSnapshot(
        session: SessionContext,
        params: {
            stepType: string;
            candidateTools: string[];
            maxAgeMs: number;
            minSamples: number;
        }
    ): SessionExecutionMemorySelectionSnapshot {
        const scores = this.getExecutionMemoryToolScores(session, params.stepType, params.maxAgeMs);
        const contextualConfidenceByTool: Record<string, number> = {};
        let bestConfidence = 0;

        for (const candidate of params.candidateTools) {
            const { confidence } = this.getExecutionMemoryToolConfidence(
                session,
                params.stepType,
                candidate,
                params.maxAgeMs,
                params.minSamples
            );
            contextualConfidenceByTool[candidate] = confidence;

            const scoreEntry = scores.find((score) => score.tool === candidate);
            if (scoreEntry && scoreEntry.score > 0 && confidence > bestConfidence) {
                bestConfidence = confidence;
            }
        }

        return {
            stepType: params.stepType,
            candidateTools: [...params.candidateTools],
            scores,
            contextualConfidenceByTool,
            bestConfidence,
            decisionConfidence: bestConfidence > 0
                ? bestConfidence
                : this.getExecutionMemoryDecisionConfidence(
                    session,
                    params.stepType,
                    scores,
                    params.maxAgeMs,
                    params.minSamples
                ),
            updatedAt: Date.now()
        };
    }

    /**
     * Cleanup de sessões antigas com lock para evitar remoção durante iteração.
     */
    static cleanupOldSessions(maxAgeMs: number = 3600000): number {
        const now = Date.now();
        let removed = 0;

        // Coletar IDs para remover (evita modificação durante iteração)
        const toRemove: string[] = [];
        for (const [id, session] of sessionStore.entries()) {
            const lastAccess = session.lastAccessedAt ?? 0;
            if (now - lastAccess > maxAgeMs) {
                toRemove.push(id);
            }
        }

        // Remover coletados
        for (const id of toRemove) {
            sessionStore.delete(id);
            removed++;
        }

        return removed;
    }

    /**
     * Cleanup assíncrono com mutex para ambientes de alta concorrência.
     */
    static async cleanupOldSessionsAsync(maxAgeMs: number = 3600000): Promise<number> {
        return sessionMutex.withLock(() => {
            const now = Date.now();
            let removed = 0;

            const toRemove: string[] = [];
            for (const [id, session] of sessionStore.entries()) {
                const lastAccess = session.lastAccessedAt ?? 0;
                if (now - lastAccess > maxAgeMs) {
                    toRemove.push(id);
                }
            }

            for (const id of toRemove) {
                sessionStore.delete(id);
                removed++;
            }

            return removed;
        });
    }

    static getSafeSession(conversationId: string = 'default'): SessionContext {
        const session = this.getCurrentSession();
        if (session) return session;
        return this.getSession(conversationId);
    }

    /**
     * Verifica se uma sessão existe sem criar nova.
     */
    static hasSession(conversationId: string): boolean {
        return sessionStore.has(conversationId);
    }

    /**
     * Remove uma sessão específica.
     */
    static deleteSession(conversationId: string): boolean {
        return sessionStore.delete(conversationId);
    }

    /**
     * Retorna número de sessões ativas (para monitoramento).
     */
    static getSessionCount(): number {
        return sessionStore.size;
    }

    // Garante que todas as operações no sessionStore sejam feitas com lock
    public async getSession(sessionId: string): Promise<SessionContext | undefined> {
        return sessionMutex.withLock(() => {
            return sessionStore.get(sessionId);
        });
    }

    public async setSession(sessionId: string, session: SessionContext): Promise<void> {
        return sessionMutex.withLock(() => {
            sessionStore.set(sessionId, session);
        });
    }

    public async deleteSession(sessionId: string): Promise<void> {
        return sessionMutex.withLock(() => {
            sessionStore.delete(sessionId);
        });
    }

    /**
     * Retorna um snapshot semântico do estado cognitivo da sessão.
     * Centraliza a interpretação de flags soltas para o motor de decisão.
     */
    static getCognitiveState(session: SessionContext) {
        const hasReactiveFailure = session.reactive_state?.hasFailure === true;
        const pending = getPendingAction(session);

        return {
            hasPendingAction: Boolean(pending),
            hasReactiveFailure,
            lastErrorType: session.last_error_type,
            projectId: session.current_project_id,
            attempt: session.reactive_state?.attempt ?? 0,
            isInRecovery: hasReactiveFailure,
            isStable: !pending && !hasReactiveFailure,
            pendingAction: pending,
            reactiveState: session.reactive_state,
            taskContext: session.task_context,
            // KB-021: fluxo guiado visível no CognitiveState
            isInGuidedFlow: Boolean(session.flow_state),
            guidedFlowState: session.flow_state ?? undefined
        };
    }
}

// Cleanup periódico com tratamento de erro
let cleanupIntervalId: ReturnType<typeof setInterval> | null = null;

function startCleanupInterval(): void {
    if (cleanupIntervalId) return;

    cleanupIntervalId = setInterval(() => {
        try {
            SessionManager.cleanupOldSessions();
        } catch (error) {
            console.error('[SessionManager] Erro no cleanup:', error);
        }
    }, 300000);
}

// Iniciar cleanup automaticamente
startCleanupInterval();

// Exportar função para parar cleanup (útil para tests)
export function stopCleanupInterval(): void {
    if (cleanupIntervalId) {
        clearInterval(cleanupIntervalId);
        cleanupIntervalId = null;
    }
}
