import { ActiveDecisionSnapshot, ActiveDecisionsResult } from '../../types/ActiveDecisionsTypes';

export function buildActiveDecisionsResult(params: {
    loop: ActiveDecisionSnapshot;
    orchestrator: ActiveDecisionSnapshot;
}): ActiveDecisionsResult {
    const { loop, orchestrator } = params;

    const applied: ActiveDecisionSnapshot = {
        stop: orchestrator.stop ?? loop.stop,
        fallback: orchestrator.fallback ?? loop.fallback,
        validation: orchestrator.validation ?? loop.validation,
        route: orchestrator.route ?? loop.route,
        failSafe: orchestrator.failSafe ?? loop.failSafe
    };

    return {
        loop,
        orchestrator,
        applied,
        safeModeFallbackApplied: {
            stop: !orchestrator.stop && !!loop.stop,
            fallback: !orchestrator.fallback && !!loop.fallback,
            validation: !orchestrator.validation && !!loop.validation,
            route: !orchestrator.route && !!loop.route,
            failSafe: !orchestrator.failSafe && !!loop.failSafe
        }
    };
}
