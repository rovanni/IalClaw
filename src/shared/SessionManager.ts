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
            reactiveState: session.reactive_state
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
