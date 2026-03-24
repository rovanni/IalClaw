import { Capability } from './CapabilityRegistry';

export type CapabilityFallback =
    | {
        mode: 'degraded';
        strategy: 'static_validation' | 'no_versioning';
    }
    | {
        mode: 'blocked';
        reason: string;
    };

export function handleCapabilityFallback(capability: Capability): CapabilityFallback {
    if (capability === 'browser_execution') {
        return {
            mode: 'degraded',
            strategy: 'static_validation'
        };
    }

    if (capability === 'git') {
        return {
            mode: 'degraded',
            strategy: 'no_versioning'
        };
    }

    return {
        mode: 'blocked',
        reason: `missing_${capability}`
    };
}
