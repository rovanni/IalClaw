import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

export interface TraceStore {
    trace_id: string;
    agent_id: string;
}

// Cria um armazenamento isolado para cada requisição/fluxo assíncrono
export const traceStorage = new AsyncLocalStorage<TraceStore>();

/**
 * Envolve a execução principal. Tudo rodado aqui dentro compartilha o mesmo traceId.
 */
export function runWithTrace<T>(callback: () => T, agent_id: string = 'system_core'): T {
    const traceId = randomUUID();
    return traceStorage.run({ trace_id: traceId, agent_id }, callback);
}

export function getContext(): TraceStore {
    const store = traceStorage.getStore();
    if (!store?.trace_id) throw new Error('trace_id ausente no contexto assíncrono');
    return store;
}

/**
 * Recupera o traceId atual de qualquer lugar do código (sem prop drilling).
 */
export function getTraceId(): string {
    return traceStorage.getStore()?.trace_id || 'no-trace-id';
}