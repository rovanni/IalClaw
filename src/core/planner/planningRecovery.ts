import { ExecutionPlan } from './types';
import { ProjectType } from '../../services/WorkspaceService';

export type PlannerIntent = 'presentation' | 'frontend' | 'automation' | 'document' | 'generic';

export function detectPlannerIntent(userInput: string): { intent: PlannerIntent; projectType: ProjectType } {
    const normalized = userInput.toLowerCase();

    if (/(slide|slides|apresenta|deck|pitch)/i.test(normalized)) {
        return { intent: 'presentation', projectType: 'slides' };
    }

    if (/(bot|automacao|automate|script|workflow|scraper)/i.test(normalized)) {
        return { intent: 'automation', projectType: 'automation' };
    }

    if (/(document|relatorio|markdown|manual|guia|texto)/i.test(normalized)) {
        return { intent: 'document', projectType: 'document' };
    }

    if (/(site|pagina|frontend|html|css|ui|landing page|jogo)/i.test(normalized)) {
        return { intent: 'frontend', projectType: 'code' };
    }

    return { intent: 'generic', projectType: 'code' };
}

export function buildPlannerFallbackPlan(userInput: string, hasActiveProject: boolean, reason: string): ExecutionPlan {
    const timestamp = Date.now();
    const projectName = buildProjectName(userInput);
    const detection = detectPlannerIntent(userInput);
    const filename = `IALCLAW_FALLBACK_TASK_${timestamp}.md`;
    const content = buildFallbackTaskContent(userInput, reason, detection.intent);

    if (hasActiveProject) {
        return {
            goal: `Registrar tarefa em modo resiliente: ${truncate(userInput, 72)}`,
            steps: [
                {
                    id: 1,
                    type: 'tool',
                    tool: 'workspace_save_artifact',
                    input: {
                        filename,
                        content
                    },
                    capabilities: { requiresDOM: false }
                }
            ]
        };
    }

    return {
        goal: `Preparar fallback resiliente para: ${truncate(userInput, 72)}`,
        steps: [
            {
                id: 1,
                type: 'tool',
                tool: 'workspace_create_project',
                input: {
                    name: projectName,
                    type: detection.projectType,
                    prompt: userInput
                },
                capabilities: { requiresDOM: false }
            },
            {
                id: 2,
                type: 'tool',
                tool: 'workspace_save_artifact',
                input: {
                    filename,
                    content
                },
                capabilities: { requiresDOM: false }
            }
        ]
    };
}

function buildProjectName(userInput: string): string {
    const tokens = userInput
        .toLowerCase()
        .replace(/[^a-z0-9\s-]/g, ' ')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 4);

    return tokens.join('-') || 'fallback-task';
}

function buildFallbackTaskContent(userInput: string, reason: string, intent: PlannerIntent): string {
    return [
        '# IalClaw Fallback Task',
        '',
        'O planner principal nao conseguiu produzir um plano confiavel apos parse, recovery e autocorrecao.',
        '',
        `Intent detectado: ${intent}`,
        `Motivo do fallback: ${reason}`,
        '',
        'Tarefa original:',
        userInput,
        '',
        'Proxima acao recomendada:',
        '- usar este arquivo como baseline para uma nova rodada de planejamento ou execucao assistida',
        '- preservar o pedido original sem perder contexto de sessao'
    ].join('\n');
}

function truncate(value: string, maxLength: number): string {
    if (value.length <= maxLength) {
        return value;
    }

    return `${value.slice(0, Math.max(0, maxLength - 3))}...`;
}