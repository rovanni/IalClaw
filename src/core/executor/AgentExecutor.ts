import { executeToolCall } from '../agent/executeTool';
import { validatePlan } from '../planner/PlanValidator';
import { ExecutionPlan } from '../planner/types';
import { debugBus } from '../../shared/DebugBus';
import { CognitiveMemory } from '../../memory/CognitiveMemory';
import { Session } from '../../shared/SessionManager';
import { LLMProvider, MessagePayload, ProviderFactory } from '../../engine/ProviderFactory';
import { classifyError } from '../../utils/errorClassifier';
import { normalizeError } from '../../utils/errorFingerprint';
import { parseLlmJson } from '../../utils/parseLlmJson';

const MAX_RETRIES = 5;

export class AgentExecutor {
    private llm: LLMProvider;
    private memory: CognitiveMemory;

    constructor(memory: CognitiveMemory) {
        this.memory = memory;
        this.llm = ProviderFactory.getProvider();
    }

    async run(plan: ExecutionPlan) {
        debugBus.emit('thought', { type: 'action', content: `[EXECUTOR] Iniciando meta: ${plan.goal}` });

        for (const step of plan.steps) {
            debugBus.emit('thought', { type: 'thought', content: `[EXECUTOR] Executando Step ${step.id}: ${step.tool}` });

            const result = await executeToolCall(step.tool, step.input);

            if (!result.success) {
                debugBus.emit('thought', { type: 'error', content: `[EXECUTOR] Abortando. Falha no Step ${step.id}: ${result.error}` });
                throw new Error(`Execucao interrompida no step ${step.id}: ${result.error}`);
            }

            await new Promise(resolve => setTimeout(resolve, 500));
        }

        debugBus.emit('thought', { type: 'final', content: '[EXECUTOR] Plano finalizado com sucesso.' });
    }

    async runWithHealing(plan: ExecutionPlan, session: Session) {
        let attempt = 0;
        let lastError: string | null = null;

        while (attempt <= MAX_RETRIES) {
            debugBus.emit('executor:attempt', { attempt });

            try {
                await this.run(plan);
            } catch (error: any) {
                const failureMessage = error.message || 'Falha desconhecida na execucao do plano.';
                lastError = failureMessage;
                session.last_error = failureMessage;
                session.last_error_type = classifyError(failureMessage);
                session.last_error_hash = undefined;

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

    private parsePlan(rawPlan: string): ExecutionPlan {
        return parseLlmJson<ExecutionPlan>(rawPlan);
    }
}
