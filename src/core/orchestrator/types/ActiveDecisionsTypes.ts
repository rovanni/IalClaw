import { FailSafeSignal, RouteAutonomySignal, StepValidationSignal, StopContinueSignal, ToolFallbackSignal } from '../../../engine/AgentLoopTypes';

export type ActiveDecisionSnapshot = {
    stop?: StopContinueSignal;
    fallback?: ToolFallbackSignal;
    validation?: StepValidationSignal;
    route?: RouteAutonomySignal;
    failSafe?: FailSafeSignal;
};

export type SafeModeFallbackAppliedSummary = {
    stop: boolean;
    fallback: boolean;
    validation: boolean;
    route: boolean;
    failSafe: boolean;
};

export type ActiveDecisionsResult = {
    loop: ActiveDecisionSnapshot;
    orchestrator: ActiveDecisionSnapshot;
    applied: ActiveDecisionSnapshot;
    safeModeFallbackApplied: SafeModeFallbackAppliedSummary;
};
