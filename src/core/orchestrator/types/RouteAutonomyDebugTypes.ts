import type { RouteAutonomySignal } from '../../../engine/AgentLoopTypes';

export type RouteAutonomyDecisionSnapshot = {
    route: RouteAutonomySignal['route'];
    autonomyDecision: RouteAutonomySignal['autonomyDecision'];
    requiresUserInput: RouteAutonomySignal['requiresUserInput'];
    confidence: RouteAutonomySignal['confidence'];
};

export type RouteAutonomyAuthorityResolutionPayload = {
    type: 'signal_authority_resolution';
    sessionId: string;
    decisionPoint: 'route_autonomy';
    authorityDecision: { override?: boolean };
    overriddenSignals: [];
    finalDecision: RouteAutonomyDecisionSnapshot;
};

export type RouteAutonomyActiveDecisionPayload = RouteAutonomyDecisionSnapshot & {
    sessionId: string;
    source: 'loop_signal_applied_by_orchestrator';
};
