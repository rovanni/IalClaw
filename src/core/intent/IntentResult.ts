export type IntentMode = 'EXPLORATION' | 'EXECUTION' | 'HYBRID' | 'UNKNOWN';

export interface IntentResult {
    mode: IntentMode;
    confidence: number;
}