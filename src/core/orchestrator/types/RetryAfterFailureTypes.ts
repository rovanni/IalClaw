import { StepValidationSignal, StopContinueSignal, FailSafeSignal } from '../../../engine/AgentLoopTypes';
import { SelfHealingSignal } from '../../executor/AgentExecutor';

export type RetryAfterFailureContext = {
    sessionId: string;
    attempt?: number;
    executorDecision?: boolean;
};

export type RetryAfterFailureDecisionContext = {
    selfHealing?: SelfHealingSignal;
    failSafe?: FailSafeSignal;
    stopContinue?: StopContinueSignal;
    validation?: StepValidationSignal;
};

export type RetryAfterFailureDecision = {
    orchestratorDecision: boolean | undefined;
    reason: string;
};
