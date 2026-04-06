import { ExecutionRoute } from '../../../autonomy/ActionRouter';
import type { SignalConflictCandidate, SignalConflictFactContext } from '../../types/SignalConflictTypes';
import { routeRequestsExecution } from '../../types/SignalConflictTypes';

export function detectSignalConflicts(context: SignalConflictFactContext): SignalConflictCandidate[] {
    const {
        selfHealing,
        stopContinue,
        failSafe,
        validation,
        route,
        fallback,
        llmRetry,
        reclassification,
        planAdjustment,
        routeVsFailSafeConflictLoggedInCycle
    } = context;

    const conflicts: SignalConflictCandidate[] = [];

    if (selfHealing?.activated && stopContinue?.shouldStop) {
        conflicts.push({
            conflict: 'self_healing_vs_stop_continue',
            severity: 'high',
            details: { selfHealing, stopContinue }
        });
    }

    if (selfHealing?.activated && failSafe?.activated) {
        conflicts.push({
            conflict: 'self_healing_vs_fail_safe',
            severity: 'critical',
            details: { selfHealing, failSafe }
        });
    }

    if (validation && !validation.validationPassed && selfHealing?.activated) {
        conflicts.push({
            conflict: 'validation_vs_self_healing',
            severity: 'medium',
            details: { validation, selfHealing }
        });
    }

    if (llmRetry?.retryRecommended && stopContinue?.shouldStop) {
        conflicts.push({
            conflict: 'llm_retry_vs_stop_continue',
            severity: 'high',
            details: { llmRetry, stopContinue }
        });
    }

    if (planAdjustment?.shouldAdjustPlan && stopContinue?.shouldStop) {
        conflicts.push({
            conflict: 'plan_adjustment_vs_stop_continue',
            severity: 'high',
            details: { planAdjustment, stopContinue }
        });
    }

    if (reclassification?.reclassificationRecommended && failSafe?.activated) {
        conflicts.push({
            conflict: 'reclassification_vs_fail_safe',
            severity: 'medium',
            details: { reclassification, failSafe }
        });
    }

    if (fallback?.fallbackRecommended && failSafe?.activated) {
        conflicts.push({
            conflict: 'tool_fallback_vs_fail_safe',
            severity: 'high',
            details: { fallback, failSafe }
        });
    }

    if (fallback?.fallbackRecommended && llmRetry?.retryRecommended) {
        conflicts.push({
            conflict: 'tool_fallback_vs_retry',
            severity: 'medium',
            details: { fallback, llmRetry }
        });
    }

    if (fallback?.fallbackRecommended && planAdjustment?.shouldAdjustPlan) {
        conflicts.push({
            conflict: 'tool_fallback_vs_replan',
            severity: 'medium',
            details: { fallback, planAdjustment }
        });
    }

    if (fallback?.fallbackRecommended && route?.route === ExecutionRoute.DIRECT_LLM) {
        conflicts.push({
            conflict: 'tool_fallback_vs_direct_execution',
            severity: 'high',
            details: { fallback, route }
        });
    }

    if (failSafe?.activated && route && routeRequestsExecution(route) && !routeVsFailSafeConflictLoggedInCycle) {
        conflicts.push({
            conflict: 'route_autonomy_vs_fail_safe',
            severity: 'high',
            details: { route, failSafe }
        });
    }

    return conflicts;
}
