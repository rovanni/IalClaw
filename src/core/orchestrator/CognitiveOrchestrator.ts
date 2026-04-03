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
import { CognitiveSignalsState, RouteAutonomySignal, StopContinueSignal, StepValidationSignal, ToolFallbackSignal, FailSafeSignal, LlmRetrySignal, ReclassificationSignal, PlanAdjustmentSignal } from '../../engine/AgentLoop';
import { SelfHealingSignal } from '../executor/AgentExecutor';
import { emitDebug } from '../../shared/DebugBus';

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

type SignalAuthorityDecision = {
    override?: boolean;
};

type SignalAuthorityContext = {
    sessionId: string;
    type: 'retry' | 'reclassification' | 'plan_adjustment' | 'retry_after_failure' | 'stop_continue' | 'route_autonomy';
    selfHealing?: SelfHealingSignal;
    stopContinue?: StopContinueSignal;
    failSafe?: FailSafeSignal;
    validation?: StepValidationSignal;
    route?: RouteAutonomySignal;
};

type RetryAfterFailureContext = {
    sessionId: string;
    attempt?: number;
    executorDecision?: boolean;
};

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
    private observedSelfHealingSignal?: SelfHealingSignal;
    private routeVsFailSafeConflictLoggedInCycle = false;

        // ─── Orchestrator Applied Decisions (para auditSignalConsistency) ─────────
        // Rastreia o que cada decide*() retornou no ciclo atual para permitir
        // comparação Loop vs Orchestrator na auditoria cruzada.
        // Reset a cada ingestSignalsFromLoop() — garante que não há estado stale.
        private _orchestratorAppliedDecisions: Partial<CognitiveSignalsState> = {};

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
        this.routeVsFailSafeConflictLoggedInCycle = false;

            // Reseta decisões aplicadas do ciclo anterior para evitar estado stale na auditoria
            this._orchestratorAppliedDecisions = {};

        // ─── Log each signal type for audit trail ───────────────────────
        if (signals.stop) {
            this._logStopSignal(signals.stop, sessionId);
        }

        if (signals.fallback) {
            this.logger.info('signal_fallback_observed', '[ORCHESTRATOR PASSIVE] ToolFallbackSignal observado', {
                sessionId,
                trigger: signals.fallback.trigger,
                fallbackRecommended: signals.fallback.fallbackRecommended,
                originalTool: signals.fallback.originalTool,
                suggestedTool: signals.fallback.suggestedTool,
                reason: signals.fallback.reason
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
     * SAFE MODE: Ingest self-healing signal from AgentExecutor in passive mode.
     * The Orchestrator only observes and logs. No decision or override is applied.
     */
    public ingestSelfHealingSignal(signal: Readonly<SelfHealingSignal>, sessionId: string): void {
        this.observedSelfHealingSignal = { ...signal };

        this.logger.info('signal_self_healing_observed', '[ORCHESTRATOR PASSIVE] SelfHealingSignal observado', {
            sessionId,
            activated: signal.activated,
            attempts: signal.attempts,
            maxAttempts: signal.maxAttempts,
            success: signal.success,
            lastError: signal.lastError,
            stepId: signal.stepId,
            toolName: signal.toolName
        });
    }

    /**
     * ACTIVE MODE: decide explicitamente retry apos falha usando apenas sinais ja existentes.
     *
     * Regras desta etapa:
     * - Sem heuristica nova
     * - Reuso de signals observados (FailSafe/StopContinue/Validation/SelfHealing)
     * - Sem alterar estado de self-healing
     */
    public decideRetryAfterFailure(context: RetryAfterFailureContext): boolean | undefined {
        const { sessionId, attempt, executorDecision } = context;
        const selfHealingSignal = this.observedSelfHealingSignal;
        const failSafeSignal = this.observedSignals.failSafe;
        const stopSignal = this.observedSignals.stop;
        const validationSignal = this.observedSignals.validation;

        let orchestratorDecision: boolean | undefined;
        let reason = 'insufficient_context';

        if (failSafeSignal?.activated) {
            orchestratorDecision = false;
            reason = 'fail_safe_activated';
        } else if (stopSignal?.shouldStop) {
            orchestratorDecision = false;
            reason = 'stop_continue_should_stop';
        } else if (validationSignal && !validationSignal.validationPassed) {
            orchestratorDecision = true;
            reason = 'validation_failed';
        } else if (selfHealingSignal?.activated) {
            orchestratorDecision = true;
            reason = 'self_healing_active';
        }

        const authorityDecision = this.resolveSignalAuthority({
            sessionId,
            type: 'retry_after_failure',
            selfHealing: selfHealingSignal,
            stopContinue: stopSignal,
            failSafe: failSafeSignal,
            validation: validationSignal,
            route: this.observedSignals.route
        });

        const authorityOverride = authorityDecision.override;

        const finalDecision = authorityOverride ?? orchestratorDecision;

        emitDebug('signal_authority_resolution', {
            type: 'signal_authority_resolution',
            sessionId,
            decisionPoint: 'self_healing_retry',
            authorityDecision,
            overriddenSignals: [],
            finalDecision
        });

        emitDebug('retry_decision', {
            type: 'retry_decision',
            sessionId,
            attempt,
            orchestratorDecision,
            executorDecision,
            finalDecision
        });

        this.logger.info('self_healing_active_decision', '[ORCHESTRATOR ACTIVE] Governança de self-healing avaliada', {
            sessionId,
            source: 'existing_signal_governance',
            activated: selfHealingSignal?.activated ?? false,
            attempts: selfHealingSignal?.attempts,
            maxAttempts: selfHealingSignal?.maxAttempts,
            success: selfHealingSignal?.success,
            stepId: selfHealingSignal?.stepId,
            toolName: selfHealingSignal?.toolName,
            failSafeActivated: failSafeSignal?.activated ?? false,
            stopShouldStop: stopSignal?.shouldStop ?? false,
            validationPassed: validationSignal?.validationPassed,
            orchestratorDecision: finalDecision,
            reason
        });

        return finalDecision;
    }

    /**
     * Compatibilidade retroativa: manter API antiga enquanto a migracao para
     * decideRetryAfterFailure(context) e finalizada.
     */
    public decideSelfHealing(sessionId: string): boolean | undefined {
        return this.decideRetryAfterFailure({ sessionId });
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
    public getObservedSignals(sessionId?: string): Readonly<Partial<CognitiveSignalsState>> {
        void sessionId;
        return { ...this.observedSignals };
    }

    public auditSignalConsistency(sessionId: string): void {
        const signals = this.getObservedSignals(sessionId);

        if (!signals) {
            return;
        }

        const selfHealing = this.observedSelfHealingSignal;
        const stopContinue = signals.stop;
        const failSafe = signals.failSafe;
        const validation = signals.validation;
        const route = signals.route;

        if (selfHealing?.activated && stopContinue?.shouldStop) {
            this._reportSignalConflict('self_healing_vs_stop_continue', sessionId, 'high', {
                selfHealing,
                stopContinue
            });
        }

        if (selfHealing?.activated && failSafe?.activated) {
            this._reportSignalConflict('self_healing_vs_fail_safe', sessionId, 'critical', {
                selfHealing,
                failSafe
            });
        }

        if (validation && !validation.validationPassed && selfHealing?.activated) {
            this._reportSignalConflict('validation_vs_self_healing', sessionId, 'medium', {
                validation,
                selfHealing
            });
        }

        const routeWantsExecution = !!route && (
            route.route === ExecutionRoute.DIRECT_LLM ||
            route.route === ExecutionRoute.TOOL_LOOP
        );
        if (failSafe?.activated && route && routeWantsExecution && !this.routeVsFailSafeConflictLoggedInCycle) {
            this._reportSignalConflict('route_autonomy_vs_fail_safe', sessionId, 'high', {
                route,
                failSafe
            });
            this.routeVsFailSafeConflictLoggedInCycle = true;
        }
    }

    public resolveSignalAuthority(context: SignalAuthorityContext): { override?: boolean } {
        const session = SessionManager.getSession(context.sessionId);
        const state = SessionManager.getCognitiveState(session) as {
            failSafe?: { activated?: boolean };
            stopContinue?: { shouldStop?: boolean };
        };
        const signals = this.observedSignals;

        const failSafe = context.failSafe ?? signals.failSafe;
        const stopContinue = context.stopContinue ?? signals.stop;
        const validation = context.validation ?? signals.validation;
        const selfHealing = context.selfHealing ?? this.observedSelfHealingSignal;

        const validationFailed = !!validation && (
            (validation as StepValidationSignal & { valid?: boolean }).valid === false ||
            validation.validationPassed === false
        );
        const selfHealingBlocked = (selfHealing as SelfHealingSignal & { blocked?: boolean } | undefined)?.blocked === true;

        if (state.failSafe?.activated || failSafe?.activated) {
            return { override: false };
        }

        if (state.stopContinue?.shouldStop || stopContinue?.shouldStop) {
            return { override: false };
        }

        if (validationFailed) {
            return { override: false };
        }

        if (selfHealingBlocked) {
            return { override: false };
        }

        return {};
    }

    private _reportSignalConflict(
        conflict: 'self_healing_vs_stop_continue' | 'self_healing_vs_fail_safe' | 'validation_vs_self_healing' | 'route_autonomy_vs_fail_safe',
        sessionId: string,
        severity: 'medium' | 'high' | 'critical',
        details: Record<string, unknown>
    ): void {
        this.logger.warn('signal_conflict_detected', '[ORCHESTRATOR AUDIT] Conflito de signals detectado', {
            type: 'signal_conflict',
            conflict,
            sessionId,
            severity,
            ...details
        });

        emitDebug('signal_conflict', {
            type: 'signal_conflict',
            conflict,
            sessionId,
            severity,
            ...details
        });
    }

    /**
     * Get the last observed StopContinueSignal (for audit/debugging).
     * @returns The StopContinueSignal if available, undefined otherwise
     */
    public getLastStopSignal(): StopContinueSignal | undefined {
        return this.observedSignals.stop;
    }

    /**
     * Get the last observed ToolFallbackSignal (for audit/debugging).
     * @returns The ToolFallbackSignal if available, undefined otherwise
     */
    public getLastFallbackSignal(): ToolFallbackSignal | undefined {
        return this.observedSignals.fallback;
    }

    /**
     * ACTIVE MODE: Decide route autonomy based on observed RouteAutonomySignal.
     *
     * Regras obrigatorias desta etapa:
     * - Nao recalcular autonomia
     * - Nao redefinir thresholds
     * - Apenas aplicar o signal ja produzido pelo AgentLoop
     * - Safe mode: sem signal => undefined (loop permanece decisor)
     *
     * @param sessionId Session context for audit logging
     * @returns Applied RouteAutonomySignal decision, or undefined for fallback to AgentLoop
     */
    public decideRouteAutonomy(sessionId: string): RouteAutonomySignal | undefined {
        const routeSignal = this.observedSignals.route;

        if (!routeSignal) {
            this.logger.debug('no_route_signal_available', '[ORCHESTRATOR ACTIVE] Nenhum RouteAutonomySignal observado para decisão ativa', {
                sessionId
            });
            return undefined;
        }

        const authorityDecision = this.resolveSignalAuthority({
            sessionId,
            type: 'route_autonomy',
            route: routeSignal,
            failSafe: this.observedSignals.failSafe,
            stopContinue: this.observedSignals.stop,
            validation: this.observedSignals.validation,
            selfHealing: this.observedSelfHealingSignal
        });

        let authorityOverride: RouteAutonomySignal | undefined;
        if (authorityDecision.override === false) {
            authorityOverride = undefined;
        } else {
            authorityOverride = routeSignal;
        }

        const finalDecision = authorityOverride ?? routeSignal;

        emitDebug('signal_authority_resolution', {
            type: 'signal_authority_resolution',
            sessionId,
            decisionPoint: 'route_autonomy',
            authorityDecision,
            overriddenSignals: [],
            finalDecision: finalDecision ? {
                recommendedStrategy: finalDecision.recommendedStrategy,
                route: finalDecision.route,
                reason: finalDecision.reason
            } : undefined
        });

        this.logger.info('route_autonomy_active_decision', '[ORCHESTRATOR ACTIVE] Route autonomy decision applied', {
            sessionId,
            source: 'loop_signal_applied_by_orchestrator',
            strategy: routeSignal.recommendedStrategy,
            route: routeSignal.route,
            reason: routeSignal.reason,
            confidence: routeSignal.confidence,
            requiresUserConfirmation: routeSignal.requiresUserConfirmation,
            requiresUserInput: routeSignal.requiresUserInput,
            autonomyDecision: routeSignal.autonomyDecision,
            suggestedTool: routeSignal.suggestedTool
        });

        this._orchestratorAppliedDecisions.route = finalDecision;

        return finalDecision ?? undefined;
    }

    /**
     * ACTIVE MODE: Decide fail-safe activation based on observed FailSafeSignal.
     *
     * Regras obrigatorias desta etapa (ETAPA 7):
     * - NAO recalcular heuristicas de ativacao (buildFailSafeSignal permanece no AgentLoop)
        this._orchestratorAppliedDecisions.route = routeSignal ?? undefined;
        return routeSignal ?? undefined;
     * - Apenas ler e aplicar o signal ja produzido pelo AgentLoop
     * - Safe mode: sem signal => undefined (loop permanece decisor)
     * - FailSafe tem PRIORIDADE sobre RouteAutonomy (apenas auditado aqui, nao resolvido)
     *
     * @param sessionId Session context for audit logging
     * @returns Applied FailSafeSignal decision, or undefined for fallback to AgentLoop
     */
    public decideFailSafe(sessionId: string): FailSafeSignal | undefined {
        const signal = this.observedSignals.failSafe;

        if (!signal) {
            this.logger.debug('no_failsafe_signal_available', '[ORCHESTRATOR ACTIVE] Nenhum FailSafeSignal observado para decisão ativa', {
                sessionId
            });
            return undefined;
        }

        this.logger.info('failsafe_active_decision', '[ORCHESTRATOR ACTIVE] Fail-safe decision applied', {
            sessionId,
            source: 'loop_signal_applied_by_orchestrator',
            activated: signal.activated,
            trigger: signal.trigger,
            reason: (signal as any).reason,
            context: (signal as any).context
        });

        // ─── Auditoria de coerência de autoridade: FailSafe vs Route ─────────
        // FailSafe SEMPRE tem prioridade sobre Route.
        // Aqui apenas AUDITAMOS o conflito — nenhum override é aplicado ainda.
        const routeSignal = this.observedSignals.route;
        if (signal.activated && routeSignal) {
            const routeWantsExecution =
                routeSignal.route === ExecutionRoute.DIRECT_LLM ||
                routeSignal.route === ExecutionRoute.TOOL_LOOP;
            if (routeWantsExecution) {
                this.logger.warn('authority_conflict_failsafe_vs_route', '[ORCHESTRATOR AUTHORITY] CONFLITO detectado: FailSafe ativado, mas Route quer executar', {
                    sessionId,
                    failSafeTrigger: signal.trigger,
                    routeStrategy: routeSignal.recommendedStrategy,
                    routeRoute: routeSignal.route,
                    resolution: 'failsafe_has_priority — override nao aplicado ainda, apenas auditado'
                });

                this.routeVsFailSafeConflictLoggedInCycle = true;

                emitDebug('signal_conflict', {
                    type: 'signal_conflict',
                    conflict: 'route_autonomy_vs_fail_safe',
                    sessionId,
                    severity: 'high',
                    route: routeSignal,
                    failSafe: signal
                });
            }
        }

        this._orchestratorAppliedDecisions.failSafe = signal;

        return signal ?? undefined;
    }

    /**
     * ACTIVE MODE: Decide step validation based on observed StepValidationSignal.
     *
        this._orchestratorAppliedDecisions.failSafe = signal ?? undefined;
        return signal ?? undefined;
     * - Nao recalcular validacao
     * - Nao alterar heuristicas de validateStepResult
     * - Apenas aplicar o signal ja produzido pelo AgentLoop
     * - Safe mode: sem signal => undefined (loop permanece decisor)
     *
     * @param sessionId Session context for audit logging
     * @returns Applied StepValidationSignal decision, or undefined for fallback to AgentLoop
     */
    public decideStepValidation(sessionId: string): StepValidationSignal | undefined {
        const validationSignal = this.observedSignals.validation;

        if (!validationSignal) {
            this.logger.debug('no_step_validation_signal_available', '[ORCHESTRATOR ACTIVE] Nenhum StepValidationSignal observado para decisão ativa', {
                sessionId
            });
            return undefined;
        }

        this.logger.info('step_validation_active_decision', '[ORCHESTRATOR ACTIVE] Step validation decision applied', {
            sessionId,
            source: 'loop_signal_applied_by_orchestrator',
            validationPassed: validationSignal.validationPassed,
            reason: validationSignal.reason,
            confidence: validationSignal.confidence,
            failureReason: validationSignal.failureReason,
            requiresLlmReview: validationSignal.requiresLlmReview
        });

        this._orchestratorAppliedDecisions.validation = validationSignal;

        return validationSignal;
    }

    /**
     * ACTIVE MODE: Decide tool fallback based on observed ToolFallbackSignal.
     *
     * Regras obrigatorias desta etapa:
     * - Nao recalcular fallback
        this._orchestratorAppliedDecisions.validation = validationSignal;
        return validationSignal;
     * - Apenas aplicar o signal ja produzido pelo AgentLoop
     * - Safe mode: sem signal => undefined (loop permanece decisor)
     *
     * @param sessionId Session context for audit logging
     * @returns Applied ToolFallbackSignal decision, or undefined for fallback to AgentLoop
     */
    public decideToolFallback(sessionId: string): ToolFallbackSignal | undefined {
        const fallbackSignal = this.getLastFallbackSignal();

        if (!fallbackSignal) {
            this.logger.debug('no_fallback_signal_available', '[ORCHESTRATOR ACTIVE] Nenhum ToolFallbackSignal observado para decisão ativa', {
                sessionId
            });
            return undefined;
        }

        const hasDelta = !!fallbackSignal.suggestedTool && fallbackSignal.originalTool !== fallbackSignal.suggestedTool;
        if (hasDelta) {
            this.logger.debug('tool_fallback_decision_delta', '[ORCHESTRATOR DECISION DELTA] Delta de fallback aplicado a partir do signal', {
                sessionId,
                originalTool: fallbackSignal.originalTool,
                fallbackTool: fallbackSignal.suggestedTool,
                reason: fallbackSignal.reason
            });
        }

        this.logger.info('tool_fallback_active_decision', '[ORCHESTRATOR ACTIVE] Decisão de fallback aplicada a partir do ToolFallbackSignal', {
            sessionId,
            source: 'loop_signal_applied_by_orchestrator',
            trigger: fallbackSignal.trigger,
            fallbackRecommended: fallbackSignal.fallbackRecommended,
            fallbackTool: fallbackSignal.suggestedTool,
            reason: fallbackSignal.reason
        });

        this._orchestratorAppliedDecisions.fallback = fallbackSignal;

        return fallbackSignal;
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
                reason: 'recurrent_failure_detected'
            };
        }

        const finalDecision = adjustedDecision ?? baseDecision;

        const authorityDecision = this.resolveSignalAuthority({
            sessionId,
            type: 'stop_continue',
            stopContinue: finalDecision,
            failSafe: this.observedSignals.failSafe,
            validation: this.observedSignals.validation,
            selfHealing: this.observedSelfHealingSignal,
            route: this.observedSignals.route
        });

        const authorityOverride: StopContinueSignal | undefined = undefined;
        const authoritativeFinalDecision = authorityOverride ?? finalDecision;

        emitDebug('signal_authority_resolution', {
            type: 'signal_authority_resolution',
            sessionId,
            decisionPoint: 'stop_continue',
            authorityDecision,
            overriddenSignals: [],
            finalDecision: {
                shouldStop: authoritativeFinalDecision.shouldStop,
                reason: authoritativeFinalDecision.reason,
                globalConfidence: authoritativeFinalDecision.globalConfidence,
                stepCount: authoritativeFinalDecision.stepCount
            }
        });

        // Auditoria explícita de delta: registra apenas quando a decisão final muda
        // em relação ao signal base do loop (observabilidade sem alterar comportamento).
        if (baseDecision.shouldStop !== authoritativeFinalDecision.shouldStop) {
            this.logger.debug('stop_continue_decision_delta', '[ORCHESTRATOR DECISION DELTA] Comparação explícita base vs final', {
                sessionId,
                baseShouldStop: baseDecision.shouldStop,
                finalShouldStop: authoritativeFinalDecision.shouldStop,
                baseReason: baseDecision.reason,
                finalReason: authoritativeFinalDecision.reason,
                context: {
                    attempt: context?.attempt,
                    hasReactiveFailure: context?.hasReactiveFailure
                }
            });
        }

        // ─── ACTIVE DECISION: Apply the signal directly ───────────────────
        // Base heuristics continuam no AgentLoop; o Orchestrator só aplica ajuste
        // contextual leve quando elegível, mantendo fallback e compatibilidade.
        this.logger.info('stop_continue_active_decision', '[ORCHESTRATOR ACTIVE] Decisão de parada/continuidade aplicada', {
            sessionId,
            shouldStop: authoritativeFinalDecision.shouldStop,
            reason: authoritativeFinalDecision.reason,
            globalConfidence: authoritativeFinalDecision.globalConfidence,
            stepCount: authoritativeFinalDecision.stepCount,
            source: adjustedDecision ? 'loop_signal_contextually_refined_by_orchestrator' : 'loop_heuristics_applied_by_orchestrator',
            contextualAdjustmentApplied: !!adjustedDecision
        });

        this._orchestratorAppliedDecisions.stop = authoritativeFinalDecision;

        return authoritativeFinalDecision;
    }

    /**
     * Decide a melhor estratégia para processar o input do usuário.
     * Internaliza a recuperação de estado e a hierarquia de precedência.
     */
    async decide(cognitiveInput: CognitiveInput): Promise<CognitiveDecision> {
        const sessionId = cognitiveInput.sessionId;
        const text = cognitiveInput.input;

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
            const gapCapability = inputGap.capability;
            delete currentSession.last_input_gap;
            this.logger.info('consuming_input_gap', '[ORCHESTRATOR] Consumindo sinal de gap para decisão', { capability: gapCapability });
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
            const pendingActionId = pendingAction.id;
            this.logger.info('precedence_pending', '[ORCHESTRATOR] Prioridade: Pending Action');

            if (intent === 'CONFIRM' || intent === 'CONTINUE' || intent === 'EXECUTE') {
                return { strategy: CognitiveStrategy.EXECUTE_PENDING, confidence: 1.0, reason: "user_confirmed_pending", pendingActionId };
            }

            if (intent === 'STOP' || intent === 'DECLINE') {
                return { strategy: CognitiveStrategy.CANCEL_PENDING, confidence: 1.0, reason: "user_declined_pending", pendingActionId };
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
     * ACTIVE MODE: Decide whether to retry with LLM based on observed LlmRetrySignal.
     *
     * Regras obrigatórias:
     * - Não recalcular heurística de retry
     * - Apenas interpretar o signal já produzido pelo AgentLoop
     * - Safe mode: signal ausente => undefined (AgentLoop permanece decisor)
     */
    public decideRetryWithLlm(context: { sessionId: string; signal: LlmRetrySignal }): boolean | undefined {
        const { sessionId, signal } = context;

        const authority = this.resolveSignalAuthority({
            sessionId,
            type: 'retry'
        });

        if (authority.override !== undefined) {
            const failSafe = this.observedSignals.failSafe;
            const stopContinue = this.observedSignals.stop;

            if (failSafe?.activated) {
            this.logger.info('llm_retry_blocked_by_failsafe', '[ORCHESTRATOR AUTHORITY] LLM retry bloqueado pelo FailSafe', {
                sessionId,
                failSafeTrigger: failSafe.trigger,
                signal_reason: signal?.reason
            });
            } else if (stopContinue?.shouldStop) {
                this.logger.info('llm_retry_blocked_by_stop', '[ORCHESTRATOR AUTHORITY] LLM retry bloqueado pelo StopContinue', {
                    sessionId,
                    stopReason: stopContinue.reason,
                    signal_reason: signal?.reason
                });
            }

            this._orchestratorAppliedDecisions.llmRetry = signal;
            return authority.override;
        }

        // Sem bloqueio — delegar ao loop (safe mode).
        return undefined;
    }

    /**
     * ACTIVE MODE: Decide whether to reclassify task based on observed ReclassificationSignal.
     *
     * Regras obrigatórias:
     * - Não recalcular heurística de reclassificação
     * - Apenas interpretar o signal já produzido pelo AgentLoop
     * - Safe mode: signal ausente => undefined (AgentLoop permanece decisor)
     */
    public decideReclassification(context: { sessionId: string; signal: ReclassificationSignal }): boolean | undefined {
        const { sessionId, signal } = context;

        const authority = this.resolveSignalAuthority({
            sessionId,
            type: 'reclassification'
        });

        if (authority.override !== undefined) {
            const failSafe = this.observedSignals.failSafe;
            const stopContinue = this.observedSignals.stop;

            if (failSafe?.activated) {
                this.logger.info('reclassification_blocked_by_failsafe', '[ORCHESTRATOR AUTHORITY] Reclassificação bloqueada pelo FailSafe', {
                    sessionId,
                    failSafeTrigger: failSafe.trigger,
                    signal_reason: signal?.reason
                });
            } else if (stopContinue?.shouldStop) {
                this.logger.info('reclassification_blocked_by_stop', '[ORCHESTRATOR AUTHORITY] Reclassificação bloqueada pelo StopContinue', {
                    sessionId,
                    stopReason: stopContinue.reason,
                    signal_reason: signal?.reason
                });
            }

            this._orchestratorAppliedDecisions.reclassification = signal;
            return authority.override;
        }

        // Sem bloqueio — delegar ao loop (safe mode).
        return undefined;
    }

    /**
     * ACTIVE MODE: Decide whether to adjust plan based on observed PlanAdjustmentSignal.
     *
     * Regras obrigatórias:
     * - Não recalcular heurística de ajuste de plano
     * - Apenas interpretar o signal já produzido pelo AgentLoop
     * - Safe mode: signal ausente => undefined (AgentLoop permanece decisor)
     */
    public decidePlanAdjustment(context: { sessionId: string; signal: PlanAdjustmentSignal }): boolean | undefined {
        const { sessionId, signal } = context;

        const authority = this.resolveSignalAuthority({
            sessionId,
            type: 'plan_adjustment'
        });

        if (authority.override !== undefined) {
            const failSafe = this.observedSignals.failSafe;
            const stopContinue = this.observedSignals.stop;

            if (failSafe?.activated) {
                this.logger.info('plan_adjustment_blocked_by_failsafe', '[ORCHESTRATOR AUTHORITY] Ajuste de plano bloqueado pelo FailSafe', {
                    sessionId,
                    failSafeTrigger: failSafe.trigger,
                    signal_failedStep: signal?.failedStep
                });
            } else if (stopContinue?.shouldStop) {
                this.logger.info('plan_adjustment_blocked_by_stop', '[ORCHESTRATOR AUTHORITY] Ajuste de plano bloqueado pelo StopContinue', {
                    sessionId,
                    stopReason: stopContinue.reason,
                    signal_failedStep: signal?.failedStep
                });
            }

            this._orchestratorAppliedDecisions.planAdjustment = signal;
            return authority.override;
        }

        // Sem bloqueio — delegar ao loop (safe mode).
        return undefined;
    }

    /**
     * ETAPA SHORT-CIRCUIT GOVERNANCE: Decide se o AgentLoop pode executar diretamente
     * (sem passar pelo loop de tools). Retorna false para bloquear, undefined para delegar.
     *
     * Regras:
     * - FailSafe ativado → bloqueia execução direta (false)
     * - hasExecutionIntent === true → bloqueia (false)
     * - Caso contrário → delega ao loop (undefined = safe mode)
     */
    public decideDirectExecution(context: {
        sessionId: string;
        context: {
            hasExecutionIntent: boolean;
            strategy: string;
            taskType: TaskType | null;
        };
    }): boolean | undefined {
        const { sessionId } = context;
        const { hasExecutionIntent } = context.context;

        const failSafe = this.observedSignals.failSafe;
        if (failSafe?.activated) {
            this.logger.info('direct_execution_blocked_by_failsafe', '[ORCHESTRATOR] Execução direta bloqueada pelo FailSafe', {
                sessionId,
                failSafeTrigger: failSafe.trigger,
                strategy: context.context.strategy
            });
            return false;
        }

        if (hasExecutionIntent) {
            this.logger.info('direct_execution_blocked_intent', '[ORCHESTRATOR] Execução direta bloqueada — intenção de execução real detectada', {
                sessionId,
                strategy: context.context.strategy,
                taskType: context.context.taskType
            });
            return false;
        }

        return undefined;
    }

    /**
     * Delega a execução da decisão para o CognitiveActionExecutor.
     */
    public async executeDecision(decision: CognitiveDecision, session: SessionContext, userQuery: string): Promise<ExecutionResult> {
        return this.actionExecutor.execute(decision, session, userQuery);
    }
}
