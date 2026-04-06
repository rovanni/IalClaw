import { CognitiveOrchestrator, CognitiveStrategy, CognitiveDecision } from '../../src/core/orchestrator/CognitiveOrchestrator';
import { FlowManager } from '../../src/core/flow/FlowManager';
import { SessionManager } from '../../src/shared/SessionManager';
import { debugBus, removeDebugListener } from '../../src/shared/DebugBus';
import { setPendingAction, clearPendingAction } from '../../src/core/agent/PendingActionTracker';
import { FlowRegistry } from '../../src/core/flow/FlowRegistry';

export interface SimulationResult {
    decision: CognitiveDecision;
    debugLogs: any[];
}

/**
 * Utilitário para simular pressões cognitivas e observar o comportamento do Single Brain.
 */
export class ScenarioSimulator {
    private orchestrator: CognitiveOrchestrator;
    private flowManager: FlowManager;
    private sessionId: string;

    constructor(sessionId: string) {
        this.sessionId = sessionId;
        this.flowManager = new FlowManager();
        // Mock de memória simplificado
        this.orchestrator = new CognitiveOrchestrator({} as any, this.flowManager, null);
    }

    /**
     * Prepara a sessão com uma ação pendente.
     */
    public withPendingAction(type: any, payload: any = {}): this {
        const session = SessionManager.getSession(this.sessionId);
        setPendingAction(session, { type, payload });
        
        // Sincroniza flag no CognitiveState
        const state = SessionManager.getCognitiveState(session);
        state.hasPendingAction = true;
        
        return this;
    }

    /**
     * Limpa ações pendentes.
     */
    public withoutPendingAction(): this {
        const session = SessionManager.getSession(this.sessionId);
        clearPendingAction(session);
        
        const state = SessionManager.getCognitiveState(session);
        state.hasPendingAction = false;
        
        return this;
    }

    /**
     * Simula o estado de um flow em andamento.
     */
    public withActiveFlow(flowId: string, currentStep?: string): this {
        const session = SessionManager.getSession(this.sessionId);
        const state = SessionManager.getCognitiveState(session);
        
        state.isInGuidedFlow = true;
        state.guidedFlowState = {
            flowId,
            stepIndex: 0,
            retryCount: 0,
            confidence: 0.9,
            context: {},
            topic: flowId === 'html_slides' ? 'slides' : undefined
        };

        // Força o FlowManager interno do simulator a reconhecer o flow (se possível)
        // Ou simplesmente confiamos no estado da sessão que o Orchestrator lê.
        
        return this;
    }

    /**
     * Executa um input e captura o comportamento do Orchestrator.
     */
    public async simulate(input: string): Promise<SimulationResult> {
        const debugLogs: any[] = [];
        
        // Listener para capturar logs de decisão governada
        const captureLog = (payload: any) => {
            debugLogs.push(payload);
        };

        // Escutando eventos críticos de decisão
        debugBus.on('flow_start_decision', captureLog);
        debugBus.on('final_decision_recommended', captureLog);

        try {
            const decision = await this.orchestrator.decide({
                sessionId: this.sessionId,
                input
            });

            // Auto-apply decision to maintain session state (Caminho C)
            this.applyDecision(decision);

            return {
                decision,
                debugLogs
            };
        } finally {
            // Limpeza de listeners
            removeDebugListener('flow_start_decision', captureLog);
            removeDebugListener('final_decision_recommended', captureLog);
        }
    }

    /**
     * Aplica a decisão ao estado da sessão para simular a progressão do sistema.
     */
    private applyDecision(decision: CognitiveDecision): void {
        const session = SessionManager.getSession(this.sessionId);
        const state = SessionManager.getCognitiveState(session);

        switch (decision.strategy) {
            case CognitiveStrategy.START_FLOW:
                if (decision.flowId) {
                    session.flow_state = {
                        flowId: decision.flowId,
                        stepIndex: 0,
                        retryCount: 0,
                        confidence: 0.9,
                        context: {},
                        topic: decision.flowId === 'html_slides' ? 'slides' : undefined
                    };
                }
                break;

            case CognitiveStrategy.FLOW:
                if (session.flow_state) {
                    session.flow_state.stepIndex++; // Simula avanço de step
                }
                break;

            case CognitiveStrategy.INTERRUPT_FLOW:
                session.flow_state = undefined;
                break;

            case CognitiveStrategy.EXECUTE_PENDING:
            case CognitiveStrategy.CANCEL_PENDING:
                clearPendingAction(session, decision.pendingActionId);
                break;

            case CognitiveStrategy.CONFIRM:
                // Se a decisão é confirmar algo, simulamos o estado de pendência
                if (decision.reason === 'capability_gap_detected') {
                    setPendingAction(session, { 
                        type: 'install_capability' as any, 
                        payload: { capability: 'mock_cap' } 
                    });
                }
                break;
        }
    }

    public getSessionId(): string {
        return this.sessionId;
    }
}
