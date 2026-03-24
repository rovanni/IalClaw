import { AsyncLocalStorage } from 'async_hooks';

export interface SessionContext {
    conversation_id: string;
    current_goal?: string;
    current_project_id?: string;
    last_error?: string;
    last_error_type?: string;
    last_error_hash?: string;
    last_error_fingerprint?: string;
    _tool_input_attempts?: number;
    _input_history?: string[];
    last_artifacts: string[];
    last_action?: string;
}

export type Session = SessionContext;

const sessionStore = new Map<string, SessionContext>();
export const sessionAsyncStorage = new AsyncLocalStorage<SessionContext>();

export class SessionManager {
    static getSession(conversationId: string): SessionContext {
        if (!sessionStore.has(conversationId)) {
            sessionStore.set(conversationId, {
                conversation_id: conversationId,
                last_artifacts: []
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

    static resetVolatileState(conversationId: string): SessionContext {
        const session = this.getSession(conversationId);
        session.last_error = undefined;
        session.last_error_type = undefined;
        session.last_error_hash = undefined;
        session.last_error_fingerprint = undefined;
        session._tool_input_attempts = 0;
        session._input_history = [];
        return session;
    }
}
