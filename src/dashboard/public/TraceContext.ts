import { AsyncLocalStorage } from 'async_hooks';
import { randomUUID } from 'crypto';

// Cria um armazenamento isolado para cada requisição/fluxo assíncrono
export const traceStorage = new AsyncLocalStorage<string>();

/**
 * Envolve a execução principal. Tudo rodado aqui dentro compartilha o mesmo traceId.
 */
export function runWithTrace<T>(callback: () => T): T {
    const traceId = randomUUID();
    return traceStorage.run(traceId, callback);
}

/**
 * Recupera o traceId atual de qualquer lugar do código (sem prop drilling).
 */
export function getTraceId(): string {
    return traceStorage.getStore() || 'no-trace-id';
}