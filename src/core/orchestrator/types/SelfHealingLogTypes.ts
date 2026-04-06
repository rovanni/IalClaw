export type SelfHealingObservedPayload = {
    sessionId: string;
    activated: boolean;
    attempts?: number;
    maxAttempts?: number;
    success?: boolean;
    lastError?: string;
    stepId?: string;
    toolName?: string;
};
