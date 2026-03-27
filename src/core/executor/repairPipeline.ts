import { Session } from '../../shared/SessionManager';
import { buildPlannerFallbackPlan } from '../planner/planningRecovery';
import { ExecutionPlan } from '../planner/types';
import { sanitizeStep } from '../../capabilities/stepCapabilities';
import { toolRegistry } from '../tools/ToolRegistry';
import { t } from '../../i18n';

export type RepairResult = {
    repairedPlan: ExecutionPlan | null;
    repairActions: string[];
    success: boolean;
    error?: string;
};

export function cloneExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
    return JSON.parse(JSON.stringify(plan)) as ExecutionPlan;
}

export function normalizeExecutionPlan(plan: ExecutionPlan): ExecutionPlan {
    const normalized = cloneExecutionPlan(plan);

    normalized.steps = normalized.steps.map((step, index) => ({
        ...sanitizeStep(step),
        id: index + 1,
        type: 'tool'
    }));

    return normalized;
}

export function repairPlanStructure(plan: ExecutionPlan, session: Session): RepairResult {
    const repairedPlan = normalizeExecutionPlan(plan);
    const repairActions: string[] = ['normalize_plan'];
    const hadCreateProject = repairedPlan.steps.some(step => step.tool === 'workspace_create_project');
    const usesWorkspace = repairedPlan.steps.some(step => step.tool.startsWith('workspace_'));

    if (session.current_project_id && hadCreateProject) {
        repairedPlan.steps = repairedPlan.steps
            .filter(step => step.tool !== 'workspace_create_project')
            .map((step, index) => ({ ...step, id: index + 1 }));
        repairActions.push('remove_workspace_create_project_for_active_session');
    }

    if (!session.current_project_id && usesWorkspace && repairedPlan.steps[0]?.tool !== 'workspace_create_project') {
        const createIndex = repairedPlan.steps.findIndex(step => step.tool === 'workspace_create_project');

        if (createIndex > 0) {
            const [createStep] = repairedPlan.steps.splice(createIndex, 1);
            repairedPlan.steps.unshift(createStep);
            repairedPlan.steps = repairedPlan.steps.map((step, index) => ({ ...step, id: index + 1 }));
            repairActions.push('move_workspace_create_project_to_front');
        } else if (createIndex === -1) {
            const fallbackPlan = buildPlannerFallbackPlan(session.current_goal || repairedPlan.goal, false, 'repair_pipeline_workspace_bootstrap');
            const bootstrapStep = fallbackPlan.steps.find(step => step.tool === 'workspace_create_project');

            if (!bootstrapStep) {
                return {
                    repairedPlan: null,
                    repairActions,
                    success: false,
                    error: t('error.repair.bootstrap_failed')
                };
            }

            repairedPlan.steps.unshift({ ...bootstrapStep, id: 1 });
            repairedPlan.steps = repairedPlan.steps.map((step, index) => ({ ...step, id: index + 1 }));
            repairActions.push('inject_workspace_create_project');
        }
    }

    try {
        validateRepairCandidate(repairedPlan, session);
        return {
            repairedPlan,
            repairActions,
            success: true
        };
    } catch (error: any) {
        return {
            repairedPlan: null,
            repairActions,
            success: false,
            error: error?.message || t('error.repair.validation_failed')
        };
    }
}

function validateRepairCandidate(plan: ExecutionPlan, session: Session): void {
    if (!plan || !Array.isArray(plan.steps) || plan.steps.length === 0) {
        throw new Error(t('error.plan.invalid_or_empty'));
    }

    const usesWorkspace = plan.steps.some(step => step.tool.startsWith('workspace_'));
    const hasActiveProject = Boolean(session.current_project_id);

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
