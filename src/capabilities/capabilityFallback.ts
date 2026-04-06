import { Capability } from './CapabilityRegistry';

export type CapabilityFallback =
    {
        failureType: 'capability_missing';
        capability: Capability;
        retryPossible: boolean;
        severity: 'medium' | 'high';
        reasonCode: string;
        context: {
            suggestedDegradation?: 'static_validation' | 'no_versioning';
        };
    };

export type CapabilityFallbackDecisionAction = 'retry' | 'abort' | 'switch_tool' | 'degrade';
export type CapabilityFallbackDecisionPriority = 'low' | 'medium' | 'high';

export type CapabilityFallbackDecision = {
    action: CapabilityFallbackDecisionAction;
    priority: CapabilityFallbackDecisionPriority;
    capability: Capability;
    reason: string;
    suggestedDegradation?: 'static_validation' | 'no_versioning';
};

export function handleCapabilityFallback(capability: Capability): CapabilityFallback {
    if (capability === 'browser_execution') {
        return {
            failureType: 'capability_missing',
            capability,
            retryPossible: true,
            severity: 'medium',
            reasonCode: `missing_${capability}`,
            context: {
                suggestedDegradation: 'static_validation'
            }
        };
    }

    if (capability === 'git') {
        return {
            failureType: 'capability_missing',
            capability,
            retryPossible: true,
            severity: 'medium',
            reasonCode: `missing_${capability}`,
            context: {
                suggestedDegradation: 'no_versioning'
            }
        };
    }

    return {
        failureType: 'capability_missing',
        capability,
        retryPossible: false,
        severity: 'high',
        reasonCode: `missing_${capability}`,
        context: {}
    };
}
