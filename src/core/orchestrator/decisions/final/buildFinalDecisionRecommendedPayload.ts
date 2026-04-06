import type { CapabilityAwarePlan } from '../../types/PlanningTypes';
import type { FinalDecisionRecommendedPayload } from '../../types/FinalDecisionDebugTypes';

export function buildFinalDecisionRecommendedPayload(params: {
    sessionId: string;
    strategy: string;
    reason: string;
    capabilityAwarePlan: CapabilityAwarePlan;
}): FinalDecisionRecommendedPayload {
    const { sessionId, strategy, reason, capabilityAwarePlan } = params;

    return {
        type: 'final_decision_recommended',
        sessionId,
        strategy,
        reason,
        source: capabilityAwarePlan.finalDecisionSource
    };
}
