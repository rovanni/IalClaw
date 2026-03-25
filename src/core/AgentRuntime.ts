import { AgentPlanner } from './planner/AgentPlanner';
import { AgentExecutor } from './executor/AgentExecutor';
import { emitDebug } from '../shared/DebugBus';
import { runWithTrace } from '../shared/TraceContext';
import { CognitiveMemory } from '../memory/CognitiveMemory';
import { SessionManager } from '../shared/SessionManager';
import { agentConfig } from './executor/AgentConfig';
import { resolveExecutionMode } from './executor/diffStrategy';
import { decideExecutionPath, RuntimeDecision } from './runtime/decisionGate';
import { ExecutionPlan, PlannerOutput } from './planner/types';
import { workspaceService } from '../services/WorkspaceService';

export class AgentRuntime {
    private planner: AgentPlanner;
    private executor: AgentExecutor;

    constructor(memory: CognitiveMemory) {
        this.planner = new AgentPlanner(memory);
        this.executor = new AgentExecutor(memory);
    }

    async execute(userInput: string, mode: 'react' | 'planner' = 'planner'): Promise<string> {
        return runWithTrace(async () => {
            emitDebug('gateway', { route: mode, query: userInput, timestamp: Date.now() });

            if (mode !== 'planner') {
                return 'Fluxo ReAct legado acionado (adicione a logica do AgentLoop aqui, se necessario).';
            }

            try {
                const session = SessionManager.getCurrentSession();

                if (!session) {
                    throw new Error('Sessao ativa nao encontrada para executar o plano.');
                }

                let plannerOutput = await this.planner.createPlanWithDiagnostics(userInput);
                let selectedMode = resolveExecutionMode(agentConfig.getExecutionMode(), plannerOutput.diagnostics.confidenceScore);
                let decision = decideExecutionPath(plannerOutput, selectedMode);

                this.emitPlannerDecision('initial', plannerOutput, selectedMode, decision);

                if (decision === 'REPLAN') {
                    plannerOutput = await this.planner.createPlanWithDiagnostics(userInput, {
                        supplementalInstruction: 'Replaneje em modo conservador. Prefira no maximo 3 steps. Retorne apenas o essencial para destravar a execucao.'
                    });
                    selectedMode = resolveExecutionMode(agentConfig.getExecutionMode(), plannerOutput.diagnostics.confidenceScore);
                    decision = decideExecutionPath(plannerOutput, selectedMode);

                    if (decision === 'REPLAN') {
                        decision = plannerOutput.plan ? 'REPAIR_AND_EXECUTE' : 'DIRECT_EXECUTION';
                    }

                    this.emitPlannerDecision('replan', plannerOutput, selectedMode, decision);
                }

                if (decision === 'DIRECT_EXECUTION') {
                    const direct = await this.executor.executeDirect(userInput, session, plannerOutput.diagnostics.confidenceScore);

                    if (!direct.success) {
                        return `Falha na execucao direta: ${direct.error}`;
                    }

                    return direct.answer || 'Execucao direta concluida sem resposta textual.';
                }

                const plan = plannerOutput.plan;
                if (!plan) {
                    return 'Falha na execucao: nenhuma estrategia de planejamento gerou um plano utilizavel.';
                }

                emitDebug('plan_generated', {
                    plan,
                    diagnostics: plannerOutput.diagnostics,
                    decision,
                    selected_mode: selectedMode
                });

                const result = decision === 'REPAIR_AND_EXECUTE'
                    ? await this.executor.repairAndExecute(plan, session, userInput, plannerOutput.diagnostics.confidenceScore)
                    : await this.executor.executePlanned(plan, session, userInput, decision, plannerOutput.diagnostics.confidenceScore);

                if (!result.success) {
                    if (result.error_type === 'missing_capability' && result.capability === 'browser_execution') {
                        return result.error || `O ambiente atual nao oferece a capacidade obrigatoria: ${result.capability}.`;
                    }

                    if (result.error_type === 'environment_dependency' && result.dependency === 'puppeteer') {
                        return `O projeto foi gerado, mas falta um componente do ambiente para testar HTML automaticamente: puppeteer.

Voce pode seguir de duas formas:
1. instalar o componente manualmente
2. autorizar o agente a tentar instalar para voce

Se quiser, me responda:
"pode instalar o puppeteer"
e eu tento fazer isso para voce.`;
                    }

                    return `Falha na execucao do plano: ${result.error}`;
                }

                return this.buildExecutionSuccessMessage(plan, session, result.answer);
            } catch (error: any) {
                return `Falha na execucao do plano: ${error.message}`;
            }
        }, 'runtime_core');
    }

    private buildExecutionSuccessMessage(plan: ExecutionPlan, session: NonNullable<ReturnType<typeof SessionManager.getCurrentSession>>, answer?: string): string {
        if (answer && answer.trim()) {
            return answer.trim();
        }

        const projectId = session.current_project_id;
        const artifacts = session.last_artifacts || [];

        if (!projectId) {
            return `Execucao concluida com sucesso.\nPassos executados: ${plan.steps.length}`;
        }

        const metadata = workspaceService.readProjectMetadata(projectId);
        const projectType = metadata?.type;
        const outputPath = workspaceService.getProjectOutputPath(projectId);
        const artifactLines = artifacts.length > 0
            ? artifacts.map(file => `- ${outputPath.replace(/\\/g, '/')}/${file}`)
            : [`- ${outputPath.replace(/\\/g, '/')}`];

        if (projectType === 'slides') {
            return [
                'Slides gerados com sucesso.',
                `Projeto: ${projectId}`,
                'Arquivos gerados:',
                ...artifactLines,
                'Abra o arquivo HTML no output para visualizar a apresentacao.'
            ].join('\n');
        }

        return [
            'Execucao concluida com sucesso.',
            `Projeto: ${projectId}`,
            'Arquivos gerados:',
            ...artifactLines,
            `Passos executados: ${plan.steps.length}`
        ].join('\n');
    }

    private emitPlannerDecision(stage: 'initial' | 'replan', output: PlannerOutput, selectedMode: string, decision: RuntimeDecision) {
        emitDebug('planner_diagnostics', {
            stage,
            diagnostics: output.diagnostics,
            has_plan: Boolean(output.plan)
        });

        emitDebug('runtime_decision', {
            stage,
            decision,
            confidence: output.diagnostics.confidenceScore,
            selected_mode: selectedMode,
            planner_used: decision !== 'DIRECT_EXECUTION',
            reason: `${stage}:${decision.toLowerCase()}`
        });
    }
}
