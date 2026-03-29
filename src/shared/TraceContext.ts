import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface TraceStore {
    trace_id: string;
    agent_id: string;
}

export const traceStorage = new AsyncLocalStorage<TraceStore>();

export function runWithTrace<T>(callback: () => T, agent_id: string = 'system_core'): T {
    const currentStore = traceStorage.getStore();
    if (currentStore?.trace_id) {
        return callback();
    }

    const traceId = randomUUID();
    return traceStorage.run({ trace_id: traceId, agent_id }, callback);
}

export function getContext(): TraceStore | undefined {
    return traceStorage.getStore();
}

/**
 * Recupera o traceId atual de qualquer lugar do código (sem prop drilling).
 */
export function getTraceId(): string {
    return traceStorage.getStore()?.trace_id || 'no-trace-id';
}
