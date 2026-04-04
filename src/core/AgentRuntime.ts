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
import { ExecutionPolicy } from './ExecutionPolicy';
import { t } from '../i18n';
import { CognitiveOrchestrator } from './orchestrator/CognitiveOrchestrator';

export class AgentRuntime {
    private planner: AgentPlanner;
    private executor: AgentExecutor;
    private orchestrator?: CognitiveOrchestrator;

    constructor(memory: CognitiveMemory) {
        this.planner = new AgentPlanner(memory);
        this.executor = new AgentExecutor(memory, this.orchestrator);
    }

    public setOrchestrator(orchestrator: CognitiveOrchestrator): void {
        this.orchestrator = orchestrator;
        this.executor.setOrchestrator(orchestrator);
    }

    async execute(userInput: string, mode: 'react' | 'planner' = 'planner', policy?: ExecutionPolicy): Promise<string> {
        return runWithTrace(async () => {
            emitDebug('gateway', { route: mode, query: userInput, timestamp: Date.now() });

            if (mode !== 'planner') {
                return t('runtime.react_legacy');
            }

            try {
                const session = SessionManager.getCurrentSession();
                const safeMode = policy?.safeMode ?? agentConfig.isSafeModeEnabled();

                if (safeMode) {
                    emitDebug('runtime_decision', {
                        stage: 'safe_mode',
                        decision: 'DIRECT_EXECUTION',
                        confidence: 1,
                        selected_mode: 'safe_mode',
                        planner_used: false,
                        reason: 'safe_mode:direct_only'
                    });

                    const direct = await this.executor.executeDirect(userInput, session, 1);

                    if (!direct.success) {
                        return t('runtime.direct_failed', { error: direct.error });
                    }

                    return direct.answer || t('runtime.direct_no_answer');
                }

                if (!session) {
                    throw new Error(t('runtime.session_not_found'));
                }

                let plannerOutput = await this.planner.createPlanWithDiagnostics(userInput);
                let selectedMode = resolveExecutionMode(agentConfig.getExecutionMode(), plannerOutput.diagnostics.confidenceScore);
                let decision = decideExecutionPath(plannerOutput, selectedMode);

                this.emitPlannerDecision('initial', plannerOutput, selectedMode, decision);

                if (decision === 'REPLAN') {
                    plannerOutput = await this.planner.createPlanWithDiagnostics(userInput, {
                        supplementalInstruction: t('runtime.replan_instruction')
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
                        return t('runtime.direct_failed', { error: direct.error });
                    }

                    return direct.answer || t('runtime.direct_no_answer');
                }

                const plan = plannerOutput.plan;
                if (!plan) {
                    return t('runtime.plan_missing');
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

                const selfHealingSignal = this.executor.getSelfHealingSignal();
                if (selfHealingSignal) {
                    this.orchestrator?.ingestSelfHealingSignal(selfHealingSignal, session.conversation_id);
                }

                if (!result.success) {
                    if (result.error_type === 'missing_capability' && result.capability === 'browser_execution') {
                        return result.error || t('runtime.missing_capability', { capability: result.capability });
                    }

                    if (result.error_type === 'environment_dependency' && result.dependency === 'puppeteer') {
                        return t('runtime.puppeteer_missing');
                    }

                    return t('runtime.plan_failed', { error: result.error });
                }

                return this.buildExecutionSuccessMessage(plan, session, result.answer);
            } catch (error: any) {
                return t('runtime.plan_failed', { error: error.message });
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
            return t('runtime.success.no_project', { steps: plan.steps.length });
        }

        const metadata = workspaceService.readProjectMetadata(projectId);
        const projectType = metadata?.type;
        const outputPath = workspaceService.getProjectOutputPath(projectId);
        const artifactLines = artifacts.length > 0
            ? artifacts.map(file => `- ${outputPath.replace(/\\/g, '/')}/${file}`)
            : [`- ${outputPath.replace(/\\/g, '/')}`];

        if (projectType === 'slides') {
            return [
                t('runtime.success.slides.title'),
                t('runtime.success.project', { projectId }),
                t('runtime.success.files'),
                ...artifactLines,
                t('runtime.success.slides.open_html')
            ].join('\n');
        }

        return [
            t('runtime.success.title'),
            t('runtime.success.project', { projectId }),
            t('runtime.success.files'),
            ...artifactLines,
            t('runtime.success.steps', { steps: plan.steps.length })
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
