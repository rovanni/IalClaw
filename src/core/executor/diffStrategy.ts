export type DiffStrategy = 'diff' | 'overwrite';
export type ChangeSizeEstimate = 'small' | 'medium' | 'large';

export function estimateChangeSize(currentContent: string, desiredContent: string): ChangeSizeEstimate {
    const currentLength = currentContent.length || 1;
    const desiredLength = desiredContent.length || 1;
    const deltaRatio = Math.abs(desiredLength - currentLength) / currentLength;

    if (deltaRatio > 0.6) {
        return 'large';
    }

    if (deltaRatio > 0.2) {
        return 'medium';
    }

    return 'small';
}

export function selectDiffStrategy(input: {
    confidence: number;
    fileExists: boolean;
    changeSizeEstimate: ChangeSizeEstimate;
    errorContext?: boolean;
}): DiffStrategy {
    if (!input.fileExists) return 'overwrite';
    if (input.confidence < 0.55) return 'overwrite';
    if (input.changeSizeEstimate === 'large') return 'overwrite';
    if (input.errorContext && input.confidence < 0.7) return 'overwrite';
    return 'diff';
}
