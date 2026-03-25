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

export function resolveRuntimeModeForPlan(
    plan: ExecutionPlan,
    workspaceContext: WorkspaceFileContext[]
): {
    requiresBrowserValidation: boolean;
    skipRuntimeExecution: boolean;
    skipReason?: 'no_runnable_entry' | 'html_without_requiresDOM';
} {
    const hasHtmlEntry = workspaceContext.some(file => file.relative_path.toLowerCase() === 'index.html');
    const hasNodeEntry = workspaceContext.some(file => file.relative_path.toLowerCase() === 'index.js');
    const requiresBrowserValidation = plan.steps.some(step => requiresDOM(step));

    if (!hasHtmlEntry && !hasNodeEntry) {
        return {
            requiresBrowserValidation: false,
            skipRuntimeExecution: true,
            skipReason: 'no_runnable_entry'
        };
    }

    return {
        requiresBrowserValidation: hasHtmlEntry && requiresBrowserValidation,
        skipRuntimeExecution: hasHtmlEntry && !hasNodeEntry && !requiresBrowserValidation,
        skipReason: hasHtmlEntry && !hasNodeEntry && !requiresBrowserValidation ? 'html_without_requiresDOM' : undefined
    };
}
