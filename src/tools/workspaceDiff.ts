export type DiffOperation =
    | {
        type: 'replace';
        anchor: string;
        content: string;
    }
    | {
        type: 'insert';
        anchor: string;
        position: 'before' | 'after';
        content: string;
    }
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
    strategy?: 'exact' | 'trim' | 'normalized' | 'fuzzy';
    score?: number;
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
            return typeof operation.anchor === 'string'
                && operation.anchor.length > 0
                && typeof operation.content === 'string'
                && operation.content.length >= 2;
        }

        if (operation.type === 'insert') {
            return typeof operation.anchor === 'string'
                && operation.anchor.length > 0
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
        resolvedAnchor: string;
        strategy: string;
        score?: number;
    }) => void;
    onAnchorResolutionFailed?: (data: { anchor: string }) => void;
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

        const resolution = resolveAnchor(operation.anchor, original);

        if (validation.requireAnchorMatch && !resolution.found) {
            onAnchorResolutionFailed?.({ anchor: operation.anchor });
            throw new Error(`ANCHOR_NOT_FOUND:${operation.anchor}`);
        }

        const resolvedAnchor = resolution.resolved || operation.anchor;
        if (resolution.found) {
            onAnchorResolved?.({
                originalAnchor: operation.anchor,
                resolvedAnchor,
                strategy: resolution.strategy || 'exact',
                score: resolution.score
            });
        }

        resolvedOperations.push({
            ...operation,
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
            case 'replace':
                updated = updated.replace(operation.anchor, operation.content);
                break;
            case 'insert':
                updated = updated.replace(
                    operation.anchor,
                    operation.position === 'before'
                        ? `${operation.content}${operation.anchor}`
                        : `${operation.anchor}${operation.content}`
                );
                break;
            case 'append':
                updated = `${updated}\n${operation.content}`;
                break;
            default:
                throw new Error(`UNSUPPORTED_DIFF_OPERATION:${(operation as { type?: string }).type || 'unknown'}`);
        }
    }

    return updated;
}
