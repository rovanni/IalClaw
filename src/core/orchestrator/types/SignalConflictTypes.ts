import { ExecutionRoute } from '../../autonomy/ActionRouter';
import type {
    FailSafeSignal,
    LlmRetrySignal,
    PlanAdjustmentSignal,
    ReclassificationSignal,
    RouteAutonomySignal,
    StepValidationSignal,
    StopContinueSignal,
    ToolFallbackSignal
} from '../../../engine/AgentLoopTypes';
import type { SelfHealingSignal } from '../../executor/AgentExecutor';

export type SignalConflictId =
    | 'self_healing_vs_stop_continue'
    | 'self_healing_vs_fail_safe'
    | 'validation_vs_self_healing'
    | 'route_autonomy_vs_fail_safe'
    | 'llm_retry_vs_stop_continue'
    | 'plan_adjustment_vs_stop_continue'
    | 'reclassification_vs_fail_safe'
    | 'tool_fallback_vs_fail_safe'
    | 'tool_fallback_vs_retry'
    | 'tool_fallback_vs_direct_execution'
    | 'tool_fallback_vs_replan';

export type SignalConflictSeverity = 'medium' | 'high' | 'critical';

export type SignalConflictFactContext = {
    selfHealing?: SelfHealingSignal;
    stopContinue?: StopContinueSignal;
    failSafe?: FailSafeSignal;
    validation?: StepValidationSignal;
    route?: RouteAutonomySignal;
    fallback?: ToolFallbackSignal;
    llmRetry?: LlmRetrySignal;
    reclassification?: ReclassificationSignal;
    planAdjustment?: PlanAdjustmentSignal;
    routeVsFailSafeConflictLoggedInCycle?: boolean;
};

export type SignalConflictCandidate = {
    conflict: SignalConflictId;
    severity: SignalConflictSeverity;
    details: Record<string, unknown>;
};

export function routeRequestsExecution(route?: RouteAutonomySignal): boolean {
    return !!route && (
        route.route === ExecutionRoute.DIRECT_LLM ||
        route.route === ExecutionRoute.TOOL_LOOP
    );
}
