import { CanonicalCapability, isCanonicalCapability } from './CapabilityRegistry';
import { CAPABILITY_ALIASES } from './capabilityAliasMap';

export type CapabilityCanonicalizationResult = {
    canonical: string;
    normalized: string;
    isCanonical: boolean;
    isKnown: boolean;
    isUnknown: boolean;
};

export function normalizeCapabilityValue(raw: string): string {
    return String(raw || '')
        .trim()
        .toLowerCase()
        .replace(/[\s-]+/g, '_');
}

export function canonicalizeCapability(raw: string): CapabilityCanonicalizationResult {
    const normalized = normalizeCapabilityValue(raw);
    const aliasCanonical = CAPABILITY_ALIASES[normalized as keyof typeof CAPABILITY_ALIASES];
    const canonical = (aliasCanonical || normalized) as string;
    const isKnown = isCanonicalCapability(canonical);

    return {
        canonical,
        normalized,
        isCanonical: isKnown && normalized === canonical,
        isKnown,
        isUnknown: !isKnown
    };
}

export function asCanonicalCapability(raw: string): CanonicalCapability | undefined {
    const result = canonicalizeCapability(raw);
    if (!result.isKnown) {
        return undefined;
    }

    return result.canonical as CanonicalCapability;
}
