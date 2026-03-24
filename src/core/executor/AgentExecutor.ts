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

export class AgentExecutor {
    private llm: LLMProvider;
    private memory: CognitiveMemory;

    constructor(memory: CognitiveMemory) {
        this.memory = memory;
        this.llm = ProviderFactory.getProvider();
    }

    async run(plan: ExecutionPlan, session?: Session) {
        debugBus.emit('thought', { type: 'action', content: `[EXECUTOR] Iniciando meta: ${plan.goal}` });

        for (const [stepIndex, step] of plan.steps.entries()) {
            debugBus.emit('thought', { type: 'thought', content: `[EXECUTOR] Executando Step ${step.id}: ${step.tool}` });

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
                        attempt
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
                    plan.steps = [repairStep];

                    const newStep = await this.replanToolInputStep(repairStep, session);
                    const isCorrectionMode = repairStep.is_repair === true
                        && session.last_error_type === 'tool_input'
                        && payload.tool === repairStep.tool;

                    if (newStep?.tool !== repairStep.tool) {
                        debugBus.emit('self_healing_abort', {
                            reason: 'tool_mismatch_during_repair',
                            expected_tool: repairStep.tool,
                            received_tool: newStep?.tool
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

            const validation = await executeToolCall('workspace_validate_project', {
                project_id: session.current_project_id
            });

            if (!validation.success) {
                const validationError = ('data' in validation && validation.data?.errors?.length)
                    ? validation.data.errors.join('\n')
                    : validation.error || 'Falha desconhecida na validacao.';
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
        const messages: MessagePayload[] = [
            {
                role: 'system',
                content: `Voce corrige ExecutionPlans.
Retorne apenas JSON valido.
Nao recrie o projeto atual.
Reutilize os arquivos existentes.
Gere apenas os passos necessarios para corrigir a falha.`
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
        validatePlan(repairedPlan);
        return repairedPlan;
    }

    private async replanToolInputStep(currentStep: PlanStep, session: Session): Promise<PlanStep> {
        const messages: MessagePayload[] = [
            {
                role: 'system',
                content: `Voce corrige inputs de tools.
Retorne apenas JSON valido.
Nao altere o nome da tool.
Nao recrie o projeto.
Corrija somente os campos invalidos.`
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

        const parsed = parseLlmJson<any>(raw);
        const normalized = this.normalizeToolInputRepair(parsed, currentStep);

        if (normalized.tool !== currentStep.tool) {
            throw new Error(`Tool mismatch during tool_input correction: expected ${currentStep.tool}, received ${normalized.tool}`);
        }

        return normalized;
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
                input: parsed.input
            };
        }

        if (parsed && typeof parsed === 'object') {
            return {
                id: currentStep.id,
                type: currentStep.type,
                tool: currentStep.tool,
                input: parsed.input && typeof parsed.input === 'object' ? parsed.input : parsed
            };
        }

        throw new Error('Resposta invalida para correcao de tool_input.');
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
}
