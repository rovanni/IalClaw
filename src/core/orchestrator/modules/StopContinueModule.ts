import { StopContinueSignal } from '../../../engine/AgentLoop';

export type StopContinueExecutionContext = {
    hasPendingSteps: boolean;
    failSafeActive: boolean;
    stepCount: number;
    globalConfidence: number;
    lastStepSuccessful: boolean;
    globalConfidenceThreshold: number;
    maxStepsBeforeOverexecutionCheck: number;
    stepValidations: number[];
};

export type StopContinueDeltaContext = {
    stepIndex: number;
    stepValidations: number[];
    previousConfidence: number | null;
    lowImprovementCount: number;
    minDeltaThreshold: number;
    maxLowImprovements: number;
};

export type StopContinueDeltaEvaluationResult = {
    decision: StopContinueSignal;
    nextPreviousConfidence: number | null;
    nextLowImprovementCount: number;
};

export class StopContinueModule {
    public decide(signal: StopContinueSignal): StopContinueSignal | undefined {
        if (this.isContextFreePassThrough(signal)) {
            return signal;
        }

        return undefined;
    }

    public isRecoveryContinuationEligible(signal: StopContinueSignal): boolean {
        return signal.shouldStop && (
            signal.reason === 'low_improvement_delta' ||
            signal.reason === 'over_execution_detected'
        );
    }

    public isRecurrentFailureEscalationEligible(signal: StopContinueSignal): boolean {
        return signal.shouldStop === false;
    }

    public createRecoveryContinuationDecision(signal: StopContinueSignal): StopContinueSignal {
        return {
            ...signal,
            shouldStop: false,
            reason: 'execution_continues'
        };
    }

    public createRecurrentFailureStopDecision(signal: StopContinueSignal): StopContinueSignal {
        return {
            ...signal,
            shouldStop: true,
            reason: 'recurrent_failure_detected'
        };
    }

    public evaluateExecutionStop(context: StopContinueExecutionContext): StopContinueSignal {
        const {
            hasPendingSteps,
            failSafeActive,
            stepCount,
            globalConfidence,
            lastStepSuccessful,
            globalConfidenceThreshold,
            maxStepsBeforeOverexecutionCheck,
            stepValidations
        } = context;

        if (hasPendingSteps && failSafeActive) {
            return { shouldStop: false, reason: 'fail_safe_prevents_stop_has_pending_steps', stepCount };
        }

        if (stepCount < 2) {
            return { shouldStop: false, reason: 'insufficient_steps', stepCount };
        }

        if (hasPendingSteps && globalConfidence >= globalConfidenceThreshold && lastStepSuccessful) {
            return { shouldStop: false, reason: 'has_pending_steps_prevent_stop', globalConfidence, stepCount };
        }

        if (globalConfidence >= globalConfidenceThreshold && lastStepSuccessful && !hasPendingSteps) {
            return {
                shouldStop: true,
                reason: 'global_confidence_threshold_met',
                globalConfidence,
                stepCount
            };
        }

        if (stepCount >= maxStepsBeforeOverexecutionCheck) {
            const recentValidations = stepValidations.slice(-3);
            if (recentValidations.length >= 2) {
                const avgRecent = recentValidations.reduce((a, b) => a + b, 0) / recentValidations.length;
                if (avgRecent < 0.4) {
                    return {
                        shouldStop: true,
                        reason: 'over_execution_detected',
                        globalConfidence: avgRecent,
                        stepCount
                    };
                }
            }
        }

        return { shouldStop: false, reason: 'execution_continues', stepCount };
    }

    public evaluateDeltaStop(context: StopContinueDeltaContext): StopContinueDeltaEvaluationResult {
        const {
            stepIndex,
            stepValidations,
            previousConfidence,
            lowImprovementCount,
            minDeltaThreshold,
            maxLowImprovements
        } = context;

        if (stepIndex < 2) {
            return {
                decision: { shouldStop: false, reason: 'insufficient_steps_for_delta', stepCount: stepIndex },
                nextPreviousConfidence: previousConfidence,
                nextLowImprovementCount: lowImprovementCount
            };
        }

        if (stepValidations.length < 2) {
            return {
                decision: { shouldStop: false, reason: 'insufficient_validations_for_delta', stepCount: stepIndex },
                nextPreviousConfidence: previousConfidence,
                nextLowImprovementCount: lowImprovementCount
            };
        }

        const recent = stepValidations.slice(-3);
        const currentConfidence = recent.reduce((a, b) => a + b, 0) / recent.length;

        if (typeof currentConfidence !== 'number') {
            return {
                decision: { shouldStop: false, reason: 'invalid_confidence', stepCount: stepIndex },
                nextPreviousConfidence: previousConfidence,
                nextLowImprovementCount: lowImprovementCount
            };
        }

        let nextLowImprovementCount = lowImprovementCount;

        if (previousConfidence !== null) {
            const delta = currentConfidence - previousConfidence;
            if (delta < minDeltaThreshold) {
                nextLowImprovementCount++;
            } else {
                nextLowImprovementCount = 0;
            }
        }

        if (nextLowImprovementCount >= maxLowImprovements) {
            return {
                decision: {
                    shouldStop: true,
                    reason: 'low_improvement_delta',
                    globalConfidence: currentConfidence,
                    stepCount: stepIndex
                },
                nextPreviousConfidence: currentConfidence,
                nextLowImprovementCount
            };
        }

        return {
            decision: { shouldStop: false, reason: 'delta_check_continues', globalConfidence: currentConfidence, stepCount: stepIndex },
            nextPreviousConfidence: currentConfidence,
            nextLowImprovementCount
        };
    }

    private isContextFreePassThrough(signal: StopContinueSignal): boolean {
        return signal.shouldStop && !this.isRecoveryContinuationEligible(signal);
    }
}