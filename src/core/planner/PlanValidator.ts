import { ExecutionPlan } from './types';
import { toolRegistry } from '../tools/ToolRegistry';
import { SessionManager } from '../../shared/SessionManager';

export function validatePlan(plan: ExecutionPlan): void {
    if (!plan || !plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
        throw new Error('Plano invalido ou vazio.');
    }

    const usesWorkspace = plan.steps.some(step => step.tool.startsWith('workspace_'));
    const session = SessionManager.getCurrentSession();
    const hasActiveProject = Boolean(session?.current_project_id);

    if (usesWorkspace && !hasActiveProject && plan.steps[0].tool !== 'workspace_create_project') {
        throw new Error("Validacao falhou: o plano deve iniciar com 'workspace_create_project' quando nao houver projeto ativo.");
    }

    for (const step of plan.steps) {
        if (!toolRegistry.get(step.tool)) {
            throw new Error(`Validacao falhou: tool alucinada detectada no plano -> ${step.tool}`);
        }
    }
}
