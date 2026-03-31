import { createHash } from 'crypto';

export type LearningRecord = {
    inputHash: string;
    decision: string;
    confidence: number;
    success: boolean;
    errorType?: string;
    repairActions?: string[];
    reactiveState?: {
        hasFailure: boolean;
        errorType?: string;
        attempt: number;
        resolved?: boolean;
    };
};

const learningBuffer: LearningRecord[] = [];

export function pushLearningRecord(record: LearningRecord): void {
    learningBuffer.push(record);

    if (learningBuffer.length > 500) {
        learningBuffer.shift();
    }
}

export function getLearningBuffer(): LearningRecord[] {
    return [...learningBuffer];
}

export function clearLearningBuffer(): void {
    learningBuffer.length = 0;
}

export function hashLearningInput(input: string): string {
    return createHash('sha1').update(input).digest('hex');
}