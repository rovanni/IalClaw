import { ExecutionPlan } from './types';
import { toolRegistry } from '../tools/ToolRegistry';
import { SessionManager } from '../../shared/SessionManager';
import { t } from '../../i18n';

export function validatePlan(plan: ExecutionPlan): void {
    if (!plan || !plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
        throw new Error(t('error.plan.invalid_or_empty'));
    }

    const usesWorkspace = plan.steps.some(step => step.tool.startsWith('workspace_'));
    const session = SessionManager.getCurrentSession();
    const hasActiveProject = Boolean(session?.current_project_id);

    if (usesWorkspace && !hasActiveProject && plan.steps[0].tool !== 'workspace_create_project') {
        throw new Error(t('error.plan.workspace_requires_create_first'));
    }

    if (hasActiveProject && plan.steps.some(step => step.tool === 'workspace_create_project')) {
        throw new Error(t('error.plan.recreate_active_project'));
    }

    for (const step of plan.steps) {
        if (!toolRegistry.get(step.tool)) {
            throw new Error(t('error.plan.hallucinated_tool', { tool: step.tool }));
        }
    }
}
