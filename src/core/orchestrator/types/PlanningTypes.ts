import { ExecutionRoute } from '../../autonomy/ActionRouter';
import { ResolutionProposal } from '../../autonomy/CapabilityResolver';
import { TaskType } from '../../agent/TaskClassifier';

export type CapabilityAwarePlan = {
    steps?: Array<{
        tool?: string;
        description?: string;
    }>;
    requiredCapabilities: string[];
    missingCapabilities: string[];
    hasGap: boolean;
    isExecutable: boolean;
    fallbackStrategy?: 'graceful_response' | 'request_install' | 'defer';
    // Fonte da recomendacao cognitiva de planejamento (nao representa aplicacao final).
    finalDecisionSource: 'orchestrator' | 'loop_safe_fallback';
};

export type PlanningStrategyContext = {
    sessionId: string;
    taskType: TaskType;
    route: ExecutionRoute;
    capabilityGap: ResolutionProposal;
};
