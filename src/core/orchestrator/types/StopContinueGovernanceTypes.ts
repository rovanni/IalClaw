import type { StopContinueSignal } from '../../../engine/AgentLoopTypes';

export type StopContinueGovernanceAuditContext = {
    attempt?: number;
    hasReactiveFailure?: boolean;
};

export type StopContinueGovernanceSource =
    | 'loop_signal_contextually_refined_by_orchestrator'
    | 'loop_heuristics_applied_by_orchestrator';

export type StopContinueFinalDecisionSnapshot = {
    shouldStop: boolean;
    reason: StopContinueSignal['reason'];
    globalConfidence?: number;
    stepCount?: number;
};

export type StopContinueAuthorityResolutionPayload = {
    type: 'signal_authority_resolution';
    sessionId: string;
    decisionPoint: 'stop_continue';
    authorityDecision: { override?: boolean };
    overriddenSignals: [];
    finalDecision: StopContinueFinalDecisionSnapshot;
};

export type StopContinueDecisionDeltaPayload = {
    sessionId: string;
    baseShouldStop: boolean;
    finalShouldStop: boolean;
    baseReason: StopContinueSignal['reason'];
    finalReason: StopContinueSignal['reason'];
    context: StopContinueGovernanceAuditContext;
};

export type StopContinueContextualAdjustmentPayload = {
    sessionId: string;
    baseReason: StopContinueSignal['reason'];
    adjustedReason: StopContinueSignal['reason'];
    recoveryAttempt?: number;
    hasPendingAction?: boolean;
    isInRecovery?: boolean;
};

export type StopContinueRecurrentFailurePayload = {
    sessionId: string;
    attempt?: number;
    hasReactiveFailure?: boolean;
    baseReason: StopContinueSignal['reason'];
};

export type StopContinueActiveDecisionPayload = {
    sessionId: string;
    shouldStop: boolean;
    reason: StopContinueSignal['reason'];
    globalConfidence?: number;
    stepCount?: number;
    source: StopContinueGovernanceSource;
    contextualAdjustmentApplied: boolean;
};
