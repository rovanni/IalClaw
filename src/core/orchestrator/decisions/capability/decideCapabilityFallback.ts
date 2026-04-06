import { CapabilityFallbackDecision } from '../../../../capabilities/capabilityFallback';
import { CapabilityFallbackDecisionContext } from '../../types/CapabilityFallbackTypes';

export function decideCapabilityFallback(context: CapabilityFallbackDecisionContext): CapabilityFallbackDecision | undefined {
    const { signal } = context;

    if (!signal?.capability) {
        return undefined;
    }

    if (signal.context.suggestedDegradation) {
        return {
            action: 'degrade',
            priority: signal.severity,
            capability: signal.capability,
            reason: 'degradation_available',
            suggestedDegradation: signal.context.suggestedDegradation
        };
    }

    if (signal.retryPossible) {
        return {
            action: 'retry',
            priority: signal.severity,
            capability: signal.capability,
            reason: 'retry_possible'
        };
    }

    return {
        action: 'abort',
        priority: 'high',
        capability: signal.capability,
        reason: 'capability_unavailable_no_safe_degradation'
    };
}
