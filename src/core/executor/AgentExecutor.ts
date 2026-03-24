import { executeToolCall } from '../agent/executeTool';
import { validatePlan } from '../planner/PlanValidator';
import { ExecutionPlan } from '../planner/types';
import { debugBus } from '../../shared/DebugBus';
import { Session } from '../../shared/SessionManager';
import { LLMProvider, MessagePayload, ProviderFactory } from '../../engine/ProviderFactory';

const MAX_RETRIES = 2;

export class AgentExecutor {
    private llm: LLMProvider;

    constructor() {
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

                debugBus.emit('executor:validation_failed', {
                    error: failureMessage,
                    stage: 'execution'
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

            if (validation.success) {
                debugBus.emit('executor:success', {});
                return { success: true };
            }

            const validationError = ('data' in validation && validation.data?.errors?.length)
                ? validation.data.errors.join('\n')
                : validation.error || 'Falha desconhecida na validacao.';
            lastError = validationError;
            session.last_error = validationError;

            debugBus.emit('executor:validation_failed', {
                error: validationError,
                stage: 'validation'
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
        const normalized = rawPlan.trim();

        try {
            return JSON.parse(normalized);
        } catch {
            const jsonBlock = normalized.match(/\{[\s\S]*\}/);

            if (!jsonBlock) {
                throw new Error('Resposta de replan nao contem JSON valido.');
            }

            return JSON.parse(jsonBlock[0]);
        }
    }
}
