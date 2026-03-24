type AnchorStrategy = 'exact' | 'trim' | 'normalized' | 'fuzzy';

type AnchoredDiffBase = {
    anchor?: string;
    anchors?: string[];
};

export type DiffOperation =
    | ({
        type: 'replace';
        content: string;
    } & AnchoredDiffBase)
    | ({
        type: 'insert';
        position: 'before' | 'after';
        content: string;
    } & AnchoredDiffBase)
    | {
        type: 'append';
        content: string;
    };

export interface DiffValidationOptions {
    requireAnchorMatch: boolean;
    maxReplacements?: number;
}

export interface WorkspaceApplyDiffInput {
    project_id: string;
    filename: string;
    operations: DiffOperation[];
    validation: DiffValidationOptions;
}

export interface AnchorResolution {
    found: boolean;
    resolved?: string;
    strategy?: AnchorStrategy;
    score?: number;
}

export interface AnchorCandidateRanking {
    candidate: string;
    resolved?: string;
    strategy?: AnchorStrategy;
    score?: number;
    rankScore?: number;
    found: boolean;
}

function normalize(input: string): string {
    return input
        .replace(/\s+/g, ' ')
        .trim()
        .toLowerCase();
}

function similarity(a: string, b: string): number {
    if (a === b) return 1;
    if (!a || !b) return 0;

    const longer = a.length >= b.length ? a : b;
    const shorter = a.length >= b.length ? b : a;
    let matches = 0;

    for (let index = 0; index < shorter.length; index++) {
        if (longer.includes(shorter[index])) {
            matches += 1;
        }
    }

    return matches / longer.length;
}

export function resolveAnchor(anchor: string, original: string): AnchorResolution {
    if (original.includes(anchor)) {
        return { found: true, resolved: anchor, strategy: 'exact' };
    }

    const trimmed = anchor.trim();
    if (trimmed && original.includes(trimmed)) {
        return { found: true, resolved: trimmed, strategy: 'trim' };
    }

    const normalizedAnchor = normalize(anchor);
    const lines = original.split('\n');

    for (const line of lines) {
        if (normalize(line) === normalizedAnchor) {
            return {
                found: true,
                resolved: line,
                strategy: 'normalized'
            };
        }
    }

    let bestMatch: { line: string; score: number } | null = null;

    for (const line of lines) {
        const score = similarity(normalize(line), normalizedAnchor);
        if (score >= 0.85 && (!bestMatch || score > bestMatch.score)) {
            bestMatch = { line, score };
        }
    }

    if (bestMatch) {
        return {
            found: true,
            resolved: bestMatch.line,
            strategy: 'fuzzy',
            score: bestMatch.score
        };
    }

    return { found: false };
}

function getAnchorsFromOperation(operation: DiffOperation): string[] {
    if (operation.type === 'append') {
        return [];
    }

    const values = [operation.anchor, ...(operation.anchors || [])]
        .filter((value): value is string => typeof value === 'string')
        .map(value => value.trim())
        .filter(value => value.length > 0);

    return Array.from(new Set(values));
}

function strategyWeight(strategy?: AnchorStrategy): number {
    switch (strategy) {
        case 'exact':
            return 1;
        case 'trim':
            return 0.97;
        case 'normalized':
            return 0.93;
        case 'fuzzy':
            return 0.85;
        default:
            return 0;
    }
}

function rankResolvedAnchor(candidate: string, resolution: AnchorResolution, original: string): number {
    const resolved = resolution.resolved || candidate;
    const occurrences = resolved ? original.split(resolved).length - 1 : 0;
    const uniquenessBoost = occurrences === 1 ? 0.03 : 0;
    const specificityBoost = Math.min(0.05, resolved.length / 500);
    const fuzzyScore = resolution.strategy === 'fuzzy'
        ? Math.min(0.05, resolution.score || 0)
        : 0;

    return strategyWeight(resolution.strategy) + uniquenessBoost + specificityBoost + fuzzyScore;
}

export function rankAnchors(anchors: string[], original: string): {
    found: boolean;
    resolved?: string;
    strategy?: AnchorStrategy;
    score?: number;
    originalAnchor?: string;
    rankings: AnchorCandidateRanking[];
} {
    const rankings = anchors.map(candidate => {
        const resolution = resolveAnchor(candidate, original);
        const rankScore = resolution.found ? rankResolvedAnchor(candidate, resolution, original) : 0;

        return {
            candidate,
            resolved: resolution.resolved,
            strategy: resolution.strategy,
            score: resolution.score,
            rankScore,
            found: resolution.found
        };
    });

    const rankedMatches = rankings
        .filter(ranking => ranking.found)
        .sort((left, right) => (right.rankScore || 0) - (left.rankScore || 0));

    const best = rankedMatches[0];
    if (!best) {
        return { found: false, rankings };
    }

    return {
        found: true,
        resolved: best.resolved,
        strategy: best.strategy,
        score: best.score,
        originalAnchor: best.candidate,
        rankings
    };
}

export function validateDiffOperations(operations: DiffOperation[]): boolean {
    if (!Array.isArray(operations) || operations.length === 0) {
        return false;
    }

    return operations.every(operation => {
        if (!operation || typeof operation !== 'object' || typeof operation.type !== 'string') {
            return false;
        }

        if (operation.type === 'append') {
            return typeof operation.content === 'string' && operation.content.length >= 2;
        }

        if (operation.type === 'replace') {
            return getAnchorsFromOperation(operation).length > 0
                && typeof operation.content === 'string'
                && operation.content.length >= 2;
        }

        if (operation.type === 'insert') {
            return getAnchorsFromOperation(operation).length > 0
                && (operation.position === 'before' || operation.position === 'after')
                && typeof operation.content === 'string'
                && operation.content.length >= 2;
        }

        return false;
    });
}

export function validateDiff(params: {
    original: string;
    operations: DiffOperation[];
    validation: DiffValidationOptions;
    onAnchorResolved?: (data: {
        originalAnchor: string;
        attemptedAnchors: string[];
        resolvedAnchor: string;
        strategy: string;
        score?: number;
        rankings?: AnchorCandidateRanking[];
    }) => void;
    onAnchorResolutionFailed?: (data: { anchor: string; attemptedAnchors: string[] }) => void;
}) {
    const { original, operations, validation, onAnchorResolved, onAnchorResolutionFailed } = params;

    if (!validateDiffOperations(operations)) {
        throw new Error('DIFF_OPERATIONS_INVALID');
    }

    let anchoredOperations = 0;
    const resolvedOperations: DiffOperation[] = [];

    for (const operation of operations) {
        if (operation.type === 'append') {
            resolvedOperations.push(operation);
            continue;
        }

        anchoredOperations += 1;
        const attemptedAnchors = getAnchorsFromOperation(operation);
        const primaryAnchor = attemptedAnchors[0] || '';

        const resolution = rankAnchors(attemptedAnchors, original);

        if (validation.requireAnchorMatch && !resolution.found) {
            onAnchorResolutionFailed?.({
                anchor: primaryAnchor,
                attemptedAnchors
            });
            throw new Error(`ANCHOR_NOT_FOUND:${primaryAnchor}`);
        }

        const resolvedAnchor = resolution.resolved || primaryAnchor;
        if (resolution.found) {
            onAnchorResolved?.({
                originalAnchor: resolution.originalAnchor || primaryAnchor,
                attemptedAnchors,
                resolvedAnchor,
                strategy: resolution.strategy || 'exact',
                score: resolution.score,
                rankings: resolution.rankings
            });
        }

        resolvedOperations.push({
            ...operation,
            anchors: attemptedAnchors,
            anchor: resolvedAnchor
        } as DiffOperation);
    }

    if (validation.maxReplacements && anchoredOperations > validation.maxReplacements) {
        throw new Error('DIFF_TOO_MANY_REPLACEMENTS');
    }

    return resolvedOperations;
}

export function applyDiff(original: string, operations: DiffOperation[]): string {
    let updated = original;

    for (const operation of operations) {
        switch (operation.type) {
            case 'replace': {
                if (!operation.anchor) {
                    throw new Error('DIFF_OPERATION_MISSING_ANCHOR');
                }

                updated = updated.replace(operation.anchor, operation.content);
                break;
            }
            case 'insert': {
                if (!operation.anchor) {
                    throw new Error('DIFF_OPERATION_MISSING_ANCHOR');
                }

                updated = updated.replace(
                    operation.anchor,
                    operation.position === 'before'
                        ? `${operation.content}${operation.anchor}`
                        : `${operation.anchor}${operation.content}`
                );
                break;
            }
            case 'append':
                updated = `${updated}\n${operation.content}`;
                break;
            default:
                throw new Error(`UNSUPPORTED_DIFF_OPERATION:${(operation as { type?: string }).type || 'unknown'}`);
        }
    }

    return updated;
}
