import { ActionRouter, ExecutionRoute, TaskNature } from '../autonomy/ActionRouter';
import { decideAutonomy, AutonomyDecision, AutonomyLevel, AutonomyContext } from '../autonomy/DecisionEngine';
import { CognitiveMemory } from '../../memory/CognitiveMemory';
import { FlowManager } from '../flow/FlowManager';
import { CognitiveActionExecutor, ExecutionResult } from './CognitiveActionExecutor';
import { IntentionResolver } from '../agent/IntentionResolver';
import { TaskClassifier, TaskType } from '../agent/TaskClassifier';
import { createLogger } from '../../shared/AppLogger';
import { getSecurityPolicy } from '../policy/SecurityPolicyProvider';
import { DecisionMemory } from '../../memory/DecisionMemory';
import { CapabilityResolver, ResolutionProposal, CapabilityStatus } from '../autonomy/CapabilityResolver';
import { ConfidenceScorer, AggregatedConfidence } from '../autonomy/ConfidenceScorer';
import { getPendingAction } from '../agent/PendingActionTracker';
import { SessionManager, SessionContext } from '../../shared/SessionManager';
import { t } from '../../i18n';

export enum CognitiveStrategy {
    FLOW = "flow",
    TOOL = "tool",
    LLM = "llm",
    HYBRID = "hybrid",      // LLM + Tool opcional
    ASK = "ask",
    CONFIRM = "confirm",
    EXECUTE_PENDING = "execute_pending",
    CANCEL_PENDING = "cancel_pending",
    INTERRUPT_FLOW = "interrupt_flow" // Novo: Interrupção estratégica de flow
}

export interface CognitiveInput {
    sessionId: string;
    input: string;
}

export interface CognitiveDecision {
    strategy: CognitiveStrategy;
    confidence: number;
    reason: string;
    clearPendingAction?: boolean;
    pendingActionId?: string;
    toolProposal?: any;
    resolutionProposal?: ResolutionProposal;
    interruptionReason?: string;

    // Metadados para diagnóstico (opcionais)
    route?: any;
    autonomy?: any;
    memoryHits?: any[];
    capabilityGap?: ResolutionProposal;
    aggregatedConfidence?: AggregatedConfidence;
}

/**
 * CognitiveOrchestrator: Centraliza a tomada de decisão do agente.
 * Coordena entre fluxos guiados, execução de ferramentas e resposta direta via LLM.
 */
export class CognitiveOrchestrator {
    private logger = createLogger('CognitiveOrchestrator');
    private capabilityResolver = new CapabilityResolver();
    private confidenceScorer = new ConfidenceScorer();
    private actionRouter = new ActionRouter();
    private taskClassifier = new TaskClassifier();
    private actionExecutor: CognitiveActionExecutor;

    constructor(
        private memoryService: CognitiveMemory,
        private flowManager: FlowManager,
        private decisionMemory?: DecisionMemory | null
    ) {
        this.actionExecutor = new CognitiveActionExecutor(this.memoryService, this.flowManager);
    }

    /**
     * Decide a melhor estratégia para processar o input do usuário.
     * Internaliza a recuperação de estado e a hierarquia de precedência.
     */
    async decide(input: CognitiveInput): Promise<CognitiveDecision> {
        const { input: text, sessionId } = input;

        // ── 1. RECUPERAÇÃO DE ESTADO (Internalizada) ───────────────────────
        const currentSession = SessionManager.getSession(sessionId);
        if (!currentSession) {
            return { strategy: CognitiveStrategy.LLM, confidence: 0.5, reason: "session_not_found" };
        }

        const cognitiveState = SessionManager.getCognitiveState(currentSession);
        const pendingAction = getPendingAction(currentSession);
        const reactiveState = cognitiveState.reactiveState;
        const inputGap = currentSession.last_input_gap;

        // Limpa sinal de gap se existir (consumo imediato)
        if (inputGap) {
            delete currentSession.last_input_gap;
            this.logger.info('consuming_input_gap', '[ORCHESTRATOR] Consumindo sinal de gap para decisão', { capability: inputGap.capability });
        }

        const match = IntentionResolver.resolve(text);
        const intent = match.type;

        // ── 2. HIERARQUIA DE PRECEDÊNCIA (Production-Level) ─────────────────

        // --- 2.1. RECOVERY (MÁXIMA PRIORIDADE) ---
        if (reactiveState) {
            this.logger.info('precedence_recovery', '[ORCHESTRATOR] Prioridade: Recovery');

            if (intent === 'STOP' || intent === 'DECLINE') {
                return { strategy: CognitiveStrategy.LLM, confidence: 1.0, reason: "user_cancelled_recovery", clearPendingAction: true };
            }

            if (reactiveState.type === 'capability_missing' || reactiveState.type === 'execution_failed') {
                return {
                    strategy: CognitiveStrategy.CONFIRM,
                    confidence: 0.95,
                    reason: "reactive_recovery_needed",
                    resolutionProposal: {
                        hasGap: true,
                        status: CapabilityStatus.MISSING,
                        gap: {
                            resource: reactiveState.context?.capability || 'unknown',
                            reason: reactiveState.error || 'Reactive recovery',
                            task: 'recovery',
                            severity: 'blocking'
                        }
                    }
                };
            }
        }

        // --- 2.2. FLOW (GUIADO) ---
        if (this.flowManager.isInFlow() && !reactiveState) {
            const flowState = this.flowManager.getState();
            const topic = flowState?.topic;

            const isRelated = IntentionResolver.isIntentRelatedToTopic(text, topic || undefined);
            const isEscape = (intent === 'STOP' || intent === 'QUESTION' || intent === 'META') && !isRelated;

            if (isEscape) {
                this.logger.info('precedence_flow_interrupt', '[ORCHESTRATOR] Flow interrompido por topic shift');
                return {
                    strategy: CognitiveStrategy.INTERRUPT_FLOW,
                    confidence: 0.95,
                    reason: "topic_shift",
                    interruptionReason: "user_interruption"
                };
            }

            this.logger.info('precedence_flow', '[ORCHESTRATOR] Prioridade: Flow Ativo');
            return {
                strategy: CognitiveStrategy.FLOW,
                confidence: Math.max(0.85, flowState?.confidence || 0.9),
                reason: "active_flow_continuity"
            };
        }

        // --- 2.3. PENDING ACTION (CONFIRMAÇÃO) ---
        if (pendingAction && !reactiveState) {
            this.logger.info('precedence_pending', '[ORCHESTRATOR] Prioridade: Pending Action');

            if (intent === 'CONFIRM' || intent === 'CONTINUE' || intent === 'EXECUTE') {
                return { strategy: CognitiveStrategy.EXECUTE_PENDING, confidence: 1.0, reason: "user_confirmed_pending", pendingActionId: pendingAction.id };
            }

            if (intent === 'STOP' || intent === 'DECLINE') {
                return { strategy: CognitiveStrategy.CANCEL_PENDING, confidence: 1.0, reason: "user_declined_pending", pendingActionId: pendingAction.id };
            }

            if (match.type === 'UNKNOWN' && text.length > 120) {
                return { strategy: CognitiveStrategy.LLM, confidence: 0.9, reason: "topic_shift_clearing_pending", clearPendingAction: true };
            }
        }

        // --- 2.4. NORMAL (DECISION HUB) ---
        this.logger.info('precedence_normal', '[ORCHESTRATOR] Prioridade: Processamento Normal');

        const classification = await this.taskClassifier.classify(text);
        const routeDecision = this.actionRouter.decideRoute(text, classification.type);
        const memoryHits = await this.safeMemoryQuery(text);

        const capabilityGap = this.capabilityResolver.resolve(text, classification.type, routeDecision.nature, inputGap || undefined);

        const aggregatedConfidence = this.confidenceScorer.calculate({
            classifierConfidence: classification.confidence,
            routerConfidence: routeDecision.confidence,
            memoryHits: memoryHits,
            nature: routeDecision.nature
        });

        const autonomyDecision = decideAutonomy({
            intent: classification.type,
            isContinuation: !!pendingAction,
            hasAllParams: true,
            riskLevel: 'medium',
            isDestructive: false,
            isReversible: true,
            confidence: aggregatedConfidence.score,
            aggregatedConfidence,
            cognitiveState,
            nature: routeDecision.nature,
            capabilityGap,
            pendingAction,
            reactiveState
        });

        // ── 3. MAPEAMENTO FINAL DE ESTRATÉGIA ───────────────────────────────

        if (autonomyDecision === AutonomyDecision.ASK) {
            return {
                strategy: CognitiveStrategy.ASK,
                confidence: aggregatedConfidence.score,
                reason: t('agent.orchestrator.ask.low_confidence_fallback')
            };
        }

        if (autonomyDecision === AutonomyDecision.CONFIRM) {
            return {
                strategy: CognitiveStrategy.CONFIRM,
                confidence: aggregatedConfidence.score,
                reason: capabilityGap.hasGap ? "capability_gap_detected" : "high_risk_confirmation",
                capabilityGap
            };
        }

        if (routeDecision.nature === TaskNature.HYBRID) {
            return {
                strategy: CognitiveStrategy.HYBRID,
                confidence: 0.9,
                reason: "hybrid_informative_executable",
                toolProposal: this.suggestHybridTool(text, classification.type)
            };
        }

        if (routeDecision.route === ExecutionRoute.TOOL_LOOP) {
            return {
                strategy: CognitiveStrategy.TOOL,
                confidence: routeDecision.confidence,
                reason: "tool_execution"
            };
        }

        return {
            strategy: CognitiveStrategy.LLM,
            confidence: routeDecision.confidence,
            reason: "direct_response"
        };
    }

    private async safeMemoryQuery(input: string) {
        try {
            return this.memoryService?.searchByContent(input, 5) || [];
        } catch {
            return [];
        }
    }

    private suggestHybridTool(input: string, taskType: TaskType): string | undefined {
        const text = input.toLowerCase();
        const heuristics: Record<string, string> = {
            'cripto': 'crypto-tracker',
            'bitcoin': 'crypto-tracker',
            'ethereum': 'crypto-tracker',
            'paxg': 'paxg-monitor'
        };

        for (const [key, tool] of Object.entries(heuristics)) {
            if (text.includes(key)) return tool;
        }

        if (taskType === 'data_analysis') return 'crypto-tracker';
        return undefined;
    }

    /**
     * Delega a execução da decisão para o CognitiveActionExecutor.
     */
    public async executeDecision(decision: CognitiveDecision, session: SessionContext, userQuery: string): Promise<ExecutionResult> {
        return this.actionExecutor.execute(decision, session, userQuery);
    }
}
