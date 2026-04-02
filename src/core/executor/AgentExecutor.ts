import { executeToolCall } from '../agent/executeTool';
import { validatePlan } from '../planner/PlanValidator';
import { ExecutionPlan } from '../planner/types';
import { debugBus, emitDebug } from '../../shared/DebugBus';
import { CognitiveMemory } from '../../memory/CognitiveMemory';
import { getPendingAction } from '../agent/PendingActionTracker';
import { Session } from '../../shared/SessionManager';
import { createLogger } from '../../shared/AppLogger';
import { LLMProvider, MessagePayload, ProviderFactory } from '../../engine/ProviderFactory';
import { classifyError } from '../../utils/errorClassifier';
import { normalizeError } from '../../utils/errorFingerprint';
import { detectOscillation, updateHistory } from '../../utils/inputOscillation';
import { isMinimalChange } from '../../utils/minimalChange';
import { parseLlmJson } from '../../utils/parseLlmJson';
import { PlanStep } from '../planner/types';
import { toolRegistry } from '../tools/ToolRegistry';
import { buildWorkspaceContext, formatWorkspaceForRepair } from '../planner/workspaceContext';
import { formatTargetFileBlock, rankFiles, selectWithConfidence } from '../planner/fileTargeting';
import { workspaceService } from '../../services/WorkspaceService';
import { DiffOperation, validateDiffOperations } from '../../tools/workspaceDiff';
import { estimateChangeSize, resolveExecutionMode, selectDiffStrategy, selectValidationMode } from './diffStrategy';
import { getContext } from '../../shared/TraceContext';
import { getRequiredCapabilities } from '../../capabilities/taskCapabilities';
import { handleCapabilityFallback } from '../../capabilities/capabilityFallback';
import { skillManager } from '../../capabilities';
import { SkillPolicy } from '../../capabilities/SkillManager';
import { agentConfig } from './AgentConfig';
import {
    getRequiredCapabilitiesForStep,
    requiresDOM,
    resolveRuntimeModeForPlan,
    sanitizeStep
} from '../../capabilities/stepCapabilities';
import { cloneExecutionPlan, RepairResult, repairPlanStructure } from './repairPipeline';
import { hashLearningInput, pushLearningRecord } from './operationalLearning';
import { RuntimeDecision } from '../runtime/decisionGate';
import { CognitiveOrchestrator } from '../orchestrator/CognitiveOrchestrator';
import { t } from '../../i18n';

const MAX_RETRIES = 5;
const MAX_TOOL_INPUT_RETRIES = 2;

class StepExecutionError extends Error {
    stepIndex: number;
    stepId: number;
    stepTool: string;

    constructor(message: string, stepIndex: number, stepId: number, stepTool: string) {
        super(message);
        this.name = 'StepExecutionError';
        this.stepIndex = stepIndex;
        this.stepId = stepId;
        this.stepTool = stepTool;
    }
}

type SaveExecutionDecision = {
    handled: boolean;
    blocked?: string;
};

export interface ExecutionTrace {
    decision: RuntimeDecision;
    confidence: number;
    success: boolean;
    retries: number;
    durationMs: number;
    errorType?: string;
    repairUsed?: boolean;
    repairSuccess?: boolean;
    planSize?: number;
    reactive?: boolean;
    pending?: boolean;
    recoveryAttempt?: number;
}

export type SelfHealingSignal = {
    activated: boolean;
    attempts: number;
    maxAttempts: number;
    success: boolean;
    lastError?: string;
    stepId?: string;
    toolName?: string;
};

export class AgentExecutor {
    private llm: LLMProvider;
    private memory: CognitiveMemory;
    private logger = createLogger('AgentExecutor');
    private lastSelfHealingSignal?: SelfHealingSignal;
    private orchestrator?: CognitiveOrchestrator;

    constructor(memory: CognitiveMemory, orchestrator?: CognitiveOrchestrator) {
        this.memory = memory;
        this.orchestrator = orchestrator;
        this.llm = ProviderFactory.getProvider();
    }

    private shouldRetryWithGovernance(session: Session, attempt: number, executorDecision: boolean): boolean {
        if (this.lastSelfHealingSignal) {
            this.orchestrator?.ingestSelfHealingSignal(this.lastSelfHealingSignal, session.conversation_id);
        }

        const orchestratorDecision = this.orchestrator?.decideRetryAfterFailure({
            sessionId: session.conversation_id,
            attempt,
            executorDecision
        });
        const finalDecision = orchestratorDecision ?? executorDecision;

        debugBus.emit('self_healing_governance', {
            type: 'self_healing_governance',
            sessionId: session.conversation_id,
            attempt,
            executorDecision,
            orchestratorDecision,
            finalDecision,
            trace_id: getTraceIdSafe()
        });

        debugBus.emit('retry_decision', {
            type: 'retry_decision',
            sessionId: session.conversation_id,
            attempt,
            orchestratorDecision,
            executorDecision,
            finalDecision,
            trace_id: getTraceIdSafe()
        });

        return finalDecision;
    }

    async run(plan: ExecutionPlan, session?: Session) {
        debugBus.emit('thought', { type: 'action', content: `[EXECUTOR] Iniciando meta: ${plan.goal}` });

        for (const [stepIndex, rawStep] of plan.steps.entries()) {
            const step = sanitizeStep(rawStep);
            plan.steps[stepIndex] = step;

            debugBus.emit('dom_decision', {
                stepId: step.id,
                tool: step.tool,
                requiresDOM: requiresDOM(step),
                source: rawStep.capabilities ? 'planner' : 'default_false',
                trace_id: getTraceIdSafe()
            });

            const capabilityCheck = await this.ensureStepCapabilities(step, session, plan.goal);
            if (!capabilityCheck.ok) {
                return {
                    success: false,
                    error: capabilityCheck.error || 'Capacidade obrigatoria indisponivel.',
                    error_type: 'missing_capability',
                    capability: capabilityCheck.capability,
                    fallback: capabilityCheck.fallback
                };
            }

            this.applyFileTargeting(step, plan.goal, session);
            debugBus.emit('thought', { type: 'thought', content: `[EXECUTOR] Executando Step ${step.id}: ${step.tool}` });

            const saveDecision = await this.tryApplyDiffAwareSave(step, plan.goal, session);
            if (saveDecision.blocked) {
                throw new StepExecutionError(
                    saveDecision.blocked,
                    stepIndex,
                    step.id,
                    step.tool
                );
            }

            if (saveDecision.handled) {
                if (session) {
                    session.last_error = undefined;
                    session.last_error_type = undefined;
                    session.last_error_hash = undefined;
                    session.last_error_fingerprint = undefined;
                    session._tool_input_attempts = 0;
                    session._input_history = [];
                }

                await new Promise(resolve => setTimeout(resolve, 500));
                continue;
            }

            let result;
            try {
                result = await executeToolCall(step.tool, step.input);
            } catch (error: any) {
                throw new StepExecutionError(
                    error?.message || `Execucao interrompida no step ${step.id}`,
                    stepIndex,
                    step.id,
                    step.tool
                );
            }

            if (!result.success) {
                debugBus.emit('thought', { type: 'error', content: `[EXECUTOR] Abortando. Falha no Step ${step.id}: ${result.error}` });
                throw new StepExecutionError(
                    `Execucao interrompida no step ${step.id}: ${result.error}`,
                    stepIndex,
                    step.id,
                    step.tool
                );
            }

            if (session) {
                session.last_error = undefined;
                session.last_error_type = undefined;
                session.last_error_hash = undefined;
                session.last_error_fingerprint = undefined;
                session._tool_input_attempts = 0;
                session._input_history = [];
            }

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        debugBus.emit('thought', { type: 'final', content: '[EXECUTOR] Plano finalizado com sucesso.' });
    }

    async executePlanned(
        plan: ExecutionPlan,
        session: Session,
        input: string,
        decision: RuntimeDecision,
        confidence: number
    ) {
        return this.executeWithTrace({
            plan,
            session,
            input,
            decision,
            confidence,
            repairUsed: false,
            runner: (candidatePlan, candidateSession) => this.runWithHealing(candidatePlan, candidateSession)
        });
    }

    async repairAndExecute(
        plan: ExecutionPlan,
        session: Session,
        input: string,
        confidence: number
    ) {
        const startedAt = Date.now();
        const planCopy = cloneExecutionPlan(plan);
        const repairResult = this.runRepairPipeline(planCopy, session);

        emitDebug('repair_metrics', {
            actions: repairResult.repairActions,
            success: repairResult.success,
            error: repairResult.error,
            plan_size: plan.steps.length
        });

        if (!repairResult.success || !repairResult.repairedPlan) {
            const failure = {
                success: false,
                error: repairResult.error || 'Repair pipeline falhou.',
                error_type: 'repair'
            };

            this.emitExecutionResult({
                decision: 'REPAIR_AND_EXECUTE' as any,
                confidence,
                success: false,
                retries: 0,
                durationMs: Date.now() - startedAt,
                errorType: 'repair',
                repairUsed: true,
                repairSuccess: false,
                planSize: plan.steps.length,
                reactive: session.reactive_state?.hasFailure === true,
                pending: Boolean(getPendingAction(session))
            });
            this.recordLearning(input, 'REPAIR_AND_EXECUTE' as any, confidence, false, session, 'repair', repairResult.repairActions);
            return failure;
        }

        return this.executeWithTrace({
            plan: repairResult.repairedPlan,
            session,
            input,
            decision: 'REPAIR_AND_EXECUTE',
            confidence,
            repairUsed: true,
            repairActions: repairResult.repairActions,
            runner: (candidatePlan, candidateSession) => this.runWithHealing(candidatePlan, candidateSession)
        });
    }

    async runWithHealing(plan: ExecutionPlan, session: Session) {
        let attempt = 0;
        let lastError: string | null = null;
        session._tool_input_attempts = 0;

        const selfHealingSignal: SelfHealingSignal = {
            activated: true,
            attempts: 0,
            maxAttempts: MAX_RETRIES + 1,
            success: false,
            stepId: plan.steps[0]?.id?.toString(),
            toolName: plan.steps[0]?.tool
        };
        const updateSelfHealingSignal = (patch: Partial<SelfHealingSignal>) => {
            Object.assign(selfHealingSignal, patch);
            this.lastSelfHealingSignal = { ...selfHealingSignal };
        };
        updateSelfHealingSignal({});

        debugBus.emit('executor_self_healing_start', {
            type: 'executor_self_healing_start',
            sessionId: session.conversation_id,
            stepId: plan.steps[0]?.id,
            toolName: plan.steps[0]?.tool,
            trace_id: getTraceIdSafe()
        });

        const emitSelfHealingEnd = (totalAttempts: number, success: boolean) => {
            updateSelfHealingSignal({
                attempts: totalAttempts,
                success,
                lastError: success ? undefined : (lastError || undefined)
            });
            debugBus.emit('executor_self_healing_end', {
                type: 'executor_self_healing_end',
                sessionId: session.conversation_id,
                totalAttempts,
                success,
                trace_id: getTraceIdSafe()
            });
        };

        while (attempt <= MAX_RETRIES) {
            updateSelfHealingSignal({
                attempts: attempt + 1,
                stepId: plan.steps[0]?.id?.toString(),
                toolName: plan.steps[0]?.tool
            });
            debugBus.emit('executor:attempt', { attempt });
            debugBus.emit('executor_self_healing', {
                type: 'executor_self_healing',
                sessionId: session.conversation_id,
                attempt: attempt + 1,
                maxAttempts: MAX_RETRIES + 1,
                error: undefined,
                stepId: plan.steps[0]?.id,
                toolName: plan.steps[0]?.tool,
                timestamp: new Date().toISOString(),
                action: 'attempt_started',
                trace_id: getTraceIdSafe()
            });

            try {
                await this.run(plan, session);
            } catch (error: any) {
                const failureMessage = error.message || 'Falha desconhecida na execucao do plano.';
                const failedStepIndex = error instanceof StepExecutionError ? error.stepIndex : 0;
                const currentStep = plan.steps[failedStepIndex] || plan.steps[0];
                updateSelfHealingSignal({
                    lastError: failureMessage,
                    stepId: currentStep?.id?.toString(),
                    toolName: currentStep?.tool
                });

                if (failureMessage.startsWith('tool_input_error::')) {
                    let payload: any;

                    try {
                        payload = JSON.parse(failureMessage.replace('tool_input_error::', ''));
                    } catch {
                        payload = { type: 'tool_input', issues: [{ path: '', message: failureMessage, expected: null, received: null }] };
                    }

                    const toolInputAttempts: number = (session._tool_input_attempts || 0) + 1;
                    session._tool_input_attempts = toolInputAttempts;

                    if (toolInputAttempts >= MAX_TOOL_INPUT_RETRIES) {
                        const executorDecision = false;
                        const orchestratorDecision = this.orchestrator?.decideRetryAfterFailure({
                            sessionId: session.conversation_id,
                            attempt,
                            executorDecision: false
                        });
                        const finalDecision = orchestratorDecision ?? executorDecision;

                        debugBus.emit('self_healing_abort', {
                            reason: 'tool_input_not_converging',
                            tool: payload.tool,
                            issues: payload.issues,
                            governedByOrchestrator: finalDecision !== false
                        });

                        emitSelfHealingEnd(attempt + 1, false);

                        if (orchestratorDecision === true) {
                            return {
                                success: false,
                                error: t('error.executor.governance.tool_input_not_converging', { attempts: String(toolInputAttempts), max: String(MAX_TOOL_INPUT_RETRIES) })
                            };
                        }

                        return {
                            success: false,
                            error: t('error.executor.selfhealing.tool_input_not_converging')
                        };
                    }

                    session.last_error = JSON.stringify(payload);
                    session.last_error_type = 'tool_input';
                    session.last_error_hash = undefined;
                    session.last_error_fingerprint = undefined;

                    debugBus.emit('self_healing', {
                        stage: 'tool_input',
                        tool: payload.tool,
                        issues: payload.issues,
                        attempt,
                        failed_step: {
                            id: currentStep?.id,
                            tool: currentStep?.tool,
                            input: currentStep?.input
                        }
                    });

                    debugBus.emit('executor:replan', {
                        attempt,
                        reason: 'tool_input_error'
                    });
                    debugBus.emit('executor_self_healing', {
                        type: 'executor_self_healing',
                        sessionId: session.conversation_id,
                        attempt: attempt + 1,
                        maxAttempts: MAX_RETRIES + 1,
                        error: failureMessage,
                        stepId: currentStep?.id,
                        toolName: currentStep?.tool,
                        timestamp: new Date().toISOString(),
                        action: 'replan_triggered',
                        trace_id: getTraceIdSafe()
                    });

                    const repairBaselineInput = payload.received_input && typeof payload.received_input === 'object'
                        ? payload.received_input
                        : currentStep.input;

                    const repairStep = {
                        ...currentStep,
                        input: repairBaselineInput,
                        is_repair: true
                    };
                    debugBus.emit('repair:tool_input:baseline', {
                        step: {
                            id: repairStep.id,
                            tool: repairStep.tool,
                            input: repairStep.input
                        },
                        payload
                    });
                    plan.steps = [repairStep];

                    const newStep = await this.replanToolInputStep(repairStep, session);
                    const isCorrectionMode = repairStep.is_repair === true
                        && session.last_error_type === 'tool_input'
                        && payload.tool === repairStep.tool;

                    if (newStep?.tool !== repairStep.tool) {
                        const executorDecision = false;
                        const orchestratorDecision = this.orchestrator?.decideRetryAfterFailure({
                            sessionId: session.conversation_id,
                            attempt,
                            executorDecision: false
                        });
                        const finalDecision = orchestratorDecision ?? executorDecision;

                        debugBus.emit('self_healing_abort', {
                            reason: 'tool_mismatch_during_repair',
                            expected_tool: repairStep.tool,
                            received_tool: newStep?.tool,
                            repair_step: repairStep,
                            normalized_step: newStep,
                            governedByOrchestrator: finalDecision !== false
                        });

                        emitSelfHealingEnd(attempt + 1, false);

                        if (orchestratorDecision === true) {
                            return {
                                success: false,
                                error: t('error.executor.governance.tool_mismatch_repair', { expected: repairStep.tool, received: newStep?.tool ?? '' })
                            };
                        }

                        return {
                            success: false,
                            error: t('error.executor.selfhealing.tool_mismatch_repair')
                        };
                    }

                    if (isCorrectionMode && JSON.stringify(repairStep.input) === JSON.stringify(newStep?.input)) {
                        const executorDecision = false;
                        const orchestratorDecision = this.orchestrator?.decideRetryAfterFailure({
                            sessionId: session.conversation_id,
                            attempt,
                            executorDecision: false
                        });
                        const finalDecision = orchestratorDecision ?? executorDecision;

                        debugBus.emit('self_healing_abort', {
                            reason: 'noop_correction',
                            tool: payload.tool,
                            input: newStep?.input,
                            governedByOrchestrator: finalDecision !== false
                        });

                        emitSelfHealingEnd(attempt + 1, false);

                        if (orchestratorDecision === true) {
                            return {
                                success: false,
                                error: t('error.executor.governance.noop_correction')
                            };
                        }

                        return {
                            success: false,
                            error: t('error.executor.selfhealing.noop_correction')
                        };
                    }

                    if (isCorrectionMode && !isMinimalChange(repairStep, newStep, payload.issues || [])) {
                        const executorDecision = false;
                        const orchestratorDecision = this.orchestrator?.decideRetryAfterFailure({
                            sessionId: session.conversation_id,
                            attempt,
                            executorDecision: false
                        });
                        const finalDecision = orchestratorDecision ?? executorDecision;

                        debugBus.emit('self_healing_abort', {
                            reason: 'non_minimal_change',
                            tool: payload.tool,
                            issues: payload.issues,
                            prev_input: repairStep.input,
                            new_input: newStep?.input,
                            governedByOrchestrator: finalDecision !== false
                        });

                        emitSelfHealingEnd(attempt + 1, false);

                        if (orchestratorDecision === true) {
                            return {
                                success: false,
                                error: t('error.executor.governance.non_minimal_correction')
                            };
                        }

                        return {
                            success: false,
                            error: t('error.executor.selfhealing.non_minimal_correction')
                        };
                    }

                    session._input_history = session._input_history || [];

                    if (isCorrectionMode && detectOscillation(session._input_history, newStep.input)) {
                        const executorDecision = false;
                        const orchestratorDecision = this.orchestrator?.decideRetryAfterFailure({
                            sessionId: session.conversation_id,
                            attempt,
                            executorDecision: false
                        });
                        const finalDecision = orchestratorDecision ?? executorDecision;

                        debugBus.emit('self_healing_abort', {
                            reason: 'input_oscillation',
                            tool: payload.tool,
                            input: newStep.input,
                            governedByOrchestrator: finalDecision !== false
                        });

                        emitSelfHealingEnd(attempt + 1, false);

                        if (orchestratorDecision === true) {
                            return {
                                success: false,
                                error: t('error.executor.governance.input_oscillation')
                            };
                        }

                        return {
                            success: false,
                            error: t('error.executor.selfhealing.input_oscillation')
                        };
                    }

                    if (isCorrectionMode) {
                        session._input_history = updateHistory(session._input_history, newStep.input);
                    }
                    plan = {
                        ...plan,
                        steps: [{ ...newStep, is_repair: false }]
                    };

                    const shouldRetry = this.shouldRetryWithGovernance(session, attempt + 1, true);
                    if (!shouldRetry) {
                        emitSelfHealingEnd(attempt + 1, false);
                        return {
                            success: false,
                            error: failureMessage
                        };
                    }

                    debugBus.emit('executor_self_healing', {
                        type: 'executor_self_healing',
                        sessionId: session.conversation_id,
                        attempt: attempt + 1,
                        maxAttempts: MAX_RETRIES + 1,
                        error: failureMessage,
                        stepId: currentStep?.id,
                        toolName: currentStep?.tool,
                        timestamp: new Date().toISOString(),
                        action: 'automatic_retry',
                        trace_id: getTraceIdSafe()
                    });
                    attempt++;
                    continue;
                }

                lastError = failureMessage;
                session.last_error = failureMessage;
                session.last_error_type = classifyError(failureMessage);
                session.last_error_hash = undefined;
                session.last_error_fingerprint = undefined;
                session._tool_input_attempts = undefined;
                session._input_history = [];

                debugBus.emit('self_healing', {
                    error: failureMessage,
                    error_type: session.last_error_type,
                    stage: 'execution',
                    attempt
                });

                if (attempt === MAX_RETRIES) {
                    emitSelfHealingEnd(attempt + 1, false);
                    return {
                        success: false,
                        error: `Falha na execucao apos ${MAX_RETRIES} tentativas: ${lastError}`
                    };
                }

                debugBus.emit('executor:replan', {
                    attempt,
                    reason: 'execution_error'
                });
                const shouldRetry = this.shouldRetryWithGovernance(session, attempt + 1, true);
                if (!shouldRetry) {
                    emitSelfHealingEnd(attempt + 1, false);
                    return {
                        success: false,
                        error: failureMessage
                    };
                }

                debugBus.emit('executor_self_healing', {
                    type: 'executor_self_healing',
                    sessionId: session.conversation_id,
                    attempt: attempt + 1,
                    maxAttempts: MAX_RETRIES + 1,
                    error: failureMessage,
                    stepId: currentStep?.id,
                    toolName: currentStep?.tool,
                    timestamp: new Date().toISOString(),
                    action: 'replan_triggered',
                    trace_id: getTraceIdSafe()
                });
                plan = await this.replan(plan, failureMessage, session);

                debugBus.emit('executor_self_healing', {
                    type: 'executor_self_healing',
                    sessionId: session.conversation_id,
                    attempt: attempt + 1,
                    maxAttempts: MAX_RETRIES + 1,
                    error: failureMessage,
                    stepId: currentStep?.id,
                    toolName: currentStep?.tool,
                    timestamp: new Date().toISOString(),
                    action: 'automatic_retry',
                    trace_id: getTraceIdSafe()
                });
                attempt++;
                continue;
            }

            if (!session.current_project_id) {
                debugBus.emit('executor:success', { skipped_validation: true });
                emitSelfHealingEnd(attempt + 1, true);
                return { success: true };
            }

            const configuredMode = agentConfig.getExecutionMode();
            const validationMode = selectValidationMode(configuredMode);

            debugBus.emit('execution_mode', {
                stage: 'validation',
                configured: configuredMode,
                selected: configuredMode,
                validation_mode: validationMode,
                trace_id: getTraceIdSafe()
            });

            if (validationMode === 'minimal') {
                debugBus.emit('thought', {
                    type: 'thought',
                    content: '[EXECUTOR] Validacao estrutural pulada pelo modo aggressive.'
                });
                debugBus.emit('executor:success', { skipped_validation: true, reason: 'execution_mode_minimal' });
            } else {
                const validation = await executeToolCall('workspace_validate_project', {
                    project_id: session.current_project_id
                });

                if (!validation.success) {
                    const validationError = ('data' in validation && validation.data?.errors?.length)
                        ? validation.data.errors.join('\n')
                        : validation.error || 'Falha desconhecida na validacao.';

                    if (validationMode === 'soft') {
                        debugBus.emit('validation_soft_failed', {
                            error: validationError,
                            stage: 'validation',
                            attempt,
                            trace_id: getTraceIdSafe()
                        });
                        debugBus.emit('thought', {
                            type: 'thought',
                            content: `[EXECUTOR] Validacao leve detectou problemas, mas o modo balanced manteve o progresso: ${validationError}`
                        });
                    } else {
                        lastError = validationError;
                        session.last_error = validationError;
                        session.last_error_type = 'structure';
                        session.last_error_hash = undefined;
                        session.last_error_fingerprint = undefined;
                        session._tool_input_attempts = undefined;
                        session._input_history = [];

                        debugBus.emit('self_healing', {
                            error: validationError,
                            error_type: 'structure',
                            stage: 'validation',
                            attempt
                        });

                        if (attempt === MAX_RETRIES) {
                            emitSelfHealingEnd(attempt + 1, false);
                            return {
                                success: false,
                                error: `Falha na validacao apos ${MAX_RETRIES} tentativas: ${lastError}`
                            };
                        }

                        debugBus.emit('executor:replan', {
                            attempt,
                            reason: 'validation_error'
                        });
                        const shouldRetry = this.shouldRetryWithGovernance(session, attempt + 1, true);
                        if (!shouldRetry) {
                            emitSelfHealingEnd(attempt + 1, false);
                            return {
                                success: false,
                                error: validationError
                            };
                        }

                        debugBus.emit('executor_self_healing', {
                            type: 'executor_self_healing',
                            sessionId: session.conversation_id,
                            attempt: attempt + 1,
                            maxAttempts: MAX_RETRIES + 1,
                            error: validationError,
                            stepId: plan.steps[0]?.id,
                            toolName: plan.steps[0]?.tool,
                            timestamp: new Date().toISOString(),
                            action: 'replan_triggered',
                            trace_id: getTraceIdSafe()
                        });
                        plan = await this.replan(plan, validationError, session);

                        debugBus.emit('executor_self_healing', {
                            type: 'executor_self_healing',
                            sessionId: session.conversation_id,
                            attempt: attempt + 1,
                            maxAttempts: MAX_RETRIES + 1,
                            error: validationError,
                            stepId: plan.steps[0]?.id,
                            toolName: plan.steps[0]?.tool,
                            timestamp: new Date().toISOString(),
                            action: 'automatic_retry',
                            trace_id: getTraceIdSafe()
                        });
                        attempt++;
                        continue;
                    }
                }
            }

            const workspaceContextForRuntime = buildWorkspaceContext(session.current_project_id);
            const runtimeMode = resolveRuntimeModeForPlan(plan, workspaceContextForRuntime);

            if (runtimeMode.requiresBrowserValidation) {
                debugBus.emit('browser_validation_enabled', {
                    stepId: 'runtime',
                    trace_id: getTraceIdSafe()
                });
                const browserCapability = await this.ensureBrowserCapability(session, plan.goal);
                if (!browserCapability.available) {
                    const fallback = browserCapability.fallback;
                    debugBus.emit('capability_fallback', {
                        capability: 'browser_execution',
                        fallback,
                        trace_id: getTraceIdSafe()
                    });

                    emitSelfHealingEnd(attempt + 1, false);

                    return {
                        success: false,
                        error: browserCapability.error,
                        error_type: 'missing_capability',
                        capability: 'browser_execution',
                        fallback
                    };
                }
            }

            if (runtimeMode.skipRuntimeExecution) {
                debugBus.emit('browser_skipped', {
                    stepId: 'runtime',
                    reason: runtimeMode.skipReason || 'runtime_skipped',
                    trace_id: getTraceIdSafe()
                });
                debugBus.emit('thought', {
                    type: 'thought',
                    content: runtimeMode.skipReason === 'no_runnable_entry'
                        ? '[EXECUTOR] Projeto sem entry point executavel suportado. Pulando runtime e preservando os artefatos gerados.'
                        : '[EXECUTOR] Projeto HTML detectado sem requiresDOM. Pulando validacao em browser.'
                });
                debugBus.emit('execution_success', {
                    project_id: session.current_project_id,
                    runtime_skipped: true,
                    reason: runtimeMode.skipReason || 'runtime_skipped'
                });

                if (session.last_error && session.last_error.length < 5000) {
                    await this.memory.saveExecutionFix({
                        content: `Erro anterior:\n${session.last_error}\n\nTipo:\n${session.last_error_type || 'unknown'}\n\nFingerprint:\n${session.last_error_fingerprint || 'unknown'}\n\nCorrecao aplicada:\n${JSON.stringify(plan)}`,
                        error_type: session.last_error_type || 'unknown',
                        fingerprint: session.last_error_fingerprint || 'none'
                    });
                }

                session.last_error = undefined;
                session.last_error_type = undefined;
                session.last_error_hash = undefined;
                session.last_error_fingerprint = undefined;
                session._tool_input_attempts = 0;
                session._input_history = [];

                debugBus.emit('executor:success', { runtime_skipped: true });
                emitSelfHealingEnd(attempt + 1, true);
                return { success: true };
            }

            const runtimeResult = await executeToolCall('workspace_run_project', {
                project_id: session.current_project_id
            });

            if (!runtimeResult.success) {
                const runtimeData = 'data' in runtimeResult ? runtimeResult.data : undefined;
                const runtimeError = runtimeResult.error
                    || runtimeData?.stderr
                    || runtimeData?.runtime_errors?.join('\n')
                    || 'Unknown runtime error';
                const runtimeHash = runtimeData?.error_hash;
                const errorType = classifyError(runtimeError);
                const normalizedError = normalizeError(runtimeError);

                if (errorType === 'environment_dependency') {
                    const executorDecision = false;
                    const orchestratorDecision = this.orchestrator?.decideRetryAfterFailure({
                        sessionId: session.conversation_id,
                        attempt,
                        executorDecision: false
                    });
                    const finalDecision = orchestratorDecision ?? executorDecision;

                    debugBus.emit('self_healing_abort', {
                        reason: 'missing_runtime_dependency',
                        error: runtimeError,
                        dependency: 'puppeteer',
                        governedByOrchestrator: finalDecision !== false
                    });

                    emitSelfHealingEnd(attempt + 1, false);

                    if (orchestratorDecision === true) {
                        return {
                            success: false,
                            error: t('error.executor.governance.missing_runtime_dependency', { error: runtimeError }),
                            error_type: 'environment_dependency',
                            dependency: 'puppeteer'
                        };
                    }

                    return {
                        success: false,
                        error: runtimeError,
                        error_type: 'environment_dependency',
                        dependency: 'puppeteer'
                    };
                }

                if (session.last_error_fingerprint && session.last_error_fingerprint === normalizedError) {
                    const executorDecision = false;
                    const orchestratorDecision = this.orchestrator?.decideRetryAfterFailure({
                        sessionId: session.conversation_id,
                        attempt,
                        executorDecision: false
                    });
                    const finalDecision = orchestratorDecision ?? executorDecision;

                    debugBus.emit('self_healing_abort', {
                        reason: 'equivalent_error_loop',
                        error: runtimeError,
                        error_hash: runtimeHash,
                        normalized: normalizedError,
                        governedByOrchestrator: finalDecision !== false
                    });

                    emitSelfHealingEnd(attempt + 1, false);

                    if (orchestratorDecision === true) {
                        return {
                            success: false,
                            error: t('error.executor.governance.equivalent_error_loop', { error: runtimeError })
                        };
                    }

                    return {
                        success: false,
                        error: t('error.executor.selfhealing.equivalent_error_loop', { error: runtimeError })
                    };
                }

                lastError = runtimeError;
                session.last_error = runtimeError;
                session.last_error_type = errorType;
                session.last_error_hash = runtimeHash;
                session.last_error_fingerprint = normalizedError;
                session._tool_input_attempts = undefined;
                session._input_history = [];

                debugBus.emit('self_healing', {
                    error: runtimeError,
                    error_type: errorType,
                    normalized: normalizedError,
                    stage: 'runtime',
                    attempt
                });

                if (attempt === MAX_RETRIES) {
                    emitSelfHealingEnd(attempt + 1, false);
                    return {
                        success: false,
                        error: `Falha de runtime apos ${MAX_RETRIES} tentativas: ${runtimeError}`
                    };
                }

                debugBus.emit('executor:replan', {
                    attempt,
                    reason: 'runtime_error'
                });
                const shouldRetry = this.shouldRetryWithGovernance(session, attempt + 1, true);
                if (!shouldRetry) {
                    emitSelfHealingEnd(attempt + 1, false);
                    return {
                        success: false,
                        error: runtimeError
                    };
                }

                debugBus.emit('executor_self_healing', {
                    type: 'executor_self_healing',
                    sessionId: session.conversation_id,
                    attempt: attempt + 1,
                    maxAttempts: MAX_RETRIES + 1,
                    error: runtimeError,
                    stepId: plan.steps[0]?.id,
                    toolName: plan.steps[0]?.tool,
                    timestamp: new Date().toISOString(),
                    action: 'replan_triggered',
                    trace_id: getTraceIdSafe()
                });
                plan = await this.replan(plan, runtimeError, session);

                debugBus.emit('executor_self_healing', {
                    type: 'executor_self_healing',
                    sessionId: session.conversation_id,
                    attempt: attempt + 1,
                    maxAttempts: MAX_RETRIES + 1,
                    error: runtimeError,
                    stepId: plan.steps[0]?.id,
                    toolName: plan.steps[0]?.tool,
                    timestamp: new Date().toISOString(),
                    action: 'automatic_retry',
                    trace_id: getTraceIdSafe()
                });
                attempt++;
                continue;
            }

            debugBus.emit('execution_success', {
                project_id: session.current_project_id
            });

            if (session.last_error && session.last_error.length < 5000) {
                await this.memory.saveExecutionFix({
                    content: `Erro anterior:\n${session.last_error}\n\nTipo:\n${session.last_error_type || 'unknown'}\n\nFingerprint:\n${session.last_error_fingerprint || 'unknown'}\n\nCorrecao aplicada:\n${JSON.stringify(plan)}`,
                    error_type: session.last_error_type || 'unknown',
                    fingerprint: session.last_error_fingerprint || 'none'
                });
            }

            session.last_error = undefined;
            session.last_error_type = undefined;
            session.last_error_hash = undefined;
            session.last_error_fingerprint = undefined;
            session._tool_input_attempts = 0;
            session._input_history = [];

            debugBus.emit('executor:success', {});
            emitSelfHealingEnd(attempt + 1, true);
            return { success: true };
        }

        emitSelfHealingEnd(MAX_RETRIES + 1, false);
        return {
            success: false,
            error: `Loop de healing excedeu o numero maximo de tentativas. Ultimo erro: ${lastError}`
        };
    }

    public getSelfHealingSignal(): SelfHealingSignal | undefined {
        if (!this.lastSelfHealingSignal) {
            return undefined;
        }

        return { ...this.lastSelfHealingSignal };
    }

    async executeDirect(userInput: string, session?: Session, confidenceScore?: number): Promise<{
        success: boolean;
        answer?: string;
        error?: string;
    }> {
        const startedAt = Date.now();
        debugBus.emit('thought', {
            type: 'thought',
            content: '[EXECUTOR] Confidence baixo detectado. Executando caminho direto sem depender do planner.'
        });

        debugBus.emit('direct_execution', {
            confidence: confidenceScore,
            project_id: session?.current_project_id,
            trace_id: getTraceIdSafe()
        });

        const contextBlock = session
            ? `CONTEXTO DE SESSAO:\n- Projeto atual: ${session.current_project_id || 'nenhum'}\n- Objetivo atual: ${session.current_goal || 'nenhum'}\n- Ultimo erro: ${session.last_error || 'nenhum'}`
            : 'CONTEXTO DE SESSAO: indisponivel';

        // STM: historico de conversa recente (ultimas 5 trocas = ate 10 mensagens)
        const stmHistory: MessagePayload[] = (session?.conversation_history ?? []).slice(-10).map(
            h => ({ role: h.role, content: h.content })
        );
        const contextUsed = stmHistory.length > 0;
        const totalMessages = 1 + stmHistory.length + 1; // system + history + user

        this.logger.info('direct_execution_context', 'Construindo contexto para execucao direta.', {
            cognitive_stage: 'execution',
            messages_sent: totalMessages,
            context_used: contextUsed,
            history_messages: stmHistory.length
        });

        const response = await this.llm.generate([
            {
                role: 'system',
                content: `Voce e um assistente direto e prestativo.\nUse o historico da conversa para entender referencias como "isso", "aquilo", "o codigo", "faz pra mim", etc.\nSe o usuario se referir a algo dito anteriormente, use esse contexto sem pedir esclarecimentos.\nResponda de forma objetiva e acionavel.\n\nMODO ATUAL: resposta direta sem execucao de ferramentas.\nREGRA CRITICA: nunca afirme que executou comandos, instalou pacotes, criou arquivos, rodou testes ou obteve logs reais.\nREGRA CRITICA: nunca invente saida de terminal (ex.: "added X packages", "build ok", "deploy concluido").\nREGRA CRITICA: nunca descreva resultados de execucao como fatos consumados.\nDescreva somente o que DEVE acontecer e use linguagem de previsao como:\n- "isso deve instalar..."\n- "isso deve criar..."\n- "ao executar, a saida esperada e..."\nSe o usuario pedir execucao real, seja explicito: diga que ainda nao foi executado e informe o comando ou passo para executar.\n${contextBlock}`
            },
            ...stmHistory,
            {
                role: 'user',
                content: userInput
            }
        ]);

        if (!response.final_answer || !response.final_answer.trim()) {
            this.emitExecutionResult({
                decision: 'DIRECT_EXECUTION' as any,
                confidence: confidenceScore || 0,
                success: false,
                retries: 0,
                durationMs: Date.now() - startedAt,
                errorType: 'direct_execution',
                repairUsed: false,
                planSize: 0,
                reactive: session?.reactive_state?.hasFailure === true,
                pending: session ? Boolean(getPendingAction(session)) : false
            });
            if (session) {
                this.recordLearning(userInput, 'DIRECT_EXECUTION' as any, confidenceScore || 0, false, session, 'direct_execution');
            }
            return {
                success: false,
                error: 'LLM nao retornou resposta na execucao direta.'
            };
        }

        this.emitExecutionResult({
            decision: 'DIRECT_EXECUTION' as any,
            confidence: confidenceScore || 0,
            success: true,
            retries: 0,
            durationMs: Date.now() - startedAt,
            repairUsed: false,
            planSize: 0,
            reactive: session?.reactive_state?.hasFailure === true,
            pending: session ? Boolean(getPendingAction(session)) : false
        });
        if (session) {
            this.recordLearning(userInput, 'DIRECT_EXECUTION' as any, confidenceScore || 0, true, session);
        }

        return {
            success: true,
            answer: response.final_answer.trim()
        };
    }

    async replan(previousPlan: ExecutionPlan, error: string, session: Session) {
        const strictToolPrompt = this.buildStrictToolPrompt();
        const workspaceContext = buildWorkspaceContext(session.current_project_id);
        const workspaceRepairPrompt = formatWorkspaceForRepair(workspaceContext);
        const fileSelection = selectWithConfidence(rankFiles({
            goal: session.current_goal || previousPlan.goal,
            error: this.safeParseErrorPayload(session.last_error),
            files: workspaceContext
        }));
        const targetFilePrompt = formatTargetFileBlock(fileSelection);
        const activeProjectRule = session.current_project_id
            ? `PROJETO ATIVO:
- Ja existe um projeto ativo com ID ${session.current_project_id}.
- Nao use "workspace_create_project".
- Corrija ou continue usando apenas as tools necessarias sobre o projeto atual.`
            : `SEM PROJETO ATIVO:
- Se precisar gerar arquivos em workspace, o primeiro passo deve ser "workspace_create_project".`;

        const messages: MessagePayload[] = [
            {
                role: 'system',
                content: `Voce corrige ExecutionPlans.
Retorne apenas JSON valido.
Reutilize os arquivos existentes.
Gere apenas os passos necessarios para corrigir a falha.

${strictToolPrompt}

${activeProjectRule}
${workspaceRepairPrompt}
${targetFilePrompt}

REGRAS:
- Nao invente tools.
- Nao use "execute_command" nem qualquer tool fora da lista permitida.
- Se houver projeto ativo, nao recrie o projeto.
- Se o projeto ja tiver arquivos, reutilize-os.
- Modifique arquivos existentes quando isso resolver o erro.
- Modifique SOMENTE o arquivo-alvo quando isso for suficiente.`
            },
            {
                role: 'user',
                content: `Voce executou um plano que falhou.

ERRO:
${error}

CONTEXTO:
Projeto atual: ${session.current_project_id || 'nenhum'}
Objetivo: ${session.current_goal || 'nao informado'}
Arquivos gerados: ${session.last_artifacts.length > 0 ? session.last_artifacts.join(', ') : 'nenhum'}

${this.buildStructuredErrorPrompt(session.last_error, session.last_error_type)}

PLANO ANTERIOR:
${JSON.stringify(previousPlan, null, 2)}

OUTPUT:
Novo ExecutionPlan JSON`
            }
        ];

        const response = await this.llm.generate(messages);
        const rawPlan = response.final_answer;

        if (!rawPlan) {
            throw new Error(t('error.executor.repair_plan_missing'));
        }

        const repairedPlan = this.parsePlan(rawPlan);
        this.assertReplanConstraints(repairedPlan, session);
        validatePlan(repairedPlan);
        return repairedPlan;
    }

    private async replanToolInputStep(currentStep: PlanStep, session: Session): Promise<PlanStep> {
        const workspaceContext = buildWorkspaceContext(session.current_project_id);
        const workspaceRepairPrompt = formatWorkspaceForRepair(workspaceContext);
        const fileSelection = selectWithConfidence(rankFiles({
            goal: session.current_goal,
            error: this.safeParseErrorPayload(session.last_error),
            files: workspaceContext
        }));
        const targetFilePrompt = formatTargetFileBlock(fileSelection);
        const messages: MessagePayload[] = [
            {
                role: 'system',
                content: `Voce corrige inputs de tools.
Retorne apenas JSON valido.
Nao altere o nome da tool.
Nao recrie o projeto.
Corrija somente os campos invalidos.
${workspaceRepairPrompt}
${targetFilePrompt}`
            },
            {
                role: 'user',
                content: `Corrija o step abaixo com base no erro informado.

ERRO:
${session.last_error || 'Erro de input nao informado'}

STEP ATUAL:
${JSON.stringify(currentStep, null, 2)}

INSTRUCOES:
- Mantenha o mesmo "tool".
- Mantenha o mesmo "id".
- Corrija apenas os campos invalidos de "input".
- Voce pode responder de um destes jeitos:
  1. Um step completo { "id": ..., "type": "tool", "tool": "...", "input": { ... } }
  2. Apenas o objeto "input" corrigido.

OUTPUT:
JSON valido`
            }
        ];

        const response = await this.llm.generate(messages);
        const raw = response.final_answer;

        if (!raw) {
            throw new Error(t('error.executor.tool_input_correction_missing'));
        }

        debugBus.emit('repair:tool_input:raw', {
            step: {
                id: currentStep.id,
                tool: currentStep.tool
            },
            raw
        });

        const parsed = parseLlmJson<any>(raw);
        const normalized = this.normalizeToolInputRepair(parsed, currentStep);

        debugBus.emit('repair:tool_input:normalized', {
            expected_tool: currentStep.tool,
            normalized_step: normalized
        });

        if (normalized.tool !== currentStep.tool) {
            throw new Error(`Tool mismatch during tool_input correction: expected ${currentStep.tool}, received ${normalized.tool}`);
        }

        return normalized;
    }

    private applyFileTargeting(step: PlanStep, goal: string, session?: Session) {
        if (!session?.current_project_id || step.tool !== 'workspace_save_artifact') {
            return;
        }

        const workspaceContext = buildWorkspaceContext(session.current_project_id);
        const fileSelection = selectWithConfidence(rankFiles({
            goal,
            error: this.safeParseErrorPayload(session.last_error),
            files: workspaceContext
        }));

        if (!fileSelection) {
            return;
        }

        debugBus.emit('thought', {
            type: 'thought',
            content: `[EXECUTOR] File ranking: ${fileSelection.target} (conf=${fileSelection.confidence.toFixed(2)}, gap=${fileSelection.top2Gap})`
        });

        if (fileSelection.confidence < 0.7) {
            return;
        }

        if (step.input.filename !== fileSelection.target) {
            debugBus.emit('thought', {
                type: 'thought',
                content: `[EXECUTOR] File targeting ajustou workspace_save_artifact para ${fileSelection.target}`
            });
            step.input.filename = fileSelection.target;
        }
    }

    private async tryApplyDiffAwareSave(step: PlanStep, goal: string, session?: Session): Promise<SaveExecutionDecision> {
        if (!session?.current_project_id || step.tool !== 'workspace_save_artifact') {
            return { handled: false };
        }

        const workspaceContext = buildWorkspaceContext(session.current_project_id);
        const fileSelection = selectWithConfidence(rankFiles({
            goal,
            error: this.safeParseErrorPayload(session.last_error),
            files: workspaceContext
        }));

        const filename = step.input.filename || fileSelection?.target;
        if (!filename) {
            return { handled: false };
        }

        const targetingConfidence = fileSelection?.confidence ?? 1;
        const configuredMode = agentConfig.getExecutionMode();
        const selectedMode = resolveExecutionMode(configuredMode, targetingConfidence);

        debugBus.emit('execution_mode', {
            stage: 'save_artifact',
            configured: configuredMode,
            selected: selectedMode,
            confidence: targetingConfidence,
            file: filename,
            trace_id: getTraceIdSafe()
        });

        if (selectedMode !== 'strict' && (!fileSelection || fileSelection.confidence < 0.8)) {
            return { handled: false };
        }

        const desiredContent = typeof step.input.content === 'string' ? step.input.content : '';
        const currentContent = workspaceService.readArtifact(session.current_project_id, filename);
        const changeSizeEstimate = currentContent ? estimateChangeSize(currentContent, desiredContent) : 'large';
        const strategy = selectDiffStrategy({
            confidence: targetingConfidence,
            fileExists: currentContent !== null,
            changeSizeEstimate,
            errorContext: Boolean(session.last_error),
            executionMode: selectedMode
        });

        debugBus.emit('diff_strategy_selected', {
            strategy,
            configured_mode: configuredMode,
            selected_mode: selectedMode,
            confidence: targetingConfidence,
            file: filename,
            change_size_estimate: changeSizeEstimate,
            trace_id: getTraceIdSafe()
        });

        if (strategy !== 'diff') {
            debugBus.emit('diff_fallback_triggered', {
                reason: 'strategy_selected_overwrite',
                file: filename,
                configured_mode: configuredMode,
                selected_mode: selectedMode,
                confidence: targetingConfidence,
                trace_id: getTraceIdSafe()
            });
            return { handled: false };
        }

        if (!currentContent || !desiredContent || currentContent === desiredContent) {
            return { handled: false };
        }

        const operations = await this.generateDiffOperations(filename, currentContent, desiredContent);
        if (!operations || !validateDiffOperations(operations)) {
            debugBus.emit('diff_validation_failed', {
                reason: 'invalid_operations',
                file: filename,
                trace_id: getTraceIdSafe()
            });
            debugBus.emit('thought', {
                type: 'thought',
                content: `[EXECUTOR] Diff-aware editing nao encontrou patch confiavel para ${filename}. Fallback para overwrite.`
            });
            if (selectedMode === 'strict') {
                return {
                    handled: false,
                    blocked: `Modo strict bloqueou overwrite completo em ${filename} porque nao houve patch confiavel.`
                };
            }
            debugBus.emit('diff_fallback_triggered', {
                reason: 'invalid_operations',
                file: filename,
                trace_id: getTraceIdSafe()
            });
            return { handled: false };
        }

        const diffResult = await executeToolCall('workspace_apply_diff', {
            project_id: session.current_project_id,
            filename,
            operations,
            validation: {
                requireAnchorMatch: true,
                maxReplacements: 6
            }
        });

        if (!diffResult.success) {
            debugBus.emit('diff_validation_failed', {
                reason: diffResult.error || 'unknown_diff_failure',
                file: filename,
                trace_id: getTraceIdSafe()
            });
            debugBus.emit('thought', {
                type: 'thought',
                content: `[EXECUTOR] workspace_apply_diff falhou em ${filename}. Fallback para overwrite completo.`
            });
            if (selectedMode === 'strict') {
                return {
                    handled: false,
                    blocked: `Modo strict bloqueou overwrite completo em ${filename} porque o diff falhou: ${diffResult.error || 'unknown_diff_failure'}`
                };
            }
            debugBus.emit('diff_fallback_triggered', {
                reason: diffResult.error || 'unknown_diff_failure',
                file: filename,
                trace_id: getTraceIdSafe()
            });
            return { handled: false };
        }

        debugBus.emit('diff_applied', {
            file: filename,
            operationsCount: operations.length,
            confidence: targetingConfidence,
            trace_id: getTraceIdSafe()
        });
        debugBus.emit('thought', {
            type: 'thought',
            content: `[EXECUTOR] Diff-aware editing aplicado em ${filename} com ${operations.length} operacao(oes).`
        });
        return { handled: true };
    }

    private async ensureBrowserCapability(session: Session, goal: string): Promise<{
        available: boolean;
        error?: string;
        fallback?: ReturnType<typeof handleCapabilityFallback>;
    }> {
        const required = getRequiredCapabilities({
            type: 'browser_validation'
        });

        for (const capability of required) {
            const overridePolicy = this.getCapabilityPolicyOverride(session, capability);
            const available = await skillManager.ensure(capability, overridePolicy);

            if (!available) {
                const fallback = handleCapabilityFallback(capability);

                if (capability === 'browser_execution') {
                    if (overridePolicy === 'auto-install') {
                        return {
                            available: false,
                            error: 'Nao foi possivel instalar automaticamente o suporte a browser (Puppeteer) neste ambiente.',
                            fallback
                        };
                    }

                    return {
                        available: false,
                        error: `Esta tarefa requer suporte a browser para validar o projeto atual.

Objetivo atual: ${goal}

Posso continuar em modo degradado sem validacao em browser, ou voce pode autorizar a tentativa de instalacao do suporte necessario.

Se quiser autorizar, responda:
"pode instalar o puppeteer"`,
                        fallback
                    };
                }

                return {
                    available: false,
                    error: `Capacidade obrigatoria indisponivel: ${capability}`,
                    fallback
                };
            }
        }

        return { available: true };
    }

    private async ensureStepCapabilities(
        step: PlanStep,
        session: Session | undefined,
        goal: string
    ): Promise<{
        ok: boolean;
        capability?: string;
        error?: string;
        fallback?: ReturnType<typeof handleCapabilityFallback>;
    }> {
        if (step.tool === 'workspace_run_project' && !requiresDOM(step)) {
            debugBus.emit('browser_skipped', {
                stepId: step.id,
                reason: 'requiresDOM_false',
                trace_id: getTraceIdSafe()
            });
        }

        const capabilities = getRequiredCapabilitiesForStep(step);
        for (const capability of capabilities) {
            if (capability === 'browser_execution' && !requiresDOM(step)) {
                debugBus.emit('browser_skipped', {
                    stepId: step.id,
                    reason: 'requiresDOM_false',
                    trace_id: getTraceIdSafe()
                });
                continue;
            }

            if (capability === 'browser_execution' && requiresDOM(step)) {
                debugBus.emit('browser_validation_enabled', {
                    stepId: step.id,
                    trace_id: getTraceIdSafe()
                });
            }

            const overridePolicy = session ? this.getCapabilityPolicyOverride(session, capability) : undefined;
            const available = await skillManager.ensure(capability as any, overridePolicy);

            if (!available) {
                const fallback = handleCapabilityFallback(capability as any);
                debugBus.emit('capability_fallback', {
                    capability,
                    stepId: step.id,
                    fallback,
                    trace_id: getTraceIdSafe()
                });

                if (capability === 'browser_execution') {
                    if (overridePolicy === 'auto-install') {
                        return {
                            ok: false,
                            capability,
                            error: 'Nao foi possivel instalar automaticamente o suporte a browser (Puppeteer) neste ambiente.',
                            fallback
                        };
                    }

                    return {
                        ok: false,
                        capability,
                        error: `Esta tarefa requer suporte a browser para validar o projeto atual.

Objetivo atual: ${goal}

Posso continuar em modo degradado sem validacao em browser, ou voce pode autorizar a tentativa de instalacao do suporte necessario.

Se quiser autorizar, responda:
"pode instalar o puppeteer"`,
                        fallback
                    };
                }

                return {
                    ok: false,
                    capability,
                    error: `Capacidade obrigatoria indisponivel: ${capability}`,
                    fallback
                };
            }

            debugBus.emit('capability_available', {
                capability,
                stepId: step.id,
                trace_id: getTraceIdSafe()
            });
        }

        return { ok: true };
    }

    private parsePlan(rawPlan: string): ExecutionPlan {
        return parseLlmJson<ExecutionPlan>(rawPlan);
    }

    private runRepairPipeline(plan: ExecutionPlan, session: Session): RepairResult {
        return repairPlanStructure(plan, session);
    }

    private async executeWithTrace(input: {
        plan: ExecutionPlan;
        session: Session;
        runner: (plan: ExecutionPlan, session: Session) => Promise<any>;
        decision: RuntimeDecision;
        input: string;
        confidence: number;
        repairUsed: boolean;
        repairActions?: string[];
    }) {
        const startedAt = Date.now();
        const result = await input.runner(input.plan, input.session);
        const errorType = result.success ? undefined : result.error_type || classifyError(result.error || 'execution_failed');

        // ── SINCRONIZAÇÃO COGNITIVA: Refletir resultado técnico no estado de sessão ──
        if (result.success) {
            input.session.last_error = undefined;
            input.session.reactive_state = {
                hasFailure: false,
                resolved: true,
                attempt: 0,
                timestamp: Date.now()
            };
        } else {
            input.session.last_error = result.error;
            input.session.last_error_type = errorType;
            input.session.reactive_state = {
                type: 'failure_recovery',
                source: 'executor',
                hasFailure: true,
                error: result.error,
                errorType,
                attempt: (input.session.reactive_state?.attempt || 0) + 1,
                timestamp: Date.now()
            };
        }

        this.emitExecutionResult({
            decision: input.decision,
            confidence: input.confidence,
            success: result.success,
            retries: input.session._tool_input_attempts || 0,
            durationMs: Date.now() - startedAt,
            errorType,
            repairUsed: input.repairUsed,
            repairSuccess: input.repairUsed ? result.success : undefined,
            planSize: input.plan.steps.length,
            reactive: input.session.reactive_state?.hasFailure === true,
            pending: Boolean(getPendingAction(input.session)),
            recoveryAttempt: input.session.reactive_state?.attempt
        });
        this.recordLearning(input.input, input.decision, input.confidence, result.success, input.session, errorType, input.repairActions);

        return result;
    }

    private emitExecutionResult(trace: ExecutionTrace) {
        emitDebug('execution_result', trace);
    }

    private recordLearning(
        input: string,
        decision: RuntimeDecision,
        confidence: number,
        success: boolean,
        session: Session,
        errorType?: string,
        repairActions?: string[]
    ) {
        const reactive = session.reactive_state;
        const reducedReactive = reactive ? {
            hasFailure: reactive.hasFailure,
            errorType: reactive.errorType || errorType,
            attempt: reactive.attempt,
            resolved: reactive.resolved
        } : undefined;

        pushLearningRecord({
            inputHash: hashLearningInput(input),
            decision,
            confidence,
            success,
            errorType,
            repairActions,
            reactiveState: reducedReactive
        });
    }

    private normalizeToolInputRepair(parsed: any, currentStep: PlanStep): PlanStep {
        if (parsed && Array.isArray(parsed.steps)) {
            const matchingStep = parsed.steps.find((step: any) => step?.tool === currentStep.tool) || parsed.steps[0];
            return this.normalizeToolInputRepair(matchingStep, currentStep);
        }

        if (parsed && typeof parsed === 'object' && parsed.tool && parsed.input) {
            return {
                id: typeof parsed.id === 'number' ? parsed.id : currentStep.id,
                type: parsed.type === 'tool' ? 'tool' : currentStep.type,
                tool: parsed.tool,
                input: parsed.input,
                capabilities: parsed.capabilities && typeof parsed.capabilities === 'object'
                    ? parsed.capabilities
                    : currentStep.capabilities
            };
        }

        if (parsed && typeof parsed === 'object') {
            return {
                id: currentStep.id,
                type: currentStep.type,
                tool: currentStep.tool,
                input: parsed.input && typeof parsed.input === 'object' ? parsed.input : parsed,
                capabilities: parsed.capabilities && typeof parsed.capabilities === 'object'
                    ? parsed.capabilities
                    : currentStep.capabilities
            };
        }

        throw new Error(t('error.executor.tool_input_correction_invalid'));
    }

    private safeParseErrorPayload(raw?: string): any | null {
        if (!raw) {
            return null;
        }

        try {
            return JSON.parse(raw);
        } catch {
            return null;
        }
    }

    private getCapabilityPolicyOverride(session: Session, capability: string): SkillPolicy | undefined {
        return session.capability_policy_overrides?.[capability] as SkillPolicy | undefined;
    }

    private async generateDiffOperations(filename: string, currentContent: string, desiredContent: string): Promise<DiffOperation[] | null> {
        const messages: MessagePayload[] = [
            {
                role: 'system',
                content: `Voce gera patches minimos e seguros.
Retorne apenas JSON valido.
Nao reescreva o arquivo inteiro.
Use apenas operacoes com ancoras textuais existentes.
Prefira replace a append quando possivel.
Quando houver ambiguidade, inclua "anchors" com alternativas da mais especifica para a mais generica.

Formato:
{
  "operations": [
    { "type": "replace", "anchor": "ancora existente", "anchors": ["ancora mais especifica", "fallback"], "content": "novo conteudo" },
    { "type": "insert", "anchor": "ancora existente", "anchors": ["ancora mais especifica", "fallback"], "position": "before" | "after", "content": "novo conteudo" },
    { "type": "append", "content": "novo conteudo" }
  ]
}`
            },
            {
                role: 'user',
                content: `Arquivo alvo: ${filename}

CONTEUDO ATUAL:
${currentContent.slice(0, 12000)}

CONTEUDO DESEJADO:
${desiredContent.slice(0, 12000)}

REGRAS:
- Use mudancas minimas.
- Use ancoras que ja existam no CONTEUDO ATUAL.
- Se existir mais de uma ancora viavel, forneca "anchors" em ordem de preferencia.
- Nao reescreva o arquivo todo.
- Se nao for possivel fazer patch seguro, retorne {"operations":[]}.
- Retorne apenas JSON.`
            }
        ];

        const response = await this.llm.generate(messages);
        const raw = response.final_answer;
        if (!raw) {
            return null;
        }

        try {
            const parsed = parseLlmJson<any>(raw);
            if (Array.isArray(parsed)) {
                return parsed as DiffOperation[];
            }

            if (Array.isArray(parsed?.operations)) {
                return parsed.operations as DiffOperation[];
            }
        } catch {
            return null;
        }

        return null;
    }

    private buildStructuredErrorPrompt(lastError?: string, lastErrorType?: string): string {
        if (lastErrorType !== 'tool_input' || !lastError) {
            return '';
        }

        try {
            const payload = JSON.parse(lastError);
            const issues = Array.isArray(payload.issues)
                ? payload.issues.map((issue: any) => `- ${issue.path || ''}: ${issue.message} (expected: ${issue.expected ?? 'unknown'}, received: ${issue.received ?? 'unknown'})`).join('\n')
                : '- sem issues estruturadas';

            return `PREVIOUS ERROR (JSON):
${lastError}

If type == "tool_input":
- Tool: ${payload.tool || 'unknown'}
- Issues:
${issues}

INSTRUCTION:
- Fix ONLY the invalid input fields reported in "issues".
- Do NOT change other steps or recreate the project.
- Keep all valid fields unchanged.
- Ensure all required fields are present and correctly typed.
- Return ONLY the corrected "input" object for the SAME tool.
- Do NOT change tool name.
- Do NOT modify other steps.`;
        } catch {
            return `PREVIOUS ERROR (JSON):
${lastError}`;
        }
    }

    private buildStrictToolPrompt(): string {
        const registeredTools = toolRegistry.list();
        const strictToolList = registeredTools.map(tool => `- ${tool.name}: ${tool.description}`).join('\n');
        const strictToolEnum = registeredTools.map(tool => `"${tool.name}"`).join(', ');

        return `TOOLS PERMITIDAS:
${strictToolList}

AVAILABLE TOOLS (STRICT):
Use ONLY these tools.
Each step.tool must be one of: [${strictToolEnum}]`;
    }

    private assertReplanConstraints(plan: ExecutionPlan, session: Session) {
        if (!session.current_project_id) {
            return;
        }

        const recreatesProject = plan.steps.some(step => step.tool === 'workspace_create_project');
        if (recreatesProject) {
            throw new Error(t('error.plan.recreate_active_project'));
        }
    }
}

function getTraceIdSafe(): string | undefined {
    return getContext()?.trace_id;
}
