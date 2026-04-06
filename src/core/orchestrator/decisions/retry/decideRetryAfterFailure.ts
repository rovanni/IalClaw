import { RetryAfterFailureDecision, RetryAfterFailureDecisionContext } from '../../types/RetryAfterFailureTypes';

export function decideRetryAfterFailure(context: RetryAfterFailureDecisionContext): RetryAfterFailureDecision {
    const { failSafe, stopContinue, validation, selfHealing } = context;

    if (failSafe?.activated) {
        return {
            orchestratorDecision: false,
            reason: 'fail_safe_activated'
        };
    }

    if (stopContinue?.shouldStop) {
        return {
            orchestratorDecision: false,
            reason: 'stop_continue_should_stop'
        };
    }

    if (validation && !validation.validationPassed) {
        return {
            orchestratorDecision: true,
            reason: 'validation_failed'
        };
    }

    if (selfHealing?.activated) {
        return {
            orchestratorDecision: true,
            reason: 'self_healing_active'
        };
    }

    return {
        orchestratorDecision: undefined,
        reason: 'insufficient_context'
    };
}
