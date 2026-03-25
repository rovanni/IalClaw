export interface LlmJsonParseMeta {
    extractedFromMarkdownFence: boolean;
    extractedFromTextEnvelope: boolean;
    repaired: boolean;
    removedTrailingCommas: boolean;
    closedOpenString: boolean;
    balancedClosers: boolean;
    prunedDanglingTail: boolean;
    truncatedLikely: boolean;
    rootType: 'object' | 'array' | 'unknown';
    attempts: string[];
    candidate: string;
}

export interface LlmJsonParseResult<T> {
    value: T;
    meta: LlmJsonParseMeta;
}

interface JsonCandidateExtraction {
    candidate: string;
    extractedFromMarkdownFence: boolean;
    extractedFromTextEnvelope: boolean;
    truncatedLikely: boolean;
    rootType: 'object' | 'array' | 'unknown';
}

interface RepairState {
    value: string;
    removedTrailingCommas: boolean;
    closedOpenString: boolean;
    balancedClosers: boolean;
    prunedDanglingTail: boolean;
}

export function parseLlmJson<T = any>(raw: string): T {
    return parseLlmJsonWithRecovery<T>(raw).value;
}

export function parseLlmJsonWithRecovery<T = any>(raw: string): LlmJsonParseResult<T> {
    if (!raw || !raw.trim()) {
        throw new Error('Empty LLM response');
    }

    const extracted = extractJsonCandidate(raw);
    const attempts: string[] = [];

    try {
        attempts.push('direct');
        return {
            value: JSON.parse(extracted.candidate) as T,
            meta: buildMeta(extracted, attempts, extracted.candidate, {
                value: extracted.candidate,
                removedTrailingCommas: false,
                closedOpenString: false,
                balancedClosers: false,
                prunedDanglingTail: false
            })
        };
    } catch {
        const repaired = repairJsonCandidate(extracted.candidate);

        try {
            attempts.push('repaired');
            return {
                value: JSON.parse(repaired.value) as T,
                meta: buildMeta(extracted, attempts, repaired.value, repaired)
            };
        } catch {
            throw new Error(`Failed to parse LLM JSON after recovery attempts:\n${repaired.value.slice(0, 500)}`);
        }
    }
}

function buildMeta(
    extracted: JsonCandidateExtraction,
    attempts: string[],
    candidate: string,
    repair: RepairState
): LlmJsonParseMeta {
    return {
        extractedFromMarkdownFence: extracted.extractedFromMarkdownFence,
        extractedFromTextEnvelope: extracted.extractedFromTextEnvelope,
        repaired: attempts.includes('repaired'),
        removedTrailingCommas: repair.removedTrailingCommas,
        closedOpenString: repair.closedOpenString,
        balancedClosers: repair.balancedClosers,
        prunedDanglingTail: repair.prunedDanglingTail,
        truncatedLikely: extracted.truncatedLikely,
        rootType: extracted.rootType,
        attempts,
        candidate
    };
}

function extractJsonCandidate(raw: string): JsonCandidateExtraction {
    let cleaned = raw.trim().replace(/^\uFEFF/, '');
    let extractedFromMarkdownFence = false;
    let extractedFromTextEnvelope = false;

    if (cleaned.startsWith('```')) {
        extractedFromMarkdownFence = true;
        cleaned = cleaned
            .replace(/^```[a-zA-Z]*\r?\n?/, '')
            .replace(/```\s*$/, '')
            .trim();
    }

    const startIndex = findFirstJsonStart(cleaned);
    if (startIndex === -1) {
        return {
            candidate: cleaned,
            extractedFromMarkdownFence,
            extractedFromTextEnvelope,
            truncatedLikely: false,
            rootType: 'unknown'
        };
    }

    if (startIndex > 0) {
        extractedFromTextEnvelope = true;
    }

    const rootChar = cleaned[startIndex];
    const rootType = rootChar === '{' ? 'object' : rootChar === '[' ? 'array' : 'unknown';
    const slice = extractBalancedJsonSlice(cleaned, startIndex);

    return {
        candidate: slice.candidate.trim(),
        extractedFromMarkdownFence,
        extractedFromTextEnvelope,
        truncatedLikely: slice.truncatedLikely,
        rootType
    };
}

function findFirstJsonStart(input: string): number {
    const braceIndex = input.indexOf('{');
    const bracketIndex = input.indexOf('[');

    if (braceIndex === -1) {
        return bracketIndex;
    }

    if (bracketIndex === -1) {
        return braceIndex;
    }

    return Math.min(braceIndex, bracketIndex);
}

function extractBalancedJsonSlice(input: string, startIndex: number): { candidate: string; truncatedLikely: boolean } {
    const stack: string[] = [];
    let inString = false;
    let escaping = false;

    for (let index = startIndex; index < input.length; index += 1) {
        const char = input[index];

        if (inString) {
            if (escaping) {
                escaping = false;
                continue;
            }

            if (char === '\\') {
                escaping = true;
                continue;
            }

            if (char === '"') {
                inString = false;
            }

            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{' || char === '[') {
            stack.push(char);
            continue;
        }

        if (char === '}' || char === ']') {
            const expected = char === '}' ? '{' : '[';
            if (stack[stack.length - 1] === expected) {
                stack.pop();
            }

            if (stack.length === 0) {
                return {
                    candidate: input.slice(startIndex, index + 1),
                    truncatedLikely: index < input.length - 1
                };
            }
        }
    }

    return {
        candidate: input.slice(startIndex),
        truncatedLikely: true
    };
}

function repairJsonCandidate(candidate: string): RepairState {
    let value = candidate.trim();
    let removedTrailingCommas = false;
    let prunedDanglingTail = false;
    let closedOpenString = false;
    let balancedClosers = false;

    const normalizedQuotes = value
        .replace(/[\u201C\u201D]/g, '"')
        .replace(/[\u2018\u2019]/g, "'");
    value = normalizedQuotes;

    const pruned = pruneDanglingTail(value);
    value = pruned.value;
    prunedDanglingTail = pruned.changed;

    const commaFree = value.replace(/,\s*(?=[}\]])/g, '');
    removedTrailingCommas = commaFree !== value;
    value = commaFree;

    const stringRepair = closeOpenString(value);
    value = stringRepair.value;
    closedOpenString = stringRepair.changed;

    const balanced = balanceJsonClosers(value);
    value = balanced.value;
    balancedClosers = balanced.changed;

    const finalCommaFree = value.replace(/,\s*(?=[}\]])/g, '');
    removedTrailingCommas = removedTrailingCommas || finalCommaFree !== value;
    value = finalCommaFree;

    return {
        value,
        removedTrailingCommas,
        closedOpenString,
        balancedClosers,
        prunedDanglingTail
    };
}

function pruneDanglingTail(input: string): { value: string; changed: boolean } {
    let value = input.trimEnd();
    const original = value;

    value = value
        .replace(/,\s*$/, '')
        .replace(/:\s*$/, '')
        .replace(/,\s*"[^"\\]*\s*$/, '')
        .replace(/,\s*"[^"\\]*"\s*:\s*$/, '')
        .replace(/"[^"\\]*"\s*:\s*$/, '');

    return {
        value: value.trimEnd(),
        changed: value !== original
    };
}

function closeOpenString(input: string): { value: string; changed: boolean } {
    let inString = false;
    let escaping = false;

    for (const char of input) {
        if (inString) {
            if (escaping) {
                escaping = false;
                continue;
            }

            if (char === '\\') {
                escaping = true;
                continue;
            }

            if (char === '"') {
                inString = false;
            }

            continue;
        }

        if (char === '"') {
            inString = true;
        }
    }

    return {
        value: inString ? `${input}"` : input,
        changed: inString
    };
}

function balanceJsonClosers(input: string): { value: string; changed: boolean } {
    const stack: string[] = [];
    let inString = false;
    let escaping = false;

    for (const char of input) {
        if (inString) {
            if (escaping) {
                escaping = false;
                continue;
            }

            if (char === '\\') {
                escaping = true;
                continue;
            }

            if (char === '"') {
                inString = false;
            }

            continue;
        }

        if (char === '"') {
            inString = true;
            continue;
        }

        if (char === '{' || char === '[') {
            stack.push(char);
            continue;
        }

        if (char === '}' && stack[stack.length - 1] === '{') {
            stack.pop();
            continue;
        }

        if (char === ']' && stack[stack.length - 1] === '[') {
            stack.pop();
        }
    }

    if (stack.length === 0) {
        return { value: input, changed: false };
    }

    const suffix = stack
        .reverse()
        .map((entry) => entry === '{' ? '}' : ']')
        .join('');

    return {
        value: `${input}${suffix}`,
        changed: true
    };
}
