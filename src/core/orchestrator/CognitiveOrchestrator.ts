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
import { CognitiveSignalsState, StopContinueSignal } from '../../engine/AgentLoop';

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

    // ─── Cognitive Signals State (Passive Observation) ───────────────────
    // Armazena os signals observados do AgentLoop em modo passivo.
    // TODO: Quando o CognitiveOrchestrator assumir as decisões, usará esses signals
    // para tomar decisões reais em vez de o AgentLoop decidir localmente.
    private observedSignals: Partial<CognitiveSignalsState> = {};

    constructor(
        private memoryService: CognitiveMemory,
        private flowManager: FlowManager,
        private decisionMemory?: DecisionMemory | null
    ) {
        this.actionExecutor = new CognitiveActionExecutor(this.memoryService, this.flowManager);
    }

    /**
     * SAFE MODE: Ingest signals from AgentLoop in passive mode.
     * The Orchestrator OBSERVES but does NOT decide yet.
     * The AgentLoop continues to execute its own decisions.
     *
     * This is the first step toward Single Brain: learning to observe before deciding.
     *
     * TODO: When Orchestrator enters active mode, this method will feed decision logic
     * instead of just logging/observing.
     *
     * @param signals Immutable snapshot from AgentLoop.getSignalsSnapshot()
     * @param sessionId Session context for logging
     */
    public ingestSignalsFromLoop(signals: Readonly<CognitiveSignalsState>, sessionId: string): void {
        this.logger.info('signals_ingested_passive_mode', '[ORCHESTRATOR PASSIVE] Consumindo signals do AgentLoop', {
            sessionId,
            hasStop: !!signals.stop,
            hasFallback: !!signals.fallback,
            hasValidation: !!signals.validation,
            hasRoute: !!signals.route,
            hasFailSafe: !!signals.failSafe
        });

        // Store the observed signals (immutably merge new observations)
        this.observedSignals = { ...signals };

        // ─── Log each signal type for audit trail ───────────────────────
        if (signals.stop) {
            this._logStopSignal(signals.stop, sessionId);
        }

        if (signals.fallback) {
            this.logger.info('signal_fallback_observed', '[ORCHESTRATOR PASSIVE] ToolFallbackSignal observado', {
                sessionId,
                trigger: signals.fallback.trigger,
                fallbackRecommended: signals.fallback.fallbackRecommended,
                originalTool: signals.fallback.originalTool
            });
        }

        if (signals.validation) {
            this.logger.info('signal_validation_observed', '[ORCHESTRATOR PASSIVE] StepValidationSignal observado', {
                sessionId,
                validationPassed: signals.validation.validationPassed,
                reason: signals.validation.reason,
                requiresLlmReview: signals.validation.requiresLlmReview
            });
        }

        if (signals.route) {
            this.logger.info('signal_route_observed', '[ORCHESTRATOR PASSIVE] RouteAutonomySignal observado', {
                sessionId,
                recommendedStrategy: signals.route.recommendedStrategy,
                route: signals.route.route,
                reason: signals.route.reason
            });
        }

        if (signals.failSafe) {
            this.logger.info('signal_failsafe_observed', '[ORCHESTRATOR PASSIVE] FailSafeSignal observado', {
                sessionId,
                isActivated: signals.failSafe.activated,
                trigger: signals.failSafe.trigger
            });
        }
    }

    /**
     * Log StopContinueSignal with structured audit trail.
     * @private
     */
    private _logStopSignal(signal: StopContinueSignal, sessionId: string): void {
        this.logger.info('signal_stop_observed', '[ORCHESTRATOR PASSIVE] StopContinueSignal observado', {
            sessionId,
            shouldStop: signal.shouldStop,
            reason: signal.reason,
            globalConfidence: signal.globalConfidence,
            stepCount: signal.stepCount
        });

        // TODO (Single Brain): This is where the Orchestrator will decide in active mode.
        // For now, we just observe:
        if (signal.shouldStop) {
            this.logger.info('stop_decision_made_by_loop', '[ORCHESTRATOR PASSIVE] AgentLoop decidiu PARAR', {
                sessionId,
                reason: signal.reason,
                confidence: signal.globalConfidence
            });
        } else {
            this.logger.info('stop_decision_made_by_loop', '[ORCHESTRATOR PASSIVE] AgentLoop decidiu CONTINUAR', {
                sessionId,
                reason: signal.reason,
                confidence: signal.globalConfidence
            });
        }
    }

    /**
     * Get immutable snapshot of last observed signals (for future decision makers).
     * @returns Readonly snapshot of observed signals
     */
    public getObservedSignals(): Readonly<Partial<CognitiveSignalsState>> {
        return { ...this.observedSignals };
    }

    /**
     * Get the last observed StopContinueSignal (for audit/debugging).
     * @returns The StopContinueSignal if available, undefined otherwise
     */
    public getLastStopSignal(): StopContinueSignal | undefined {
        return this.observedSignals.stop;
    }

    /**
     * ACTIVE MODE: Decide whether execution should stop based on observed signals.
     *
     * This is the first REAL decision migration from AgentLoop to CognitiveOrchestrator.
     * The Orchestrator now actively decides on StopContinueSignal WITHOUT duplicating logic.
     *
     * Why this works:
     * - AgentLoop.shouldStopExecution() and checkDeltaAndStop() already CREATE the StopContinueSignal
     * - The signal CONTAINS the full decision logic result (shouldStop + reason + confidence)
     * - Orchestrator simply APPLIES that decision (no new heuristics)
     * - This is governance without logic duplication
     *
     * SAFE MODE (mandatory):
     * - If signal is undefined (orchestrator timing issue), returns undefined
     * - AgentLoop receives undefined and uses its local decision (fallback)
     * - System continues functioning with zero behavior change if orchestrator fails
     *
     * Migration strategy:
     * 1. Orchestrator reads signal (this is active mode)
     * 2. AgentLoop gets decision: `const appliedDecision = orchestratorDecision ?? localDecision`
     * 3. Both see the same decision source
     * 4. In future: can audit/filter decisions here before applying
     * 5. Eventually: can integrate with other signals (context/confidence from other domains)
     *
     * @param sessionId Session context for audit logging
     * @returns Applied StopContinueSignal decision, or undefined for fallback to AgentLoop
     */
    public decideStopContinue(sessionId: string): StopContinueSignal | undefined {
        const baseDecision = this.observedSignals.stop;

        if (!baseDecision) {
            this.logger.debug('no_stop_signal_available', '[ORCHESTRATOR ACTIVE] Nenhum StopContinueSignal observado para decisão ativa', {
                sessionId
            });
            // Fallback: orchestrator cannot decide, AgentLoop will use its local decision
            return undefined;
        }

        // Reuso obrigatório do estado cognitivo centralizado (sem state paralelo).
        const currentSession = SessionManager.getSession(sessionId);
        const context = currentSession ? SessionManager.getCognitiveState(currentSession) : undefined;

        let adjustedDecision: StopContinueSignal | undefined;

        // Refinamento contextual leve e reversível:
        // se o loop decidiu parar por baixa melhora/sobre-execução, mas ainda existe
        // recuperação ativa com ação pendente nas primeiras tentativas, continua.
        if (
            context &&
            baseDecision.shouldStop &&
            context.isInRecovery &&
            context.hasPendingAction &&
            context.attempt <= 1 &&
            (baseDecision.reason === 'low_improvement_delta' || baseDecision.reason === 'over_execution_detected')
        ) {
            adjustedDecision = {
                ...baseDecision,
                shouldStop: false,
                reason: 'execution_continues'
            };

            this.logger.info('stop_continue_contextual_adjustment_applied', '[ORCHESTRATOR CONTEXTUAL] Ajuste leve aplicado para preservar recuperação ativa', {
                sessionId,
                baseReason: baseDecision.reason,
                adjustedReason: adjustedDecision.reason,
                recoveryAttempt: context.attempt,
                hasPendingAction: context.hasPendingAction,
                isInRecovery: context.isInRecovery
            });
        }

        // ETAPA 3.1: Governança contextual controlada para falha recorrente.
        // Regra única: se o loop decidiu continuar, mas há falha reativa recorrente,
        // o Orchestrator força parada para evitar insistência excessiva.
        if (
            baseDecision.shouldStop === false &&
            context?.hasReactiveFailure &&
            context?.attempt >= 2
        ) {
            this.logger.debug('stop_continue_recurrent_failure_forced_stop', '[ORCHESTRATOR CONTEXTUAL] Forçando parada por falha recorrente', {
                sessionId,
                attempt: context.attempt,
                hasReactiveFailure: context.hasReactiveFailure,
                baseReason: baseDecision.reason
            });

            adjustedDecision = {
                ...baseDecision,
                shouldStop: true,
                // Não alteramos o tipo StopContinueSignal nesta etapa; motivo é anotado via cast local controlado.
                reason: 'recurrent_failure_detected' as StopContinueSignal['reason']
            };

            this.logger.debug('stop_continue_decision_delta', '[ORCHESTRATOR DECISION DELTA] Comparação explícita base vs final', {
                sessionId,
                baseShouldStop: baseDecision.shouldStop,
                finalShouldStop: adjustedDecision.shouldStop,
                reason: adjustedDecision.reason,
                attempt: context.attempt,
                hasReactiveFailure: context.hasReactiveFailure
            });
        }

        const finalDecision = adjustedDecision ?? baseDecision;

        // ─── ACTIVE DECISION: Apply the signal directly ───────────────────
        // Base heuristics continuam no AgentLoop; o Orchestrator só aplica ajuste
        // contextual leve quando elegível, mantendo fallback e compatibilidade.
        this.logger.info('stop_continue_active_decision', '[ORCHESTRATOR ACTIVE] Decisão de parada/continuidade aplicada', {
            sessionId,
            shouldStop: finalDecision.shouldStop,
            reason: finalDecision.reason,
            globalConfidence: finalDecision.globalConfidence,
            stepCount: finalDecision.stepCount,
            source: adjustedDecision ? 'loop_signal_contextually_refined_by_orchestrator' : 'loop_heuristics_applied_by_orchestrator',
            contextualAdjustmentApplied: !!adjustedDecision
        });

        return finalDecision;
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
