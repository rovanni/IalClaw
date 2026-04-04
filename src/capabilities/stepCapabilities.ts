import { ExecutionPlan, PlanStep } from '../core/planner/types';
import { Capability } from './CapabilityRegistry';
import { WorkspaceFileContext } from '../core/planner/workspaceContext';

export function requiresDOM(step: PlanStep): boolean {
    return step.capabilities?.requiresDOM === true;
}

export function sanitizeStep(step: PlanStep): PlanStep {
    return {
        ...step,
        capabilities: {
            requiresDOM: requiresDOM(step)
        }
    };
}

export function getRequiredCapabilitiesForStep(step: PlanStep): Capability[] {
    switch (step.tool) {
        case 'workspace_create_project':
        case 'workspace_save_artifact':
        case 'workspace_apply_diff':
        case 'workspace_validate_project':
            return requiresDOM(step)
                ? ['fs_access', 'browser_execution']
                : ['fs_access'];
        case 'workspace_run_project':
            return requiresDOM(step)
                ? ['fs_access', 'browser_execution']
                : ['fs_access'];
        default:
            return ['fs_access'];
    }
}

import { 
    PlanRuntimeDecision, 
    RuntimeDecisionReasons 
} from '../core/orchestrator/PlanRuntimeDecision';

export interface PlanRuntimeSignals {
    hasHtmlEntry: boolean;
    hasNodeEntry: boolean;
    hasDomSteps: boolean;
}

export function extractPlanRuntimeSignals(
    plan: ExecutionPlan,
    workspaceContext: WorkspaceFileContext[]
): PlanRuntimeSignals {
    return {
        hasHtmlEntry: workspaceContext.some(file => file.relative_path.toLowerCase() === 'index.html'),
        hasNodeEntry: workspaceContext.some(file => file.relative_path.toLowerCase() === 'index.js'),
        hasDomSteps: plan.steps.some(step => requiresDOM(step))
    };
}

/**
 * Adapter para converter a auditoria legada no novo contrato de decisão.
 * Usado pelo Executor para manter o SAFE MODE durante a migração definitiva.
 */
export function mapLegacyToDecision(legacy: {
    requiresBrowserValidation: boolean;
    skipRuntimeExecution: boolean;
    skipReason?: 'no_runnable_entry' | 'html_without_requiresDOM';
}): PlanRuntimeDecision {
    const reasonMap = {
        'no_runnable_entry': RuntimeDecisionReasons.NO_RUNNABLE_ENTRY,
        'html_without_requiresDOM': RuntimeDecisionReasons.HTML_WITHOUT_DOM
    };

    return {
        shouldExecute: !legacy.skipRuntimeExecution,
        requiresBrowser: legacy.requiresBrowserValidation,
        reasonKey: legacy.skipReason ? (reasonMap[legacy.skipReason] || RuntimeDecisionReasons.LEGACY_FALLBACK) : RuntimeDecisionReasons.EXECUTABLE_PROJECT,
        decisionSource: "safe_mode"
    };
}

/**
 * @deprecated Use extractPlanRuntimeSignals + orchestrator.decidePlanRuntimeMode
 * Mantido apenas para suporte ao SAFE MODE durante a migração.
 */
export function legacyResolveRuntimeModeForPlan(
    plan: ExecutionPlan,
    workspaceContext: WorkspaceFileContext[]
): {
    requiresBrowserValidation: boolean;
    skipRuntimeExecution: boolean;
    skipReason?: 'no_runnable_entry' | 'html_without_requiresDOM';
} {
    const signals = extractPlanRuntimeSignals(plan, workspaceContext);

    if (!signals.hasHtmlEntry && !signals.hasNodeEntry) {
        return {
            requiresBrowserValidation: false,
            skipRuntimeExecution: true,
            skipReason: 'no_runnable_entry'
        };
    }

    return {
        requiresBrowserValidation: signals.hasHtmlEntry && signals.hasDomSteps,
        skipRuntimeExecution: signals.hasHtmlEntry && !signals.hasNodeEntry && !signals.hasDomSteps,
        skipReason: signals.hasHtmlEntry && !signals.hasNodeEntry && !signals.hasDomSteps ? 'html_without_requiresDOM' : undefined
    };
}


