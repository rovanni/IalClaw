import type { StopContinueSignal } from '../../../../engine/AgentLoopTypes';
import type {
    StopContinueActiveDecisionPayload,
    StopContinueAuthorityResolutionPayload,
    StopContinueContextualAdjustmentPayload,
    StopContinueDecisionDeltaPayload,
    StopContinueGovernanceAuditContext
    ,
    StopContinueRecurrentFailurePayload
} from '../../types/StopContinueGovernanceTypes';

export function buildStopContinueAuthorityResolutionPayload(params: {
    sessionId: string;
    authorityDecision: { override?: boolean };
    finalDecision: StopContinueSignal;
}): StopContinueAuthorityResolutionPayload {
    const { sessionId, authorityDecision, finalDecision } = params;

    return {
        type: 'signal_authority_resolution',
        sessionId,
        decisionPoint: 'stop_continue',
        authorityDecision,
        overriddenSignals: [],
        finalDecision: {
            shouldStop: finalDecision.shouldStop,
            reason: finalDecision.reason,
            globalConfidence: finalDecision.globalConfidence,
            stepCount: finalDecision.stepCount
        }
    };
}

export function buildStopContinueDecisionDeltaPayload(params: {
    sessionId: string;
    baseDecision: StopContinueSignal;
    finalDecision: StopContinueSignal;
    context: StopContinueGovernanceAuditContext;
}): StopContinueDecisionDeltaPayload | undefined {
    const { sessionId, baseDecision, finalDecision, context } = params;

    if (baseDecision.shouldStop === finalDecision.shouldStop) {
        return undefined;
    }

    return {
        sessionId,
        baseShouldStop: baseDecision.shouldStop,
        finalShouldStop: finalDecision.shouldStop,
        baseReason: baseDecision.reason,
        finalReason: finalDecision.reason,
        context
    };
}

export function buildStopContinueContextualAdjustmentPayload(params: {
    sessionId: string;
    baseDecision: StopContinueSignal;
    recoveryDecision: StopContinueSignal;
    context: {
        attempt?: number;
        hasPendingAction?: boolean;
        isInRecovery?: boolean;
    };
}): StopContinueContextualAdjustmentPayload {
    const { sessionId, baseDecision, recoveryDecision, context } = params;

    return {
        sessionId,
        baseReason: baseDecision.reason,
        adjustedReason: recoveryDecision.reason,
        recoveryAttempt: context.attempt,
        hasPendingAction: context.hasPendingAction,
        isInRecovery: context.isInRecovery
    };
}

export function buildStopContinueRecurrentFailurePayload(params: {
    sessionId: string;
    baseDecision: StopContinueSignal;
    context: StopContinueGovernanceAuditContext;
}): StopContinueRecurrentFailurePayload {
    const { sessionId, baseDecision, context } = params;

    return {
        sessionId,
        attempt: context.attempt,
        hasReactiveFailure: context.hasReactiveFailure,
        baseReason: baseDecision.reason
    };
}

export function buildStopContinueActiveDecisionPayload(params: {
    sessionId: string;
    finalDecision: StopContinueSignal;
    adjustedDecision?: StopContinueSignal;
}): StopContinueActiveDecisionPayload {
    const { sessionId, finalDecision, adjustedDecision } = params;

    return {
        sessionId,
        shouldStop: finalDecision.shouldStop,
        reason: finalDecision.reason,
        globalConfidence: finalDecision.globalConfidence,
        stepCount: finalDecision.stepCount,
        source: adjustedDecision ? 'loop_signal_contextually_refined_by_orchestrator' : 'loop_heuristics_applied_by_orchestrator',
        contextualAdjustmentApplied: !!adjustedDecision
    };
}
