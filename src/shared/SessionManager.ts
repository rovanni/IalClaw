import { AsyncLocalStorage } from 'async_hooks';
import { Lang } from '../i18n/types';

export interface ConversationMessage {
    role: 'user' | 'assistant';
    content: string;
}

export interface PendingAction {
    id: string;
    type: 'install_skill';
    payload: { skillName: string };
    timestamp: number;
    expires_at: number;
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
}

export type Session = SessionContext;

const sessionStore = new Map<string, SessionContext>();
export const sessionAsyncStorage = new AsyncLocalStorage<SessionContext>();

export class SessionManager {
    static getSession(conversationId: string): SessionContext {
        if (!sessionStore.has(conversationId)) {
            sessionStore.set(conversationId, {
                conversation_id: conversationId,
                language: 'pt-BR',
                last_artifacts: [],
                conversation_history: [],
                pending_actions: []
            });
        }
        return sessionStore.get(conversationId)!;
    }

    static runWithSession<T>(conversationId: string, callback: () => T | Promise<T>): T | Promise<T> {
        const session = this.getSession(conversationId);
        return sessionAsyncStorage.run(session, callback);
    }

    static getCurrentSession(): SessionContext | undefined {
        return sessionAsyncStorage.getStore();
    }

    static addToHistory(conversationId: string, role: 'user' | 'assistant', content: string): void {
        const session = this.getSession(conversationId);
        session.conversation_history.push({ role, content });
        if (session.conversation_history.length > STM_MAX_MESSAGES) {
            session.conversation_history = session.conversation_history.slice(-STM_MAX_MESSAGES);
        }
    }

    static resetVolatileState(conversationId: string): SessionContext {
        const session = this.getSession(conversationId);
        session.last_error = undefined;
        session.last_error_type = undefined;
        session.last_error_hash = undefined;
        session.last_error_fingerprint = undefined;
        session._tool_input_attempts = 0;
        session._input_history = [];
        session.pending_actions = [];
        return session;
    }
}
