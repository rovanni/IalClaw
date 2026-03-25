import { ExecutionMode } from '../executor/AgentConfig';
import { PlannerOutput } from '../planner/types';

export type RuntimeDecision = 'PLAN_EXECUTION' | 'REPAIR_AND_EXECUTE' | 'REPLAN' | 'DIRECT_EXECUTION';

export function decideExecutionPath(output: PlannerOutput, mode: ExecutionMode): RuntimeDecision {
    if (!output.plan) {
        return mode === 'aggressive' ? 'DIRECT_EXECUTION' : 'REPLAN';
    }

    const confidence = output.diagnostics.confidenceScore;

    if (mode === 'strict') {
        if (confidence > 0.8) {
            return 'PLAN_EXECUTION';
        }

        return 'REPLAN';
    }

    if (mode === 'balanced') {
        if (confidence > 0.7) {
            return 'PLAN_EXECUTION';
        }

        if (confidence > 0.4) {
            return 'REPAIR_AND_EXECUTE';
        }

        return 'REPLAN';
    }

    if (confidence > 0.6) {
        return 'PLAN_EXECUTION';
    }

    if (confidence > 0.3) {
        return 'REPAIR_AND_EXECUTE';
    }

    return 'DIRECT_EXECUTION';
}