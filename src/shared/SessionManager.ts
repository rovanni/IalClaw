import { AsyncLocalStorage } from 'async_hooks';

export interface SessionContext {
    conversation_id: string;
    current_goal?: string;
    current_project_id?: string;
    last_artifacts: string[];
    last_action?: string;
}

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
}
