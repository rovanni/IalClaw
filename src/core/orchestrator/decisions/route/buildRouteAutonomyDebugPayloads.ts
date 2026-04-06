import type { RouteAutonomySignal } from '../../../../engine/AgentLoopTypes';
import type {
    RouteAutonomyActiveDecisionPayload,
    RouteAutonomyAuthorityResolutionPayload
} from '../../types/RouteAutonomyDebugTypes';

export function buildRouteAutonomyAuthorityResolutionPayload(params: {
    sessionId: string;
    authorityDecision: { override?: boolean };
    routeSignal: RouteAutonomySignal;
}): RouteAutonomyAuthorityResolutionPayload {
    const { sessionId, authorityDecision, routeSignal } = params;

    return {
        type: 'signal_authority_resolution',
        sessionId,
        decisionPoint: 'route_autonomy',
        authorityDecision,
        overriddenSignals: [],
        finalDecision: {
            route: routeSignal.route,
            autonomyDecision: routeSignal.autonomyDecision,
            requiresUserInput: routeSignal.requiresUserInput,
            confidence: routeSignal.confidence
        }
    };
}

export function buildRouteAutonomyActiveDecisionPayload(params: {
    sessionId: string;
    routeSignal: RouteAutonomySignal;
}): RouteAutonomyActiveDecisionPayload {
    const { sessionId, routeSignal } = params;

    return {
        sessionId,
        route: routeSignal.route,
        autonomyDecision: routeSignal.autonomyDecision,
        requiresUserInput: routeSignal.requiresUserInput,
        confidence: routeSignal.confidence,
        source: 'loop_signal_applied_by_orchestrator'
    };
}
