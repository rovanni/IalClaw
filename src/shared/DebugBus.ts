import { EventEmitter } from 'events';
import { getTraceId } from './TraceContext';

// Singleton exportado para que toda a aplicação use a mesma instância do barramento
export const debugBus = new EventEmitter();

export function emitDebug(type: string, payload: any) {
    // Dispara o evento injetando o trace_id atual automaticamente
    debugBus.emit(type, {
        ...payload,
        trace_id: getTraceId(),
        timestamp: Date.now()
    });
}

// Sempre remova listeners não mais necessários para evitar vazamento
public removeDebugListener(type: string, listener: (...args: any[]) => void) {
    debugBus.removeListener(type, listener);
}