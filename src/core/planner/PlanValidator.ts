import { ExecutionPlan } from './types';
import { toolRegistry } from '../tools/ToolRegistry';

export function validatePlan(plan: ExecutionPlan): void {
    if (!plan || !plan.steps || !Array.isArray(plan.steps) || plan.steps.length === 0) {
        throw new Error("Plano inválido ou vazio.");
    }

    // Regra de Negócio: Se vai usar ferramentas do workspace, a primeira DEVE ser a criação do projeto.
    const usesWorkspace = plan.steps.some(s => s.tool.startsWith('workspace_'));
    if (usesWorkspace && plan.steps[0].tool !== "workspace_create_project") {
        throw new Error("Validação Falhou: O plano deve obrigatoriamente iniciar com 'workspace_create_project'.");
    }

    // Valida se as ferramentas existem no registro (Anti-Alucinação)
    for (const step of plan.steps) {
        if (!toolRegistry.get(step.tool)) {
            throw new Error(`Validação Falhou: Tool alucinada detectada no plano -> ${step.tool}`);
        }
    }
}