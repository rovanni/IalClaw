import { LLMProvider, MessagePayload } from './ProviderFactory';
import { SkillRegistry } from './SkillRegistry';
import { createLogger } from '../shared/AppLogger';
import { emitDebug } from '../shared/DebugBus';
import { SessionManager } from '../shared/SessionManager';
import { CognitiveOrchestrator } from '../core/orchestrator/CognitiveOrchestrator';
import { t } from '../i18n';
import { classifyTask, getForcedPlanForTaskType, TaskType } from '../core/agent/TaskClassifier';
import { decideAutonomy, createAutonomyContext, AutonomyDecision } from '../core/autonomy';
import { TaskContextSignals } from '../core/context/TaskContextSignals';
import { getPlanExecutionValidator, PlanExecutionValidator } from '../core/validation/PlanExecutionValidator';
import { getDecisionHandler, clearDecisionHandler, DecisionHandler, DecisionRequest } from '../core/validation/DecisionHandler';
import { StepValidator, ValidationContext } from './StepValidator';
import { ToolReliability } from './ToolReliability';
import { ResultEvaluator } from './ResultEvaluator';
import { DecisionMemory, ToolDecision } from '../memory';
import { getActionRouter, ExecutionRoute } from '../core/autonomy/ActionRouter';
import { getSecurityPolicy } from '../core/policy/SecurityPolicyProvider';

export type AgentProgressEvent = {
    stage:
    | 'loop_started'
    | 'iteration_started'
    | 'llm_started'
    | 'llm_completed'
    | 'tool_started'
    | 'tool_completed'
    | 'tool_failed'
    | 'finalizing'
    | 'completed'
    | 'stopped'
    | 'failed'
    | 'planning'
    | 'executing_step';
    iteration?: number;
    tool_name?: string;
    duration_ms?: number;
};

export type ExecutionStep = {
    id: number;
    description: string;
    tool?: string;
    completed: boolean;
    failed: boolean;
    error?: string;
    result?: string;
};

export type ExecutionPlan = {
    goal: string;
    steps: ExecutionStep[];
    currentStepIndex: number;
    createdAt: number;
    triedPaths: string[];
    failedTools: Map<string, number>;
};

export type ExecutionContext = {
    currentPlan: ExecutionPlan | null;
    pathsTried: Set<string>;
    toolsFailed: Map<string, number>;
    lastToolResult: string | null;
    planTaskType: TaskType | null;
    currentStepIndex?: number;
};

export type StepValidation = {
    success: boolean;
    confidence: number;
    reason: string;
    needsLlm: boolean;
};

export type StepValidationSignal = {
    validationPassed: boolean;
    reason: 'step_validation_passed' | 'step_validation_failed';
    confidence: number;
    failureReason?: string;
    requiresLlmReview: boolean;
};

export type StepValidationResult = {
    validation: StepValidation;
    signal: StepValidationSignal;
};

export type ToolFallbackTrigger =
    | 'tool_repetition'
    | 'tool_failure_history'
    | 'memory_block'
    | 'reliability_risk'
    | 'retry_refinement';

export type ToolFallbackSignal = {
    trigger: ToolFallbackTrigger;
    fallbackRecommended: boolean;
    originalTool: string;
    suggestedTool?: string;
    reason:
    | 'fallback_available'
    | 'no_step_context'
    | 'no_fallback_available'
    | 'same_tool_only'
    | 'incompatible_fallback';
};

export type LlmRetrySignal = {
    retryRecommended: boolean;
    reason: 'needs_llm_validation' | 'step_succeeded' | 'failure_limit_reached';
    consecutiveFailures: number;
};

export type ReclassificationSignal = {
    reclassificationRecommended: boolean;
    reason: 'failure_limit_reached' | 'low_step_confidence' | 'classification_unchanged' | 'low_classifier_confidence' | 'attempt_limit_reached' | 'missing_input';
    suggestedTaskType: TaskType | null;
    confidence: number;
};

export type RouteAutonomySignal = {
    recommendedStrategy: 'DIRECT_LLM' | 'HYBRID' | 'ASK' | 'CONFIRM' | 'TOOL_LOOP';
    reason: 'low_risk_direct_llm' | 'orchestrator_hybrid' | 'autonomy_confirm' | 'autonomy_ask' | 'tool_loop_required';
    confidence: number;
    requiresUserConfirmation: boolean;
    requiresUserInput: boolean;
    suggestedTool?: string;
    route: ExecutionRoute;
    autonomyDecision: AutonomyDecision;
};

export type PlanAdjustmentSignal = {
    shouldAdjustPlan: boolean;
    reason: 'step_failed';
    suggestedActions: ['adjust_next_step', 'use_alternative_tool', 'change_strategy'];
    failedStep: string;
    failureReason: string;
};

export type PlanAdjustmentResult = {
    messages: MessagePayload[];
    signal: PlanAdjustmentSignal;
};

// ─── Stop/Continue Signal ────────────────────────────────────────────────────
// Formaliza a decisão de parar ou continuar o loop de execução.
// TODO: migrar tomada de decisão para CognitiveOrchestrator.
export type StopContinueSignal = {
    shouldStop: boolean;
    reason:
        | 'global_confidence_threshold_met'
        | 'over_execution_detected'
        | 'has_pending_steps_prevent_stop'
        | 'fail_safe_prevents_stop_has_pending_steps'
        | 'insufficient_steps'
        | 'execution_continues'
        | 'recurrent_failure_detected'
        | 'low_improvement_delta'
        | 'delta_check_continues'
        | 'insufficient_steps_for_delta'
        | 'insufficient_validations_for_delta'
        | 'invalid_confidence';
    globalConfidence?: number;
    stepCount?: number;
};

// ─── Fail-Safe Signal ────────────────────────────────────────────────────────
// Formaliza a decisão de ativar o modo fail-safe automático.
// TODO: migrar tomada de decisão para CognitiveOrchestrator.
export type FailSafeActivationTrigger =
    | 'intent_clear'
    | 'unknown_task_type'
    | 'generic_task_type'
    | 'force_type_override_disabled'
    | 'not_activated';

export type FailSafeSignal = {
    activated: boolean;
    trigger: FailSafeActivationTrigger;
};

// ─── Aggregated Cognitive Signals State ─────────────────────────────────────
// Consolida todos os signals ativos da iteração corrente num único ponto de
// leitura. Nenhuma lógica de decisão vive aqui — é apenas um espelho organizado
// do que já foi decidido localmente no AgentLoop.
// TODO: quando o CognitiveOrchestrator assumir, ele lerá/preencherá este estado
// em vez do AgentLoop fazer isso diretamente.
export type CognitiveSignalsState = {
    route?: RouteAutonomySignal;
    fallback?: ToolFallbackSignal;
    validation?: StepValidationSignal;
    stop?: StopContinueSignal;
    failSafe?: FailSafeSignal;
    // ETAPA 4 — signals extraídos do mini-brain do AgentLoop
    // AgentLoop ainda decide localmente (safe stage); Orchestrator consumirá em fase futura.
    reclassification?: ReclassificationSignal;
    llmRetry?: LlmRetrySignal;
    planAdjustment?: PlanAdjustmentSignal;
};

export type ExecutionMemoryEntry = {
    stepType: string;
    tool: string;
    success: boolean;
    context: string;
    timestamp: number;
};

export type ToolScore = {
    tool: string;
    score: number;
    successes: number;
    failures: number;
};

const EXECUTION_CLAIM_PATTERNS: RegExp[] = [
    /\binstalled\b/i,
    /\binstalad[oa]\b/i,
    /\badded\s+\d+\s+packages\b/i,
    /\bcreated\s+(file|project|artifact)\b/i,
    /\bcriad[oa]\s+com\s+sucesso\b/i,
    /\bexecuted\s+successfully\b/i,
    /\bexecu(tado|cao)\s+com\s+sucesso\b/i,
    /\bbuild\s+(successful|completed|ok)\b/i,
    /\bdeploy\s+(successful|completed|concluido|concluida)\b/i,
    /\b(npm\s+install|yarn\s+add|pnpm\s+add|pip\s+install)\b/i
];

const INSTALL_SUCCESS_CLAIM_PATTERNS: RegExp[] = [
    /\bskill\s+instalad[oa]\s+com\s+sucesso\b/i,
    /\binstalad[oa]\s+com\s+sucesso\b/i,
    /\binstalled\s+successfully\b/i,
    /\badded\s+\d+\s+packages\b/i
];

const INSTALL_EVIDENCE_PATTERNS: RegExp[] = [
    /OK:\s*(SKILL\.md|skill\.json|README\.md)\s+salvo\s+em\s+skills\/public\//i,
    /skills\/public\/[a-z0-9\-_]+\//i,
    /auditoria\s+(aprovada|concluida\s+com\s+sucesso)/i,
    /added\s+\d+\s+packages/i,
    /•\s+[a-z0-9\-_]+/i
];

const STEP_TOOL_MAPPING: Record<string, string[]> = {
    'localizar arquivo': ['list_directory', 'search_file', 'read_local_file'],
    'buscar arquivo': ['list_directory', 'search_file', 'read_local_file'],
    'procurar arquivo': ['list_directory', 'search_file'],
    'listar diretório': ['list_directory'],
    'ler arquivo': ['read_local_file'],
    'ler conteúdo': ['read_local_file'],
    'escrever arquivo': ['write_file'],
    'salvar arquivo': ['write_file'],
    'criar arquivo': ['write_file'],
    'criar diretório': ['create_directory'],
    'deletar arquivo': ['delete_file'],
    'remover arquivo': ['delete_file'],
    'mover arquivo': ['move_file'],
    'renomear arquivo': ['move_file'],
    'buscar na web': ['web_search'],
    'pesquisar': ['web_search'],
    'buscar URL': ['fetch_url'],
    'obter hora': ['get_system_time'],
    'instalar skill': ['write_skill_file', 'promote_skill_temp'],
    'identificar nome': ['web_search'],
    'verificar se já está instalada': ['list_directory'],
    'buscar skill': ['web_search'],
    'auditar skill': ['run_skill_auditor'],
    'verificar skill': ['read_audit_log'],
    'verificar instalação': ['list_directory'],
};

export type AgentMode = 'THINKING' | 'EXECUTION';

export const TASK_TOOL_MAP: Record<string, string[]> = {
    'file_conversion': ['file_convert', 'read_local_file', 'list_directory', 'run_python', 'exec_command'],
    'file_search': ['list_directory', 'search_file', 'read_local_file'],
    'content_generation': ['workspace_create_project', 'workspace_save_artifact'],
    'system_operation': ['exec_command', 'run_python', 'list_directory'],
    'web_search': ['web_search', 'fetch_url'],
};

export class AgentLoop {
    private llm: LLMProvider;
    private registry: SkillRegistry;
    private maxIterations = 4;
    private logger = createLogger('AgentLoop');
    private executionContext: ExecutionContext = {
        currentPlan: null,
        pathsTried: new Set(),
        toolsFailed: new Map(),
        lastToolResult: null,
        planTaskType: null
    };
    private executionMemory: ExecutionMemoryEntry[] = [];
    private readonly MAX_MEMORY_ENTRIES = 50;
    private originalInput: string = '';
    private currentTaskType: TaskType | null = null;
    private currentTaskConfidence: number = 0;
    private forcedTaskType: boolean = false;
    private stepValidations: number[] = [];
    private createdPaths: Set<string> = new Set();
    private actionTaken: boolean = false;
    private reclassificationAttempts: number = 0;
    private readonly MAX_RECLASSIFY_ATTEMPTS = 1;
    private readonly LOW_CONFIDENCE_THRESHOLD = 0.85;
    private readonly STEP_CONFIDENCE_THRESHOLD = 0.5;
    private readonly GLOBAL_CONFIDENCE_THRESHOLD = 0.8;
    private readonly MAX_STEPS_BEFORE_OVEREXECUTION_CHECK = 4;
    private lastStepResult: string = '';
    private mode: AgentMode = 'THINKING';
    private disableFollowUpQuestions: boolean = false;
    private refinementUsed: boolean = false;
    private readonly QUALITY_THRESHOLD = 0.5;

    private readonly MODE_TRANSITION_CONFIDENCE = 0.75;

    // Delta detection for marginal improvement
    private previousConfidence: number | null = null;
    private lowImprovementCount = 0;
    private readonly MIN_DELTA_THRESHOLD = 0.05;
    private readonly MAX_LOW_IMPROVEMENTS = 2;
    private decisionMemory: DecisionMemory | null = null;
    private failSafe: boolean = false;

    // ETAPA 5 — Orchestrator injetado pelo AgentController para governança ativa.
    // Safe mode: se não injetado, todas as decisões permanecem no AgentLoop.
    private orchestrator?: CognitiveOrchestrator;

    // Detecção de intenção incompleta
    // Agregação de signals — espelho do estado cognitivo ativo (sem lógica de decisão).
    // TODO: quando o CognitiveOrchestrator assumir, este estado será preenchido por ele.
    private currentSignals: CognitiveSignalsState = {};

    // Detecção de intenção incompleta
    private needsUserContext: boolean = false;
    private contextQuestion: string | undefined;
    private isContinuation: boolean = false;  // É continuação de tarefa anterior?

    // Gerenciamento de contexto contínuo
    private planValidator = getPlanExecutionValidator();
    private decisionHandler: DecisionHandler;
    private chatId: string = 'default';

    /**
     * [HYBRID] Executa uma resposta direta do LLM e adiciona uma sugestão de ferramenta.
     */
    private async executeHybridStrategy(userInput: string, initialMessages: MessagePayload[], suggestedTool?: string): Promise<{ answer: string; newMessages: MessagePayload[] }> {
        // 1. Gera a resposta informativa básica (mesmo que content_generation)
        const directResult = await this.executeContentGenerationDirect(userInput, initialMessages);

        // 2. Se houver ferramenta, anexa o CTA de ampliação
        if (suggestedTool) {
            const cta = t('hybrid.suggest_tool', { tool: suggestedTool });
            return {
                answer: `${directResult.answer}\n\n${cta}`,
                newMessages: directResult.newMessages
            };
        }

        return directResult;
    }

    /**
     * Detecta fonte de conteúdo no input (caminho de arquivo).
     */
    private detectSource(input: string): string | null {
        const filePathMatch = input.match(/\/[\w\-\.\/]+\.\w+/i);
        if (filePathMatch) {
            return filePathMatch[0];
        }

        const usarMatch = input.match(/usar\s+(?:o\s+)?(?:arquivo\s+)?([^\s,;.]+)/i);
        if (usarMatch) {
            return usarMatch[1];
        }

        const utilizarMatch = input.match(/utilizar\s+(?:o\s+)?([^\s,;.]+)/i);
        if (utilizarMatch) {
            return utilizarMatch[1];
        }

        return null;
    }

    /**
     * Verifica se tem todos os parâmetros necessários para o tipo de tarefa.
     */
    private hasRequiredParams(input: string, type: TaskType | null): boolean {
        // content_generation precisa de fonte de conteúdo
        if (type === 'content_generation') {
            // EXCEÇÃO: se o input pede scan/indexação ou varredura, não exige fonte imediata
            // (o agente pode começar listando o diretório raiz ou projeto)
            if (/\b(varredura|varedura|scan|indexar|mapear|listar)\b/i.test(input)) {
                return true;
            }

            const hasSource = /\b(usar|utilizar|com|arquivo|conte[úu]do)\b/i.test(input) ||
                /\/[\w\-\.\/]+\.(md|html|txt|json|pdf)/i.test(input);

            // SE É PERGUNTA (e não tem fonte), não exigir fonte imediata no classificador
            // Deixa o LLM responder a pergunta no loop normal
            if (!hasSource && (input.includes('?') || /^(como|qual|o que|você|voce)\b/i.test(input))) {
                return true;
            }

            return hasSource;
        }

        // file_conversion precisa de arquivo fonte e destino
        if (type === 'file_conversion') {
            const hasSource = /\/[\w\-\.\/]+\.(md|html|txt|json|pdf)/i.test(input);
            return hasSource;
        }

        // Outros tipos não precisam de parâmetros especiais
        return true;
    }

    /**
     * Detecta nível de risco baseado no tipo de tarefa e input.
     */
    private detectRiskLevel(type: TaskType | null, input: string): 'low' | 'medium' | 'high' {
        return getSecurityPolicy().detectRisk(input);
    }

    constructor(llm: LLMProvider, registry: SkillRegistry, decisionMemory?: DecisionMemory) {
        this.llm = llm;
        this.registry = registry;
        this.decisionMemory = decisionMemory || null;
        this.decisionHandler = getDecisionHandler('default');
    }

    public reset(): void {
        this.executionContext = {
            currentPlan: null,
            pathsTried: new Set(),
            toolsFailed: new Map(),
            lastToolResult: null,
            planTaskType: null
        };
        this.actionTaken = false;
        this.stepValidations = [];
        this.createdPaths.clear();
        let toolCallsCount = 0;
        this.reclassificationAttempts = 0;
        this.executionMemory = [];
        this.mode = 'THINKING';
        this.disableFollowUpQuestions = false;
        this.refinementUsed = false;
        this.previousConfidence = null;
        this.lowImprovementCount = 0;
        this.failSafe = false;
        this.needsUserContext = false;
        this.contextQuestion = undefined;
        this.currentTaskType = null;
        this.currentTaskConfidence = 0;
        this.isContinuation = false;
        this.lastStepResult = '';
    this.currentSignals = {};

        // Limpar histórico da sessão se for o padrão (evita vazamento em testes)
        const session = SessionManager.getCurrentSession();
        if (session && (session.conversation_id === 'default' || !session.conversation_id)) {
            session.conversation_history = [];
            session.pending_actions = [];
        }

        ToolReliability.reset();
    }

    public getProvider(): LLMProvider {
        return this.llm;
    }

    public getDecisionMemory(): DecisionMemory | null {
        return this.decisionMemory;
    }

    /** ETAPA 5 — Injeta o CognitiveOrchestrator para governança ativa dos 3 call sites. */
    public setOrchestrator(orchestrator: CognitiveOrchestrator): void {
        this.orchestrator = orchestrator;
    }

    private evaluateModeTransition(): void {
        if (this.mode === 'EXECUTION') return;

        const confidence = this.currentTaskConfidence;
        const classified = this.currentTaskType !== null && this.currentTaskType !== 'unknown' && this.currentTaskType !== 'generic_task';

        if (confidence >= this.MODE_TRANSITION_CONFIDENCE && classified) {
            this.mode = 'EXECUTION';
            this.disableFollowUpQuestions = true;
            this.logger.info('mode_transition', `[MODE] Transicionando para EXECUTION: confidence=${confidence.toFixed(2)}, type=${this.currentTaskType}`);
        }
    }

    private isUserIntentClear(input: string): boolean {
        const text = input.toLowerCase();

        return (
            text.includes("converter") ||
            text.includes("criar") ||
            text.includes("gerar") ||
            text.includes("buscar") ||
            text.includes("ler") ||
            text.includes("salvar")
        );
    }

    private getDefaultToolForInput(input: string): string {
        const text = input.toLowerCase();

        if (text.includes("converter")) return "file.convert";
        if (text.includes("criar") || text.includes("gerar")) return "write_file";
        if (text.includes("buscar") || text.includes("procurar")) return "search_file";
        if (text.includes("ler")) return "read_local_file";
        if (text.includes("salvar")) return "write_file";
        if (text.includes("listar")) return "list_directory";
        if (text.includes("deletar") || text.includes("remover")) return "delete_file";
        if (text.includes("web") || text.includes("pesquisar")) return "web_search";

        return "list_directory";
    }

    private isPlanCompatibleWithInput(): boolean {
        const plan = this.executionContext.currentPlan;
        if (!plan || !this.currentTaskType) return false;

        const hasPendingSteps = plan.steps.some(step => !step.completed && !step.failed);
        if (!hasPendingSteps) {
            this.logger.info('plan_completed', '[PLAN] Plano anterior já concluído, resetando para novo ciclo');
            return false;
        }

        const isSameTaskType = this.executionContext.planTaskType === this.currentTaskType;
        if (!isSameTaskType) {
            this.logger.info('plan_incompatible', `[PLAN] Tipo incompatível: plano=${this.executionContext.planTaskType}, atual=${this.currentTaskType}`);
            return false;
        }

        return true;
    }

    private resetExecutionState(): void {
        this.executionContext.currentPlan = null;
        this.executionContext.planTaskType = null;
        this.executionContext.pathsTried.clear();
        this.executionContext.toolsFailed.clear();
        this.executionContext.lastToolResult = null;
        this.logger.info('execution_state_reset', '[PLAN] Estado de execução resetado');
    }

    private ensureMinimalPlan(): void {
        if (this.executionContext.currentPlan && this.executionContext.currentPlan.steps.length > 0) {
            if (!this.isPlanCompatibleWithInput()) {
                this.resetExecutionState();
            } else {
                return;
            }
        }

        // Se não há tipo definido, usa plano mínimo genérico
        if (!this.currentTaskType || this.currentTaskType === 'unknown') {
            const forcedPlan = getForcedPlanForTaskType('unknown');
            this.executionContext.currentPlan = {
                goal: this.originalInput,
                steps: forcedPlan ? forcedPlan.map((desc, idx) => ({
                    id: idx + 1,
                    description: desc,
                    completed: false,
                    failed: false
                })) : [{ id: 1, description: 'analisar solicitação', completed: false, failed: false }],
                currentStepIndex: 0,
                createdAt: Date.now(),
                triedPaths: [],
                failedTools: new Map()
            };
            this.executionContext.planTaskType = this.currentTaskType;
            this.logger.warn('minimal_plan_unknown', '[PLAN] Tipo desconhecido - usando plano mínimo');
            return;
        }

        // generic_task AGORA TEM PLANO ÚTIL (não é mais "processar entrada")
        const forcedPlan = getForcedPlanForTaskType(this.currentTaskType);
        if (forcedPlan) {
            const steps = forcedPlan.map((desc, idx) => ({
                id: idx + 1,
                description: desc,
                completed: false,
                failed: false
            }));

            this.executionContext.currentPlan = {
                goal: this.originalInput,
                steps,
                currentStepIndex: 0,
                createdAt: Date.now(),
                triedPaths: [],
                failedTools: new Map()
            };
            this.executionContext.planTaskType = this.currentTaskType;

            this.logger.info('minimal_plan_created', `[PLAN] Plano mínimo criado para: ${this.currentTaskType}`);
        }
    }

    private executeNextStep(plan: ExecutionPlan): void {
        if (plan.currentStepIndex >= plan.steps.length) return;

        const step = plan.steps[plan.currentStepIndex];
        if (!step.tool) {
            step.tool = this.mapStepToTool(step.description);
        }

        this.logger.info('forced_step_execution', `[EXECUTE] Forçando execução do step: ${step.description} (tool: ${step.tool || 'none'})`);
    }

    private clearTaskContextIfDone(isCriticalFailure: boolean = false): void {
        const session = SessionManager.getSafeSession(this.chatId);
        // Não limpa o contexto se houver ações pendentes explícitas (esperando o usuário)
        if (session.pending_actions.length > 0) {
            return;
        }

        SessionManager.clearTaskContext(session);
        this.logger.info('task_context_cleared', '[CONTEXT] Contexto operacional limpo ' + (isCriticalFailure ? '(falha crítica)' : '(execução finalizada)'));
    }

    private buildRouteAutonomySignal(params: {
        decision: { route: ExecutionRoute; confidence: number };
        autonomyDecision: AutonomyDecision;
        isLowRisk: boolean;
        suggestedTool?: string;
        orchestrationStrategy?: string;
    }): RouteAutonomySignal {
        const { decision, autonomyDecision, isLowRisk, suggestedTool, orchestrationStrategy } = params;

        let routeSignal: RouteAutonomySignal;
        if (decision.route === ExecutionRoute.DIRECT_LLM && isLowRisk) {
            routeSignal = {
                recommendedStrategy: 'DIRECT_LLM',
                reason: 'low_risk_direct_llm',
                confidence: decision.confidence,
                requiresUserConfirmation: false,
                requiresUserInput: false,
                route: decision.route,
                autonomyDecision
            };
        } else if (orchestrationStrategy === 'hybrid') {
            routeSignal = {
                recommendedStrategy: 'HYBRID',
                reason: 'orchestrator_hybrid',
                confidence: decision.confidence,
                requiresUserConfirmation: false,
                requiresUserInput: false,
                suggestedTool,
                route: decision.route,
                autonomyDecision
            };
        } else if (autonomyDecision === AutonomyDecision.CONFIRM) {
            routeSignal = {
                recommendedStrategy: 'CONFIRM',
                reason: 'autonomy_confirm',
                confidence: decision.confidence,
                requiresUserConfirmation: true,
                requiresUserInput: false,
                route: decision.route,
                autonomyDecision
            };
        } else if (autonomyDecision === AutonomyDecision.ASK) {
            routeSignal = {
                recommendedStrategy: 'ASK',
                reason: 'autonomy_ask',
                confidence: decision.confidence,
                requiresUserConfirmation: false,
                requiresUserInput: true,
                route: decision.route,
                autonomyDecision
            };
        } else {
            routeSignal = {
                recommendedStrategy: 'TOOL_LOOP',
                reason: 'tool_loop_required',
                confidence: decision.confidence,
                requiresUserConfirmation: false,
                requiresUserInput: false,
                route: decision.route,
                autonomyDecision
            };
        }

        this.currentSignals.route = routeSignal;
        return routeSignal;
    }

    /** Expõe um snapshot imutável do estado de signals da iteração corrente. */
    public getSignalsSnapshot(): Readonly<CognitiveSignalsState> {
        return { ...this.currentSignals };
    }

    public async run(initialMessages: MessagePayload[], policy?: any): Promise<{ answer: string; newMessages: MessagePayload[] }> {
        const session = SessionManager.getCurrentSession();
        this.chatId = session?.conversation_id || 'default';
        this.reset();

        this.decisionHandler = getDecisionHandler(this.chatId);

        try {
            const result = await this.runInternal(initialMessages, policy);
            this.clearTaskContextIfDone();
            return result;
        } catch (err) {
            this.clearTaskContextIfDone(true);
            throw err;
        } finally {
            clearDecisionHandler(this.chatId);
        }
    }

    private async runInternal(initialMessages: MessagePayload[], policy?: any): Promise<{ answer: string, newMessages: MessagePayload[] }> {
        // ═══════════════════════════════════════════════════════════════════
        // TASK CONTEXT: Gerenciamento de estado contínuo
        // "O agente não está pensando em continuidade, está reagindo por mensagem."
        // ═══════════════════════════════════════════════════════════════════
        const userInput = initialMessages.filter(m => m.role === 'user').pop()?.content || '';
        const simpleCommandResponse = this.handleSimpleCommands(userInput);
        if (simpleCommandResponse) {
            return simpleCommandResponse;
        }

        this.setOriginalInput(userInput);

        // ═══════════════════════════════════════════════════════════════════
        // TASK CONTEXT: Verificar continuação ANTES de classificar
        // "O agente não está pensando em continuidade, está reagindo por mensagem."
        // ═══════════════════════════════════════════════════════════════════

        // Verificar se há execução em andamento (se há ações pendentes ou task context active)
        const currentSession = SessionManager.getSafeSession(this.chatId);
        const cognitiveState = SessionManager.getCognitiveState(currentSession);

        if (cognitiveState.taskContext?.active && !cognitiveState.isStable && !cognitiveState.hasPendingAction) {
            // Em progresso puramente
            this.logger.warn('task_in_progress', '[CONTEXT] Tarefa em andamento, aguarde');
            return {
                answer: t('context.task_in_progress'),
                newMessages: []
            };
        }

        // Recuperar idade da ultima ação concluída
        const lastCompletedAgeMs = currentSession.lastCompletedAction ? (Date.now() - currentSession.lastCompletedAction.completedAt) : undefined;

        // Verificar se contexto é VÁLIDO (recente + relevante) usando os Sinais puros
        const isContextValid = TaskContextSignals.detectContinuation(userInput, cognitiveState.taskContext, lastCompletedAgeMs);
        const hasActiveTask = cognitiveState.taskContext?.active === true;
        const hasValidPlan = this.executionContext.currentPlan !== null;

        // Verificar se última execução foi bem-sucedida
        const lastExecutionFailed = this.executionContext.toolsFailed.size > 0;

        if (isContextValid && (hasActiveTask || hasValidPlan) && !lastExecutionFailed) {
            // Contexto válido + tarefa ativa/plano válido + última execução OK → continuação
            const previousCtx = cognitiveState.taskContext;
            this.isContinuation = true;
            this.currentTaskType = previousCtx?.type as TaskType || null;
            this.currentTaskConfidence = 1.0;

            this.logger.info('continuation_detected', '[CONTEXT] Continuação detectada - contexto válido com tarefa ativa', {
                type: previousCtx?.type,
                hasSource: !!previousCtx?.data?.source
            });
        } else {
            // Contexto inválido, sem tarefa ativa, sem plano, ou última execução falhou → nova tarefa
            this.isContinuation = false;
            this.evaluateModeTransition();

            if (lastExecutionFailed) {
                this.logger.warn('previous_execution_failed', '[CONTEXT] Última execução falhou, resetando para nova tarefa');
            }
        }

        this.ensureMinimalPlan();

        // Atualizar contexto com tipo final
        const extractedData = TaskContextSignals.extractTaskData(userInput);
        SessionManager.updateTaskContext(currentSession, {
            type: this.currentTaskType || 'unknown',
            data: {
                ...cognitiveState.taskContext?.data,
                ...extractedData
            }
        });

        // Detectar fonte de conteúdo e adicionar ao contexto explicitamente via data
        const detectedSource = this.detectSource(userInput);
        if (detectedSource) {
            SessionManager.updateTaskContext(currentSession, {
                data: {
                    ...cognitiveState.taskContext?.data,
                    source: detectedSource
                }
            });
        }

        // Refresh cognitive state pós atualização inicial
        const updatedCognitiveState = SessionManager.getCognitiveState(currentSession);

        // ═══════════════════════════════════════════════════════════════════
        // AUTONOMY ENGINE: Decidir se EXECUTA, PERGUNTA ou CONFIRMA
        // ═══════════════════════════════════════════════════════════════════
        const actionRouter = getActionRouter();
        const decision = (policy as any)?.orchestrationResult?.route || actionRouter.decideRoute(userInput, this.currentTaskType);

        const autonomyCtx = createAutonomyContext(
            this.currentTaskType || 'unknown',
            {
                isContinuation: this.isContinuation,
                hasAllParams: updatedCognitiveState.taskContext?.data?.source ? true : this.hasRequiredParams(userInput, this.currentTaskType),
                riskLevel: this.detectRiskLevel(this.currentTaskType, userInput),
                isDestructive: false,
                isReversible: true,
                route: decision.route,
                nature: decision.nature
            }
        );

        // Injetar dados do router (com fallback para testes diretos onde currentTaskConfidence é 0)
        autonomyCtx.confidence = (this.currentTaskConfidence > 0) ? this.currentTaskConfidence : Math.max(decision.confidence, 0.92);
        autonomyCtx.intentSubtype = decision.subtype;

        const autonomyDecision = policy?.orchestrationResult?.autonomy || decideAutonomy(autonomyCtx);

        // Log da decisão (essencial para debug)
        this.logger.info('autonomy_decision', `[AUTONOMY] Decisão: ${autonomyDecision}`, {
            intent: autonomyCtx.intent,
            decision: autonomyDecision,
            hasAllParams: autonomyCtx.hasAllParams,
            riskLevel: autonomyCtx.riskLevel,
            isContinuation: autonomyCtx.isContinuation,
            confidence: autonomyCtx.confidence,
            subtype: autonomyCtx.intentSubtype,
            taskType: this.currentTaskType
        });

        // ═══════════════════════════════════════════════════════════════════
        // SHORT-CIRCUIT: content_generation / conversation / info (apenas se for puramente cognitivo)
        // ═══════════════════════════════════════════════════════════════════
        const orchestration = (policy as any)?.orchestrationResult;
        const isLowRisk = this.detectRiskLevel(this.currentTaskType, userInput) === 'low';
        const routeAutonomySignal = this.buildRouteAutonomySignal({
            decision,
            autonomyDecision,
            isLowRisk,
            suggestedTool: orchestration?.suggestedTool,
            orchestrationStrategy: orchestration?.strategy
        });

        this.logger.info('route_autonomy_signal_emitted', '[SIGNAL] Route/autonomy recommendation emitted', {
            strategy: routeAutonomySignal.recommendedStrategy,
            reason: routeAutonomySignal.reason,
            confidence: routeAutonomySignal.confidence,
            requires_confirmation: routeAutonomySignal.requiresUserConfirmation,
            requires_user_input: routeAutonomySignal.requiresUserInput,
            route: routeAutonomySignal.route,
            autonomy: routeAutonomySignal.autonomyDecision,
            suggested_tool: routeAutonomySignal.suggestedTool
        });

        this.orchestrator?.ingestSignalsFromLoop(this.getSignalsSnapshot(), this.chatId);

        // ═══════════════════════════════════════════════════════════════════
        // GOVERNANÇA DO SHORT-CIRCUIT — Detectar intenção de execução real
        // antes de permitir curto-circuito. Safe mode: orchestratorDecision ?? loopDecision
        // ═══════════════════════════════════════════════════════════════════
        const planForIntent = this.executionContext.currentPlan;
        const planRequiresTools = planForIntent?.steps?.some(
            step => !!this.mapStepToTool(step.description)
        ) || false;
        const inputMentionsSkill = /\bskill\b/i.test(userInput);
        const hasExecutionIntent = planRequiresTools || inputMentionsSkill;

        const loopDecision = !hasExecutionIntent;
        const orchestratorDecision = this.orchestrator?.decideDirectExecution({
            sessionId: this.chatId,
            context: {
                hasExecutionIntent,
                strategy: routeAutonomySignal.recommendedStrategy,
                taskType: this.currentTaskType
            }
        });
        const finalDirectDecision = orchestratorDecision ?? loopDecision;

        this.logger.info('short_circuit_governance', '[GOVERNANCE] Governança do short-circuit avaliada', {
            hasExecutionIntent,
            planRequiresTools,
            inputMentionsSkill,
            loopDecision,
            orchestratorDecision: orchestratorDecision ?? 'undefined',
            finalDirectDecision,
            strategy: routeAutonomySignal.recommendedStrategy
        });

        // TODO (Single Brain): RouteAutonomySignal deve ser decidido pelo CognitiveOrchestrator.
        // AgentLoop deve apenas executar a estrategia ja definida.
        if (routeAutonomySignal.recommendedStrategy === 'DIRECT_LLM') {
            if (finalDirectDecision) {
                this.logger.info('short_circuit_activated', '[SHORT-CIRCUIT] Execução direta ativada (baixo risco + rota LLM)', {
                    mode: 'cognitive_direct',
                    bypass_loop: true,
                    task_type: this.currentTaskType
                });
                return this.executeContentGenerationDirect(userInput, initialMessages);
            }
            this.logger.info('short_circuit_blocked', '[GOVERNANCE] Short-circuit bloqueado — intenção de execução detectada, continuando para loop', {
                hasExecutionIntent,
                task_type: this.currentTaskType
            });
        }

        // ═══════════════════════════════════════════════════════════════════
        // 🧠 HYBRID STRATEGY: Resposta direta + Sugestão de Tool
        // ═══════════════════════════════════════════════════════════════════
        if (routeAutonomySignal.recommendedStrategy === 'HYBRID') {
            if (finalDirectDecision) {
                const suggestedTool = routeAutonomySignal.suggestedTool;
                this.logger.info('hybrid_strategy_activated', '[HYBRID] Estratégia híbrida ativada', {
                    suggestedTool,
                    taskType: this.currentTaskType
                });
                return this.executeHybridStrategy(userInput, initialMessages, suggestedTool);
            }
            this.logger.info('hybrid_blocked', '[GOVERNANCE] Estratégia híbrida bloqueada — intenção de execução detectada, continuando para loop', {
                hasExecutionIntent,
                task_type: this.currentTaskType
            });
        }

        // ═══════════════════════════════════════════════════════════════════
        // 🔴 CONFIRM: Ação destrutiva ou risco alto → confirmar
        // ═══════════════════════════════════════════════════════════════════
        if (routeAutonomySignal.recommendedStrategy === 'CONFIRM') {
            this.logger.warn('autonomy_confirm_required', '[AUTONOMY] Ação requer confirmação', {
                taskType: this.currentTaskType,
                riskLevel: autonomyCtx.riskLevel
            });
            return {
                answer: t('autonomy.confirm_action', { action: this.currentTaskType }),
                newMessages: []
            };
        }

        // ═══════════════════════════════════════════════════════════════════
        // 🟡 ASK: Falta informação → perguntar (específico por tipo)
        // ═══════════════════════════════════════════════════════════════════
        if (routeAutonomySignal.recommendedStrategy === 'ASK') {
            this.logger.info('autonomy_ask', '[AUTONOMY] Informação necessária', {
                taskType: this.currentTaskType,
                missing: !autonomyCtx.hasAllParams ? 'params' : 'context'
            });

            // Mensagem específica por tipo de tarefa
            if (this.currentTaskType === 'content_generation') {
                return { answer: t('content.ask_for_source'), newMessages: [] };
            }

            if (this.currentTaskType === 'file_conversion') {
                return { answer: t('file.ask_for_source'), newMessages: [] };
            }

            if (this.currentTaskType === 'file_search') {
                return { answer: t('file.ask_search_query'), newMessages: [] };
            }

            if (this.currentTaskType === 'data_analysis') {
                return { answer: t('data.ask_for_source'), newMessages: [] };
            }

            // Tratamento especial para comandos simples ou perguntas informativas
            if (userInput.startsWith('/help')) {
                return {
                    answer: t('agent.command.help'),
                    newMessages: []
                };
            }

            if (userInput.startsWith('/status')) {
                const ctx = SessionManager.getSession(this.chatId)?.task_context;
                return {
                    answer: t('agent.command.status', {
                        sessionId: this.chatId,
                        project: ctx?.data?.source || 'Nenhum',
                        messages: initialMessages.length
                    }),
                    newMessages: []
                };
            }

            if (/só tem esses comandos\?|quais comandos existem\?/i.test(userInput)) {
                return {
                    answer: t('agent.command.help'),
                    newMessages: []
                };
            }

            // Fallback genérico
            return { answer: t('autonomy.ask_context'), newMessages: [] };
        }

        // Se a rota for TOOL_LOOP, mas o tipo for content_generation, loggar o motivo
        if (this.currentTaskType === 'content_generation' && routeAutonomySignal.recommendedStrategy === 'TOOL_LOOP' && decision.route === ExecutionRoute.TOOL_LOOP) {
            this.logger.info('bypass_short_circuit', '[ROUTER] Pulando short-circuit de content_generation: ação detectada no input', {
                subtype: decision.subtype,
                confidence: decision.confidence
            });
        }

        // ═══════════════════════════════════════════════════════════════════
        // EXPLICABILIDADE: Simular plano antes de agir
        // ═══════════════════════════════════════════════════════════════════
        const planExplanation = await this.simulatePlan(userInput, decision.subtype);
        this.logger.info('action_plan_simulated', '[COGNITIVE] Plano simulado para o usuário', { explanation: planExplanation });

        // ═══════════════════════════════════════════════════════════════════
        // FLUXO NORMAL: Outros tipos de tarefa usam loop
        // ═══════════════════════════════════════════════════════════════════
        const maxIter = policy?.limits?.max_steps || this.maxIterations;
        const maxTools = policy?.limits?.max_tool_calls || 3;
        const timeoutMs = 30000; // 30 segundos
        let toolCallsCount = 0;
        let consecutiveToolFailures = 0;
        const toolEvidence: string[] = [];
        const startedAt = Date.now();
        let lastToolName: string | null = null;
        let toolRepeatCount = 0;
        let totalResponseLength = 0;

        let toolsDefinition = this.registry.getDefinitions();

        // Apply policy to tools
        if (policy?.tool_policy) {
            toolsDefinition = toolsDefinition.filter(t => {
                if (policy.tool_policy.deny?.includes(t.name)) return false;
                if (policy.tool_policy.allow && policy.tool_policy.allow.length > 0) {
                    return policy.tool_policy.allow.includes(t.name);
                }
                return true;
            });

            const priority = policy.tool_policy.priority || [];
            if (priority.length > 0) {
                toolsDefinition.sort((a, b) => {
                    const idxA = priority.indexOf(a.name);
                    const idxB = priority.indexOf(b.name);
                    if (idxA === -1 && idxB === -1) return 0;
                    if (idxA === -1) return 1;
                    if (idxB === -1) return -1;
                    return idxA - idxB;
                });
            }
        }

        let messages = [...initialMessages];
        const newMessages: MessagePayload[] = [];

        if (this.failSafe) {
            this.logger.warn('fail_safe_mode', '[FAIL-SAFE] Modo de execução garantida ativado');
        }

        this.evaluateModeTransition();

        this.ensureMinimalPlan();

        if (this.currentTaskType && ['file_conversion', 'file_search', 'content_generation'].includes(this.currentTaskType)) {
            const workspaceHint: MessagePayload = {
                role: 'system',
                content: `[WORKSPACE] Tarefa de arquivo detectada (${this.currentTaskType}). Prepare o workspace automaticamente se necessário.`
            };
            messages.push(workspaceHint);
        }

        if (this.currentTaskType === 'skill_installation') {
            const skillHint: MessagePayload = {
                role: 'system',
                content: `[SKILL INSTALLATION] Para instalar skills: use 'list_directory' para verificar se já existe, 'web_search' para buscar, e 'write_skill_file' para salvar. NÃO use fetch_url para instalação.`
            };
            messages.push(skillHint);
        }

        messages = this.addPlanningGuidanceToMessages(messages, policy);

        const progressCb = typeof policy?.progress?.onEvent === 'function'
            ? policy.progress.onEvent as ((event: AgentProgressEvent) => Promise<void> | void)
            : undefined;
        const shouldStop = typeof policy?.control?.shouldStop === 'function'
            ? policy.control.shouldStop as (() => boolean)
            : undefined;

        const emitProgress = async (event: AgentProgressEvent) => {
            if (!progressCb) return;
            try {
                await progressCb(event);
            } catch {
                // Non-critical: progresso não pode interromper o loop principal
            }
        };

        const stopIfRequested = async (): Promise<boolean> => {
            if (!shouldStop || !shouldStop()) {
                return false;
            }

            const stoppedAnswer = t('loop.stopped_by_user');
            const finalMsg: MessagePayload = { role: 'assistant', content: stoppedAnswer };
            newMessages.push(finalMsg);
            await emitProgress({ stage: 'stopped' });
            this.logger.warn('loop_stopped_by_user', t('log.loop.stopped_by_user'));
            return true;
        };

        this.logger.info('loop_started', t('log.loop.started'), {
            initial_messages: initialMessages.length,
            max_iterations: maxIter,
            max_tools: maxTools,
            available_tools: toolsDefinition.length
        });
        await emitProgress({ stage: 'loop_started' });

        if (await stopIfRequested()) {
            return { answer: t('loop.stopped_by_user'), newMessages };
        }

        const effectiveMaxIter = this.failSafe ? Math.min(maxIter, 3) : maxIter;

        for (let i = 0; i < effectiveMaxIter; i++) {
            if (await stopIfRequested()) {
                return { answer: t('loop.stopped_by_user'), newMessages };
            }

            if (this.executionContext.currentPlan && this.executionContext.currentPlan.currentStepIndex >= this.executionContext.currentPlan.steps.length) {
                this.logger.info('all_steps_exhausted', `[LOOP] Todos os steps foram executados, encerrando loop`);
                break;
            }

            // Verificar timeout global
            const elapsedTime = Date.now() - startedAt;
            if (elapsedTime > timeoutMs) {
                this.logger.warn('loop_timeout', t('log.loop.timeout'), {
                    elapsed_ms: elapsedTime,
                    timeout_ms: timeoutMs
                });
                break;
            }

            this.logger.debug('iteration_started', t('log.loop.iteration_started'), {
                iteration: i + 1,
                message_count: messages.length,
                tool_calls_count: toolCallsCount
            });
            await emitProgress({ stage: 'iteration_started', iteration: i + 1 });

            if (this.executionContext.currentPlan) {
                this.logCurrentPlan();
                await emitProgress({ stage: 'executing_step', iteration: i + 1 });
            }

            await emitProgress({ stage: 'llm_started', iteration: i + 1 });
            const response = await this.llm.generate(messages, toolsDefinition);
            await emitProgress({ stage: 'llm_completed', iteration: i + 1 });

            if (!this.executionContext.currentPlan && response.final_answer) {
                const plan = this.createPlanFromLLMResponse(response, messages);
                if (plan) {
                    this.logger.info('plan_parsed', '[PLAN] Plano estruturado detectado e criado', {
                        goal: plan.goal,
                        steps: plan.steps.length
                    });
                }
            }

            if (await stopIfRequested()) {
                return { answer: t('loop.stopped_by_user'), newMessages };
            }

            if (response.tool_call) {
                if (lastToolName === response.tool_call.name) {
                    toolRepeatCount++;
                    if (toolRepeatCount >= 2) {
                        this.logger.warn('tool_loop_detected', t('log.loop.tool_loop_detected'), {
                            tool_name: response.tool_call.name,
                            repeat_count: toolRepeatCount
                        });

                        const plan = this.executionContext.currentPlan;
                        const fallbackStep = plan && plan.currentStepIndex < plan.steps.length
                            ? plan.steps[plan.currentStepIndex]
                            : undefined;
                        const toolFallbackSignal = await this.buildToolFallbackSignal({
                            step: fallbackStep,
                            toolName: fallbackStep?.tool || response.tool_call.name,
                            trigger: 'tool_repetition'
                        });

                        this.logToolFallbackSignal(toolFallbackSignal);

                        if (toolFallbackSignal.fallbackRecommended && toolFallbackSignal.suggestedTool && plan) {
                            if (fallbackStep) {
                                // TODO (Single Brain): ToolFallbackSignal deve ser decidido pelo CognitiveOrchestrator.
                                // AgentLoop deve apenas aplicar a ferramenta alternativa ja recomendada.
                                fallbackStep.tool = toolFallbackSignal.suggestedTool;
                                this.logger.info('forced_tool_change', `[LOOP] Forçando ferramenta alternativa: ${toolFallbackSignal.suggestedTool}`);
                            }
                        }

                        // UX FIX: Interromper loop infinito de ferramenta e pedir elaboração
                        const loopAns = t('loop.tool_repeat_clarification');
                        const loopAnsMsg: MessagePayload = { role: 'assistant', content: loopAns };
                        newMessages.push(loopAnsMsg);
                        return { answer: loopAns, newMessages };
                    }
                } else {
                    lastToolName = response.tool_call.name;
                    toolRepeatCount = 1;
                }

                if (toolCallsCount >= maxTools) {
                    const blockMsg: MessagePayload = { role: 'tool', content: `[POLICY ENGINE] Tool call limite reached. Max: ${maxTools}` };
                    const assistBlock: MessagePayload = { role: 'assistant', content: `[Tentei executar ${response.tool_call.name} mas fui bloqueado pela Policy de limites]` };
                    messages.push(assistBlock, blockMsg);
                    newMessages.push(assistBlock, blockMsg);
                    this.logger.warn('tool_call_blocked', t('log.loop.tool_call_blocked'), {
                        iteration: i + 1,
                        tool_name: response.tool_call.name,
                        max_tools: maxTools
                    });
                    continue; // Pushes model to finalize answer
                }

                toolCallsCount++;
                try {
                    const plan = this.executionContext.currentPlan;
                    const currentStepForValidation = plan && plan.currentStepIndex < plan.steps.length
                        ? plan.steps[plan.currentStepIndex]
                        : undefined;
                    const validationContext: ValidationContext = {
                        safeMode: policy?.security?.safeMode ?? false,
                        currentPlan: plan ?? undefined
                    };

                    if (currentStepForValidation) {
                        const stepValidation = StepValidator.validate(currentStepForValidation, validationContext);
                        if (!stepValidation.plausible || stepValidation.risk === "high") {
                            this.logger.warn('step_validation_failed', `[VALIDATION] Step skipped: ${stepValidation.reason}`);
                            const skipMsg: MessagePayload = { role: 'tool', content: `[VALIDATION] Step skipped due to: ${stepValidation.reason}` };
                            messages.push(skipMsg);
                            continue;
                        }
                    }

                    const toolName = response.tool_call.name;
                    const contextKey = `${this.currentTaskType || 'unknown'}:${currentStepForValidation?.description || ''}`;

                    if (this.executionContext.toolsFailed.has(toolName)) {
                        this.logger.warn('tool_loop_prevented', `[LOOP] Tool já falhou: ${toolName}`);
                        const loopMsg: MessagePayload = { role: 'tool', content: `[LOOP] Tool ${toolName} already failed, selecting alternative` };
                        messages.push(loopMsg);

                        const toolFallbackSignal = await this.buildToolFallbackSignal({
                            step: currentStepForValidation,
                            toolName,
                            trigger: 'tool_failure_history'
                        });

                        this.logToolFallbackSignal(toolFallbackSignal);

                        if (toolFallbackSignal.fallbackRecommended && toolFallbackSignal.suggestedTool) {
                            // TODO (Single Brain): ToolFallbackSignal deve ser decidido pelo CognitiveOrchestrator.
                            // AgentLoop deve apenas aplicar a ferramenta alternativa ja recomendada.
                            this.logger.info('tool_fallback_loop', `[FALLBACK] ${toolName} → ${toolFallbackSignal.suggestedTool}`);
                            response.tool_call.name = toolFallbackSignal.suggestedTool;
                        } else {
                            continue;
                        }
                    }

                    if (!this.failSafe && await this.checkMemoryBlock(toolName)) {
                        const toolFallbackSignal = await this.buildToolFallbackSignal({
                            step: currentStepForValidation,
                            toolName,
                            trigger: 'memory_block'
                        });

                        this.logToolFallbackSignal(toolFallbackSignal);

                        if (toolFallbackSignal.fallbackRecommended && toolFallbackSignal.suggestedTool) {
                            // TODO (Single Brain): ToolFallbackSignal deve ser decidido pelo CognitiveOrchestrator.
                            // AgentLoop deve apenas aplicar a ferramenta alternativa ja recomendada.
                            this.logger.info('memory_fallback', `[MEMORY FALLBACK] ${toolName} → ${toolFallbackSignal.suggestedTool}`);
                            response.tool_call.name = toolFallbackSignal.suggestedTool;
                        } else {
                            this.logger.warn('memory_block_override', `[MEMORY] Tool ${toolName} com histórico ruim, mas executando mesmo assim`);
                        }
                    }

                    if (this.failSafe && await this.checkMemoryBlock(toolName)) {
                        this.logger.warn('fail_safe_override', '[FAIL-SAFE] Ignorando bloqueio de memória');
                    }

                    if (ToolReliability.shouldAvoid(toolName, contextKey)) {
                        if (this.failSafe) {
                            this.logger.warn('fail_safe_tool_override', `[FAIL-SAFE] Ignorando bloqueio de tool: ${toolName}`);
                        } else {
                            const toolFallbackSignal = await this.buildToolFallbackSignal({
                                step: currentStepForValidation,
                                toolName,
                                trigger: 'reliability_risk'
                            });

                            this.logToolFallbackSignal(toolFallbackSignal);

                            if (toolFallbackSignal.fallbackRecommended && toolFallbackSignal.suggestedTool) {
                                // TODO (Single Brain): ToolFallbackSignal deve ser decidido pelo CognitiveOrchestrator.
                                // AgentLoop deve apenas aplicar a ferramenta alternativa ja recomendada.
                                this.logger.info('tool_fallback', `[FALLBACK] ${toolName} → ${toolFallbackSignal.suggestedTool}`);
                                response.tool_call.name = toolFallbackSignal.suggestedTool;
                            } else {
                                this.logger.warn('fallback_override', `[RELIABILITY] Tool ${toolName} com problemas, mas executando mesmo assim - sem fallback válido`);
                            }
                        }
                    }

                    if (this.currentTaskType === 'skill_installation' && currentStepForValidation) {
                        const mappedTool = this.mapStepToTool(currentStepForValidation.description);
                        if (mappedTool && mappedTool !== toolName) {
                            this.logger.info('skill_installation_tool_override', `[FORCE TOOL] ${toolName} → ${mappedTool} (skill_installation mode)`);
                            response.tool_call.name = mappedTool;
                        }
                    }

                    this.logger.info('tool_call_started', t('log.loop.tool_call_started'), {
                        iteration: i + 1,
                        tool_name: response.tool_call.name,
                        tool_calls_count: toolCallsCount
                    });
                    await emitProgress({ stage: 'tool_started', iteration: i + 1, tool_name: response.tool_call.name });

                    const execToolName = response.tool_call.name;
                    if (!execToolName || execToolName.trim() === '') {
                        if (this.failSafe) {
                            this.logger.warn('fail_safe_tool', '[FAIL-SAFE] Selecionando tool padrão');
                            response.tool_call.name = this.getDefaultToolForInput(userInput);
                            this.logger.info('fail_safe_tool_selected', `[FAIL-SAFE] Tool selecionada: ${response.tool_call.name}`);
                        } else {
                            this.logger.warn('no_tool_available', 'Executando fallback básico - nenhuma tool_name disponível');
                            const fallbackResult = t('loop.fallback.default_answer');
                            const fallbackMsg: MessagePayload = { role: 'tool', content: fallbackResult };
                            messages.push(fallbackMsg);
                            newMessages.push(fallbackMsg);
                            continue;
                        }
                    }

                    let result = await this.registry.executeTool(execToolName, response.tool_call.args);

                    // ═════════════════════════════════════════════════════════════
                    // FIX: Garantir que resultados tipo objeto sejam stringificados
                    // ═══════════════════════════════════════════════════════════════
                    if (typeof result === 'object' && result !== null) {
                        result = JSON.stringify(result, null, 2);
                    }

                    const execPlan = this.executionContext.currentPlan;
                    const execStep = execPlan && execPlan.currentStepIndex < execPlan.steps.length
                        ? execPlan.steps[execPlan.currentStepIndex]
                        : undefined;

                    const evaluation = ResultEvaluator.evaluate(result);
                    const recordContext = `${this.currentTaskType || 'unknown'}:${execStep?.description || ''}`;

                    ToolReliability.record(execToolName, evaluation.success, recordContext);

                    if (evaluation.success && evaluation.quality > 0.8) {
                        this.logger.info('reinforce_tool', `[LEARNING] Tool reforçada por alto qualidade: ${execToolName} (quality=${evaluation.quality.toFixed(2)})`);
                    }

                    if (evaluation.success) {
                        this.executionContext.toolsFailed.delete(execToolName);
                    } else {
                        this.recordToolFailure(execToolName);
                    }

                    if (evaluation.quality < this.QUALITY_THRESHOLD && !this.refinementUsed) {
                        this.refinementUsed = true;

                        const refinedResult = await this.retryWithBetterParams(execStep, response.tool_call.args);

                        if (refinedResult) {
                            this.logger.info('refinement_success', '[REFINE] Active refinement completed successfully');
                            result = refinedResult;
                            const newEvaluation = ResultEvaluator.evaluate(result);
                            ToolReliability.record(execToolName, newEvaluation.success, recordContext);
                        } else {
                            this.logger.warn('refinement_failed', '[REFINE] Active refinement failed, using original result');
                        }
                    }

                    toolEvidence.push(String(result).slice(0, 2000));
                    consecutiveToolFailures = 0;

                    const assistantMsg: MessagePayload = {
                        role: 'assistant',
                        content: '',
                        tool_name: execToolName,
                        tool_args: response.tool_call.args
                    };
                    const toolMsg: MessagePayload = { role: 'tool', content: result };

                    messages.push(assistantMsg, toolMsg);
                    newMessages.push(assistantMsg, toolMsg);

                    this.logger.info('tool_call_completed', t('log.loop.tool_call_completed'), {
                        iteration: i + 1,
                        tool_name: execToolName,
                        result_length: result.length
                    });
                    await emitProgress({ stage: 'tool_completed', iteration: i + 1, tool_name: execToolName });

                    if (execStep) {
                        const validationResult = this.validateStepResult(execStep, result, execToolName);
                        const validation = validationResult.validation;
                        const stepValidationSignal = validationResult.signal;

                        this.logger.info('step_validation_signal_emitted', '[SIGNAL] Step validation recommendation emitted', {
                            reason: stepValidationSignal.reason,
                            confidence: stepValidationSignal.confidence,
                            validation_passed: stepValidationSignal.validationPassed,
                            requires_llm_review: stepValidationSignal.requiresLlmReview,
                            failure_reason: stepValidationSignal.failureReason
                        });

                        this.logValidation(execStep, validation);

                        this.stepValidations.push(validation.confidence);
                        this.actionTaken = true;

                        if (!stepValidationSignal.validationPassed) {
                            // TODO (Single Brain): StepValidationSignal deve ser decidido pelo CognitiveOrchestrator.
                            // AgentLoop deve apenas aplicar o resultado de validacao ja definido.
                            this.markCurrentStepFailed(validation.reason);

                            const reclassificationSignal = this.shouldReclassify(consecutiveToolFailures);
                            // ETAPA 4 — signal explícito de reclassificação registrado no snapshot cognitivo.
                            // AgentLoop ainda decide localmente (safe stage).
                            // TODO (Single Brain): delegar decisão ao CognitiveOrchestrator.
                            this.currentSignals.reclassification = reclassificationSignal;
                            this.orchestrator?.ingestSignalsFromLoop(this.getSignalsSnapshot(), this.chatId);
                            const loopDecisionReclassify = reclassificationSignal.reclassificationRecommended;
                            // ETAPA 5 — Orchestrator decide reclassificação (safe mode: undefined => fallback ao loop).
                            const orchestratorDecisionReclassify = this.orchestrator?.decideReclassification({
                                sessionId: this.chatId,
                                signal: reclassificationSignal
                            });
                            const finalDecisionReclassify = orchestratorDecisionReclassify ?? loopDecisionReclassify;
                            if (finalDecisionReclassify) {
                                this.logger.info('reclassification_signal_emitted', '[SIGNAL] Reclassification recommended', {
                                    reason: reclassificationSignal.reason,
                                    suggested_task_type: reclassificationSignal.suggestedTaskType,
                                    confidence: reclassificationSignal.confidence
                                });
                                messages = this.reclassifyAndAdjustPlan(messages);
                            }

                            const llmRetrySignal = this.shouldRetryWithLlm(validation, consecutiveToolFailures);
                            // ETAPA 4 — signal explícito de retry via LLM registrado no snapshot cognitivo.
                            // AgentLoop ainda decide localmente (safe stage).
                            // TODO (Single Brain): delegar decisão ao CognitiveOrchestrator.
                            this.currentSignals.llmRetry = llmRetrySignal;
                            this.orchestrator?.ingestSignalsFromLoop(this.getSignalsSnapshot(), this.chatId);
                            const loopDecisionLlmRetry = llmRetrySignal.retryRecommended;
                            // ETAPA 5 — Orchestrator decide retry via LLM (safe mode: undefined => fallback ao loop).
                            const orchestratorDecisionLlmRetry = this.orchestrator?.decideRetryWithLlm({
                                sessionId: this.chatId,
                                signal: llmRetrySignal
                            });
                            const finalDecisionLlmRetry = orchestratorDecisionLlmRetry ?? loopDecisionLlmRetry;
                            if (finalDecisionLlmRetry) {
                                const llmCheck: MessagePayload = {
                                    role: 'system',
                                    content: `[VALIDAÇÃO] O step "${execStep.description}" pode ter falhado: ${validation.reason}. Verifique se o resultado está correto e ajuste a estratégia se necessário.`
                                };
                                messages.push(llmCheck);
                            } else if (!validation.needsLlm) {
                                const planAdjustment = this.adjustPlanAfterFailure(messages, execStep, validation);
                                // ETAPA 4 — signal explícito de ajuste de plano registrado no snapshot cognitivo.
                                // AgentLoop aplica o ajuste localmente (safe stage).
                                // TODO (Single Brain): delegar decisão ao CognitiveOrchestrator.
                                this.currentSignals.planAdjustment = planAdjustment.signal;
                                this.orchestrator?.ingestSignalsFromLoop(this.getSignalsSnapshot(), this.chatId);
                                const loopDecisionPlanAdjust = planAdjustment.signal.shouldAdjustPlan;
                                // ETAPA 5 — Orchestrator decide ajuste de plano (safe mode: undefined => fallback ao loop).
                                const orchestratorDecisionPlanAdjust = this.orchestrator?.decidePlanAdjustment({
                                    sessionId: this.chatId,
                                    signal: planAdjustment.signal
                                });
                                const finalDecisionPlanAdjust = orchestratorDecisionPlanAdjust ?? loopDecisionPlanAdjust;
                                if (finalDecisionPlanAdjust) {
                                    messages = planAdjustment.messages;
                                    this.logger.info('plan_adjustment_signal_emitted', '[SIGNAL] Plan adjustment requested after step failure', {
                                        failed_step: planAdjustment.signal.failedStep,
                                        reason: planAdjustment.signal.reason,
                                        failure_reason: planAdjustment.signal.failureReason,
                                        suggested_actions: planAdjustment.signal.suggestedActions
                                    });
                                }
                            }
                        }

                        await this.registerExecutionMemory(
                            execStep,
                            execToolName,
                            validation.success,
                            validation.reason
                        );
                    }

                    // ═════════════════════════════════════════════════════════════
                    // RASTREAMENTO DE ARQUIVOS CRIADOS
                    // ═══════════════════════════════════════════════════════════════
                    this.trackCreatedPath(execToolName, response.tool_call.args, result);

                    if (response.tool_call.args?.path) {
                        this.recordPathTried(response.tool_call.args.path);
                    }

                    this.lastStepResult = result;
                    if (evaluation.success) {
                        this.advanceToNextStep();
                    }

                    const stepCount = this.executionContext.currentPlan?.currentStepIndex || 0;
                    const lastSuccessful = evaluation.success;
                    const globalConf = this.getGlobalConfidence(this.stepValidations);

                    if (this.mode === 'EXECUTION' && !lastSuccessful && globalConf < this.GLOBAL_CONFIDENCE_THRESHOLD) {
                        const fallbackHint: MessagePayload = {
                            role: 'system',
                            content: `[CONFIANÇA BAIXA] Tentativa não bem-sucedida. Tente FERRAMENTA ALTERNATIVA ou mude de estratégia. Não pare.`
                        };
                        messages.push(fallbackHint);
                        this.logger.info('low_confidence_action', `[ACTION] Confiança baixa=${globalConf.toFixed(2)}. Forçando tentativa alternativa.`);
                    } else if (lastSuccessful) {
                        const stopDecision = this.shouldStopExecution(lastSuccessful, stepCount);
                        this.currentSignals.stop = stopDecision;
                        this.orchestrator?.ingestSignalsFromLoop(this.getSignalsSnapshot(), this.chatId);
                        const orchestratorStopDecision = this.orchestrator?.decideStopContinue(this.chatId);
                        const finalStopDecision = orchestratorStopDecision ?? stopDecision;
                        if (finalStopDecision.shouldStop) {
                            this.logger.info('execution_stopped', `[STOP] ${finalStopDecision.reason} global_confidence=${globalConf.toFixed(2)}`);
                            break;
                        }
                    }

                    const deltaStopDecision = this.checkDeltaAndStop(stepCount);
                    this.currentSignals.stop = deltaStopDecision;
                    this.orchestrator?.ingestSignalsFromLoop(this.getSignalsSnapshot(), this.chatId);
                    const orchestratorDeltaStopDecision = this.orchestrator?.decideStopContinue(this.chatId);
                    const finalDeltaStopDecision = orchestratorDeltaStopDecision ?? deltaStopDecision;
                    if (finalDeltaStopDecision.shouldStop && this.mode !== 'EXECUTION') {
                        this.logger.info('execution_stopped_delta', `[STOP] ${finalDeltaStopDecision.reason} global_confidence=${globalConf.toFixed(2)}`);
                        break;
                    } else if (finalDeltaStopDecision.shouldStop && this.mode === 'EXECUTION') {
                        const forceMsg: MessagePayload = {
                            role: 'system',
                            content: `[MODO EXECUTION] Melhoria marginal detectada. Continue executando com a melhor ferramenta disponível.`
                        };
                        messages.push(forceMsg);
                        this.logger.info('delta_forced_continue', `[EXECUTION] Forçando continuidade após delta stop.`);
                    }

                    if (await stopIfRequested()) {
                        return { answer: t('loop.stopped_by_user'), newMessages };
                    }

                    continue;
                } catch (error: any) {
                    this.logger.error('tool_call_failed', error, t('log.loop.tool_call_failed'), {
                        iteration: i + 1,
                        tool_name: response.tool_call.name
                    });
                    await emitProgress({ stage: 'tool_failed', iteration: i + 1, tool_name: response.tool_call.name });

                    this.recordToolFailure(response.tool_call.name);
                    this.markCurrentStepFailed(error.message);

                    const currentStepForMem = this.executionContext.currentPlan?.steps[this.executionContext.currentPlan.currentStepIndex];
                    if (currentStepForMem) {
                        await this.registerExecutionMemory(
                            currentStepForMem,
                            response.tool_call.name,
                            false,
                            `Exceção: ${error.message}`
                        );
                    }

                    const errMsg: MessagePayload = { role: 'tool', content: t('loop.tool_execution_error', { message: error.message }) };
                    messages.push(errMsg);
                    newMessages.push(errMsg);
                    consecutiveToolFailures++;

                    if (this.shouldUseFallbackStrategy()) {
                        messages = this.addFallbackStrategyHint(messages);
                    }

                    if (consecutiveToolFailures >= 2) {
                        this.logger.warn('multiple_tool_failures_detected', '[LOOP] Detecção de falhas consecutivas de ferramenta');
                        const failureAns = t('loop.multiple_tool_failures_answer');
                        const failureAnsMsg: MessagePayload = { role: 'assistant', content: failureAns };
                        newMessages.push(failureAnsMsg);
                        return { answer: failureAns, newMessages };
                    }
                    continue;
                }
            }

            if (response.final_answer) {
                await emitProgress({ stage: 'finalizing', iteration: i + 1 });
                const sanitizedAnswer = this.sanitizeUserFacingAnswer(response.final_answer);
                const safeAnswer = this.applyExecutionClaimGuard(sanitizedAnswer, toolCallsCount, toolEvidence);
                const finalMsg: MessagePayload = { role: 'assistant', content: safeAnswer };
                messages.push(finalMsg);
                newMessages.push(finalMsg);
                const duration = Date.now() - startedAt;
                const finalAnswer = this.appendCreatedFiles(safeAnswer);
                this.logger.info('loop_completed', t('log.loop.completed'), {
                    duration_ms: duration,
                    iterations_used: i + 1,
                    tool_calls_count: toolCallsCount,
                    answer_length: finalAnswer.length
                });
                await emitProgress({ stage: 'completed', iteration: i + 1, duration_ms: duration });
                this.logMemoryStats();
                return { answer: finalAnswer, newMessages };
            }

            // Parada inteligente: se já há conteúdo suficiente acumulado
            totalResponseLength += (response.final_answer || '').length;
            if (totalResponseLength > 500 && toolCallsCount > 0) {
                this.logger.info('loop_smart_stop', t('log.loop.smart_stop'), {
                    total_response_length: totalResponseLength,
                    tool_calls: toolCallsCount
                });
                break;
            }
        }

        // ── Unificação Cognitiva: Salvar estado reativo se houver falha ────────
        const session = SessionManager.getSession(this.chatId);
        if (session) {
            const reactiveRequest = this.validatePlanAndDecide();
            if (reactiveRequest) {
                // Salvar o estado reativo processado pelo DecisionHandler
                session.reactive_state = this.decisionHandler.getReactiveState(this.planValidator.validatePlan());
                this.logger.info('reactive_state_stored', '[LOOP] Estado reativo salvo na sessão devido a falhas no plano');
            } else if (session.reactive_state) {
                // Se o plano agora teve sucesso, limpar estado reativo antigo
                delete session.reactive_state;
                this.logger.debug('reactive_state_cleared', '[LOOP] Estado reativo limpo - plano concluído com sucesso');
            }
        }

        // Graceful fallback: pedir ao LLM uma resposta final sem tools
        const hasPendingFallback = this.hasPendingSteps();
        this.logger.warn('loop_max_iterations_fallback', t('log.loop.max_iterations_fallback'), {
            duration_ms: Date.now() - startedAt,
            max_iterations: maxIter,
            tool_calls_count: toolCallsCount,
            fail_safe: this.failSafe,
            has_pending_steps: hasPendingFallback
        });

        if ((this.failSafe || hasPendingFallback) && toolCallsCount === 0) {
            this.logger.warn('fail_safe_final', '[FAIL-SAFE] Tentando execução direta por haver steps pendentes ou modo fail-safe');
            const defaultTool = this.getDefaultToolForInput(userInput);
            this.logger.info('fail_safe_tool_attempt', `[FAIL-SAFE] Tentando ferramenta: ${defaultTool}`);

            if (this.executionContext.currentPlan && this.executionContext.currentPlan.currentStepIndex < this.executionContext.currentPlan.steps.length) {
                const currentStep = this.executionContext.currentPlan.steps[this.executionContext.currentPlan.currentStepIndex];
                if (!currentStep.tool) {
                    currentStep.tool = this.mapStepToTool(currentStep.description) || defaultTool;
                }

                try {
                    this.logger.info('fail_safe_forced_execution', `[FAIL-SAFE] Forçando execução: ${currentStep.tool} para step "${currentStep.description}"`);
                    const forcedResult = await this.registry.executeTool(currentStep.tool, {});
                    const toolMsg: MessagePayload = { role: 'tool', content: forcedResult };
                    newMessages.push(toolMsg);
                    toolCallsCount++;

                    if (forcedResult && forcedResult.length > 0 && !forcedResult.toLowerCase().includes('erro')) {
                        this.advanceToNextStep();
                        const directAnswer = t('loop.fail_safe.forced_execution_result', {
                            step: currentStep.description,
                            result: forcedResult.slice(0, 500)
                        });
                        const finalMsg: MessagePayload = { role: 'assistant', content: directAnswer };
                        newMessages.push(finalMsg);
                        const duration = Date.now() - startedAt;
                        await emitProgress({ stage: 'completed', duration_ms: duration });
                        return { answer: directAnswer, newMessages };
                    }
                } catch (forcedError: any) {
                    this.logger.error('fail_safe_forced_error', forcedError as Error, '[FAIL-SAFE] Falha na execução forçada');
                }
            }

            const directAnswer = t('loop.fail_safe.direct_attempt', { input: userInput });
            const finalMsg: MessagePayload = { role: 'assistant', content: directAnswer };
            newMessages.push(finalMsg);
            const duration = Date.now() - startedAt;
            await emitProgress({ stage: 'completed', duration_ms: duration });
            return { answer: directAnswer, newMessages };
        }

        messages.push({
            role: 'system',
            content: t('loop.system.max_iterations')
        });

        try {
            await emitProgress({ stage: 'finalizing' });
            const fallbackResponse = await this.llm.generate(messages, []);
            const fallbackAnswer = fallbackResponse.final_answer || t('loop.fallback.default_answer');
            const sanitized = this.sanitizeUserFacingAnswer(fallbackAnswer);
            const finalMsg: MessagePayload = { role: 'assistant', content: sanitized };
            newMessages.push(finalMsg);
            const duration = Date.now() - startedAt;
            const finalAnswer = this.appendCreatedFiles(sanitized);
            this.logger.info('loop_completed_via_fallback', t('log.loop.completed_fallback'), {
                duration_ms: duration,
                answer_length: finalAnswer.length
            });
            await emitProgress({ stage: 'completed', duration_ms: duration });
            this.logMemoryStats();
            return { answer: finalAnswer, newMessages };
        } catch (fallbackError: any) {
            this.logger.error('loop_fallback_failed', fallbackError, t('log.loop.fallback_failed'), {
                duration_ms: Date.now() - startedAt
            });
            await emitProgress({ stage: 'failed' });
            this.logMemoryStats();

            if (this.failSafe) {
                const failSafeAnswer = t('loop.fail_safe.direct_attempt', { input: userInput });
                const failSafeMsg: MessagePayload = { role: 'assistant', content: failSafeAnswer };
                newMessages.push(failSafeMsg);
                return { answer: failSafeAnswer, newMessages };
            }

            return { answer: t('loop.fallback.default_answer'), newMessages };
        }
    }

    private applyExecutionClaimGuard(answer: string, toolCallsCount: number, toolEvidence: string[]): string {
        if (!this.hasExecutionClaim(answer)) {
            return answer;
        }

        if (toolCallsCount > 0 && this.hasGroundingEvidence(answer, toolEvidence)) {
            return answer;
        }

        emitDebug('execution_claim_blocked', {
            reason: toolCallsCount > 0 ? 'missing_grounding_evidence' : 'no_tool_call',
            response_preview: answer.slice(0, 200)
        });

        return this.injectRealityCheck(answer);
    }

    private hasExecutionClaim(text: string): boolean {
        return EXECUTION_CLAIM_PATTERNS.some(pattern => pattern.test(text));
    }

    private hasGroundingEvidence(answer: string, toolEvidence: string[]): boolean {
        const evidenceBlob = toolEvidence.join('\n');

        const claimsInstallSuccess = INSTALL_SUCCESS_CLAIM_PATTERNS.some(pattern => pattern.test(answer));
        if (claimsInstallSuccess) {
            return INSTALL_EVIDENCE_PATTERNS.some(pattern => pattern.test(evidenceBlob));
        }

        return toolEvidence.length > 0;
    }

    private injectRealityCheck(answer: string): string {
        const suffix = t('loop.reality_check_suffix');
        return `${answer.trimEnd()}${suffix}`;
    }

    private sanitizeUserFacingAnswer(answer: string): string {
        let cleaned = answer;

        // Remove vazamento de marcadores internos de tool-call e residuos XML-like do parser.
        cleaned = cleaned.replace(/\[Usando skill:[^\]]*\]/gi, '');
        cleaned = cleaned.replace(/<\/?arg_[a-z_]+>/gi, '');
        cleaned = cleaned.replace(/<\/?tool_call[^>]*>/gi, '');
        cleaned = cleaned.replace(/<\/?function[^>]*>/gi, '');
        cleaned = cleaned.trim();

        if (!cleaned) {
            return t('loop.empty_sanitized_answer');
        }

        return cleaned;
    }

    private createPlanFromLLMResponse(response: any, messages: MessagePayload[]): ExecutionPlan | null {
        const content = response.final_answer || '';

        const goalMatch = content.match(/goal[:\s]+["']?([^"\n]+)["']?/i);
        const stepsMatch = content.match(/steps[:\s]*\n?((?:\d+[.)]\s*[^"\n]+\n?)+)/i);

        if (!goalMatch || !stepsMatch) {
            return null;
        }

        const goal = goalMatch[1].trim();
        const stepLines = stepsMatch[1].split('\n').filter((l: string) => l.trim());
        const steps: ExecutionStep[] = stepLines.map((line: string, idx: number) => {
            const desc = line.replace(/^\d+[.)]\s*/, '').trim();
            return {
                id: idx + 1,
                description: desc,
                tool: this.mapStepToTool(desc),
                completed: false,
                failed: false
            };
        });

        const plan: ExecutionPlan = {
            goal,
            steps,
            currentStepIndex: 0,
            createdAt: Date.now(),
            triedPaths: [],
            failedTools: new Map()
        };

        this.executionContext.currentPlan = plan;
        this.executionContext.planTaskType = this.currentTaskType;
        this.executionContext.pathsTried.clear();
        this.executionContext.toolsFailed.clear();

        this.logger.info('plan_created', `[PLAN] Goal: ${goal}`, {
            step_count: steps.length,
            steps: steps.map((s: ExecutionStep) => s.description).join(' → ')
        });

        return plan;
    }

    private mapStepToTool(stepDescription: string): string | undefined {
        const lowerDesc = stepDescription.toLowerCase();

        for (const [key, tools] of Object.entries(STEP_TOOL_MAPPING)) {
            if (lowerDesc.includes(key)) {
                const bestFromMemory = this.getBestToolForStep(stepDescription, tools);
                if (bestFromMemory) {
                    return bestFromMemory;
                }

                for (const tool of tools) {
                    const failCount = this.executionContext.toolsFailed.get(tool) || 0;
                    if (failCount < 2) {
                        return tool;
                    }
                }
                return tools[0];
            }
        }
        return undefined;
    }

    private getNextStepFromLLM(messages: MessagePayload[], currentPlan: ExecutionPlan): ExecutionStep | null {
        if (currentPlan.currentStepIndex >= currentPlan.steps.length) {
            return null;
        }
        return currentPlan.steps[currentPlan.currentStepIndex];
    }

    private async buildToolFallbackSignal(params: {
        step?: ExecutionStep;
        toolName: string;
        trigger: ToolFallbackTrigger;
    }): Promise<ToolFallbackSignal> {
        if (!params.step) {
            return {
                trigger: params.trigger,
                fallbackRecommended: false,
                originalTool: params.toolName,
                reason: 'no_step_context'
            };
        }

        const fallbackTool = await this.getFallbackToolForStep(params.step);

        if (!fallbackTool) {
            return {
                trigger: params.trigger,
                fallbackRecommended: false,
                originalTool: params.toolName,
                reason: 'no_fallback_available'
            };
        }

        if (fallbackTool === params.toolName) {
            return {
                trigger: params.trigger,
                fallbackRecommended: false,
                originalTool: params.toolName,
                suggestedTool: fallbackTool,
                reason: 'same_tool_only'
            };
        }

        if (!this.isToolCompatible(params.step, fallbackTool)) {
            return {
                trigger: params.trigger,
                fallbackRecommended: false,
                originalTool: params.toolName,
                suggestedTool: fallbackTool,
                reason: 'incompatible_fallback'
            };
        }

        return {
            trigger: params.trigger,
            fallbackRecommended: true,
            originalTool: params.toolName,
            suggestedTool: fallbackTool,
            reason: 'fallback_available'
        };
    }

    private logToolFallbackSignal(signal: ToolFallbackSignal) {
        this.currentSignals.fallback = signal;
        this.logger.info('tool_fallback_signal_emitted', '[SIGNAL] Tool fallback recommendation emitted', {
            trigger: signal.trigger,
            original_tool: signal.originalTool,
            suggested_tool: signal.suggestedTool,
            fallback_recommended: signal.fallbackRecommended,
            reason: signal.reason
        });
    }

    private async getFallbackToolForStep(step: ExecutionStep): Promise<string | undefined> {
        const lowerDesc = step.description.toLowerCase();

        for (const [key, tools] of Object.entries(STEP_TOOL_MAPPING)) {
            if (lowerDesc.includes(key)) {
                const ranked = await this.rankToolsForStep(step, tools);

                for (const tool of ranked) {
                    if (this.executionContext.toolsFailed.has(tool)) continue;
                    if (!this.isToolCompatible(step, tool)) continue;
                    return tool;
                }

                return ranked[0];
            }
        }
        return undefined;
    }

    private isToolCompatible(step: ExecutionStep, tool: string): boolean {
        const desc = step.description.toLowerCase();

        if (desc.includes("ler") && !tool.includes("read")) return false;
        if (desc.includes("arquivo") && tool.includes("web")) return false;
        if (desc.includes("salvar") && !tool.includes("write")) return false;
        if (desc.includes("buscar") && !(tool.includes("search") || tool.includes("web"))) return false;

        return true;
    }

    private normalizeStep(step: string): string {
        const s = step.toLowerCase();

        if (s.includes("ler") || s.includes("read")) return "read";
        if (s.includes("buscar") || s.includes("search")) return "search";
        if (s.includes("salvar") || s.includes("write") || s.includes("criar")) return "write";
        if (s.includes("converter") || s.includes("convert")) return "convert";
        if (s.includes("listar") || s.includes("list")) return "list";
        if (s.includes("deletar") || s.includes("remover") || s.includes("delete")) return "delete";

        return "generic";
    }

    private getTemporalWeight(timestamp: number): number {
        const age = Date.now() - timestamp;
        const days = age / (1000 * 60 * 60 * 24);
        return Math.exp(-days / 7);
    }

    private getMemoryScore(tool: string, decisions: ToolDecision[]): number {
        if (!decisions.length) return 0;

        const relevant = decisions.filter(d => d.tool === tool);
        if (relevant.length === 0) return 0;

        const weighted = relevant.reduce((acc, d) => {
            const w = this.getTemporalWeight(d.timestamp);
            return acc + (d.success ? w : 0);
        }, 0);

        const totalWeight = relevant.reduce((acc, d) => acc + this.getTemporalWeight(d.timestamp), 0);

        if (totalWeight === 0) return 0;
        return weighted / totalWeight;
    }

    private async checkMemoryBlock(toolName: string): Promise<boolean> {
        if (!this.decisionMemory || !this.currentTaskType) return false;

        try {
            const history = await this.decisionMemory.getToolHistory(toolName, this.currentTaskType);

            if (history.failure >= 3 && history.rate < 0.3) {
                this.logger.warn('memory_block', `[MEMORY] Tool bloqueada por histórico ruim: ${toolName} (falhas=${history.failure}, rate=${history.rate.toFixed(2)})`);
                return true;
            }
        } catch (error) {
            this.logger.warn('memory_block_check_failed', `Falha ao verificar bloqueio por memória: ${error}`);
        }

        return false;
    }

    private getTaskTypePreferences(): { prefer: string[]; avoid: string[] } {
        switch (this.currentTaskType) {
            case 'file_conversion':
                return {
                    prefer: ['file_convert', 'read_local_file', 'list_directory', 'run_python', 'exec_command'],
                    avoid: ['workspace_create_project', 'web_search']
                };
            case 'file_search':
                return {
                    prefer: ['list_directory', 'search_file', 'read_local_file'],
                    avoid: ['web_search', 'workspace_create_project']
                };
            case 'content_generation':
                return {
                    prefer: ['workspace_create_project', 'workspace_save_artifact'],
                    avoid: ['exec_command', 'delete_file']
                };
            case 'system_operation':
                return {
                    prefer: ['exec_command', 'run_python', 'list_directory'],
                    avoid: ['web_search', 'workspace_create_project']
                };
            default:
                return { prefer: [], avoid: [] };
        }
    }

    private async rankToolsForStep(step: ExecutionStep, tools: string[]): Promise<string[]> {
        const contextKey = `${this.currentTaskType || 'unknown'}:${step.description}`;
        const normalizedStep = this.normalizeStep(step.description);

        let pastDecisions: ToolDecision[] = [];
        if (this.decisionMemory && this.currentTaskType) {
            try {
                pastDecisions = await this.decisionMemory.query(this.currentTaskType, normalizedStep, 10);
            } catch (error) {
                this.logger.warn('decision_memory_query_failed', `Failed to query decision memory: ${error}`);
            }
        }

        const taskPrefs = this.getTaskTypePreferences();

        return tools
            .map(tool => {
                const reliability = ToolReliability.score(tool, contextKey);
                const compatible = this.isToolCompatible(step, tool) ? 1 : 0;
                const failurePenalty = this.executionContext.toolsFailed.has(tool) ? -0.5 : 0;

                const memoryScore = pastDecisions.length > 0
                    ? this.getMemoryScore(tool, pastDecisions)
                    : 0;

                let memoryBoost = 0;
                if (memoryScore > 0.8) {
                    memoryBoost = 0.3;
                    this.logger.info('reinforce_tool', `[LEARNING] Tool reforçada por memória positiva: ${tool} (score=${memoryScore.toFixed(2)})`);
                }

                let taskPrefBonus = 0;
                if (taskPrefs.prefer.includes(tool)) {
                    taskPrefBonus = 0.2;
                } else if (taskPrefs.avoid.includes(tool)) {
                    taskPrefBonus = -0.3;
                }

                const score = (reliability * 0.4) + (compatible * 0.3) + (memoryScore * 0.3) + failurePenalty + memoryBoost + taskPrefBonus;
                return { tool, score };
            })
            .sort((a, b) => b.score - a.score)
            .map(t => t.tool);
    }

    private adaptArgsForRetry(step: ExecutionStep, originalArgs?: Record<string, any>): Record<string, any> {
        return {
            ...originalArgs,
            improved: true,
            timestamp: Date.now()
        };
    }

    private async retryWithBetterParams(step: ExecutionStep | undefined, originalArgs?: Record<string, any>): Promise<string | null> {
        if (!step) {
            return null;
        }

        const toolFallbackSignal = await this.buildToolFallbackSignal({
            step,
            toolName: step.tool || 'unknown_tool',
            trigger: 'retry_refinement'
        });

        this.logToolFallbackSignal(toolFallbackSignal);

        if (toolFallbackSignal.fallbackRecommended && toolFallbackSignal.suggestedTool) {
            // TODO (Single Brain): ToolFallbackSignal deve ser decidido pelo CognitiveOrchestrator.
            // AgentLoop deve apenas aplicar a ferramenta alternativa ja recomendada.
            this.logger.info('refinement_tool_switch', `[REFINE] ${step.tool} → ${toolFallbackSignal.suggestedTool}`);
            try {
                return await this.registry.executeTool(toolFallbackSignal.suggestedTool, this.adaptArgsForRetry(step, originalArgs));
            } catch (error) {
                this.logger.error('refinement_tool_error', error as Error, '[REFINE] Fallback tool execution failed');
                return null;
            }
        }

        if (step.tool) {
            this.logger.info('refinement_retry_same', `[REFINE] Retrying same tool ${step.tool} with improved params`);
            try {
                return await this.registry.executeTool(step.tool, this.adaptArgsForRetry(step, originalArgs));
            } catch (error) {
                this.logger.error('refinement_retry_error', error as Error, '[REFINE] Same tool retry failed');
                return null;
            }
        }

        return null;
    }

    private recordPathTried(path: string) {
        this.executionContext.pathsTried.add(path);
        if (this.executionContext.currentPlan) {
            this.executionContext.currentPlan.triedPaths.push(path);
        }
    }

    private recordToolFailure(toolName: string) {
        const count = (this.executionContext.toolsFailed.get(toolName) || 0) + 1;
        this.executionContext.toolsFailed.set(toolName, count);

        if (this.executionContext.currentPlan) {
            this.executionContext.currentPlan.failedTools.set(toolName, count);
        }
    }

    private isPathTried(path: string): boolean {
        return this.executionContext.pathsTried.has(path);
    }

    private hasToolFailedTooManyTimes(toolName: string): boolean {
        const count = this.executionContext.toolsFailed.get(toolName) || 0;
        return count >= 2;
    }

    private logCurrentPlan() {
        const plan = this.executionContext.currentPlan;
        if (!plan) return;

        let logMsg = `[PLAN] ${plan.goal}\n`;
        plan.steps.forEach((step, idx) => {
            const marker = idx === plan.currentStepIndex ? '→ ' : idx < plan.currentStepIndex ? '✓ ' : '  ';
            const status = step.completed ? '✓' : step.failed ? '✗' : '';
            logMsg += `${marker}[STEP ${step.id}] ${step.description} ${status}\n`;
        });

        this.logger.debug('plan_progress', logMsg);
    }

    private addPlanningGuidanceToMessages(messages: MessagePayload[], policy?: any): MessagePayload[] {
        const taskType = policy?.taskType;
        const taskConfidence = policy?.taskConfidence;

        let taskGuidance = '';
        if (taskType && taskConfidence && taskConfidence > 0.5) {
            switch (taskType) {
                case 'file_conversion':
                    taskGuidance = `\n\n[TAREFA DETECTADA: Conversão de arquivo]
Plano forçado para conversões:
1. Localizar arquivo de origem
2. Ler conteúdo do arquivo  
3. Converter conteúdo
4. Salvar resultado`;
                    break;
                case 'file_search':
                    taskGuidance = `\n\n[TAREFA DETECTADA: Busca de arquivo]
Plano forçado para buscas:
1. Determinar localização de busca
2. Buscar arquivo
3. Retornar resultado`;
                    break;
                case 'content_generation':
                    taskGuidance = `\n\n[TAREFA DETECTADA: Geração de conteúdo]
Plano forçado:
1. Definir estrutura do conteúdo
2. Gerar conteúdo
3. Salvar conteúdo`;
                    break;
                case 'system_operation':
                    taskGuidance = `\n\n[TAREFA DETECTADA: Operação de sistema]
Plano forçado:
1. Verificar pré-requisitos
2. Executar operação
3. Verificar resultado`;
                    break;
            }
        }

        const guidance: MessagePayload = {
            role: 'system',
            content: `Sempre crie um plano estruturado ANTES de usar ferramentas. 
O plano deve seguir este formato:
{
  "goal": "descrição clara do objetivo",
  "steps": [
    "descrição do passo 1",
    "descrição do passo 2",
    ...
  ]
}

Execute passo a passo. Escolha a ferramenta certa para cada etapa.
Se uma ferramenta falhar, adapte a estratégia ao invés de repetir a mesma ação.
SEMPRE verifique se o resultado de cada ação atende ao objetivo antes de continuar.
Evite loops usando o histórico de caminhos já tentados: ${Array.from(this.executionContext.pathsTried).join(', ') || 'nenhum'}
Evite ferramentas que já falharam: ${Array.from(this.executionContext.toolsFailed.entries()).map(([k, v]) => `${k}(${v}x)`).join(', ') || 'nenhuma'}${taskGuidance}`
        };

        return [...messages, guidance];
    }

    private advanceToNextStep() {
        if (this.executionContext.currentPlan) {
            const plan = this.executionContext.currentPlan;
            const currentIdx = plan.currentStepIndex;
            if (currentIdx < plan.steps.length) {
                plan.steps[currentIdx].completed = true;
            }
            plan.currentStepIndex++;
            if (plan.currentStepIndex >= plan.steps.length) {
                this.logger.info('all_steps_completed', `[LOOP] Todos os steps foram executados (index=${plan.currentStepIndex}/${plan.steps.length})`);
            }
            this.logCurrentPlan();
        }
    }

    private markCurrentStepFailed(error: string) {
        if (this.executionContext.currentPlan) {
            const currentIdx = this.executionContext.currentPlan.currentStepIndex;
            if (currentIdx < this.executionContext.currentPlan.steps.length) {
                this.executionContext.currentPlan.steps[currentIdx].failed = true;
                this.executionContext.currentPlan.steps[currentIdx].error = error;
            }
        }
    }

    private shouldReclassify(consecutiveFailures: number): ReclassificationSignal {
        if (this.reclassificationAttempts >= this.MAX_RECLASSIFY_ATTEMPTS) {
            return {
                reclassificationRecommended: false,
                reason: 'attempt_limit_reached',
                suggestedTaskType: null,
                confidence: 0
            };
        }

        if (consecutiveFailures >= 2) {
            const newClassification = classifyTask(this.originalInput);

            if (newClassification.type === this.currentTaskType) {
                return {
                    reclassificationRecommended: false,
                    reason: 'classification_unchanged',
                    suggestedTaskType: newClassification.type,
                    confidence: newClassification.confidence
                };
            }

            if (newClassification.confidence < this.LOW_CONFIDENCE_THRESHOLD) {
                return {
                    reclassificationRecommended: false,
                    reason: 'low_classifier_confidence',
                    suggestedTaskType: newClassification.type,
                    confidence: newClassification.confidence
                };
            }

            return {
                reclassificationRecommended: true,
                reason: 'failure_limit_reached',
                suggestedTaskType: newClassification.type,
                confidence: newClassification.confidence
            };
        }

        if (this.stepValidations.length > 0) {
            const avgConfidence = this.stepValidations.reduce((a, b) => a + b, 0) / this.stepValidations.length;
            if (avgConfidence < this.STEP_CONFIDENCE_THRESHOLD && this.stepValidations.length >= 2) {
                const newClassification = classifyTask(this.originalInput);

                if (newClassification.type === this.currentTaskType) {
                    return {
                        reclassificationRecommended: false,
                        reason: 'classification_unchanged',
                        suggestedTaskType: newClassification.type,
                        confidence: newClassification.confidence
                    };
                }

                if (newClassification.confidence < this.LOW_CONFIDENCE_THRESHOLD) {
                    return {
                        reclassificationRecommended: false,
                        reason: 'low_classifier_confidence',
                        suggestedTaskType: newClassification.type,
                        confidence: newClassification.confidence
                    };
                }

                return {
                    reclassificationRecommended: true,
                    reason: 'low_step_confidence',
                    suggestedTaskType: newClassification.type,
                    confidence: newClassification.confidence
                };
            }
        }

        return {
            reclassificationRecommended: false,
            reason: 'missing_input',
            suggestedTaskType: null,
            confidence: 0
        };
    }

    private reclassifyAndAdjustPlan(messages: MessagePayload[]): MessagePayload[] {
        if (!this.originalInput || this.reclassificationAttempts >= this.MAX_RECLASSIFY_ATTEMPTS) {
            return messages;
        }

        const newClassification = classifyTask(this.originalInput);
        const oldType = this.currentTaskType;

        if (newClassification.type === oldType || newClassification.confidence < this.LOW_CONFIDENCE_THRESHOLD) {
            return messages;
        }

        this.reclassificationAttempts++;
        this.currentTaskType = newClassification.type;

        this.logger.info('task_reclassification', `[RECLASSIFY] old=${oldType} new=${newClassification.type} confidence=${newClassification.confidence.toFixed(2)}`);

        const forcedPlan = getForcedPlanForTaskType(newClassification.type);
        if (forcedPlan && this.executionContext.currentPlan) {
            const newSteps = forcedPlan.map((desc, idx) => ({
                id: idx + 1,
                description: desc,
                completed: false,
                failed: false
            }));

            this.executionContext.currentPlan.steps = newSteps;
            this.executionContext.currentStepIndex = 0;

            this.logger.info('plan_adjusted', `[PLAN] Plano ajustado para: ${newClassification.type}`);
        }

        this.stepValidations = [];
        this.resetDeltaDetection();

        const hint: MessagePayload = {
            role: 'system',
            content: `[TAREFA RECLASSIFICADA] O tipo de tarefa foi corrigido de "${oldType}" para "${newClassification.type}". Novo plano aplicado. Continue a execução com esta nova orientação.`
        };

        return [...messages, hint];
    }

    public setOriginalInput(input: string, forceTypeOverride: boolean = false) {
        // Se já temos um tipo forçado e não estamos pedindo para sobrescrever, manter
        if (!forceTypeOverride && this.forcedTaskType && this.currentTaskType && this.currentTaskType !== 'unknown' && this.currentTaskType !== 'generic_task') {
            this.originalInput = input;
            this.logger.info('task_type_preserved', `[PRESERVE] Tipo forçado preservado: ${this.currentTaskType}`);
            return;
        }

        this.originalInput = input;

        const intentClear = this.isUserIntentClear(input);
        const classification = classifyTask(input);

        // TODO: migrar decisão de fail-safe para CognitiveOrchestrator — o executor deve receber o FailSafeSignal já computado.
        const failSafeSignal = this.buildFailSafeSignal(intentClear, classification.type);
        this.failSafe = failSafeSignal.activated;

        if (this.failSafe) {
            this.logger.info('fail_safe_activated', `[FAIL-SAFE] Ativado: trigger=${failSafeSignal.trigger}, intentClear=${intentClear}, type=${classification.type}`);
        }

        if (this.failSafe && (classification.type === 'unknown' || classification.confidence === 0)) {
            this.logger.warn('fail_safe_classification', '[FAIL-SAFE] Classificação ignorada - definindo como generic_task');
            this.currentTaskType = 'generic_task';
            this.currentTaskConfidence = 1.0;
            this.mode = 'EXECUTION';
            this.disableFollowUpQuestions = true;
        } else {
            this.currentTaskType = classification.type;
            this.currentTaskConfidence = classification.confidence;

            if (classification.confidence >= this.MODE_TRANSITION_CONFIDENCE && this.currentTaskType !== 'unknown' && this.currentTaskType !== 'generic_task') {
                this.mode = 'EXECUTION';
                this.disableFollowUpQuestions = true;
                this.logger.info('execution_mode_ready', `[MODE] Modo EXECUTION ativado: type=${this.currentTaskType}, confidence=${classification.confidence.toFixed(2)}`);
            } else if (classification.confidence < this.LOW_CONFIDENCE_THRESHOLD) {
                this.logger.info('uncertain_task', `[CLASSIFIER] Tarefa incerta detectada: ${classification.type} (confidence: ${classification.confidence.toFixed(2)})`);
            }
        }
    }

    public forceTaskType(type: TaskType, confidence: number = 1.0): void {
        this.currentTaskType = type;
        this.currentTaskConfidence = confidence;
        this.forcedTaskType = true;
        this.mode = 'EXECUTION';
        this.disableFollowUpQuestions = true;
        // TODO: migrar decisão de fail-safe para CognitiveOrchestrator — o executor deve receber o FailSafeSignal já computado.
        const failSafeSignal: FailSafeSignal = { activated: false, trigger: 'force_type_override_disabled' };
        this.failSafe = failSafeSignal.activated;
        this.logger.info('task_type_forced', `[FORCE] Tipo forçado: ${type} (confidence=${confidence}, failSafe=${this.failSafe})`);
    }

    private getGlobalConfidence(validations: number[]): number {
        if (validations.length === 0) {
            return 0;
        }

        const total = validations.reduce((sum, v) => sum + v, 0);
        return total / validations.length;
    }

    private hasPendingSteps(): boolean {
        const plan = this.executionContext.currentPlan;
        if (!plan) return false;

        return plan.steps.some(step => !step.completed && !step.failed);
    }

    // TODO: migrar lógica de shouldStopExecution para CognitiveOrchestrator — o loop deve apenas receber o StopContinueSignal e executar.
    private shouldStopExecution(lastStepSuccessful: boolean, stepCount: number): StopContinueSignal {
        const hasPending = this.hasPendingSteps();

        if (hasPending && this.failSafe) {
            this.logger.info('fail_safe_prevents_stop', `[FAIL-SAFE] Impedindo parada - há steps pendentes (failSafe=true)`);
            return { shouldStop: false, reason: 'fail_safe_prevents_stop_has_pending_steps', stepCount };
        }

        if (stepCount < 2) {
            return { shouldStop: false, reason: 'insufficient_steps', stepCount };
        }

        const globalConfidence = this.getGlobalConfidence(this.stepValidations);

        if (hasPending && globalConfidence >= this.GLOBAL_CONFIDENCE_THRESHOLD && lastStepSuccessful) {
            const plan = this.executionContext.currentPlan;
            const pendingCount = plan?.steps.filter((s: ExecutionStep) => !s.completed && !s.failed).length || 0;
            this.logger.info('pending_steps_prevent_stop', `[STOP-BLOCK] Ignorando confiança alta - há ${pendingCount} steps pendentes`);
            return { shouldStop: false, reason: 'has_pending_steps_prevent_stop', globalConfidence, stepCount };
        }

        if (globalConfidence >= this.GLOBAL_CONFIDENCE_THRESHOLD && lastStepSuccessful && !hasPending) {
            return {
                shouldStop: true,
                reason: 'global_confidence_threshold_met',
                globalConfidence,
                stepCount
            };
        }

        if (stepCount >= this.MAX_STEPS_BEFORE_OVEREXECUTION_CHECK) {
            const recentValidations = this.stepValidations.slice(-3);
            if (recentValidations.length >= 2) {
                const avgRecent = recentValidations.reduce((a, b) => a + b, 0) / recentValidations.length;
                if (avgRecent < 0.4) {
                    return {
                        shouldStop: true,
                        reason: 'over_execution_detected',
                        globalConfidence: avgRecent,
                        stepCount
                    };
                }
            }
        }

        return { shouldStop: false, reason: 'execution_continues', stepCount };
    }

    // TODO: migrar lógica de checkDeltaAndStop para CognitiveOrchestrator — o loop deve apenas receber o StopContinueSignal e executar.
    private checkDeltaAndStop(stepIndex: number): StopContinueSignal {
        if (stepIndex < 2) {
            return { shouldStop: false, reason: 'insufficient_steps_for_delta', stepCount: stepIndex };
        }

        if (this.stepValidations.length < 2) {
            return { shouldStop: false, reason: 'insufficient_validations_for_delta', stepCount: stepIndex };
        }

        const recent = this.stepValidations.slice(-3);
        const currentConfidence = recent.reduce((a, b) => a + b, 0) / recent.length;

        if (typeof currentConfidence !== 'number') {
            return { shouldStop: false, reason: 'invalid_confidence', stepCount: stepIndex };
        }

        if (this.previousConfidence !== null) {
            const delta = currentConfidence - this.previousConfidence;

            console.log(`[DELTA] avg_current=${currentConfidence.toFixed(2)} prev=${this.previousConfidence?.toFixed(2) ?? 'null'} delta=${delta.toFixed(3)}`);

            if (delta < this.MIN_DELTA_THRESHOLD) {
                this.lowImprovementCount++;
            } else {
                this.lowImprovementCount = 0;
            }
        }

        this.previousConfidence = currentConfidence;

        if (this.lowImprovementCount >= this.MAX_LOW_IMPROVEMENTS) {
            console.log(`[STOP] low improvement detected (${this.lowImprovementCount} steps)`);
            return {
                shouldStop: true,
                reason: 'low_improvement_delta',
                globalConfidence: currentConfidence,
                stepCount: stepIndex
            };
        }

        return { shouldStop: false, reason: 'delta_check_continues', globalConfidence: currentConfidence, stepCount: stepIndex };
    }

    private resetDeltaDetection() {
        this.previousConfidence = null;
        this.lowImprovementCount = 0;
    }

    private shouldUseFallbackStrategy(): boolean {
        const failedCount = Array.from(this.executionContext.toolsFailed.values()).reduce((a, b) => a + b, 0);
        return failedCount >= 2;
    }

    private addFallbackStrategyHint(messages: MessagePayload[]): MessagePayload[] {
        const hint: MessagePayload = {
            role: 'system',
            content: `STRATÉGIA: Múltiplas ferramentas falharam. Considere:
1. Usar uma ferramenta diferente para a mesma tarefa
2. Mudar o caminho/approach
3. Usar o LLM para processar conteúdo diretamente (sem ferramenta)
4. Pedir mais informações ao usuário`
        };

        return [...messages, hint];
    }

    private buildStepValidationSignal(validation: StepValidation): StepValidationSignal {
        if (validation.success) {
            return {
                validationPassed: true,
                reason: 'step_validation_passed',
                confidence: validation.confidence,
                requiresLlmReview: validation.needsLlm
            };
        }

        return {
            validationPassed: false,
            reason: 'step_validation_failed',
            confidence: validation.confidence,
            failureReason: validation.reason,
            requiresLlmReview: validation.needsLlm
        };
    }

    // TODO: migrar lógica de buildFailSafeSignal para CognitiveOrchestrator — o executor deve apenas receber o FailSafeSignal e aplicá-lo.
    private buildFailSafeSignal(intentClear: boolean, taskType: string): FailSafeSignal {
        if (intentClear) {
              const s: FailSafeSignal = { activated: true, trigger: 'intent_clear' };
              this.currentSignals.failSafe = s;
              return s;
        }
        if (taskType === 'unknown') {
              const s: FailSafeSignal = { activated: true, trigger: 'unknown_task_type' };
              this.currentSignals.failSafe = s;
              return s;
        }
        if (taskType === 'generic_task') {
            const s: FailSafeSignal = { activated: true, trigger: 'generic_task_type' };
            this.currentSignals.failSafe = s;
            return s;
        }
        const s: FailSafeSignal = { activated: false, trigger: 'not_activated' };
        this.currentSignals.failSafe = s;
        return s;
    }

    private buildStepValidationResult(validation: StepValidation): StepValidationResult {
        const result: StepValidationResult = {
            validation,
            signal: this.buildStepValidationSignal(validation)
        };
        this.currentSignals.validation = result.signal;
        return result;
    }

    private validateStepResult(step: ExecutionStep, result: string, toolName: string): StepValidationResult {
        const lowerDesc = step.description.toLowerCase();
        const resultLower = result.toLowerCase();

        if (resultLower.includes('erro:') || resultLower.includes('error:') || resultLower.includes('failed')) {
            return this.buildStepValidationResult({ success: false, confidence: 1.0, reason: `Erro na execução: ${result.slice(0, 100)}`, needsLlm: false });
        }

        if (lowerDesc.includes('localizar') || lowerDesc.includes('buscar arquivo') || lowerDesc.includes('procurar')) {
            const found = !resultLower.includes('não encontrado') &&
                !resultLower.includes('not found') &&
                !resultLower.includes('não localizei') &&
                result.length > 10;
            return this.buildStepValidationResult({
                success: found,
                confidence: found ? 0.9 : 0.95,
                reason: found ? 'Arquivo/localizado encontrado no resultado' : 'Arquivo não encontrado no resultado',
                needsLlm: false
            });
        }

        if (lowerDesc.includes('ler arquivo') || lowerDesc.includes('ler conteúdo')) {
            const hasContent = result.length > 0 && !resultLower.includes('erro');
            return this.buildStepValidationResult({
                success: hasContent,
                confidence: hasContent ? 0.85 : 0.95,
                reason: hasContent ? 'Conteúdo lido com sucesso' : 'Falha ao ler conteúdo',
                needsLlm: false
            });
        }

        if (lowerDesc.includes('salvar') || lowerDesc.includes('escrever') || lowerDesc.includes('criar arquivo')) {
            const saved = resultLower.includes('salvo') ||
                resultLower.includes('success') ||
                resultLower.includes('criado');
            return this.buildStepValidationResult({
                success: saved,
                confidence: saved ? 0.9 : 0.8,
                reason: saved ? 'Arquivo salvo/criado com sucesso' : 'Não foi possível confirmar salvamento',
                needsLlm: false
            });
        }

        if (lowerDesc.includes('criar diretório') || lowerDesc.includes('criar pasta')) {
            const created = resultLower.includes('criado') ||
                resultLower.includes('success') ||
                resultLower.includes('já existe');
            return this.buildStepValidationResult({
                success: created,
                confidence: created ? 0.9 : 0.8,
                reason: created ? 'Diretório criado ou já existe' : 'Falha ao criar diretório',
                needsLlm: false
            });
        }

        if (lowerDesc.includes('listar') || lowerDesc.includes('list directory')) {
            const hasList = result.includes('📁') || result.includes('📄') || result.length > 5;
            return this.buildStepValidationResult({
                success: hasList,
                confidence: hasList ? 0.9 : 0.8,
                reason: hasList ? 'Lista de diretório obtida' : 'Falha ao listar diretório',
                needsLlm: false
            });
        }

        if (lowerDesc.includes('deletar') || lowerDesc.includes('remover')) {
            const deleted = resultLower.includes('removido') ||
                resultLower.includes('deletado') ||
                resultLower.includes('deleted');
            return this.buildStepValidationResult({
                success: deleted,
                confidence: deleted ? 0.9 : 0.8,
                reason: deleted ? 'Item removido com sucesso' : 'Falha ao remover item',
                needsLlm: false
            });
        }

        if (lowerDesc.includes('buscar na web') || lowerDesc.includes('pesquisar')) {
            const hasResults = result.length > 20 && !resultLower.includes('nenhum resultado');
            return this.buildStepValidationResult({
                success: hasResults,
                confidence: hasResults ? 0.8 : 0.7,
                reason: hasResults ? 'Resultados de busca obtidos' : 'Nenhum resultado encontrado',
                needsLlm: false
            });
        }

        if (lowerDesc.includes('converter') || lowerDesc.includes('transformar')) {
            const hasOutput = result.length > 0 && result.length < 50000;
            return this.buildStepValidationResult({
                success: hasOutput,
                confidence: 0.7,
                reason: hasOutput ? 'Conversão realizada' : 'Falha na conversão',
                needsLlm: true
            });
        }

        return this.buildStepValidationResult({ success: true, confidence: 0.5, reason: 'Validação padrão aplicada', needsLlm: false });
    }

    private logValidation(step: ExecutionStep, validation: StepValidation) {
        const icon = validation.success ? '✓' : '✗';
        this.logger.debug('step_validation', `[CHECK] Step: ${step.description}`, {
            success: validation.success,
            confidence: validation.confidence,
            reason: validation.reason,
            needs_llm: validation.needsLlm
        });
    }

    private adjustPlanAfterFailure(messages: MessagePayload[], step: ExecutionStep, validation: StepValidation): PlanAdjustmentResult {
        const signal: PlanAdjustmentSignal = {
            shouldAdjustPlan: true,
            reason: 'step_failed',
            suggestedActions: ['adjust_next_step', 'use_alternative_tool', 'change_strategy'],
            failedStep: step.description,
            failureReason: validation.reason
        };

        const hint: MessagePayload = {
            role: 'system',
            content: `[FALHA DETECTADA] Step "${step.description}" falhou: ${validation.reason}
Considere:
1. Ajustar o próximo step para corrigir o problema
2. Usar ferramenta diferente
3. Mudar estratégia entirely`
        };
        return {
            messages: [...messages, hint],
            signal
        };
    }

    private shouldRetryWithLlm(validation: StepValidation, consecutiveFailures: number): LlmRetrySignal {
        if (validation.success) {
            return {
                retryRecommended: false,
                reason: 'step_succeeded',
                consecutiveFailures
            };
        }

        if (validation.needsLlm && consecutiveFailures < 2) {
            return {
                retryRecommended: true,
                reason: 'needs_llm_validation',
                consecutiveFailures
            };
        }

        return {
            retryRecommended: false,
            reason: 'failure_limit_reached',
            consecutiveFailures
        };
    }

    private getStepType(stepDescription: string): string {
        const lower = stepDescription.toLowerCase();
        if (lower.includes('ler')) return 'ler arquivo';
        if (lower.includes('salvar') || lower.includes('escrever') || lower.includes('criar arquivo')) return 'salvar arquivo';
        if (lower.includes('localizar') || lower.includes('buscar') || lower.includes('procurar')) return 'localizar arquivo';
        if (lower.includes('listar')) return 'listar diretório';
        if (lower.includes('deletar') || lower.includes('remover')) return 'deletar arquivo';
        if (lower.includes('mover') || lower.includes('renomear')) return 'mover arquivo';
        if (lower.includes('web') || lower.includes('pesquisar')) return 'buscar web';
        if (lower.includes('converter') || lower.includes('transformar')) return 'converter';
        return 'outro';
    }

    private async registerExecutionMemory(step: ExecutionStep, tool: string, success: boolean, context: string = '') {
        const entry: ExecutionMemoryEntry = {
            stepType: this.getStepType(step.description),
            tool,
            success,
            context,
            timestamp: Date.now()
        };

        this.executionMemory.push(entry);

        if (this.executionMemory.length > this.MAX_MEMORY_ENTRIES) {
            this.executionMemory.shift();
        }

        if (this.decisionMemory && this.currentTaskType) {
            try {
                const normalizedStep = this.normalizeStep(step.description);

                // ═════════════════════════════════════════════════════════════
                // PROTEÇÃO DA MEMÓRIA: NÃO aprender steps cognitivos com tools
                // ═══════════════════════════════════════════════════════════════
                const cognitiveSteps = [
                    'analisar', 'analis', 'análise', 'analysis',
                    'formular', 'formul', 'formulation',
                    'pensar', 'think', 'thinking',
                    'avaliar', 'avali', 'evaluate',
                    'decidir', 'decid', 'decide',
                    'processar entrada', 'process input',
                    'entender', 'understand', 'compreender',
                    'verificar', 'verif', 'check',
                    'identificar', 'identif', 'identify'
                ];

                const isCognitiveStep = cognitiveSteps.some(cognitive =>
                    normalizedStep.toLowerCase().includes(cognitive)
                );

                // NÃO aprender se:
                // 1. Step é cognitivo E uma tool foi usada
                // 2. Isso polui a memória com decisões ruins
                if (isCognitiveStep && tool) {
                    this.logger.warn('memory_protection', 'NÃO aprendendo step cognitivo com tool', {
                        step: normalizedStep,
                        tool,
                        reason: 'Step cognitivo não deve usar tool - poluiria memória'
                    });
                } else {
                    await this.decisionMemory.store({
                        taskType: this.currentTaskType,
                        step: normalizedStep,
                        tool,
                        success,
                        timestamp: Date.now()
                    });
                }
            } catch (error) {
                this.logger.warn('decision_memory_store_failed', `Failed to store decision: ${error}`);
            }
        }

        const status = success ? 'sucesso' : 'falha';
        this.logger.debug('execution_memory', `[LEARNING] ${tool} → ${status} para step "${step.description}"`, {
            stepType: entry.stepType,
            totalEntries: this.executionMemory.length
        });
    }

    private getToolScores(stepType: string): ToolScore[] {
        const recentMemory = this.executionMemory.filter(
            e => e.stepType === stepType && Date.now() - e.timestamp < 3600000
        );

        const toolStats = new Map<string, { success: number; failure: number }>();

        for (const entry of recentMemory) {
            const stats = toolStats.get(entry.tool) || { success: 0, failure: 0 };
            if (entry.success) {
                stats.success++;
            } else {
                stats.failure++;
            }
            toolStats.set(entry.tool, stats);
        }

        const scores: ToolScore[] = [];
        toolStats.forEach((stats, tool) => {
            scores.push({
                tool,
                score: stats.success - stats.failure,
                successes: stats.success,
                failures: stats.failure
            });
        });

        return scores.sort((a, b) => b.score - a.score);
    }

    private static readonly EXPLORATION_RATE_HIGH = 0.4;
    private static readonly EXPLORATION_RATE_MEDIUM = 0.2;
    private static readonly EXPLORATION_RATE_LOW = 0.05;
    private static readonly CONFIDENCE_HIGH = 0.8;
    private static readonly CONFIDENCE_MEDIUM = 0.5;
    private static readonly MIN_CONTEXTUAL_SAMPLES = 2;

    private getContextualConfidence(stepType: string, tool: string): { confidence: number; isContextual: boolean } {
        const recentMemory = this.executionMemory.filter(
            e => e.stepType === stepType && e.tool === tool && Date.now() - e.timestamp < 3600000
        );

        if (recentMemory.length >= AgentLoop.MIN_CONTEXTUAL_SAMPLES) {
            const successes = recentMemory.filter(e => e.success).length;
            const confidence = successes / recentMemory.length;

            this.logger.debug('confidence', `[CONFIDENCE] step=${stepType} tool=${tool} contextual_samples=${recentMemory.length} rate=${confidence.toFixed(2)}`);

            return { confidence, isContextual: true };
        }

        const globalMemory = this.executionMemory.filter(
            e => e.tool === tool && Date.now() - e.timestamp < 3600000
        );

        if (globalMemory.length >= AgentLoop.MIN_CONTEXTUAL_SAMPLES) {
            const successes = globalMemory.filter(e => e.success).length;
            const confidence = successes / globalMemory.length;

            this.logger.debug('confidence', `[CONFIDENCE] step=${stepType} tool=${tool} global_samples=${globalMemory.length} rate=${confidence.toFixed(2)} (fallback)`);

            return { confidence, isContextual: false };
        }

        return { confidence: 0, isContextual: false };
    }

    private getDecisionConfidence(stepType: string, scores: ToolScore[]): number {
        if (scores.length === 0) {
            return 0;
        }

        const bestScore = scores[0];
        if (!bestScore) {
            return 0;
        }

        const { confidence, isContextual } = this.getContextualConfidence(stepType, bestScore.tool);

        if (confidence > 0) {
            return confidence;
        }

        const totalAttempts = bestScore.successes + bestScore.failures;
        if (totalAttempts === 0) {
            return 0;
        }

        return bestScore.successes / totalAttempts;
    }

    private getAdaptiveExplorationRate(confidence: number): number {
        if (confidence >= AgentLoop.CONFIDENCE_HIGH) {
            return AgentLoop.EXPLORATION_RATE_LOW;
        } else if (confidence >= AgentLoop.CONFIDENCE_MEDIUM) {
            return AgentLoop.EXPLORATION_RATE_MEDIUM;
        } else {
            return AgentLoop.EXPLORATION_RATE_HIGH;
        }
    }

    private getBestToolForStep(stepDescription: string, candidateTools: string[]): string | null {
        const stepType = this.getStepType(stepDescription);
        const scores = this.getToolScores(stepType);

        if (scores.length === 0) {
            return null;
        }

        let bestCandidate = candidateTools[0];
        let bestConfidence = 0;

        for (const candidate of candidateTools) {
            const scoreEntry = scores.find(s => s.tool === candidate);
            if (scoreEntry && scoreEntry.score > 0) {
                const { confidence } = this.getContextualConfidence(stepType, candidate);
                if (confidence > bestConfidence) {
                    bestConfidence = confidence;
                    bestCandidate = candidate;
                }
            }
        }

        const decisionConfidence = bestConfidence > 0 ? bestConfidence : this.getDecisionConfidence(stepType, scores);
        const explorationRate = this.getAdaptiveExplorationRate(decisionConfidence);

        const shouldExplore = candidateTools.length > 1 && Math.random() < explorationRate;

        if (shouldExplore) {
            const validAlternatives = candidateTools.filter(tool => {
                const scoreEntry = scores.find(s => s.tool === tool);
                return !scoreEntry || scoreEntry.score > -3;
            });

            if (validAlternatives.length > 1) {
                const randomTool = validAlternatives[Math.floor(Math.random() * validAlternatives.length)];
                this.logger.info('tool_selection', `[EXPLORATION] confidence=${decisionConfidence.toFixed(2)} rate=${explorationRate} choosing_alternative=${randomTool} for_step=${stepType}`);
                return randomTool;
            }
        }

        for (const candidate of candidateTools) {
            const scoreEntry = scores.find(s => s.tool === candidate);
            if (scoreEntry && scoreEntry.score > 0) {
                this.logger.debug('tool_selection', `[LEARNING] Tool ${candidate} selected (score=${scoreEntry.score}) for ${stepType}`);
                return candidate;
            }
        }

        const lowestFailing = scores.filter(s => s.score < 0).pop();
        if (lowestFailing) {
            this.logger.debug('tool_selection', `[LEARNING] Avoiding tool ${lowestFailing.tool} (score=${lowestFailing.score}) for ${stepType}`);
        }

        return null;
    }

    private logMemoryStats() {
        if (this.executionMemory.length === 0) return;

        const stats = new Map<string, { success: number; failure: number }>();
        for (const entry of this.executionMemory) {
            const key = `${entry.stepType}:${entry.tool}`;
            const s = stats.get(key) || { success: 0, failure: 0 };
            if (entry.success) s.success++; else s.failure++;
            stats.set(key, s);
        }

        let msg = '[MEMORY STATS]\n';
        stats.forEach((s, key) => {
            const total = s.success + s.failure;
            const rate = total > 0 ? Math.round((s.success / total) * 100) : 0;
            msg += `${key}: ${s.success}✓ ${s.failure}✗ (${rate}%)\n`;
        });

        this.logger.debug('memory_stats', msg);
    }

    // ═══════════════════════════════════════════════════════════════════════
    // SHORT-CIRCUIT PARA CONTENT_GENERATION
    // Tarefas de geração de conteúdo são ATÔMICAS, não iterativas.
    // "Se não precisa agir no mundo, não entra no loop."
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Executa tarefas de content_generation diretamente, sem loop.
     * Resolve problemas de:
     * - loop_timeout
     * - loop_max_iterations_fallback
     * - steps falsos completos
     */
    private async executeContentGenerationDirect(
        userInput: string,
        messages: MessagePayload[]
    ): Promise<{ answer: string; newMessages: MessagePayload[] }> {
        this.logger.info('short_circuit_content_generation', '[SHORT-CIRCUIT] Executando content_generation diretamente (sem loop)', {
            input_preview: userInput.slice(0, 100),
            mode: 'cognitive_direct',
            bypass_loop: true
        });

        // Prompt focado em geração de conteúdo
        const systemPrompt: MessagePayload = {
            role: 'system',
            content: `Você é um assistente especializado em criar conteúdo estruturado.
REGRAS:
1. Gere o conteúdo completo de uma vez
2. Se for slides/HTML, gere o HTML completo
3. Se mencionar limite de linhas, respeite rigorosamente
4. Retorne APENAS o conteúdo solicitado, sem explicações extras
5. Se o input não tiver fonte de conteúdo clara, pergunte antes de gerar

FORMATO DE SAÍDA:
- Para slides HTML: HTML completo com <style> inline
- Para texto estruturado: texto organizado conforme solicitado`
        };

        const allMessages = [systemPrompt, ...messages];

        try {
            const response = await this.llm.generate(allMessages);

            // ═════════════════════════════════════════════════════════════
            // GARANTIR OUTPUT MÍNIMO VÁLIDO
            // ═════════════════════════════════════════════════════════════
            const minLength = this.currentTaskType === 'conversation' ? 2 : 50;
            if (!response.final_answer || response.final_answer.trim().length < minLength) {
                this.logger.warn('short_circuit_empty', '[SHORT-CIRCUIT] LLM retornou resposta vazia ou muito curta', {
                    response_length: response.final_answer?.length || 0,
                    min_required: minLength
                });
                return {
                    answer: t('content.generation_failed'),
                    newMessages: messages
                };
            }

            this.logger.info('short_circuit_success', '[SHORT-CIRCUIT] Conteúdo gerado com sucesso', {
                response_length: response.final_answer.length,
                mode: 'cognitive_direct'
            });

            // ═════════════════════════════════════════════════════════════
            // SALVAR NA DECISION_MEMORY (aprendizado)
            // ═════════════════════════════════════════════════════════════
            if (this.decisionMemory) {
                try {
                    await this.decisionMemory.store({
                        taskType: 'content_generation',
                        step: 'direct_generation',
                        tool: 'llm_direct',
                        success: true,
                        timestamp: Date.now()
                    });
                } catch (e) {
                    // Ignora erro de memória - não é crítico
                }
            }

            return {
                answer: response.final_answer,
                newMessages: messages
            };
        } catch (error: any) {
            this.logger.error('short_circuit_error', error, '[SHORT-CIRCUIT] Erro na geração direta', {
                error_message: error.message
            });
            return {
                answer: t('content.generation_error', { error: error.message }),
                newMessages: messages
            };
        }
    }

    // ═══════════════════════════════════════════════════════════════════════
    // INTEGRAÇÃO: PlanExecutionValidator + DecisionHandler
    // ═══════════════════════════════════════════════════════════════════════

    /**
     * Inicia validação de plano no início da execução.
     */
    startPlanValidation(): void {
        this.planValidator.startPlan();
        this.logger.debug('plan_validation_started', '[VALIDATION] Iniciando validação de plano');
    }

    /**
     * Registra resultado de um step no validador.
     */
    recordStepResult(stepName: string, success: boolean, output?: string, error?: string, duration?: number): void {
        this.planValidator.recordStep(stepName, success, output, error, duration);
    }

    /**
     * Valida plano após execução e retorna decisão se necessário.
     * Retorna null se sucesso total, DecisionRequest se precisar de intervenção.
     */
    validatePlanAndDecide(): DecisionRequest | null {
        const planResult = this.planValidator.validatePlan();

        // Sucesso total → sem necessidade de decisão
        if (planResult.success) {
            this.logger.info('plan_validation_success', '[VALIDATION] Plano executado com sucesso', {
                score: planResult.score.toFixed(2),
                completed: planResult.completedSteps,
                total: planResult.totalSteps
            });
            return null;
        }

        // Falha → verificar se precisa de intervenção
        const decisionNeeded = this.decisionHandler.needsUserIntervention(planResult);

        if (!decisionNeeded) {
            // Falha sem necessidade de intervenção (ex: contexto mudou)
            this.logger.warn('plan_validation_no_intervention', '[VALIDATION] Falha sem necessidade de intervenção', {
                score: planResult.score.toFixed(2),
                reason: planResult.interruptReason
            });
            return null;
        }

        // Precisa de decisão do usuário
        const decision = this.decisionHandler.analyzePlanResult(planResult);

        if (decision) {
            this.logger.warn('plan_validation_decision_needed', '[VALIDATION] Decisão do usuário necessária', {
                failed_steps: decision.failedSteps.length,
                context: decision.context
            });
        }

        return decision;
    }

    /**
     * Processa decisão do usuário após falha.
     */
    processUserDecision(decision: 'retry' | 'ignore' | 'adjust' | 'cancel'): { action: string; retrySteps?: string[] } {
        const planResult = this.planValidator.validatePlan();
        const result = this.decisionHandler.processUserDecision(decision, planResult);

        this.logger.info('user_decision_processed', '[VALIDATION] Decisão processada', {
            decision,
            action: result.action,
            retrySteps: result.retrySteps
        });

        // Resetar contador para nova tentativa
        if (decision === 'retry') {
            this.planValidator.reset();
            this.decisionHandler.reset();
        }

        return {
            action: result.action,
            retrySteps: result.retrySteps
        };
    }

    /**
     * Retorna relatório de validação para o usuário.
     */
    getValidationReport(): string {
        const planResult = this.planValidator.validatePlan();
        return this.decisionHandler.generateUserReport(planResult);
    }

    /**
     * Retorna estatísticas da execução.
     */
    getExecutionStats(): { completed: number; failed: number; total: number; score: number } {
        const stats = this.planValidator.getStats();
        return {
            completed: stats.successSteps,
            failed: stats.failedSteps,
            total: stats.totalSteps,
            score: stats.totalSteps > 0 ? stats.validSteps / stats.totalSteps : 0
        };
    }

    /**
     * Trata comandos simples e perguntas informativas.
     * Retorna uma resposta direta se o input corresponder a um comando conhecido.
     */
    private handleSimpleCommands(userInput: string): { answer: string; newMessages: any[] } | null {
        const commandResponses: Record<string, string> = {
            '/help': 'Comandos disponíveis:\n/new - Reiniciar conversa\n/help - Ver comandos\n/status - Ver estado da sessão',
            '/status': 'O estado atual da sessão está ativo e funcional.'
        };

        // Verificar comandos exatos
        if (commandResponses[userInput]) {
            return { answer: commandResponses[userInput], newMessages: [] };
        }

        // Verificar perguntas informativas
        if (/só tem esses comandos\?|quais comandos existem\?/i.test(userInput)) {
            return {
                answer: 'Os comandos disponíveis são:\n/new - Reiniciar conversa\n/help - Ver comandos\n/status - Ver estado da sessão',
                newMessages: []
            };
        }

        return null; // Não é um comando simples
    }

    /**
     * Gera o caminho completo para criação de arquivos e pastas dentro da pasta workspace.
     * Organiza os itens por categoria.
     */
    private generateWorkspacePath(category: string, itemName: string): string {
        const basePath = 'workspace';
        const sanitizedCategory = category.replace(/[^a-zA-Z0-9_-]/g, '_');
        const sanitizedItemName = itemName.replace(/[^a-zA-Z0-9_.-]/g, '_');
        return `${basePath}/${sanitizedCategory}/${sanitizedItemName}`;
    }

    /**
     * Rastreia caminhos de arquivos criados com sucesso por ferramentas conhecidas.
     */
    private trackCreatedPath(toolName: string, args: any, result: string) {
        try {
            // Se o resultado indica erro, não rastrear
            if (result.toLowerCase().includes('erro') || result.toLowerCase().includes('error')) return;

            // 1. Extração por ferramentas estruturadas (WorkspaceTools)
            if (toolName === 'workspace_save_artifact' || toolName === 'workspace_apply_diff') {
                const data = JSON.parse(result);
                if (data.success && data.data?.path) {
                    this.createdPaths.add(data.data.path);
                }
            }

            // 2. Extração por ferramentas de escrita direta (write_file, etc)
            if (toolName === 'write_file' || toolName === 'write_skill_file') {
                if (args.path) this.createdPaths.add(args.path);
                else if (args.filename && args.skill_name) {
                    // write_skill_file usa skill_name e filename
                    const targetDir = String(args.target_dir || 'temp').toLowerCase() === 'public' ? 'public' : 'temp';
                    this.createdPaths.add(`skills/${targetDir}/${args.skill_name}/${args.filename}`);
                }
            }

            // 3. Extração por conversão (file_convert)
            if (toolName === 'file_convert') {
                const pathMatch = result.match(/Arquivo: (.*)/i);
                if (pathMatch && pathMatch[1]) {
                    this.createdPaths.add(pathMatch[1].trim());
                }
            }
        } catch (e) {
            // Ignorar erros de parsing
        }
    }

    /**
     * Acrescenta a lista de arquivos criados à resposta final, se necessário.
     */
    private appendCreatedFiles(answer: string): string {
        if (this.createdPaths.size === 0) return answer;

        const paths = Array.from(this.createdPaths);

        // Verificar se os caminhos já estão mencionados na resposta
        const missingPaths = paths.filter(p => !answer.includes(p));

        if (missingPaths.length === 0) return answer;

        let report = t('loop.created_files_section');
        for (const p of missingPaths) {
            report += t('loop.created_files_item', { path: p });
        }

        return `${answer.trimEnd()}${report}`;
    }

    /**
     * Simula o plano de ação para dar transparência ao usuário.
     */
    private async simulatePlan(userInput: string, subtype: string): Promise<string> {
        this.logger.info('simulate_plan', '[COGNITIVE] Simulando plano de ação', { subtype });

        const systemPrompt: MessagePayload = {
            role: 'system',
            content: `Você é o módulo de explicabilidade do IalClaw.
Resuma o que o agente pretende fazer baseado no input do usuário.
REGRAS:
1. Seja ultra-conciso (máximo 3 bullets)
2. Use tom de "assistente prestativo"
3. Se for uma sugestão do usuário, valide por que é uma boa ideia.
4. Se houver risco de bagunça, mencione brevemente.`
        };

        try {
            const response = await this.llm.generate([systemPrompt, { role: 'user', content: userInput }]);
            return response.final_answer || '';
        } catch (e) {
            return 'Vou processar sua solicitação agora.';
        }
    }
}
