import type { SelfHealingSignal } from '../../../executor/AgentExecutor';
import type { SelfHealingObservedPayload } from '../../types/SelfHealingLogTypes';

export function buildSelfHealingObservedPayload(params: {
    sessionId: string;
    signal: Readonly<SelfHealingSignal>;
}): SelfHealingObservedPayload {
    const { sessionId, signal } = params;

    return {
        sessionId,
        activated: signal.activated,
        attempts: signal.attempts,
        maxAttempts: signal.maxAttempts,
        success: signal.success,
        lastError: signal.lastError,
        stepId: signal.stepId,
        toolName: signal.toolName
    };
}
