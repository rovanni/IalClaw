export type RetryAfterFailureAuthorityResolutionPayload = {
    type: 'signal_authority_resolution';
    sessionId: string;
    decisionPoint: 'self_healing_retry';
    authorityDecision: { override?: boolean };
    overriddenSignals: [];
    finalDecision: boolean | undefined;
};

export type RetryDecisionPayload = {
    type: 'retry_decision';
    sessionId: string;
    attempt?: number;
    orchestratorDecision: boolean | undefined;
    executorDecision?: boolean;
    finalDecision: boolean | undefined;
};

export type SelfHealingActiveDecisionPayload = {
    sessionId: string;
    source: 'existing_signal_governance';
    activated: boolean;
    attempts?: number;
    maxAttempts?: number;
    success?: boolean;
    stepId?: string;
    toolName?: string;
    failSafeActivated: boolean;
    stopShouldStop: boolean;
    validationPassed?: boolean;
    orchestratorDecision: boolean | undefined;
    reason: string;
};
