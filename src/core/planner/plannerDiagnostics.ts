import { PlannerSignals } from './types';

/**
 * Calcula um score de confiança local baseado nos sinais do planner.
 * @deprecated Use o ConfidenceScorer centralizado para decisões.
 */
export function computeConfidence(signals: PlannerSignals): number {
    let score = 1;

    if (signals.parseRecovered) {
        score -= 0.2;
    }

    if (!signals.validationPassed) {
        score -= 0.4;
    }

    if (signals.hallucinatedToolDetected) {
        score -= 0.3;
    }

    score *= clamp01(signals.sessionConsistency);
    score *= clamp01(signals.fileTargetConfidence);

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