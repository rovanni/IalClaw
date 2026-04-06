export type FinalDecisionRecommendedPayload = {
    type: 'final_decision_recommended';
    sessionId: string;
    strategy: string;
    reason: string;
    source: string;
};
