import type { FailSafeSignal, StepValidationSignal, StopContinueSignal } from '../../../../engine/AgentLoopTypes';
import type { SelfHealingSignal } from '../../../executor/AgentExecutor';
import type {
    RetryAfterFailureAuthorityResolutionPayload,
    RetryDecisionPayload,
    SelfHealingActiveDecisionPayload
} from '../../types/RetryAfterFailureDebugTypes';

export function buildRetryAfterFailureAuthorityResolutionPayload(params: {
    sessionId: string;
    authorityDecision: { override?: boolean };
    finalDecision: boolean | undefined;
}): RetryAfterFailureAuthorityResolutionPayload {
    const { sessionId, authorityDecision, finalDecision } = params;

    return {
        type: 'signal_authority_resolution',
        sessionId,
        decisionPoint: 'self_healing_retry',
        authorityDecision,
        overriddenSignals: [],
        finalDecision
    };
}

export function buildRetryDecisionPayload(params: {
    sessionId: string;
    attempt?: number;
    orchestratorDecision: boolean | undefined;
    executorDecision?: boolean;
    finalDecision: boolean | undefined;
}): RetryDecisionPayload {
    const { sessionId, attempt, orchestratorDecision, executorDecision, finalDecision } = params;

    return {
        type: 'retry_decision',
        sessionId,
        attempt,
        orchestratorDecision,
        executorDecision,
        finalDecision
    };
}

export function buildSelfHealingActiveDecisionPayload(params: {
    sessionId: string;
    selfHealingSignal?: SelfHealingSignal;
    failSafeSignal?: FailSafeSignal;
    stopSignal?: StopContinueSignal;
    validationSignal?: StepValidationSignal;
    finalDecision: boolean | undefined;
    reason: string;
}): SelfHealingActiveDecisionPayload {
    const { sessionId, selfHealingSignal, failSafeSignal, stopSignal, validationSignal, finalDecision, reason } = params;

    return {
        sessionId,
        source: 'existing_signal_governance',
        activated: selfHealingSignal?.activated ?? false,
        attempts: selfHealingSignal?.attempts,
        maxAttempts: selfHealingSignal?.maxAttempts,
        success: selfHealingSignal?.success,
        stepId: selfHealingSignal?.stepId,
        toolName: selfHealingSignal?.toolName,
        failSafeActivated: failSafeSignal?.activated ?? false,
        stopShouldStop: stopSignal?.shouldStop ?? false,
        validationPassed: validationSignal?.validationPassed,
        orchestratorDecision: finalDecision,
        reason
    };
}
