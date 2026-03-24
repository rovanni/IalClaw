import { executeToolCall } from '../agent/executeTool';
import { validatePlan } from '../planner/PlanValidator';
import { ExecutionPlan } from '../planner/types';
import { debugBus } from '../../shared/DebugBus';
import { CognitiveMemory } from '../../memory/CognitiveMemory';
import { Session } from '../../shared/SessionManager';
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

export class AgentExecutor {
    private llm: LLMProvider;
    private memory: CognitiveMemory;

    constructor(memory: CognitiveMemory) {
        this.memory = memory;
        this.llm = ProviderFactory.getProvider();
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

    async runWithHealing(plan: ExecutionPlan, session: Session) {
        let attempt = 0;
        let lastError: string | null = null;
        session._tool_input_attempts = 0;

        while (attempt <= MAX_RETRIES) {
            debugBus.emit('executor:attempt', { attempt });

            try {
                await this.run(plan, session);
            } catch (error: any) {
                const failureMessage = error.message || 'Falha desconhecida na execucao do plano.';
                const failedStepIndex = error instanceof StepExecutionError ? error.stepIndex : 0;
                const currentStep = plan.steps[failedStepIndex] || plan.steps[0];

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
                        debugBus.emit('self_healing_abort', {
                            reason: 'tool_input_not_converging',
                            tool: payload.tool,
                            issues: payload.issues
                        });

                        return {
                            success: false,
                            error: 'Self-healing aborted: tool_input not converging'
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
                        debugBus.emit('self_healing_abort', {
                            reason: 'tool_mismatch_during_repair',
                            expected_tool: repairStep.tool,
                            received_tool: newStep?.tool,
                            repair_step: repairStep,
                            normalized_step: newStep
                        });

                        return {
                            success: false,
                            error: 'Tool mismatch during tool_input correction'
                        };
                    }

                    if (isCorrectionMode && JSON.stringify(repairStep.input) === JSON.stringify(newStep?.input)) {
                        debugBus.emit('self_healing_abort', {
                            reason: 'noop_correction',
                            tool: payload.tool,
                            input: newStep?.input
                        });

                        return {
                            success: false,
                            error: 'No-op correction detected'
                        };
                    }

                    if (isCorrectionMode && !isMinimalChange(repairStep, newStep, payload.issues || [])) {
                        debugBus.emit('self_healing_abort', {
                            reason: 'non_minimal_change',
                            tool: payload.tool,
                            issues: payload.issues,
                            prev_input: repairStep.input,
                            new_input: newStep?.input
                        });

                        return {
                            success: false,
                            error: 'Non-minimal correction detected'
                        };
                    }

                    session._input_history = session._input_history || [];

                    if (isCorrectionMode && detectOscillation(session._input_history, newStep.input)) {
                        debugBus.emit('self_healing_abort', {
                            reason: 'input_oscillation',
                            tool: payload.tool,
                            input: newStep.input
                        });

                        return {
                            success: false,
                            error: 'Input oscillation detected'
                        };
                    }

                    if (isCorrectionMode) {
                        session._input_history = updateHistory(session._input_history, newStep.input);
                    }
                    plan = {
                        ...plan,
                        steps: [{ ...newStep, is_repair: false }]
                    };
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
                    return {
                        success: false,
                        error: `Falha na execucao apos ${MAX_RETRIES} tentativas: ${lastError}`
                    };
                }

                debugBus.emit('executor:replan', {
                    attempt,
                    reason: 'execution_error'
                });
                plan = await this.replan(plan, failureMessage, session);
                attempt++;
                continue;
            }

            if (!session.current_project_id) {
                debugBus.emit('executor:success', { skipped_validation: true });
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
                            return {
                                success: false,
                                error: `Falha na validacao apos ${MAX_RETRIES} tentativas: ${lastError}`
                            };
                        }

                        debugBus.emit('executor:replan', {
                            attempt,
                            reason: 'validation_error'
                        });
                        plan = await this.replan(plan, validationError, session);
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
                    reason: 'requiresDOM_false',
                    trace_id: getTraceIdSafe()
                });
                debugBus.emit('thought', {
                    type: 'thought',
                    content: '[EXECUTOR] Projeto HTML detectado sem requiresDOM. Pulando validacao em browser.'
                });
                debugBus.emit('execution_success', {
                    project_id: session.current_project_id,
                    runtime_skipped: true,
                    reason: 'html_without_requiresDOM'
                });

                if (session.last_error && session.last_error.length < 5000) {
                    await this.memory.saveExecutionFix({
                        content: `Erro anterior:\n${session.last_error}\n\nTipo:\n${session.last_error_type || 'unknown'}\n\nFingerprint:\n${session.last_error_fingerprint || 'unknown'}\n\nCorrecao aplicada:\n${JSON.stringify(plan)}`,
                        project_id: session.current_project_id,
                        error_type: session.last_error_type,
                        fingerprint: session.last_error_fingerprint,
                        timestamp: Date.now()
                    });
                }

                session.last_error = undefined;
                session.last_error_type = undefined;
                session.last_error_hash = undefined;
                session.last_error_fingerprint = undefined;
                session._tool_input_attempts = 0;
                session._input_history = [];

                debugBus.emit('executor:success', { runtime_skipped: true });
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
                    debugBus.emit('self_healing_abort', {
                        reason: 'missing_runtime_dependency',
                        error: runtimeError,
                        dependency: 'puppeteer'
                    });

                    return {
                        success: false,
                        error: runtimeError,
                        error_type: 'environment_dependency',
                        dependency: 'puppeteer'
                    };
                }

                if (session.last_error_fingerprint && session.last_error_fingerprint === normalizedError) {
                    debugBus.emit('self_healing_abort', {
                        reason: 'equivalent_error_loop',
                        error: runtimeError,
                        error_hash: runtimeHash,
                        normalized: normalizedError
                    });

                    return {
                        success: false,
                        error: `Self-healing aborted: equivalent error loop (${runtimeError})`
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
                    return {
                        success: false,
                        error: `Falha de runtime apos ${MAX_RETRIES} tentativas: ${runtimeError}`
                    };
                }

                debugBus.emit('executor:replan', {
                    attempt,
                    reason: 'runtime_error'
                });
                plan = await this.replan(plan, runtimeError, session);
                attempt++;
                continue;
            }

            debugBus.emit('execution_success', {
                project_id: session.current_project_id
            });

            if (session.last_error && session.last_error.length < 5000) {
                await this.memory.saveExecutionFix({
                    content: `Erro anterior:\n${session.last_error}\n\nTipo:\n${session.last_error_type || 'unknown'}\n\nFingerprint:\n${session.last_error_fingerprint || 'unknown'}\n\nCorrecao aplicada:\n${JSON.stringify(plan)}`,
                    project_id: session.current_project_id,
                    error_type: session.last_error_type,
                    fingerprint: session.last_error_fingerprint,
                    timestamp: Date.now()
                });
            }

            session.last_error = undefined;
            session.last_error_type = undefined;
            session.last_error_hash = undefined;
            session.last_error_fingerprint = undefined;
            session._tool_input_attempts = 0;
            session._input_history = [];

            debugBus.emit('executor:success', {});
            return { success: true };
        }

        return {
            success: false,
            error: `Loop de healing excedeu o numero maximo de tentativas. Ultimo erro: ${lastError}`
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
            throw new Error('LLM nao retornou um plano de correcao.');
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
            throw new Error('LLM nao retornou correcao de tool_input.');
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

        throw new Error('Resposta invalida para correcao de tool_input.');
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
            throw new Error('Validacao falhou: replan tentou recriar projeto ativo.');
        }
    }
}

function getTraceIdSafe(): string | undefined {
    try {
        return getContext().trace_id;
    } catch {
        return undefined;
    }
}
