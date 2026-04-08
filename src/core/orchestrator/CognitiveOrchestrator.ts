import { ActionRouter, ExecutionRoute, TaskNature } from '../autonomy/ActionRouter';
import { decideAutonomy, AutonomyDecision, AutonomyLevel, AutonomyContext } from '../autonomy/DecisionEngine';
import { CognitiveMemory } from '../../memory/CognitiveMemory';
import { FlowManager } from '../flow/FlowManager';
import { FlowRegistry } from '../flow/FlowRegistry';
import { CognitiveActionExecutor, ExecutionResult } from './CognitiveActionExecutor';
import { IntentionResolver } from '../agent/IntentionResolver';
import { TaskClassifier, TaskType, getRequiredCapabilitiesForTaskType } from '../agent/TaskClassifier';
import { createLogger } from '../../shared/AppLogger';
import { getSecurityPolicy } from '../policy/SecurityPolicyProvider';
import { DecisionMemory } from '../../memory/DecisionMemory';
import { CapabilityResolver, ResolutionProposal, CapabilityStatus } from '../autonomy/CapabilityResolver';
import { capabilityRegistry, skillManager } from '../../capabilities';
import {
    deriveCapabilitiesFromInput,
    getCandidateSkillsForCapability,
    getRuntimeRequirementsForCapability,
    normalizeCapability
} from '../../capabilities/capabilitySkillMap';
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
import { CapabilityFallbackDecision } from '../../capabilities/capabilityFallback';
import { PlanRuntimeDecision, RuntimeDecisionReasons } from './PlanRuntimeDecision';
import { SearchSignal } from '../../shared/signals/SearchSignals';
import { buildActiveDecisionsResult } from './decisions/active/buildActiveDecisionsResult';
import { buildFinalDecisionRecommendedPayload } from './decisions/final/buildFinalDecisionRecommendedPayload';
import { buildObservedSignalLogEntries } from './decisions/signals/buildObservedSignalLogEntries';
import { buildObservedStopSignalLogEntries } from './decisions/signals/buildObservedStopSignalLogEntries';
import { detectSignalConflicts } from './decisions/signals/detectSignalConflicts';
import { buildIngestedSignalSummary } from './decisions/signals/buildIngestedSignalSummary';
import {
    buildCapabilityGapDetectedPayload,
    buildCapabilityVsRouteConflictPayload,
    buildPlanningStrategySelectedPayload
} from './decisions/planning/buildPlanningDebugPayloads';
import {
    buildStopContinueActiveDecisionPayload,
    buildStopContinueAuthorityResolutionPayload,
    buildStopContinueContextualAdjustmentPayload,
    buildStopContinueDecisionDeltaPayload,
    buildStopContinueRecurrentFailurePayload
} from './decisions/stopContinue/buildStopContinueGovernanceAuditPayloads';
import { decidePlanningStrategy as decidePlanningStrategyDecision } from './decisions/planning/decidePlanningStrategy';
import { decideCapabilityFallback as decideCapabilityFallbackDecision } from './decisions/capability/decideCapabilityFallback';
import {
    buildRetryAfterFailureAuthorityResolutionPayload,
    buildRetryDecisionPayload,
    buildSelfHealingActiveDecisionPayload
} from './decisions/retry/buildRetryAfterFailureDebugPayloads';
import { buildSelfHealingObservedPayload } from './decisions/retry/buildSelfHealingLogPayloads';
import {
    buildRepairStrategyActiveDecisionPayload,
    buildRepairStrategyDecisionPayload
} from './decisions/repair/buildRepairStrategyDebugPayloads';
import {
    buildRepairResultIngestedPayload,
    buildRepairStrategySignalReceivedPayload
} from './decisions/repair/buildRepairStrategyLogPayloads';
import {
    buildRouteAutonomyActiveDecisionPayload,
    buildRouteAutonomyAuthorityResolutionPayload
} from './decisions/route/buildRouteAutonomyDebugPayloads';
import { decideRetryAfterFailure as decideRetryAfterFailureDecision } from './decisions/retry/decideRetryAfterFailure';
import { buildDecisionPrecedenceContext } from './decisions/precedence/buildDecisionPrecedenceContext';
import type { ActiveDecisionSnapshot, ActiveDecisionsResult } from './types/ActiveDecisionsTypes';
import { CapabilityFallbackDecisionContext } from './types/CapabilityFallbackTypes';
import type { IngestedSignalSummary } from './types/IngestSignalsTypes';
import { RetryAfterFailureContext } from './types/RetryAfterFailureTypes';
import type { RepairStrategyDecisionReason, RepairStrategyDecisionValue } from './types/RepairStrategyDebugTypes';
import type { RouteAutonomyAuthorityResolutionPayload } from './types/RouteAutonomyDebugTypes';
import type { CapabilityAwarePlan, PlanningStrategyContext } from './types/PlanningTypes';
import type { ObservedSignalLogEntry, ObservedStopSignalLogEntry } from './types/ObservedSignalLogTypes';
import type { SignalConflictId, SignalConflictSeverity } from './types/SignalConflictTypes';
import type { StopContinueGovernanceAuditContext } from './types/StopContinueGovernanceTypes';
import { decideFlowStart as decideFlowStartDecision } from './decisions/flow/decideFlowStart';
import { FlowStartDecision } from './types/FlowStartTypes';
import { decideMemoryQuery as decideMemoryQueryDecision } from './decisions/memory/decideMemoryQuery';


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
    usedInputGap?: boolean;

    // Orchestration Hints (KB-049)
    type?: string;
    skipPlanning?: boolean;
    skipToolLoop?: boolean;

    // Metadados para diagnóstico (opcionais)
    route?: any;
    autonomy?: any;
    memoryHits?: any[];
    capabilityGap?: ResolutionProposal;
    aggregatedConfidence?: AggregatedConfidence;
    capabilityAwarePlan?: CapabilityAwarePlan;
}

export type { CapabilityAwarePlan } from './types/PlanningTypes';
    // Fonte da recomendação cognitiva de planejamento (não representa aplicação final).

type CapabilityFallbackContext = CapabilityFallbackDecisionContext & {
    sessionId: string;
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

export type { ActiveDecisionsResult } from './types/ActiveDecisionsTypes';

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

    // ─── Cognitive Signals State (Signal Ingestion + Active Governance) ───
    // Armazena sinais observados para auditoria e decisões ativas em safe mode.
    // O Orchestrator continua autoridade final apenas quando explicitamente aplicado.
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
        const planningDecision = decidePlanningStrategyDecision(context);
        const {
            requiredCapabilities,
            missingCapabilities,
            hasGap,
            isExecutable,
            fallbackStrategy
        } = planningDecision;

        this.lastCapabilityAwarePlanBySession.set(sessionId, planningDecision);

        if (hasGap) {
            emitDebug('capability_gap_detected', buildCapabilityGapDetectedPayload({
                sessionId,
                taskType,
                route,
                planningDecision,
                severity: capabilityGap.gap?.severity
            }));
        }

        if (route === ExecutionRoute.TOOL_LOOP && hasGap) {
            emitDebug('capability_vs_route_conflict', buildCapabilityVsRouteConflictPayload({
                sessionId,
                taskType,
                route,
                planningDecision
            }));
        }

        emitDebug('planning_strategy_selected', buildPlanningStrategySelectedPayload({
            sessionId,
            taskType,
            route,
            planningDecision
        }));

        return planningDecision;
    }

    public getLastCapabilityAwarePlan(sessionId: string): CapabilityAwarePlan | undefined {
        return this.lastCapabilityAwarePlanBySession.get(sessionId);
    }

    private reconcileCapabilityGap(input: string, taskType: TaskType, hypothesis: ResolutionProposal): ResolutionProposal {
        const requiredByTask = getRequiredCapabilitiesForTaskType(taskType);
        const requiredSemantic = new Set<string>(deriveCapabilitiesFromInput(input));
        const requiredRuntime = new Set<string>(requiredByTask);

        const fromHypothesis = [
            ...(hypothesis.gap?.missing || []),
            ...(hypothesis.gap?.resource ? [hypothesis.gap.resource] : [])
        ];

        for (const item of fromHypothesis) {
            const mapped = normalizeCapability(item);
            if (mapped) {
                requiredSemantic.add(mapped);
            }
        }

        const dynamicIndex = skillManager.getCapabilityIndex();
        const capabilityResolutionByCapability: Record<string, {
            runtimeSkills: string[];
            mappedSkills: string[];
            candidateSkills: string[];
            availableSkills: string[];
            realMissing: boolean;
        }> = {};
        const candidateSkillsByCapability: Record<string, string[]> = {};
        const availableSkillIds = skillManager.listSkillIds();

        for (const semanticCapability of requiredSemantic) {
            const runtimeSkills = dynamicIndex[semanticCapability] || [];
            const mappedSkills = getCandidateSkillsForCapability(semanticCapability);
            const candidateSkills = Array.from(new Set([
                ...runtimeSkills,
                ...mappedSkills
            ]));
            const availableSkills = candidateSkills.filter(skillId => skillManager.hasSkill(skillId));
            const realMissing = availableSkills.length === 0;

            capabilityResolutionByCapability[semanticCapability] = {
                runtimeSkills,
                mappedSkills,
                candidateSkills,
                availableSkills,
                realMissing
            };
            candidateSkillsByCapability[semanticCapability] = candidateSkills;

            this.logger.info('capability_awareness_reconciled', '[ORCHESTRATOR] Capability awareness reconciliado com runtime como fonte primaria', {
                capability: semanticCapability,
                runtimeSkills,
                mappedSkills,
                candidateSkills,
                availableSkills,
                realMissing
            });

            if (realMissing) {
                for (const runtimeCapability of getRuntimeRequirementsForCapability(semanticCapability)) {
                    requiredRuntime.add(runtimeCapability);
                }
            }
        }

        const requiredCapabilities = Array.from(requiredRuntime);
        const availableCapabilities = requiredCapabilities.filter(capability =>
            capabilityRegistry.isAvailable(capability as any)
        );
        const missingRuntimeCapabilities = requiredCapabilities.filter(capability =>
            !capabilityRegistry.isAvailable(capability as any)
        );

        const semanticMissing = Array.from(requiredSemantic).filter(capability => {
            const runtimeRequirements = getRuntimeRequirementsForCapability(capability);
            if (runtimeRequirements.length > 0) {
                return false;
            }

            return capabilityResolutionByCapability[capability]?.realMissing ?? true;
        });

        const missingCapabilities = Array.from(new Set([...missingRuntimeCapabilities, ...semanticMissing]));

        this.logger.debug('capability_awareness_reconciled', '[ORCHESTRATOR] Reconciliando hipótese de gap com estado real do registry', {
            input,
            taskType,
            requiredSemanticCapabilities: Array.from(requiredSemantic),
            requiredCapabilities,
            dynamicIndex,
            capabilityResolutionByCapability,
            candidateSkillsByCapability,
            availableSkillIds,
            availableCapabilities,
            missingCapabilities,
            hypothesisHasGap: hypothesis.hasGap,
            hypothesisMissing: hypothesis.gap?.missing || []
        });

        if (missingCapabilities.length === 0) {
            return {
                hasGap: false,
                status: CapabilityStatus.AVAILABLE
            };
        }

        const primaryMissing = missingCapabilities[0];

        return {
            hasGap: true,
            status: CapabilityStatus.MISSING,
            gap: {
                resource: primaryMissing,
                reason: hypothesis.gap?.reason || 'Missing required capabilities for current task',
                task: hypothesis.gap?.task || taskType,
                severity: hypothesis.gap?.severity || 'blocking',
                missing: missingCapabilities,
                installSuggestions: hypothesis.gap?.installSuggestions
            },
            solution: hypothesis.solution
        };
    }

    private emitFinalDecisionRecommended(params: {
        sessionId: string;
        strategy: CognitiveStrategy;
        reason: string;
        capabilityAwarePlan: CapabilityAwarePlan;
    }): void {
        emitDebug('final_decision_recommended', buildFinalDecisionRecommendedPayload(params));
    }

    // ─────────────────────────────────────────────────────────────────────────
    // ── SIGNAL INGESTION  (passive observation) ─────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

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
        const ingestedSignalSummary: IngestedSignalSummary = buildIngestedSignalSummary({ signals });

        this.logger.info('signals_ingested_passive_mode', '[ORCHESTRATOR PASSIVE] Consumindo signals do AgentLoop', {
            sessionId,
            ...ingestedSignalSummary
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

        const observedSignalLogEntries: ObservedSignalLogEntry[] = buildObservedSignalLogEntries({
            sessionId,
            signals,
            toolSelectionObservedMessage: t('agent.kb024.tool_selection_signal_observed')
        });

        for (const entry of observedSignalLogEntries) {
            this.logger.info(entry.event, entry.message, entry.payload);
        }
    }

    /**
     * SAFE MODE: Ingest self-healing signal from AgentExecutor in passive mode.
     * The Orchestrator only observes and logs. No decision or override is applied.
     */
    public ingestSelfHealingSignal(signal: Readonly<SelfHealingSignal>, sessionId: string): void {
        this.observedSelfHealingSignal = { ...signal };

        this.logger.info(
            'signal_self_healing_observed',
            '[ORCHESTRATOR PASSIVE] SelfHealingSignal observado',
            buildSelfHealingObservedPayload({
                sessionId,
                signal
            })
        );
    }

    /**
     * KB-020 Fase 1 — PASSIVE MODE: ingesta RepairStrategySignal do executor.
     * Apenas observa e loga. Nenhuma decisão é tomada nesta fase.
     */
    public ingestRepairStrategySignal(signal: Readonly<RepairStrategySignal>, sessionId: string): void {
        this.observedRepairStrategySignal = { ...signal };

        this.logger.info(
            'repair_strategy_signal_received',
            '[ORCHESTRATOR PASSIVE] RepairStrategySignal observado',
            buildRepairStrategySignalReceivedPayload({
                sessionId,
                signal
            })
        );
    }

    /**
     * KB-020 Fase 3 — Observa resultado real da pipeline de repair (passivo).
     * Permite que decideRepairStrategy tome decisão completa (abort/continue).
     */
    public ingestRepairResult(result: Readonly<{ success: boolean; hasRepairedPlan: boolean }>, sessionId: string): void {
        this._observedRepairResult = { ...result };
        this.logger.info(
            'repair_result_ingested',
            '[ORCHESTRATOR PASSIVE] RepairResult observado',
            buildRepairResultIngestedPayload({
                sessionId,
                result
            })
        );
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

        let orchestratorDecision: RepairStrategyDecisionValue;
        let reason: RepairStrategyDecisionReason = 'insufficient_context';

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

        emitDebug('repair_strategy_decision', buildRepairStrategyDecisionPayload({
            sessionId,
            orchestratorDecision,
            reason,
            repairSignal,
            repairResult,
            failSafeSignal,
            stopSignal
        }));

        this.logger.info('repair_strategy_active_decision', t('agent.repair.orchestrator_governed', {
            decision: orchestratorDecision ?? 'delegated'
        }), buildRepairStrategyActiveDecisionPayload({
            sessionId,
            reason,
            orchestratorDecision,
            repairSignal,
            repairResult,
            failSafeSignal,
            stopSignal
        }));

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
        const { orchestratorDecision, reason } = decideRetryAfterFailureDecision({
            selfHealing: selfHealingSignal,
            failSafe: failSafeSignal,
            stopContinue: stopSignal,
            validation: validationSignal
        });

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

        emitDebug('signal_authority_resolution', buildRetryAfterFailureAuthorityResolutionPayload({
            sessionId,
            authorityDecision,
            finalDecision
        }));

        emitDebug('retry_decision', buildRetryDecisionPayload({
            sessionId,
            attempt,
            orchestratorDecision,
            executorDecision,
            finalDecision
        }));

        this.logger.info('self_healing_active_decision', '[ORCHESTRATOR ACTIVE] Governança de self-healing avaliada', {
            ...buildSelfHealingActiveDecisionPayload({
                sessionId,
                selfHealingSignal,
                failSafeSignal,
                stopSignal,
                validationSignal,
                finalDecision,
                reason
            })
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
        const logEntries: ObservedStopSignalLogEntry[] = buildObservedStopSignalLogEntries({
            sessionId,
            signal
        });

        // TODO (Single Brain): This is where the Orchestrator will decide in active mode.
        // For now, we just observe:
        for (const entry of logEntries) {
            this.logger.info(entry.event, entry.message, entry.payload);
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

        const selfHealing = this.observedSelfHealingSignal;
        const stopContinue = signals.stop;
        const failSafe = signals.failSafe;
        const validation = signals.validation;
        const route = signals.route;
        const fallback = signals.fallback;
        const llmRetry = signals.llmRetry;
        const reclassification = signals.reclassification;
        const planAdjustment = signals.planAdjustment;

        const conflicts = detectSignalConflicts({
            selfHealing,
            stopContinue,
            failSafe,
            validation,
            route,
            fallback,
            llmRetry,
            reclassification,
            planAdjustment,
            routeVsFailSafeConflictLoggedInCycle: this.routeVsFailSafeConflictLoggedInCycle
        });

        for (const conflict of conflicts) {
            this._reportSignalConflict(conflict.conflict, sessionId, conflict.severity, conflict.details);

            if (conflict.conflict === 'route_autonomy_vs_fail_safe') {
                this.routeVsFailSafeConflictLoggedInCycle = true;
            }
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
        conflict: SignalConflictId,
        sessionId: string,
        severity: SignalConflictSeverity,
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

    // ─────────────────────────────────────────────────────────────────────────
    // ── ACTIVE DECISIONS ────────────────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

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

        const authorityResolutionPayload: RouteAutonomyAuthorityResolutionPayload =
            buildRouteAutonomyAuthorityResolutionPayload({
                sessionId,
                authorityDecision,
                routeSignal
            });

        emitDebug('signal_authority_resolution', authorityResolutionPayload);

        this.logger.info(
            'route_active_decision',
            '[ORCHESTRATOR ACTIVE] RouteAutonomy aplicada',
            buildRouteAutonomyActiveDecisionPayload({
                sessionId,
                routeSignal
            })
        );

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
    public decideCapabilityFallback(context: CapabilityFallbackContext): CapabilityFallbackDecision | undefined {
        const { sessionId, signal } = context;
        const decision = decideCapabilityFallbackDecision({ signal });

        if (!decision) {
            this.logger.debug('no_capability_fallback_signal_available', '[ORCHESTRATOR ACTIVE] Nenhum CapabilityFallback facts disponivel para decisao ativa', {
                sessionId
            });
        }

        return decision;
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
        const loop: ActiveDecisionSnapshot = {
            stop: this.observedSignals.stop,
            fallback: this.observedSignals.fallback,
            validation: this.observedSignals.validation,
            route: this.observedSignals.route,
            failSafe: this.observedSignals.failSafe
        };

        const orchestrator: ActiveDecisionSnapshot = {
            stop: this.decideStopContinue(sessionId),
            fallback: this.decideToolFallback(sessionId),
            validation: this.decideStepValidation(sessionId),
            route: this.decideRouteAutonomy(sessionId),
            failSafe: this.decideFailSafe(sessionId)
        };

        return buildActiveDecisionsResult({ loop, orchestrator });
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
                ...buildStopContinueContextualAdjustmentPayload({
                    sessionId,
                    baseDecision,
                    recoveryDecision,
                    context
                })
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
                ...buildStopContinueRecurrentFailurePayload({
                    sessionId,
                    baseDecision,
                    context
                })
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

        const auditContext: StopContinueGovernanceAuditContext = {
            attempt: context?.attempt,
            hasReactiveFailure: context?.hasReactiveFailure
        };

        emitDebug('signal_authority_resolution', buildStopContinueAuthorityResolutionPayload({
            sessionId,
            authorityDecision,
            finalDecision: authoritativeFinalDecision
        }));

        // Auditoria explícita de delta: registra apenas quando a decisão final muda
        // em relação ao signal base do loop (observabilidade sem alterar comportamento).
        const decisionDeltaPayload = buildStopContinueDecisionDeltaPayload({
            sessionId,
            baseDecision,
            finalDecision: authoritativeFinalDecision,
            context: auditContext
        });

        if (decisionDeltaPayload) {
            this.logger.debug('stop_continue_decision_delta', '[ORCHESTRATOR DECISION DELTA] Comparação explícita base vs final', {
                ...decisionDeltaPayload
            });
        }

        // ─── ACTIVE DECISION: Apply the signal directly ───────────────────
        // Base heuristics continuam no AgentLoop; o Orchestrator só aplica ajuste
        // contextual leve quando elegível, mantendo fallback e compatibilidade.
        this.logger.info('stop_continue_active_decision', '[ORCHESTRATOR ACTIVE] Decisão de parada/continuidade aplicada', {
            ...buildStopContinueActiveDecisionPayload({
                sessionId,
                finalDecision: authoritativeFinalDecision,
                adjustedDecision
            })
        });

        this._orchestratorAppliedDecisions.stop = authoritativeFinalDecision;

        return authoritativeFinalDecision;
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

    // ─────────────────────────────────────────────────────────────────────────
    // ── MAIN COGNITIVE DECISION FLOW ────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
     * Decide a melhor estratégia para processar o input do usuário.
     * Internaliza a recuperação de estado e a hierarquia de precedência.
     */
    async decide(cognitiveInput: CognitiveInput): Promise<CognitiveDecision> {
        const sessionId = cognitiveInput.sessionId;
        const text = cognitiveInput.input;

        // ── 1. RECUPERAÇÃO DE ESTADO (Internalizada) ───────────────────────
        let decision: CognitiveDecision | undefined;
        const currentSession = SessionManager.getSession(sessionId);
        
        if (!currentSession) {
            decision = { strategy: CognitiveStrategy.LLM, confidence: 0.5, reason: "session_not_found" };
            return this.consolidateAndReturn(decision, sessionId);
        }

        const cognitiveState = SessionManager.getCognitiveState(currentSession);
        const pendingAction = getPendingAction(currentSession);
        const reactiveState = cognitiveState.reactiveState;
        const inputGap = currentSession.last_input_gap;

        const match = IntentionResolver.resolve(text);
        const intent = match.type;
        const flowState = this.flowManager.getState() ?? cognitiveState.guidedFlowState;
        const precedence = buildDecisionPrecedenceContext({
            hasReactiveState: !!reactiveState,
            flowManagerInFlow: this.flowManager.isInFlow(),
            isInGuidedFlow: !!cognitiveState.isInGuidedFlow,
            pendingActionExists: !!pendingAction,
            intent,
            isIntentRelatedToTopic: IntentionResolver.isIntentRelatedToTopic(text, flowState?.topic || undefined)
        });

        // ── 2. HIERARQUIA DE PRECEDÊNCIA (Convergente) ───────────────────────

        // --- 2.1. RECOVERY (MÁXIMA PRIORIDADE) ---
        if (precedence.hasReactiveState) {
            this.logger.info('precedence_recovery', '[ORCHESTRATOR] Prioridade: Recovery');

            if (intent === 'STOP' || intent === 'DECLINE') {
                decision = { strategy: CognitiveStrategy.LLM, confidence: 1.0, reason: "user_cancelled_recovery", clearPendingAction: true };
            } else if (reactiveState.type === 'capability_missing' || reactiveState.type === 'execution_failed') {
                decision = {
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
        if (!decision && precedence.hasActiveFlow) {
            if (precedence.isFlowEscape) {
                this.logger.info('precedence_flow_interrupt', '[ORCHESTRATOR] Flow interrompido por topic shift');
                decision = {
                    strategy: CognitiveStrategy.INTERRUPT_FLOW,
                    confidence: 0.95,
                    reason: "topic_shift",
                    interruptionReason: "user_interruption"
                };
            } else {
                this.logger.info('precedence_flow', '[ORCHESTRATOR] Prioridade: Flow Ativo');
                decision = {
                    strategy: CognitiveStrategy.FLOW,
                    confidence: Math.max(0.85, flowState?.confidence || 0.9),
                    reason: "active_flow_continuity"
                };
            }
        }

        // --- 2.3. PENDING ACTION (CONFIRMAÇÃO) ---
        if (!decision && precedence.hasPendingAction && pendingAction) {
            const pendingActionId = pendingAction.id;
            this.logger.info('precedence_pending', '[ORCHESTRATOR] Prioridade: Pending Action');

            if (intent === 'CONFIRM' || intent === 'CONTINUE' || intent === 'EXECUTE') {
                decision = { strategy: CognitiveStrategy.EXECUTE_PENDING, confidence: 1.0, reason: "user_confirmed_pending", pendingActionId };
            } else if (intent === 'STOP' || intent === 'DECLINE') {
                decision = { strategy: CognitiveStrategy.CANCEL_PENDING, confidence: 1.0, reason: "user_declined_pending", pendingActionId };
            } else if (match.type === 'UNKNOWN' && text.length > 120) {
                decision = { strategy: CognitiveStrategy.LLM, confidence: 0.9, reason: "topic_shift_clearing_pending", clearPendingAction: true };
            }
        }

        // --- 2.4. FLOW START (nova intenção) ---
        if (!decision) {
            const flowIdToStart = precedence.canEvaluateFlowStart ? this.decideFlowStart(sessionId, text) : undefined;
            if (flowIdToStart) {
                this.logger.info('precedence_flow_start', '[ORCHESTRATOR] Prioridade: Início de Flow', {
                    sessionId,
                    flowId: flowIdToStart
                });
                decision = {
                    strategy: CognitiveStrategy.START_FLOW,
                    confidence: 0.9,
                    reason: 'flow_start_requested',
                    flowId: flowIdToStart
                };
            }
        }

        // --- 2.4.5. MEMORY INTROSPECTION (KB-048) ---
        // Prioridade cirúrgica: se for consulta de memória, intercepta antes do loop normal.
        if (!decision && (intent === 'MEMORY_QUERY' || intent === 'MEMORY_CHECK' || intent === 'MEMORY_STORE')) {
            this.logger.info('precedence_memory_introspection', '[ORCHESTRATOR] Prioridade: Introspecção de Memória', {
                intent
            });
            decision = await decideMemoryQueryDecision({
                sessionId,
                input: text,
                intent
            }, this.memoryService);
        }

        // --- 2.4.6. SMALL TALK (KB-049) ---
        // Bypass total para interações sociais (Oi, Tudo bem, etc)
        if (!decision && intent === 'SMALL_TALK') {
            this.logger.info('precedence_small_talk', '[ORCHESTRATOR] Prioridade: Small Talk (Fast Path)');
            decision = {
                strategy: CognitiveStrategy.LLM,
                type: 'small_talk',
                confidence: 1.0,
                reason: 'small_talk_fast_path',
                skipPlanning: true,
                skipToolLoop: true,
                usedInputGap: false
            };
        }

        // --- 2.5. NORMAL (DECISION HUB) ---
        if (!decision) {
            this.logger.info('precedence_normal', '[ORCHESTRATOR] Prioridade: Processamento Normal');

            if (cognitiveInput.intent?.mode === 'EXPLORATION') {
                this.logger.info('precedence_intent_exploration', '[ORCHESTRATOR] Intenção exploratória detectada', {
                    sessionId,
                    confidence: cognitiveInput.intent.confidence
                });

                decision = {
                    strategy: CognitiveStrategy.ASK,
                    confidence: cognitiveInput.intent.confidence,
                    reason: this.handleExploration(text)
                };
            } else {
                const classification = await this.taskClassifier.classify(text);
                const routeDecision = this.actionRouter.decideRoute(text, classification.type);
                const memoryHits = await this.safeMemoryQuery(text);

                const capabilityGapHypothesis = this.capabilityResolver.resolve(text, classification.type, routeDecision.nature, inputGap || undefined);
                const capabilityGap = this.reconcileCapabilityGap(text, classification.type, capabilityGapHypothesis);

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
                    riskLevel: this.resolveRiskLevel(classification.type, routeDecision.nature),
                    isDestructive: false,
                    isReversible: true,
                    confidence: aggregatedConfidence.score,
                    aggregatedConfidence,
                    cognitiveState,
                    nature: routeDecision.nature,
                    route: routeDecision.route,
                    intentSubtype: routeDecision.subtype,
                    capabilityGap,
                    pendingAction,
                    reactiveState
                });

                if (autonomyDecision === AutonomyDecision.ASK) {
                    this.emitFinalDecisionRecommended({
                        sessionId,
                        strategy: CognitiveStrategy.ASK,
                        reason: 'low_confidence_fallback',
                        capabilityAwarePlan
                    });
                    decision = {
                        strategy: CognitiveStrategy.ASK,
                        confidence: aggregatedConfidence.score,
                        reason: t('agent.orchestrator.ask.low_confidence_fallback'),
                        capabilityAwarePlan,
                        usedInputGap: !!inputGap
                    };
                } else if (autonomyDecision === AutonomyDecision.CONFIRM) {
                    decision = {
                        strategy: CognitiveStrategy.CONFIRM,
                        confidence: aggregatedConfidence.score,
                        reason: capabilityGap.hasGap ? "capability_gap_detected" : "high_risk_confirmation",
                        capabilityGap,
                        capabilityAwarePlan,
                        usedInputGap: !!inputGap
                    };
                } else if (routeDecision.nature === TaskNature.HYBRID) {
                    decision = {
                        strategy: CognitiveStrategy.HYBRID,
                        confidence: 0.9,
                        reason: "hybrid_informative_executable",
                        toolProposal: this.suggestHybridTool(text, classification.type),
                        capabilityAwarePlan,
                        usedInputGap: !!inputGap
                    };
                } else if (routeDecision.route === ExecutionRoute.TOOL_LOOP) {
                    decision = {
                        strategy: CognitiveStrategy.TOOL,
                        confidence: routeDecision.confidence,
                        reason: "tool_execution",
                        capabilityAwarePlan,
                        usedInputGap: !!inputGap
                    };
                } else {
                    decision = {
                        strategy: CognitiveStrategy.LLM,
                        confidence: routeDecision.confidence,
                        reason: "direct_response",
                        capabilityAwarePlan,
                        usedInputGap: !!inputGap
                    };
                }
            }
        }

        // ── 3. CONSOLIDAÇÃO DE EFEITOS (Single Brain Governance) ──────────────
        return this.consolidateAndReturn(decision, sessionId, inputGap);
    }

    /**
     * 🔒 RULE: All decisions MUST pass through consolidation layer.
     * Centraliza a validação final, o consumo de estado e o logging de auditoria.
     */
    private consolidateAndReturn(
        decision: CognitiveDecision | undefined, 
        sessionId: string, 
        inputGap?: any
    ): CognitiveDecision {
        // 1. INVARIANT CHECK (KB-048 refinement)
        if (!decision || !decision.strategy) {
            this.logger.error('critical_decision_failure', null, '[ORCHESTRATOR] Decision pipeline failed to converge', {
                sessionId,
                hasDecision: !!decision,
                strategy: decision?.strategy
            });
            throw new Error(`[CRITICAL] Decision pipeline failed to converge for session ${sessionId}`);
        }

        const currentSession = SessionManager.getSession(sessionId);

        // 2. STATE CONSUMPTION (Centralized)
        if (decision.usedInputGap && currentSession) {
            delete currentSession.last_input_gap;
            this.logger.info('consuming_input_gap', '[ORCHESTRATOR] Consumindo sinal de gap utilizado na decisão.', { 
                capability: inputGap?.capability,
                reason: decision.reason
            });
        }

        // 3. FINAL AUDIT LOG
        this.logger.debug('final_cognitive_decision', '[ORCHESTRATOR FINAL] Decisão cognitiva consolidada', {
            sessionId,
            strategy: decision.strategy,
            confidence: decision.confidence,
            reason: decision.reason,
            usedInputGap: decision.usedInputGap
        });

        return decision;
    }

    public decideFlowStart(sessionId: string, text: string): string | undefined {
        const availableFlows = FlowRegistry.listDefinitions();
        
        const decision: FlowStartDecision = decideFlowStartDecision({
            sessionId,
            input: text,
            availableFlows
        });

        if (decision.flowId) {
            this.logger.info('flow_start_active_decision', '[ORCHESTRATOR ACTIVE] Início de flow decidido', {
                sessionId,
                flowId: decision.flowId,
                confidence: decision.confidence,
                reason: decision.reason,
                match: decision.match
            });

            emitDebug('flow_start_decision', {
                sessionId,
                flowId: decision.flowId,
                confidence: decision.confidence,
                reason: decision.reason,
                match: decision.match,
                candidates: decision.candidates
            });

            return decision.flowId;
        }

        return undefined;
    }

    private async safeMemoryQuery(input: string) {
        try {
            return this.memoryService?.searchByContent(input, 5) || [];
        } catch {
            return [];
        }
    }

    private resolveRiskLevel(taskType: TaskType, nature: TaskNature): 'low' | 'medium' | 'high' {
        // PRINCÍPIO: Tipos que NÃO modificam o sistema são low risk.
        // Apenas ações destrutivas (delete, format, sudo) são high risk.
        const lowRiskTypes: TaskType[] = [
            'information_request',
            'conversation',
            'content_generation',
            'data_analysis',
            'file_search',
            'skill_installation'
        ];
        if (lowRiskTypes.includes(taskType)) {
            return 'low';
        }

        if (nature === TaskNature.INFORMATIVE) {
            return 'low';
        }

        // system_operation e file_conversion são medium (podem modificar o sistema)
        return 'medium';
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

    // ─────────────────────────────────────────────────────────────────────────
    // ── SEARCH GOVERNANCE  (KB-027) ─────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

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

    // ─────────────────────────────────────────────────────────────────────────
    // ── TOOL SELECTION & EXECUTION ──────────────────────────────────────────
    // ─────────────────────────────────────────────────────────────────────────

    /**
        * KB-024: governanca de selecao de tool em safe mode.
        *
        * O loop consulta este ponto e o Orchestrator pode recomendar ferramenta
        * quando houver sinal forte (exploration/positive candidate). Sem recomendacao,
        * retorna undefined para delegar ao loop local.
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

