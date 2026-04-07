import { CognitiveDecision, CognitiveStrategy } from './CognitiveOrchestrator';
import { SessionManager, SessionContext } from '../../shared/SessionManager';
import { CognitiveMemory } from '../../memory/CognitiveMemory';
import { FlowManager } from '../flow/FlowManager';
import { FlowRegistry } from '../flow/FlowRegistry';
import { skillManager } from '../../capabilities';
import { clearPendingAction, getPendingAction, setPendingAction } from '../agent/PendingActionTracker';
import { createLogger } from '../../shared/AppLogger';
import { t } from '../../i18n';

export interface ExecutionResult {
    answer?: string;
    shouldContinue?: boolean;
    retryQuery?: string;
    interrupted?: boolean;
}

/**
 * CognitiveActionExecutor: Responsável por executar as decisões do Orquestrador.
 * Centraliza mutações de estado (retries, pending actions) e execução de fluxos.
 */
export class CognitiveActionExecutor {
    private logger = createLogger('CognitiveActionExecutor');

    constructor(
        private memory: CognitiveMemory,
        private flowManager: FlowManager
    ) { }

    /**
     * Executa a estratégia decidida pelo Orquestrador.
     */
    public async execute(decision: CognitiveDecision, session: SessionContext, userQuery: string): Promise<ExecutionResult> {
        const sessionId = session.conversation_id;
        const pending = getPendingAction(session);

        this.logger.info('executing_cognitive_strategy', `[EXECUTOR] Executando: ${decision.strategy}`, {
            sessionId,
            strategy: decision.strategy
        });

        switch (decision.strategy) {
            case CognitiveStrategy.START_FLOW:
                return this.executeStartFlow(decision, session, userQuery);

            case CognitiveStrategy.FLOW:
                return this.executeFlow(session, userQuery);

            case CognitiveStrategy.CANCEL_PENDING:
                return this.executeCancelPending(session, pending, userQuery);

            case CognitiveStrategy.EXECUTE_PENDING:
                return this.executePending(session, pending, userQuery);

            case CognitiveStrategy.ASK:
            case CognitiveStrategy.CONFIRM:
                return this.executeAskConfirm(decision, session, userQuery);

            default:
                // Estratégias TOOL, LLM, HYBRID seguem para o loop unificado
                return { shouldContinue: true };
        }
    }

    private async executeStartFlow(decision: CognitiveDecision, session: SessionContext, userQuery: string): Promise<ExecutionResult> {
        if (!decision.flowId) {
            return { shouldContinue: true };
        }

        const flow = FlowRegistry.get(decision.flowId);
        if (!flow) {
            const notFound = t('flow.start.not_found', { flowId: decision.flowId });
            this.memory.saveMessage(session.conversation_id, 'user', userQuery);
            this.memory.saveMessage(session.conversation_id, 'assistant', notFound);
            SessionManager.addToHistory(session.conversation_id, 'user', userQuery);
            SessionManager.addToHistory(session.conversation_id, 'assistant', notFound);
            return { answer: notFound };
        }

        const flowPrompt = this.flowManager.startFlow(flow, {}, flow.id);
        session.flow_state = this.flowManager.getState() || undefined;

        this.logger.info('flow_started_by_orchestrator', t('flow.start.initiated', { flowId: decision.flowId }), {
            sessionId: session.conversation_id,
            flowId: decision.flowId,
            persistedFlowId: session.flow_state?.flowId
        });

        this.memory.saveMessage(session.conversation_id, 'user', userQuery);
        this.memory.saveMessage(session.conversation_id, 'assistant', flowPrompt);
        SessionManager.addToHistory(session.conversation_id, 'user', userQuery);
        SessionManager.addToHistory(session.conversation_id, 'assistant', flowPrompt);

        return { answer: flowPrompt };
    }

    private async executeFlow(session: SessionContext, userQuery: string): Promise<ExecutionResult> {
        const flowResponse = await this.flowManager.handleInput(userQuery);

        if (flowResponse.answer) {
            // Sincronizar estado do flow com a sessão
            session.flow_state = this.flowManager.getState() || undefined;
            this.memory.saveMessage(session.conversation_id, 'assistant', flowResponse.answer);
            SessionManager.addToHistory(session.conversation_id, 'assistant', flowResponse.answer);
            return { answer: flowResponse.answer };
        }

        // Flow encerrado ou completado
        session.flow_state = undefined;
        return { shouldContinue: true };
    }

    private async executeCancelPending(session: SessionContext, pending: any, userQuery: string): Promise<ExecutionResult> {
        if (pending) {
            clearPendingAction(session, pending.id);
            const declined = t('agent.pending.cancelled');
            this.memory.saveMessage(session.conversation_id, 'user', userQuery);
            this.memory.saveMessage(session.conversation_id, 'assistant', declined);
            await this.memory.learn({
                query: userQuery,
                nodes_used: [],
                success: true,
                response: declined
            }).catch(() => { });
            return { answer: declined };
        }
        return { shouldContinue: true };
    }

    private async executePending(session: SessionContext, pending: any, userQuery: string): Promise<ExecutionResult> {
        if (!pending) return { shouldContinue: true };

        if ((pending.type === 'install_capability' && pending.payload.capability) ||
            (pending.type === 'install_skill' && pending.payload.skillName)) {

            const capabilityId = pending.payload.capability || pending.payload.skillName;
            session.retry_count = (session.retry_count || 0) + 1;

            if (session.retry_count > 2) {
                clearPendingAction(session, pending.id);
                session.retry_count = 0;
                const failMsg = '⚠️ Não foi possível completar após múltiplas tentativas. Tente instalar manualmente.';
                this.memory.saveMessage(session.conversation_id, 'assistant', failMsg);
                return { answer: failMsg };
            }

            this.logger.info('executing_pending_installation', `[EXECUTOR] Instalando capability/skill: ${capabilityId}`);
            pending.status = 'executing';

            const success = await skillManager.ensure(capabilityId as any, 'auto-install');

            if (!success) {
                clearPendingAction(session, pending.id);
                session.retry_count = 0;
                const failedMsg = t('agent.install.browser.failed') || "Não consegui instalar automaticamente. Pode me dar mais contexto ou escolhemos outra abordagem?";
                this.memory.saveMessage(session.conversation_id, 'assistant', failedMsg);
                return { answer: failedMsg };
            }

            pending.status = 'completed';
            pending.completedAt = Date.now();

            const originalQuery = pending.payload.originalQuery || userQuery;
            session.lastCompletedAction = {
                type: pending.type,
                originalRequest: originalQuery,
                completedAt: Date.now()
            };

            clearPendingAction(session, pending.id);
            session.retry_count = 0;

            const retryHint = t('node.continuity.retry_hint', {
                capability: capabilityId,
                defaultValue: `[SYSTEM: Capability ${capabilityId} was just installed and is now available. Proceed with the original request.] `
            });

            return { retryQuery: `${retryHint}${originalQuery}` };
        }

        // Outras ações pendentes
        pending.status = 'executing';
        const effectiveQuery = pending.payload.originalQuery || userQuery; // Simplificado para o executor
        pending.status = 'completed';
        pending.completedAt = Date.now();
        clearPendingAction(session, pending.id);

        return { retryQuery: effectiveQuery };
    }

    private async executeAskConfirm(decision: CognitiveDecision, session: SessionContext, userQuery: string): Promise<ExecutionResult> {
        if (decision.strategy === CognitiveStrategy.CONFIRM && decision.capabilityGap?.hasGap) {
            const gap = decision.capabilityGap.gap;
            if (gap) {
                setPendingAction(session, {
                    type: 'install_capability',
                    payload: {
                        capability: gap.resource,
                        originalQuery: userQuery
                    }
                });
            }
        }

        const userFacingReason = decision.reason === 'capability_gap_detected'
            ? t('agent.orchestrator.gap.title')
            : decision.reason;

        this.memory.saveMessage(session.conversation_id, 'user', userQuery);
        this.memory.saveMessage(session.conversation_id, 'assistant', userFacingReason);
        SessionManager.addToHistory(session.conversation_id, 'user', userQuery);
        SessionManager.addToHistory(session.conversation_id, 'assistant', userFacingReason);

        return { answer: userFacingReason };
    }
}
