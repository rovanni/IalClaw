import { ActionRouter, ExecutionRoute, TaskNature } from '../autonomy/ActionRouter';
import { decideAutonomy, AutonomyDecision, AutonomyLevel, AutonomyContext } from '../autonomy/DecisionEngine';
import { CognitiveMemory } from '../../memory/CognitiveMemory';
import { FlowManager } from '../flow/FlowManager';
import { FlowRegistry } from '../flow/FlowRegistry';
import { CognitiveActionExecutor, ExecutionResult } from './CognitiveActionExecutor';
import { IntentionResolver } from '../agent/IntentionResolver';
import { getRequiredCapabilitiesForTaskType, TaskClassifier, TaskType } from '../agent/TaskClassifier';
import { createLogger } from '../../shared/AppLogger';
import { getSecurityPolicy } from '../policy/SecurityPolicyProvider';
import { DecisionMemory } from '../../memory/DecisionMemory';
import { CapabilityResolver, ResolutionProposal, CapabilityStatus } from '../autonomy/CapabilityResolver';
import { ConfidenceScorer, AggregatedConfidence } from '../autonomy/ConfidenceScorer';
import { getPendingAction } from '../agent/PendingActionTracker';
import { SessionManager, SessionContext } from '../../shared/SessionManager';
import { t } from '../../i18n';
import { CognitiveSignalsState, RouteAutonomySignal, StopContinueSignal, StepValidationSignal, ToolFallbackSignal, FallbackStrategySignal, FailSafeSignal, LlmRetrySignal, ReclassificationSignal, PlanAdjustmentSignal, RealityCheckSignal, RepairStrategySignal, ToolSelectionSignal } from '../../engine/AgentLoopTypes';
import { SelfHealingSignal } from '../executor/AgentExecutor';
import { emitDebug } from '../../shared/DebugBus';
import { FailSafeModule } from './modules/FailSafeModule';
import { StopContinueDeltaContext, StopContinueDeltaEvaluationResult, StopContinueExecutionContext, StopContinueModule } from './modules/StopContinueModule';
import { IntentResult } from '../intent/IntentResult';
import { PlanRuntimeSignals } from '../../capabilities/stepCapabilities';
import { CapabilityFallback, CapabilityFallbackDecision } from '../../capabilities/capabilityFallback';
import { PlanRuntimeDecision, RuntimeDecisionReasons } from './PlanRuntimeDecision';
import { SearchSignal } from '../../shared/signals/SearchSignals';


export enum CognitiveStrategy {
    START_FLOW = "start_flow",
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
    intent?: IntentResult;
}

export interface CognitiveDecision {
    strategy: CognitiveStrategy;
    confidence: number;
    reason: string;
    flowId?: string;
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
    capabilityAwarePlan?: CapabilityAwarePlan;
}

export type CapabilityAwarePlan = {
    steps?: Array<{
        tool?: string;
        description?: string;
    }>;
    requiredCapabilities: string[];
    missingCapabilities: string[];
    isExecutable: boolean;
    fallbackStrategy?: 'graceful_response' | 'request_install' | 'defer';
    // Fonte da recomendação cognitiva de planejamento (não representa aplicação final).
    finalDecisionSource: 'orchestrator' | 'loop_safe_fallback';
};

type PlanningStrategyContext = {
    sessionId: string;
    taskType: TaskType;
    route: ExecutionRoute;
    capabilityGap: ResolutionProposal;
};

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

export type ActiveDecisionsResult = {
    loop: {
        stop?: StopContinueSignal;
        fallback?: ToolFallbackSignal;
        validation?: StepValidationSignal;
        route?: RouteAutonomySignal;
        failSafe?: FailSafeSignal;
    };
    orchestrator: {
        stop?: StopContinueSignal;
        fallback?: ToolFallbackSignal;
        validation?: StepValidationSignal;
        route?: RouteAutonomySignal;
        failSafe?: FailSafeSignal;
    };
    applied: {
        stop?: StopContinueSignal;
        fallback?: ToolFallbackSignal;
        validation?: StepValidationSignal;
        route?: RouteAutonomySignal;
        failSafe?: FailSafeSignal;
    };
    safeModeFallbackApplied: {
        stop: boolean;
        fallback: boolean;
        validation: boolean;
        route: boolean;
        failSafe: boolean;
    };
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
    private failSafeModule = new FailSafeModule();
    private stopContinueModule = new StopContinueModule();

    // ─── Cognitive Signals State (Passive Observation) ───────────────────
    // Armazena os signals observados do AgentLoop em modo passivo.
    // TODO: Quando o CognitiveOrchestrator assumir as decisões, usará esses signals
    // para tomar decisões reais em vez de o AgentLoop decidir localmente.
    private observedSignals: Partial<CognitiveSignalsState> = {};
    private observedSelfHealingSignal?: SelfHealingSignal;
    private observedRepairStrategySignal?: RepairStrategySignal;
    private _observedRepairResult?: { success: boolean; hasRepairedPlan: boolean };
    private _observedSearchSignals: SearchSignal[] = [];
    private routeVsFailSafeConflictLoggedInCycle = false;
    private lastCapabilityAwarePlanBySession = new Map<string, CapabilityAwarePlan>();

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
     * FASE 3.1: planejamento capability-aware em modo passivo.
     * Não altera a decisão final do fluxo atual; apenas estrutura e audita.
     */
    public decidePlanningStrategy(context: PlanningStrategyContext): CapabilityAwarePlan {
        const { sessionId, taskType, route, capabilityGap } = context;
        const requiredCapabilities = getRequiredCapabilitiesForTaskType(taskType);
        const missingFromGap = capabilityGap.gap?.missing || [];
        const primaryMissing = capabilityGap.gap?.resource ? [capabilityGap.gap.resource] : [];
        const missingCapabilities = Array.from(new Set([...missingFromGap, ...primaryMissing]));

        const hasGap = capabilityGap.hasGap || missingCapabilities.length > 0;
        const isExecutable = !hasGap;
        const fallbackStrategy: CapabilityAwarePlan['fallbackStrategy'] = hasGap
            ? (capabilityGap.solution?.requiresConfirmation ? 'request_install' : 'defer')
            : undefined;

        const planningDecision: CapabilityAwarePlan = {
            requiredCapabilities,
            missingCapabilities,
            isExecutable,
            fallbackStrategy,
            finalDecisionSource: 'orchestrator'
        };

        this.lastCapabilityAwarePlanBySession.set(sessionId, planningDecision);

        if (hasGap) {
            emitDebug('capability_gap_detected', {
                type: 'capability_gap_detected',
                sessionId,
                taskType,
                missingCapabilities,
                requiredCapabilities,
                route,
                severity: capabilityGap.gap?.severity
            });
        }

        if (route === ExecutionRoute.TOOL_LOOP && hasGap) {
            emitDebug('capability_vs_route_conflict', {
                type: 'capability_vs_route_conflict',
                sessionId,
                route,
                taskType,
                missingCapabilities
            });
        }

        emitDebug('planning_strategy_selected', {
            type: 'planning_strategy_selected',
            sessionId,
            taskType,
            route,
            requiredCapabilities,
            missingCapabilities,
            isExecutable,
            fallbackStrategy,
            finalDecisionSource: planningDecision.finalDecisionSource
        });

        return planningDecision;
    }

    public getLastCapabilityAwarePlan(sessionId: string): CapabilityAwarePlan | undefined {
        return this.lastCapabilityAwarePlanBySession.get(sessionId);
    }

    private emitFinalDecisionRecommended(params: {
        sessionId: string;
        strategy: CognitiveStrategy;
        reason: string;
        capabilityAwarePlan: CapabilityAwarePlan;
    }): void {
        emitDebug('final_decision_recommended', {
            type: 'final_decision_recommended',
            sessionId: params.sessionId,
            strategy: params.strategy,
            reason: params.reason,
            source: params.capabilityAwarePlan.finalDecisionSource
        });
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
            hasFallbackStrategy: !!signals.fallbackStrategy,
            hasValidation: !!signals.validation,
            hasRoute: !!signals.route,
            hasFailSafe: !!signals.failSafe,
            hasLlmRetry: !!signals.llmRetry,
            hasReclassification: !!signals.reclassification,
            hasPlanAdjustment: !!signals.planAdjustment,
            hasRealityCheckFacts: !!signals.realityCheckFacts,
            hasRealityCheck: !!signals.realityCheck
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

        if (signals.fallbackStrategy) {
            this.logger.info('signal_fallback_strategy_observed', '[ORCHESTRATOR PASSIVE] FallbackStrategySignal observado', {
                sessionId,
                trigger: signals.fallbackStrategy.trigger,
                shouldApplyHint: signals.fallbackStrategy.shouldApplyHint,
                reason: signals.fallbackStrategy.reason,
                failedToolsCount: signals.fallbackStrategy.failedToolsCount,
                threshold: signals.fallbackStrategy.threshold,
                toolCallsCount: signals.fallbackStrategy.toolCallsCount,
                hasPendingSteps: signals.fallbackStrategy.hasPendingSteps
            });
        }

        if (signals.toolSelection) {
            this.logger.info('signal_tool_selection_observed', t('agent.kb024.tool_selection_signal_observed'), {
                sessionId,
                stepType: signals.toolSelection.stepType,
                candidateTools: signals.toolSelection.candidateTools,
                recommendedTool: signals.toolSelection.recommendedTool,
                reason: signals.toolSelection.reason,
                shouldExplore: signals.toolSelection.shouldExplore
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

        if (signals.llmRetry) {
            this.logger.info('signal_llm_retry_observed', '[ORCHESTRATOR PASSIVE] LlmRetrySignal observado', {
                sessionId,
                retryRecommended: signals.llmRetry.retryRecommended,
                reason: signals.llmRetry.reason,
                consecutiveFailures: signals.llmRetry.consecutiveFailures
            });
        }

        if (signals.reclassification) {
            this.logger.info('signal_reclassification_observed', '[ORCHESTRATOR PASSIVE] ReclassificationSignal observado', {
                sessionId,
                reclassificationRecommended: signals.reclassification.reclassificationRecommended,
                reason: signals.reclassification.reason,
                suggestedTaskType: signals.reclassification.suggestedTaskType,
                confidence: signals.reclassification.confidence
            });
        }

        if (signals.planAdjustment) {
            this.logger.info('signal_plan_adjustment_observed', '[ORCHESTRATOR PASSIVE] PlanAdjustmentSignal observado', {
                sessionId,
                shouldAdjustPlan: signals.planAdjustment.shouldAdjustPlan,
                reason: signals.planAdjustment.reason,
                failedStep: signals.planAdjustment.failedStep,
                failureReason: signals.planAdjustment.failureReason
            });
        }

        if (signals.realityCheck) {
            this.logger.info('signal_reality_check_observed', '[ORCHESTRATOR PASSIVE] RealityCheckSignal observado', {
                sessionId,
                shouldInject: signals.realityCheck.shouldInject,
                reason: signals.realityCheck.reason,
                toolCallsCount: signals.realityCheck.toolCallsCount,
                hasGroundingEvidence: signals.realityCheck.hasGroundingEvidence
            });
        }

        if (signals.realityCheckFacts) {
            this.logger.info('signal_reality_check_facts_observed', '[ORCHESTRATOR PASSIVE] RealityCheckFacts observado', {
                sessionId,
                hasExecutionClaim: signals.realityCheckFacts.hasExecutionClaim,
                hasGroundingEvidence: signals.realityCheckFacts.hasGroundingEvidence,
                toolCallsCount: signals.realityCheckFacts.toolCallsCount,
                hasToolEvidence: signals.realityCheckFacts.hasToolEvidence
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
     * KB-020 Fase 1 — PASSIVE MODE: ingesta RepairStrategySignal do executor.
     * Apenas observa e loga. Nenhuma decisão é tomada nesta fase.
     */
    public ingestRepairStrategySignal(signal: Readonly<RepairStrategySignal>, sessionId: string): void {
        this.observedRepairStrategySignal = { ...signal };

        this.logger.info('repair_strategy_signal_received', '[ORCHESTRATOR PASSIVE] RepairStrategySignal observado', {
            sessionId,
            hasActiveProject: signal.hasActiveProject,
            usesWorkspace: signal.usesWorkspace,
            hadCreateProject: signal.hadCreateProject,
            createProjectPosition: signal.createProjectPosition,
            projectMissing: signal.projectMissing,
            repairReason: signal.repairReason
        });
    }

    /**
     * KB-020 Fase 3 — Observa resultado real da pipeline de repair (passivo).
     * Permite que decideRepairStrategy tome decisão completa (abort/continue).
     */
    public ingestRepairResult(result: Readonly<{ success: boolean; hasRepairedPlan: boolean }>, sessionId: string): void {
        this._observedRepairResult = { ...result };
        this.logger.info('repair_result_ingested', '[ORCHESTRATOR PASSIVE] RepairResult observado', {
            sessionId,
            success: result.success,
            hasRepairedPlan: result.hasRepairedPlan
        });
    }

    /**
     * KB-020 Fase 3 — Autoridade completa sobre repair: decide abort/continue com base no resultado real.
     * FailSafe e StopContinue têm prioridade. Sem resultado observado: delega ao Safe Mode.
     */
    public decideRepairStrategy(sessionId: string): 'abort' | 'continue' | undefined {
        const repairSignal = this.observedRepairStrategySignal;
        const repairResult = this._observedRepairResult;
        const failSafeSignal = this.observedSignals.failSafe;
        const stopSignal = this.observedSignals.stop;

        let orchestratorDecision: 'abort' | 'continue' | undefined;
        let reason = 'insufficient_context';

        if (failSafeSignal?.activated) {
            orchestratorDecision = 'abort';
            reason = 'fail_safe_activated';
        } else if (stopSignal?.shouldStop) {
            orchestratorDecision = 'abort';
            reason = 'stop_continue_should_stop';
        } else if (!repairResult) {
            // Resultado de repair não observado — delega ao Safe Mode (localDecision)
            orchestratorDecision = undefined;
            reason = 'repair_result_not_observed';
        } else if (repairResult.success && repairResult.hasRepairedPlan) {
            orchestratorDecision = 'continue';
            reason = 'repair_succeeded_with_plan';
        } else {
            orchestratorDecision = 'abort';
            reason = 'repair_failed_or_no_plan';
        }

        emitDebug('repair_strategy_decision', {
            type: 'repair_strategy_decision',
            sessionId,
            orchestratorDecision,
            reason,
            hasRepairSignal: !!repairSignal,
            hasRepairResult: !!repairResult,
            repairSuccess: repairResult?.success,
            hasRepairedPlan: repairResult?.hasRepairedPlan,
            failSafeActivated: failSafeSignal?.activated ?? false,
            stopShouldStop: stopSignal?.shouldStop ?? false,
            repairReason: repairSignal?.repairReason,
            usesWorkspace: repairSignal?.usesWorkspace
        });

        this.logger.info('repair_strategy_active_decision', t('agent.repair.orchestrator_governed', {
            decision: orchestratorDecision ?? 'delegated'
        }), {
            sessionId,
            reason,
            orchestratorDecision,
            repairSuccess: repairResult?.success,
            hasRepairedPlan: repairResult?.hasRepairedPlan,
            failSafeActivated: failSafeSignal?.activated ?? false,
            stopShouldStop: stopSignal?.shouldStop ?? false,
            repairReason: repairSignal?.repairReason,
            usesWorkspace: repairSignal?.usesWorkspace,
            hasActiveProject: repairSignal?.hasActiveProject,
            projectMissing: repairSignal?.projectMissing
        });

        return orchestratorDecision;
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
        const fallback = signals.fallback;
        const llmRetry = signals.llmRetry;
        const reclassification = signals.reclassification;
        const planAdjustment = signals.planAdjustment;

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

        if (llmRetry?.retryRecommended && stopContinue?.shouldStop) {
            this._reportSignalConflict('llm_retry_vs_stop_continue', sessionId, 'high', {
                llmRetry,
                stopContinue
            });
        }

        if (planAdjustment?.shouldAdjustPlan && stopContinue?.shouldStop) {
            this._reportSignalConflict('plan_adjustment_vs_stop_continue', sessionId, 'high', {
                planAdjustment,
                stopContinue
            });
        }

        if (reclassification?.reclassificationRecommended && failSafe?.activated) {
            this._reportSignalConflict('reclassification_vs_fail_safe', sessionId, 'medium', {
                reclassification,
                failSafe
            });
        }

        if (fallback?.fallbackRecommended && failSafe?.activated) {
            this._reportSignalConflict('tool_fallback_vs_fail_safe', sessionId, 'high', {
                fallback,
                failSafe
            });
        }

        if (fallback?.fallbackRecommended && llmRetry?.retryRecommended) {
            this._reportSignalConflict('tool_fallback_vs_retry', sessionId, 'medium', {
                fallback,
                llmRetry
            });
        }

        if (fallback?.fallbackRecommended && planAdjustment?.shouldAdjustPlan) {
            this._reportSignalConflict('tool_fallback_vs_replan', sessionId, 'medium', {
                fallback,
                planAdjustment
            });
        }

        const routeWantsExecution = !!route && (
            route.route === ExecutionRoute.DIRECT_LLM ||
            route.route === ExecutionRoute.TOOL_LOOP
        );

        if (fallback?.fallbackRecommended && route?.route === ExecutionRoute.DIRECT_LLM) {
            this._reportSignalConflict('tool_fallback_vs_direct_execution', sessionId, 'high', {
                fallback,
                route
            });
        }

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
        conflict: 'self_healing_vs_stop_continue' | 'self_healing_vs_fail_safe' | 'validation_vs_self_healing' | 'route_autonomy_vs_fail_safe' | 'llm_retry_vs_stop_continue' | 'plan_adjustment_vs_stop_continue' | 'reclassification_vs_fail_safe' | 'tool_fallback_vs_fail_safe' | 'tool_fallback_vs_retry' | 'tool_fallback_vs_direct_execution' | 'tool_fallback_vs_replan',
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

        emitDebug('signal_authority_resolution', {
            type: 'signal_authority_resolution',
            sessionId,
            decisionPoint: 'route_autonomy',
            authorityDecision,
            overriddenSignals: [],
            finalDecision: {
                route: routeSignal.route,
                autonomyDecision: routeSignal.autonomyDecision,
                requiresUserInput: routeSignal.requiresUserInput,
                confidence: routeSignal.confidence
            }
        });

        this.logger.info('route_active_decision', '[ORCHESTRATOR ACTIVE] RouteAutonomy aplicada', {
            sessionId,
            route: routeSignal.route,
            autonomyDecision: routeSignal.autonomyDecision,
            requiresUserInput: routeSignal.requiresUserInput,
            confidence: routeSignal.confidence,
            source: 'loop_signal_applied_by_orchestrator'
        });

        this._orchestratorAppliedDecisions.route = routeSignal;
        return routeSignal;
    }

    /**
     * ACTIVE MODE: Decide fail-safe activation based on observed FailSafeSignal.
     *
     * Regras obrigatorias desta etapa (ETAPA 7):
     * - NAO recalcular heuristicas de ativacao (buildFailSafeSignal permanece no AgentLoop)
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

        const moduleDecision = this.failSafeModule.decide(signal);
        if (moduleDecision !== undefined) {
            this._orchestratorAppliedDecisions.failSafe = moduleDecision;
            return moduleDecision;
        }

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

        const postAuditDecision = this.failSafeModule.resolvePostAuditDecision(signal);
        this._orchestratorAppliedDecisions.failSafe = postAuditDecision;

        return postAuditDecision;
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
     * ACTIVE MODE: Decide fallback strategy hint based on observed FallbackStrategySignal.
     *
     * Regras obrigatórias:
     * - Não recalcular heurística
     * - Apenas aplicar signal já produzido pelo AgentLoop
     * - Safe mode: sem signal => undefined (loop permanece decisor)
     */
    public decideFallbackStrategy(sessionId: string): boolean | undefined {
        const fallbackStrategySignal: FallbackStrategySignal | undefined = this.observedSignals.fallbackStrategy;

        if (!fallbackStrategySignal) {
            this.logger.debug('no_fallback_strategy_signal_available', t('agent.kb023.fallback_strategy_signal_missing'), {
                sessionId
            });
            return undefined;
        }

        this.logger.info('fallback_strategy_active_decision', t('agent.kb023.fallback_strategy_active_applied'), {
            sessionId,
            source: 'loop_signal_applied_by_orchestrator',
            trigger: fallbackStrategySignal.trigger,
            shouldApplyHint: fallbackStrategySignal.shouldApplyHint,
            reason: fallbackStrategySignal.reason,
            failedToolsCount: fallbackStrategySignal.failedToolsCount,
            threshold: fallbackStrategySignal.threshold
        });

        this._orchestratorAppliedDecisions.fallbackStrategy = fallbackStrategySignal;
        return fallbackStrategySignal.shouldApplyHint;
    }

    /**
     * ACTIVE MODE (KB-017): decide fallback de capability a partir de facts.
     *
     * Regras desta etapa:
     * - Nao recalcular disponibilidade de capability
     * - Nao embutir estrategia no modulo de capability
     * - Decisao central no Orchestrator
     * - Safe mode no executor: undefined => decisao local
     */
    public decideCapabilityFallback(context: {
        sessionId: string;
        signal: CapabilityFallback;
    }): CapabilityFallbackDecision | undefined {
        const { sessionId, signal } = context;

        if (!signal?.capability) {
            this.logger.debug('no_capability_fallback_signal_available', '[ORCHESTRATOR ACTIVE] Nenhum CapabilityFallback facts disponivel para decisao ativa', {
                sessionId
            });
            return undefined;
        }

        if (signal.context.suggestedDegradation) {
            return {
                action: 'degrade',
                priority: signal.severity,
                capability: signal.capability,
                reason: 'degradation_available',
                suggestedDegradation: signal.context.suggestedDegradation
            };
        }

        if (signal.retryPossible) {
            return {
                action: 'retry',
                priority: signal.severity,
                capability: signal.capability,
                reason: 'retry_possible'
            };
        }

        return {
            action: 'abort',
            priority: 'high',
            capability: signal.capability,
            reason: 'capability_unavailable_no_safe_degradation'
        };
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

        return this.applyStopContinueGovernance(sessionId, baseDecision);
    }

    public applyActiveDecisions(sessionId: string): ActiveDecisionsResult {
        const loop = {
            stop: this.observedSignals.stop,
            fallback: this.observedSignals.fallback,
            validation: this.observedSignals.validation,
            route: this.observedSignals.route,
            failSafe: this.observedSignals.failSafe
        };

        const orchestrator = {
            stop: this.decideStopContinue(sessionId),
            fallback: this.decideToolFallback(sessionId),
            validation: this.decideStepValidation(sessionId),
            route: this.decideRouteAutonomy(sessionId),
            failSafe: this.decideFailSafe(sessionId)
        };

        const applied = {
            stop: orchestrator.stop ?? loop.stop,
            fallback: orchestrator.fallback ?? loop.fallback,
            validation: orchestrator.validation ?? loop.validation,
            route: orchestrator.route ?? loop.route,
            failSafe: orchestrator.failSafe ?? loop.failSafe
        };

        return {
            loop,
            orchestrator,
            applied,
            safeModeFallbackApplied: {
                stop: !orchestrator.stop && !!loop.stop,
                fallback: !orchestrator.fallback && !!loop.fallback,
                validation: !orchestrator.validation && !!loop.validation,
                route: !orchestrator.route && !!loop.route,
                failSafe: !orchestrator.failSafe && !!loop.failSafe
            }
        };
    }

    /**
     * Active stop/continue evaluation where the loop sends only execution context
     * and the Orchestrator computes the stop decision.
     */
    public decideStopContinueFromExecutionContext(context: {
        sessionId: string;
        data: StopContinueExecutionContext;
    }): StopContinueSignal {
        const baseDecision = this.stopContinueModule.evaluateExecutionStop(context.data);
        this.observedSignals.stop = baseDecision;
        return this.applyStopContinueGovernance(context.sessionId, baseDecision);
    }

    /**
     * Active delta-stop evaluation where the loop sends only confidence history
     * and receives both decision and next delta state.
     */
    public decideStopContinueFromDeltaContext(context: {
        sessionId: string;
        data: StopContinueDeltaContext;
    }): StopContinueDeltaEvaluationResult {
        const baseResult = this.stopContinueModule.evaluateDeltaStop(context.data);
        this.observedSignals.stop = baseResult.decision;
        const governedDecision = this.applyStopContinueGovernance(context.sessionId, baseResult.decision);
        return {
            decision: governedDecision,
            nextPreviousConfidence: baseResult.nextPreviousConfidence,
            nextLowImprovementCount: baseResult.nextLowImprovementCount
        };
    }

    private applyStopContinueGovernance(sessionId: string, baseDecision: StopContinueSignal): StopContinueSignal {

        // Reuso obrigatório do estado cognitivo centralizado (sem state paralelo).
        const currentSession = SessionManager.getSession(sessionId);
        const context = currentSession ? SessionManager.getCognitiveState(currentSession) : undefined;

        const moduleDecision = this.stopContinueModule.decide(baseDecision);
        let adjustedDecision: StopContinueSignal | undefined;

        // Refinamento contextual leve e reversível:
        // se o loop decidiu parar por baixa melhora/sobre-execução, mas ainda existe
        // recuperação ativa com ação pendente nas primeiras tentativas, continua.
        if (
            moduleDecision === undefined &&
            context &&
            this.stopContinueModule.isRecoveryContinuationEligible(baseDecision) &&
            context.isInRecovery &&
            context.hasPendingAction &&
            context.attempt <= 1
        ) {
            const recoveryDecision = this.stopContinueModule.createRecoveryContinuationDecision(baseDecision);
            adjustedDecision = recoveryDecision;

            this.logger.info('stop_continue_contextual_adjustment_applied', '[ORCHESTRATOR CONTEXTUAL] Ajuste leve aplicado para preservar recuperação ativa', {
                sessionId,
                baseReason: baseDecision.reason,
                adjustedReason: recoveryDecision.reason,
                recoveryAttempt: context.attempt,
                hasPendingAction: context.hasPendingAction,
                isInRecovery: context.isInRecovery
            });
        }

        // ETAPA 3.1: Governança contextual controlada para falha recorrente.
        // Regra única: se o loop decidiu continuar, mas há falha reativa recorrente,
        // o Orchestrator força parada para evitar insistência excessiva.
        if (
            moduleDecision === undefined &&
            this.stopContinueModule.isRecurrentFailureEscalationEligible(baseDecision) &&
            context?.hasReactiveFailure &&
            context?.attempt >= 2
        ) {
            this.logger.debug('stop_continue_recurrent_failure_forced_stop', '[ORCHESTRATOR CONTEXTUAL] Forçando parada por falha recorrente', {
                sessionId,
                attempt: context.attempt,
                hasReactiveFailure: context.hasReactiveFailure,
                baseReason: baseDecision.reason
            });

            adjustedDecision = this.stopContinueModule.createRecurrentFailureStopDecision(baseDecision);
        }

        const finalDecision = adjustedDecision ?? moduleDecision ?? baseDecision;

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
        // KB-021: usa cognitiveState (sessão) como fonte de verdade; flowManager como fallback em memória
        if ((this.flowManager.isInFlow() || cognitiveState.isInGuidedFlow) && !reactiveState) {
            const flowState = this.flowManager.getState() ?? cognitiveState.guidedFlowState;
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

        const flowIdToStart = !reactiveState ? this.decideFlowStart(sessionId, text) : undefined;
        if (flowIdToStart) {
            this.logger.info('precedence_flow_start', '[ORCHESTRATOR] Prioridade: Início de Flow', {
                sessionId,
                flowId: flowIdToStart
            });
            return {
                strategy: CognitiveStrategy.START_FLOW,
                confidence: 0.9,
                reason: 'flow_start_requested',
                flowId: flowIdToStart
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

        if (cognitiveInput.intent?.mode === 'EXPLORATION') {
            this.logger.info('precedence_intent_exploration', '[ORCHESTRATOR] Intenção exploratória detectada', {
                sessionId,
                confidence: cognitiveInput.intent.confidence
            });

            return {
                strategy: CognitiveStrategy.ASK,
                confidence: cognitiveInput.intent.confidence,
                reason: this.handleExploration(text)
            };
        }

        const classification = await this.taskClassifier.classify(text);
        const routeDecision = this.actionRouter.decideRoute(text, classification.type);
        const memoryHits = await this.safeMemoryQuery(text);

        const capabilityGap = this.capabilityResolver.resolve(text, classification.type, routeDecision.nature, inputGap || undefined);
        const capabilityAwarePlan = this.decidePlanningStrategy({
            sessionId,
            taskType: classification.type,
            route: routeDecision.route,
            capabilityGap
        });

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
            this.emitFinalDecisionRecommended({
                sessionId,
                strategy: CognitiveStrategy.ASK,
                reason: 'low_confidence_fallback',
                capabilityAwarePlan
            });
            return {
                strategy: CognitiveStrategy.ASK,
                confidence: aggregatedConfidence.score,
                reason: t('agent.orchestrator.ask.low_confidence_fallback'),
                capabilityAwarePlan
            };
        }

        if (autonomyDecision === AutonomyDecision.CONFIRM) {
            this.emitFinalDecisionRecommended({
                sessionId,
                strategy: CognitiveStrategy.CONFIRM,
                reason: capabilityGap.hasGap ? 'capability_gap_detected' : 'high_risk_confirmation',
                capabilityAwarePlan
            });
            return {
                strategy: CognitiveStrategy.CONFIRM,
                confidence: aggregatedConfidence.score,
                reason: capabilityGap.hasGap ? "capability_gap_detected" : "high_risk_confirmation",
                capabilityGap,
                capabilityAwarePlan
            };
        }

        if (routeDecision.nature === TaskNature.HYBRID) {
            this.emitFinalDecisionRecommended({
                sessionId,
                strategy: CognitiveStrategy.HYBRID,
                reason: 'hybrid_informative_executable',
                capabilityAwarePlan
            });
            return {
                strategy: CognitiveStrategy.HYBRID,
                confidence: 0.9,
                reason: "hybrid_informative_executable",
                toolProposal: this.suggestHybridTool(text, classification.type),
                capabilityAwarePlan
            };
        }

        if (routeDecision.route === ExecutionRoute.TOOL_LOOP) {
            this.emitFinalDecisionRecommended({
                sessionId,
                strategy: CognitiveStrategy.TOOL,
                reason: 'tool_execution',
                capabilityAwarePlan
            });
            return {
                strategy: CognitiveStrategy.TOOL,
                confidence: routeDecision.confidence,
                reason: "tool_execution",
                capabilityAwarePlan
            };
        }

        this.emitFinalDecisionRecommended({
            sessionId,
            strategy: CognitiveStrategy.LLM,
            reason: 'direct_response',
            capabilityAwarePlan
        });

        return {
            strategy: CognitiveStrategy.LLM,
            confidence: routeDecision.confidence,
            reason: "direct_response",
            capabilityAwarePlan
        };
    }

    public decideFlowStart(sessionId: string, text: string): string | undefined {
        // TODO(KB-045): migrar a deteccao de inicio de flow para decisao explicita do Orchestrator sem heuristica local no executor.
        const definitions = FlowRegistry.listDefinitions();
        const matchedFlowId = FlowRegistry.matchByInput(text);

        this.logger.info('flow_start_evaluation', '[ORCHESTRATOR] Avaliando início de flow', {
            sessionId,
            availableFlows: definitions.map((definition) => definition.id),
            matchedFlowId
        });

        return matchedFlowId;
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

    private handleExploration(input: string): string {
        const normalized = input
            .toLowerCase()
            .normalize('NFD')
            .replace(/\p{Diacritic}/gu, '');

        if (/\b(jogo|game|games)\b/.test(normalized)) {
            return t('agent.orchestrator.exploration.game_response');
        }

        return t('agent.orchestrator.exploration.generic_response');
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

        if (!signal) {
            return undefined;
        }

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

        // FASE 2 KB-023: Orchestrator aplica ativamente a decisão do signal
        // já produzido no loop, sem recalcular heurística.
        const appliedDecision = signal.retryRecommended;

        this.logger.info('llm_retry_active_decision', '[ORCHESTRATOR ACTIVE] Decisão de retry LLM aplicada', {
            sessionId,
            retryRecommended: appliedDecision,
            reason: signal.reason,
            consecutiveFailures: signal.consecutiveFailures,
            source: 'loop_signal_applied_by_orchestrator'
        });

        this._orchestratorAppliedDecisions.llmRetry = signal;
        return appliedDecision;
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

        if (!signal) {
            return undefined;
        }

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

        // FASE 2 KB-023: Orchestrator passa a aplicar ativamente a decisão do signal
        // já produzido no loop, sem recalcular heurística e sem mudar comportamento.
        const appliedDecision = signal.reclassificationRecommended;

        this.logger.info('reclassification_active_decision', '[ORCHESTRATOR ACTIVE] Decisão de reclassificação aplicada', {
            sessionId,
            reclassificationRecommended: appliedDecision,
            reason: signal.reason,
            suggestedTaskType: signal.suggestedTaskType,
            confidence: signal.confidence,
            source: 'loop_signal_applied_by_orchestrator'
        });

        this._orchestratorAppliedDecisions.reclassification = signal;
        return appliedDecision;
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

        if (!signal) {
            return undefined;
        }

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

        // FASE 2 KB-023: Orchestrator aplica ativamente a decisão do signal
        // já produzido no loop, sem recalcular heurística.
        const appliedDecision = signal.shouldAdjustPlan;

        this.logger.info('plan_adjustment_active_decision', '[ORCHESTRATOR ACTIVE] Decisão de ajuste de plano aplicada', {
            sessionId,
            shouldAdjustPlan: appliedDecision,
            reason: signal.reason,
            failedStep: signal.failedStep,
            source: 'loop_signal_applied_by_orchestrator'
        });

        this._orchestratorAppliedDecisions.planAdjustment = signal;
        return appliedDecision;
    }

    /**
     * ACTIVE MODE: Decide se deve injetar reality-check com base no RealityCheckSignal observado.
     *
     * Regras obrigatórias:
     * - Não recalcular heurística de grounding/trust
     * - Apenas aplicar o signal já produzido pelo AgentLoop
     * - Safe mode: sem signal => undefined (AgentLoop permanece decisor)
     */
    public decideRealityCheck(context: { sessionId: string; signal: RealityCheckSignal }): boolean | undefined {
        const { sessionId, signal } = context;

        if (!signal) {
            return undefined;
        }

        this.logger.info('reality_check_active_decision', '[ORCHESTRATOR ACTIVE] Decisão de reality-check aplicada', {
            sessionId,
            shouldInject: signal.shouldInject,
            reason: signal.reason,
            toolCallsCount: signal.toolCallsCount,
            hasGroundingEvidence: signal.hasGroundingEvidence,
            source: 'loop_signal_applied_by_orchestrator'
        });

        this._orchestratorAppliedDecisions.realityCheck = signal;
        return signal.shouldInject;
    }

    /**
     * KB-027 FASE 1: Ingerir signal de Search
     * 
     * Armazena signals observados do módulo Search para auditoria e governança futura.
     * Em FASE 1, apenas observa (modo passivo). Decisões de Search ainda acontecem localmente.
     * Em FASE 2+, o Orchestrator usará esses signals para tomar decisões.
     */
    public ingestSearchSignal(sessionId: string, signal: SearchSignal): void {
        this._observedSearchSignals.push(signal);

        this.logger.info('search_signal_ingested', '[ORCHESTRATOR PASSIVE KB-027] Signal de Search recebido e registrado', {
            sessionId,
            signalType: signal.type,
            timestamp: Date.now(),
            reasoningContext: signal.reasoningContext
        });

        emitDebug('search_signal_ingested', {
            sessionId,
            signalType: signal.type,
            timestamp: Date.now()
        });
    }

    /**
     * KB-027 FASE 1: Obter último signal de Search observado
     * 
     * Retorna o sinal mais recente para auditoria ou para preparar próxima decisão.
     */
    public getLastSearchSignal(): SearchSignal | undefined {
        return this._observedSearchSignals[this._observedSearchSignals.length - 1];
    }

    /**
     * KB-027 FASE 1: Limpar histórico de signals de Search
     * 
     * Limpa o histórico entre ciclos ou sessões para evitar dados stale.
     */
    public clearSearchSignals(): void {
        this._observedSearchSignals = [];
    }

    /**
     * KB-027 FASE 5: Decidir se query deve ser expandida (sinônimos)
     * 
     * IMPLEMENTAÇÃO: Expande QueryExpansion quando:
     * 1. Estado cognitivo é estável (isStable === true)
     * 2. Tarefa é exploratória (task_type = 'exploration' ou 'research')
     * 3. Nenhuma recuperação ativa (isInRecovery === false)
     * 
     * Retorna true/false para governar expansão ou undefined para delegar ao SearchEngine
     * (Safe Mode: orchestratorDecision ?? localDecision)
     */
    public decideQueryExpansion(sessionId?: string): boolean | undefined {
        if (!sessionId) return undefined;

        try {
            const session = SessionManager.getSession(sessionId);
            if (!session) return undefined;

            const cognitiveState = SessionManager.getCognitiveState(session);
            if (!cognitiveState) return undefined;

            const { isStable, isInRecovery, taskContext } = cognitiveState;

            // Expandir quando: estável + não recuperando + exploratório
            const isExploratoryTask = taskContext?.type === 'exploration' || taskContext?.type === 'research';
            const shouldExpand = isStable && !isInRecovery && isExploratoryTask;

            if (shouldExpand) {
                this.logger.debug('query_expansion_enabled', '[KB-027] Query expansion ativada', {
                    sessionId,
                    taskType: taskContext?.type,
                    cognitiveState: { isStable, isInRecovery }
                });
            }

            return shouldExpand ? true : undefined;
        } catch (error) {
            this.logger.error('decide_query_expansion_error', error, '[KB-027] Erro em decideQueryExpansion', { sessionId });
            return undefined;
        }
    }

    /**
     * KB-027 FASE 5: Decidir pesos de scoring para busca
     * 
     * IMPLEMENTAÇÃO: Ajusta pesos quando há confiança de contexto:
     * - Aumenta peso de relevância quando task_confidence > 0.8
     * - Aumenta peso com base em importância semântica quando há CognitiveMemory hits
     * - Reduz peso de antiguidade quando em tarefa urgente
     * 
     * Retorna Record<string, number> para governar pesos ou undefined para usar defaults
     * (Safe Mode: orchestratorDecision ?? defaultWeights)
     */
    public decideSearchWeights(sessionId?: string): Record<string, number> | undefined {
        if (!sessionId) return undefined;

        try {
            const session = SessionManager.getSession(sessionId);
            if (!session) return undefined;

            const cognitiveState = SessionManager.getCognitiveState(session);
            if (!cognitiveState) return undefined;

            const { taskContext } = cognitiveState;
            const taskConfidence = session.task_confidence ?? 0;

            // Aumenta relevância quando confiante da tarefa
            if (taskConfidence > 0.8) {
                const weights: Record<string, number> = {
                    relevance: 1.2,      // +20% boost
                    semanticSimilarity: 1.0,
                    recency: 0.9,        // -10% penalidade
                    importance: 1.1      // +10% boost
                };

                this.logger.debug('search_weights_adjusted', '[KB-027] Pesos de scoring ajustados', {
                    sessionId,
                    taskConfidence,
                    weights
                });

                return weights;
            }

            return undefined; // Safe Mode: usa defaults
        } catch (error) {
            this.logger.error('decide_search_weights_error', error, '[KB-027] Erro em decideSearchWeights', { sessionId });
            return undefined;
        }
    }

    /**
     * KB-027 FASE 5: Decidir se deve expandir com grafo semântico
     * 
     * IMPLEMENTAÇÃO: Ativa expansão semântica quando:
     * 1. Estado estável + não em recuperação
     * 2. TaskContext é semântico (research, analysis)
     * 3. GraphExpansion habilitado no cache de busca (search_cache.graphExpansionEnabled)
     * 
     * Retorna { enabled: boolean; maxTerms: number; boost: number } ou undefined
     * (Safe Mode: orchestratorDecision ?? defaultConfig)
     */
    public decideGraphExpansion(sessionId?: string): { enabled: boolean; maxTerms: number; boost: number } | undefined {
        if (!sessionId) return undefined;

        try {
            const session = SessionManager.getSession(sessionId);
            if (!session) return undefined;

            const cognitiveState = SessionManager.getCognitiveState(session);
            if (!cognitiveState) return undefined;

            const { isStable, isInRecovery, taskContext } = cognitiveState;

            // Ativa expansão quando: estável + não recuperando + tarefa semântica
            const isSemanticTask = taskContext?.type === 'research' || taskContext?.type === 'analysis';
            const shouldExpandGraph = isStable && !isInRecovery && isSemanticTask;

            if (shouldExpandGraph) {
                const config = {
                    enabled: true,
                    maxTerms: 15,      // Limite de expansão
                    boost: 1.3         // Boost de 30% para termos expandidos
                };

                this.logger.debug('graph_expansion_enabled', '[KB-027] Expansão semântica ativada', {
                    sessionId,
                    taskType: taskContext?.type,
                    config
                });

                return config;
            }

            return undefined; // Safe Mode: deixa SearchEngine decidir
        } catch (error) {
            this.logger.error('decide_graph_expansion_error', error, '[KB-027] Erro em decideGraphExpansion', { sessionId });
            return undefined;
        }
    }

    /**
     * KB-027 FASE 5: Decidir se deve aplicar reranking com LLM
     * 
     * IMPLEMENTAÇÃO: Ativa reranking quando:
     * 1. Estado é estável (isStable === true)
     * 2. Tentativa inicial (attempt === 1 ou undefined)
     * 3. Resultado tem múltiplos candidatos (para LLM reordenar)
     * 
     * Bloqueia reranking quando:
     * - Em recuperação de falha (isInRecovery === true)
     * - Já houve múltiplas tentativas (attempt > 2)
     * 
     * Retorna true/false para governar reranking ou undefined para delegar
     * (Safe Mode: orchestratorDecision ?? localHeuristic)
     */
    public decideReranking(sessionId?: string): boolean | undefined {
        if (!sessionId) return undefined;

        try {
            const session = SessionManager.getSession(sessionId);
            if (!session) return undefined;

            const cognitiveState = SessionManager.getCognitiveState(session);
            if (!cognitiveState) return undefined;

            const { isStable, isInRecovery, attempt } = cognitiveState;

            // Bloqueia reranking em recuperação ou após múltiplas tentativas
            if (isInRecovery || (attempt && attempt > 2)) {
                this.logger.debug('reranking_disabled', '[KB-027] Reranking bloqueado', {
                    sessionId,
                    reason: isInRecovery ? 'in_recovery' : 'max_attempts',
                    attempt
                });
                return false;
            }

            // Ativa reranking quando estável e em tentativa inicial
            const shouldRerank = isStable && (!attempt || attempt === 1);

            if (shouldRerank) {
                this.logger.debug('reranking_enabled', '[KB-027] Reranking ativado', {
                    sessionId,
                    isStable,
                    attempt
                });
            }

            return shouldRerank ? true : undefined;
        } catch (error) {
            this.logger.error('decide_reranking_error', error, '[KB-027] Erro em decideReranking', { sessionId });
            return undefined;
        }
    }

    /**
     * KB-027 FASE 5: Decidir estratégia de fallback para falhas em Search
     * 
     * IMPLEMENTAÇÃO: Escolhe fallback baseado em contexto:
     * - Falhas normais (não-críticas) → 'warn_and_continue' (padrão)
     * - Em tarefa crítica + estável → 'use_default' (usa defaults, tenta sempre)
     * - Em recuperação após falha → 'abort' (para e reclassifica)
     * - Fallback para tagging (baixa criticidade) → 'warn_and_continue'
     * 
     * Retorna 'use_default' | 'warn_and_continue' | 'abort' ou undefined
     * (Safe Mode: orchestratorDecision ?? 'warn_and_continue')
     */
    public decideSearchFallbackStrategy(
        sessionId?: string,
        component?: 'expansion' | 'scoring' | 'reranking' | 'tagging'
    ): 'use_default' | 'warn_and_continue' | 'abort' | undefined {
        if (!sessionId) return undefined;

        try {
            const session = SessionManager.getSession(sessionId);
            if (!session) return undefined;

            const cognitiveState = SessionManager.getCognitiveState(session);
            if (!cognitiveState) return undefined;

            const { isStable, isInRecovery, attempt } = cognitiveState;

            // Tagging é low-priority → sempre continua com aviso
            if (component === 'tagging') {
                return 'warn_and_continue';
            }

            // Em recuperação → aborta para reclassificar
            if (isInRecovery) {
                this.logger.debug('fallback_strategy_abort', '[KB-027] Fallback: ABORT (em recuperação)', {
                    sessionId,
                    component,
                    isInRecovery
                });
                return 'abort';
            }

            // Em estágio estável → usa defaults (tenta sempre)
            if (isStable && (!attempt || attempt === 1)) {
                this.logger.debug('fallback_strategy_use_default', '[KB-027] Fallback: USE_DEFAULT (estável)', {
                    sessionId,
                    component,
                    attempt
                });
                return 'use_default';
            }

            // Caso padrão → continua com aviso
            return 'warn_and_continue';
        } catch (error) {
            this.logger.error('decide_fallback_strategy_error', error, '[KB-027] Erro em decideSearchFallbackStrategy', { sessionId });
            return undefined;
        }
    }

    /**
     * KB-024 FASE KB-024.1: observar signal explicito de selecao de tool sem ativar
     * nova autoridade decisoria nesta etapa.
     *
     * O contrato permanece em safe mode: o loop consulta este ponto, mas a decisao final
     * continua local ate a etapa seguinte de migracao formal para o Orchestrator.
     */
    public decideToolSelection(context: {
        sessionId: string;
        signal: ToolSelectionSignal;
    }): ToolSelectionSignal | undefined {
        const { sessionId, signal } = context;

        this.logger.debug('tool_selection_decision_deferred', t('agent.kb024.tool_selection_decision_deferred'), {
            sessionId,
            stepType: signal.stepType,
            highestPositiveCandidate: signal.highestPositiveCandidate,
            explorationCandidate: signal.explorationCandidate,
            shouldExplore: signal.shouldExplore,
            source: 'passive_signal_only'
        });

        // ETAPA KB-024.2: Ativar autoridade real de selecao de tool
        // Regra: exploration > positive > nothing
        // Safe mode com retry em AgentLoop se retornar undefined

        const recommendation: ToolSelectionSignal = {
            ...signal,
            recommendedTool: undefined,
            reason: 'no_positive_score'
        };

        if (signal.shouldExplore && signal.explorationCandidate) {
            recommendation.recommendedTool = signal.explorationCandidate;
            recommendation.reason = 'exploration';
            this.logger.info('tool_selection_active_decision', t('agent.kb024.orchestrator_tool_selection_exploration'), {
                sessionId,
                stepType: signal.stepType,
                recommendedTool: recommendation.recommendedTool,
                rate: signal.explorationRate.toFixed(2)
            });
            return recommendation;
        }

        if (signal.highestPositiveCandidate) {
            recommendation.recommendedTool = signal.highestPositiveCandidate;
            recommendation.reason = signal.hasContextualPositiveCandidate ? 'contextual_confidence' : 'positive_score';
            this.logger.info('tool_selection_active_decision', t('agent.kb024.orchestrator_tool_selection_positive'), {
                sessionId,
                stepType: signal.stepType,
                recommendedTool: recommendation.recommendedTool,
                reason: recommendation.reason
            });
            return recommendation;
        }

        this.logger.debug('tool_selection_active_decision', t('agent.kb024.orchestrator_tool_selection_no_positive'), {
            sessionId,
            stepType: signal.stepType,
            candidateTools: signal.candidateTools
        });

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

    /**
     * ACTIVE MODE: Decide o modo de runtime do plano baseado em sinais puros (fatos).
     * Esta é a centralização da lógica que anteriormente residia em stepCapabilities.
     * 
     * Retorna null quando o Orquestrador delega a decisão (safe mode).
     */
    public decidePlanRuntimeMode(signals: PlanRuntimeSignals): PlanRuntimeDecision | null {
        // Implementação pura e determinística seguindo o modelo Single Brain
        if (!signals.hasHtmlEntry && !signals.hasNodeEntry) {
            return {
                shouldExecute: false,
                requiresBrowser: false,
                reasonKey: RuntimeDecisionReasons.NO_RUNNABLE_ENTRY,
                decisionSource: "orchestrator"
            };
        }

        const isHtmlOnlyWithNoDom = signals.hasHtmlEntry && !signals.hasNodeEntry && !signals.hasDomSteps;

        if (isHtmlOnlyWithNoDom) {
            return {
                shouldExecute: false,
                requiresBrowser: false,
                reasonKey: RuntimeDecisionReasons.HTML_WITHOUT_DOM,
                decisionSource: "orchestrator"
            };
        }

        // Caso padrão: executável (projeto Node ou HTML com DOM)
        return {
            shouldExecute: true,
            requiresBrowser: signals.hasHtmlEntry && signals.hasDomSteps,
            reasonKey: signals.hasHtmlEntry && signals.hasDomSteps ? RuntimeDecisionReasons.BROWSER_REQUIRED : RuntimeDecisionReasons.EXECUTABLE_PROJECT,
            decisionSource: "orchestrator"
        };
    }
}

