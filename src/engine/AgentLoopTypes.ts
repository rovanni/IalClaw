import { MessagePayload } from './ProviderFactory';
import { PlanSource, TaskType } from '../core/agent/TaskClassifier';
import { AutonomyDecision } from '../core/autonomy';
import { ExecutionRoute } from '../core/autonomy/ActionRouter';

export type AgentMode = 'THINKING' | 'EXECUTION';
export type LoopIntentMode = 'EXPLORATION' | 'EXECUTION' | 'HYBRID' | 'UNKNOWN';

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
    meta?: {
        source: PlanSource;
    };
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
    context?: {
        toolName: string;
        error?: string;
        attemptCount: number;
        maxAttempts: number;
        lastResult: string | null;
        step?: {
            id: number;
            description: string;
            tool?: string;
        };
        executionContext: {
            hasPlan: boolean;
            currentStepIndex: number;
            failedToolsCount: number;
        };
    };
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

export type RealityCheckSignal = {
    shouldInject: boolean;
    reason: 'no_execution_claim' | 'grounded_by_tool_evidence' | 'no_tool_call' | 'missing_grounding_evidence';
    toolCallsCount: number;
    hasGroundingEvidence: boolean;
};

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

export type FailSafeActivationTrigger =
    | 'intent_clear'
    | 'unknown_task_type'
    | 'generic_task_type'
    | 'force_type_override_disabled'
    | 'not_activated';

export type FailSafeSignal = {
    activated: boolean;
    trigger: FailSafeActivationTrigger;
    failureCount?: number;
    lastError?: string;
    step?: string;
    tool?: string;
    retryAttempts?: number;
    contextSnapshot?: {
        mode: AgentMode;
        taskType: TaskType | null;
        taskConfidence: number;
        hasPlan: boolean;
        pendingSteps: number;
        toolsFailed: number;
        lowImprovementCount: number;
        isContinuation: boolean;
    };
};

export type CognitiveSignalsState = {
    route?: RouteAutonomySignal;
    fallback?: ToolFallbackSignal;
    validation?: StepValidationSignal;
    stop?: StopContinueSignal;
    failSafe?: FailSafeSignal;
    reclassification?: ReclassificationSignal;
    llmRetry?: LlmRetrySignal;
    planAdjustment?: PlanAdjustmentSignal;
    realityCheck?: RealityCheckSignal;
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
