import type { ExecutionRoute } from '../../autonomy/ActionRouter';
import type { TaskType } from '../../agent/TaskClassifier';
import type { CapabilityAwarePlan } from './PlanningTypes';

export type CapabilityGapDetectedPayload = {
    type: 'capability_gap_detected';
    sessionId: string;
    taskType: TaskType;
    missingCapabilities: string[];
    requiredCapabilities: string[];
    route: ExecutionRoute;
    severity?: string;
};

export type CapabilityVsRouteConflictPayload = {
    type: 'capability_vs_route_conflict';
    sessionId: string;
    route: ExecutionRoute;
    taskType: TaskType;
    missingCapabilities: string[];
};

export type PlanningStrategySelectedPayload = {
    type: 'planning_strategy_selected';
    sessionId: string;
    taskType: TaskType;
    route: ExecutionRoute;
    requiredCapabilities: string[];
    missingCapabilities: string[];
    isExecutable: boolean;
    fallbackStrategy?: CapabilityAwarePlan['fallbackStrategy'];
    finalDecisionSource: CapabilityAwarePlan['finalDecisionSource'];
};
