import type { CognitiveSignalsState } from '../../../../engine/AgentLoopTypes';
import type { ObservedSignalLogEntry } from '../../types/ObservedSignalLogTypes';

export function buildObservedSignalLogEntries(params: {
    sessionId: string;
    signals: Readonly<CognitiveSignalsState>;
    toolSelectionObservedMessage: string;
}): ObservedSignalLogEntry[] {
    const { sessionId, signals, toolSelectionObservedMessage } = params;
    const entries: ObservedSignalLogEntry[] = [];

    if (signals.fallback) {
        entries.push({
            event: 'signal_fallback_observed',
            message: '[ORCHESTRATOR PASSIVE] ToolFallbackSignal observado',
            payload: {
                sessionId,
                trigger: signals.fallback.trigger,
                fallbackRecommended: signals.fallback.fallbackRecommended,
                originalTool: signals.fallback.originalTool,
                suggestedTool: signals.fallback.suggestedTool,
                reason: signals.fallback.reason
            }
        });
    }

    if (signals.fallbackStrategy) {
        entries.push({
            event: 'signal_fallback_strategy_observed',
            message: '[ORCHESTRATOR PASSIVE] FallbackStrategySignal observado',
            payload: {
                sessionId,
                trigger: signals.fallbackStrategy.trigger,
                shouldApplyHint: signals.fallbackStrategy.shouldApplyHint,
                reason: signals.fallbackStrategy.reason,
                failedToolsCount: signals.fallbackStrategy.failedToolsCount,
                threshold: signals.fallbackStrategy.threshold,
                toolCallsCount: signals.fallbackStrategy.toolCallsCount,
                hasPendingSteps: signals.fallbackStrategy.hasPendingSteps
            }
        });
    }

    if (signals.toolSelection) {
        entries.push({
            event: 'signal_tool_selection_observed',
            message: toolSelectionObservedMessage,
            payload: {
                sessionId,
                stepType: signals.toolSelection.stepType,
                candidateTools: signals.toolSelection.candidateTools,
                recommendedTool: signals.toolSelection.recommendedTool,
                reason: signals.toolSelection.reason,
                shouldExplore: signals.toolSelection.shouldExplore
            }
        });
    }

    if (signals.validation) {
        entries.push({
            event: 'signal_validation_observed',
            message: '[ORCHESTRATOR PASSIVE] StepValidationSignal observado',
            payload: {
                sessionId,
                validationPassed: signals.validation.validationPassed,
                reason: signals.validation.reason,
                requiresLlmReview: signals.validation.requiresLlmReview
            }
        });
    }

    if (signals.route) {
        entries.push({
            event: 'signal_route_observed',
            message: '[ORCHESTRATOR PASSIVE] RouteAutonomySignal observado',
            payload: {
                sessionId,
                recommendedStrategy: signals.route.recommendedStrategy,
                route: signals.route.route,
                reason: signals.route.reason
            }
        });
    }

    if (signals.failSafe) {
        entries.push({
            event: 'signal_failsafe_observed',
            message: '[ORCHESTRATOR PASSIVE] FailSafeSignal observado',
            payload: {
                sessionId,
                isActivated: signals.failSafe.activated,
                trigger: signals.failSafe.trigger
            }
        });
    }

    if (signals.llmRetry) {
        entries.push({
            event: 'signal_llm_retry_observed',
            message: '[ORCHESTRATOR PASSIVE] LlmRetrySignal observado',
            payload: {
                sessionId,
                retryRecommended: signals.llmRetry.retryRecommended,
                reason: signals.llmRetry.reason,
                consecutiveFailures: signals.llmRetry.consecutiveFailures
            }
        });
    }

    if (signals.reclassification) {
        entries.push({
            event: 'signal_reclassification_observed',
            message: '[ORCHESTRATOR PASSIVE] ReclassificationSignal observado',
            payload: {
                sessionId,
                reclassificationRecommended: signals.reclassification.reclassificationRecommended,
                reason: signals.reclassification.reason,
                suggestedTaskType: signals.reclassification.suggestedTaskType,
                confidence: signals.reclassification.confidence
            }
        });
    }

    if (signals.planAdjustment) {
        entries.push({
            event: 'signal_plan_adjustment_observed',
            message: '[ORCHESTRATOR PASSIVE] PlanAdjustmentSignal observado',
            payload: {
                sessionId,
                shouldAdjustPlan: signals.planAdjustment.shouldAdjustPlan,
                reason: signals.planAdjustment.reason,
                failedStep: signals.planAdjustment.failedStep,
                failureReason: signals.planAdjustment.failureReason
            }
        });
    }

    if (signals.realityCheck) {
        entries.push({
            event: 'signal_reality_check_observed',
            message: '[ORCHESTRATOR PASSIVE] RealityCheckSignal observado',
            payload: {
                sessionId,
                shouldInject: signals.realityCheck.shouldInject,
                reason: signals.realityCheck.reason,
                toolCallsCount: signals.realityCheck.toolCallsCount,
                hasGroundingEvidence: signals.realityCheck.hasGroundingEvidence
            }
        });
    }

    if (signals.realityCheckFacts) {
        entries.push({
            event: 'signal_reality_check_facts_observed',
            message: '[ORCHESTRATOR PASSIVE] RealityCheckFacts observado',
            payload: {
                sessionId,
                hasExecutionClaim: signals.realityCheckFacts.hasExecutionClaim,
                hasGroundingEvidence: signals.realityCheckFacts.hasGroundingEvidence,
                toolCallsCount: signals.realityCheckFacts.toolCallsCount,
                hasToolEvidence: signals.realityCheckFacts.hasToolEvidence
            }
        });
    }

    return entries;
}
