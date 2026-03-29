// ── Validation Module ────────────────────────────────────────────────────────────
// Validação de execução de plano e decisão interativa.

export {
    PlanExecutionValidator,
    getPlanExecutionValidator,
    type StepResult,
    type PlanValidationResult,
    type ProgressReport
} from './PlanExecutionValidator';

export {
    DecisionHandler,
    getDecisionHandler,
    type DecisionOption,
    type DecisionRequest,
    type DecisionResult,
    type FailureClassification
} from './DecisionHandler';