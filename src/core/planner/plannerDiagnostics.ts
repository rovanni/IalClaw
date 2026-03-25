import { PlannerDiagnostics } from './types';

export function computeConfidence(diagnostics: Omit<PlannerDiagnostics, 'confidenceScore'>): number {
    let score = 1;

    if (diagnostics.parseRecovered) {
        score -= 0.2;
    }

    if (!diagnostics.validationPassed) {
        score -= 0.4;
    }

    if (diagnostics.hallucinatedToolDetected) {
        score -= 0.3;
    }

    score *= clamp01(diagnostics.sessionConsistency);
    score *= clamp01(diagnostics.fileTargetConfidence);

    return clamp01(score);
}

export function evaluateSessionConsistency(userInput: string, currentGoal?: string, strictContinuity: boolean = false): number {
    if (!currentGoal || !currentGoal.trim()) {
        return strictContinuity ? 0.9 : 1;
    }

    const inputTokens = tokenize(userInput);
    const goalTokens = tokenize(currentGoal);

    if (inputTokens.size === 0 || goalTokens.size === 0) {
        return strictContinuity ? 0.6 : 0.85;
    }

    let overlap = 0;
    for (const token of inputTokens) {
        if (goalTokens.has(token)) {
            overlap += 1;
        }
    }

    const union = new Set([...inputTokens, ...goalTokens]).size || 1;
    const similarity = overlap / union;

    if (strictContinuity) {
        return clamp01(0.35 + similarity);
    }

    return clamp01(0.55 + similarity * 0.6);
}

function tokenize(input: string): Set<string> {
    return new Set(
        input
            .toLowerCase()
            .replace(/[^a-z0-9\s]/g, ' ')
            .split(/\s+/)
            .filter((token) => token.length >= 3)
    );
}

function clamp01(value: number): number {
    return Math.max(0, Math.min(1, value));
}