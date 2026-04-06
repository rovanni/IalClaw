import type { ExecutionRoute } from '../../../autonomy/ActionRouter';
import type { TaskType } from '../../../agent/TaskClassifier';
import type {
    CapabilityGapDetectedPayload,
    CapabilityVsRouteConflictPayload,
    PlanningStrategySelectedPayload
} from '../../types/PlanningDebugTypes';
import type { CapabilityAwarePlan } from '../../types/PlanningTypes';

export function buildCapabilityGapDetectedPayload(params: {
    sessionId: string;
    taskType: TaskType;
    route: ExecutionRoute;
    planningDecision: CapabilityAwarePlan;
    severity?: string;
}): CapabilityGapDetectedPayload {
    const { sessionId, taskType, route, planningDecision, severity } = params;

    return {
        type: 'capability_gap_detected',
        sessionId,
        taskType,
        missingCapabilities: planningDecision.missingCapabilities,
        requiredCapabilities: planningDecision.requiredCapabilities,
        route,
        severity
    };
}

export function buildCapabilityVsRouteConflictPayload(params: {
    sessionId: string;
    taskType: TaskType;
    route: ExecutionRoute;
    planningDecision: CapabilityAwarePlan;
}): CapabilityVsRouteConflictPayload {
    const { sessionId, taskType, route, planningDecision } = params;

    return {
        type: 'capability_vs_route_conflict',
        sessionId,
        route,
        taskType,
        missingCapabilities: planningDecision.missingCapabilities
    };
}

export function buildPlanningStrategySelectedPayload(params: {
    sessionId: string;
    taskType: TaskType;
    route: ExecutionRoute;
    planningDecision: CapabilityAwarePlan;
}): PlanningStrategySelectedPayload {
    const { sessionId, taskType, route, planningDecision } = params;

    return {
        type: 'planning_strategy_selected',
        sessionId,
        taskType,
        route,
        requiredCapabilities: planningDecision.requiredCapabilities,
        missingCapabilities: planningDecision.missingCapabilities,
        isExecutable: planningDecision.isExecutable,
        fallbackStrategy: planningDecision.fallbackStrategy,
        finalDecisionSource: planningDecision.finalDecisionSource
    };
}
