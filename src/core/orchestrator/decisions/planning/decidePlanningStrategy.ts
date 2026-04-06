import { getRequiredCapabilitiesForTaskType } from '../../../agent/TaskClassifier';
import { CapabilityAwarePlan, PlanningStrategyContext } from '../../types/PlanningTypes';

export function decidePlanningStrategy(context: PlanningStrategyContext): CapabilityAwarePlan {
    const { taskType, capabilityGap } = context;
    const requiredCapabilities = getRequiredCapabilitiesForTaskType(taskType);
    const missingFromGap = capabilityGap.gap?.missing || [];
    const primaryMissing = capabilityGap.gap?.resource ? [capabilityGap.gap.resource] : [];
    const missingCapabilities = Array.from(new Set([...missingFromGap, ...primaryMissing]));

    const hasGap = capabilityGap.hasGap || missingCapabilities.length > 0;
    const isExecutable = !hasGap;
    const fallbackStrategy: CapabilityAwarePlan['fallbackStrategy'] = hasGap
        ? (capabilityGap.solution?.requiresConfirmation ? 'request_install' : 'defer')
        : undefined;

    return {
        requiredCapabilities,
        missingCapabilities,
        isExecutable,
        fallbackStrategy,
        finalDecisionSource: 'orchestrator'
    };
}
