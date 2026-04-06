import type { StopContinueSignal } from '../../../../engine/AgentLoopTypes';
import type { ObservedStopSignalLogEntry } from '../../types/ObservedSignalLogTypes';

export function buildObservedStopSignalLogEntries(params: {
    sessionId: string;
    signal: StopContinueSignal;
}): ObservedStopSignalLogEntry[] {
    const { sessionId, signal } = params;

    return [
        {
            event: 'signal_stop_observed',
            message: '[ORCHESTRATOR PASSIVE] StopContinueSignal observado',
            payload: {
                sessionId,
                shouldStop: signal.shouldStop,
                reason: signal.reason,
                globalConfidence: signal.globalConfidence,
                stepCount: signal.stepCount
            }
        },
        {
            event: 'stop_decision_made_by_loop',
            message: signal.shouldStop
                ? '[ORCHESTRATOR PASSIVE] AgentLoop decidiu PARAR'
                : '[ORCHESTRATOR PASSIVE] AgentLoop decidiu CONTINUAR',
            payload: {
                sessionId,
                reason: signal.reason,
                confidence: signal.globalConfidence
            }
        }
    ];
}
