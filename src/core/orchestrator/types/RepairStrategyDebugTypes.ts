export type RepairStrategyDecisionValue = 'abort' | 'continue' | undefined;

export type RepairStrategyDecisionReason =
    | 'insufficient_context'
    | 'fail_safe_activated'
    | 'stop_continue_should_stop'
    | 'repair_result_not_observed'
    | 'repair_succeeded_with_plan'
    | 'repair_failed_or_no_plan';

export type RepairStrategyDecisionPayload = {
    type: 'repair_strategy_decision';
    sessionId: string;
    orchestratorDecision: RepairStrategyDecisionValue;
    reason: RepairStrategyDecisionReason;
    hasRepairSignal: boolean;
    hasRepairResult: boolean;
    repairSuccess?: boolean;
    hasRepairedPlan?: boolean;
    failSafeActivated: boolean;
    stopShouldStop: boolean;
    repairReason?: string;
    usesWorkspace?: boolean;
};

export type RepairStrategyActiveDecisionPayload = {
    sessionId: string;
    reason: RepairStrategyDecisionReason;
    orchestratorDecision: RepairStrategyDecisionValue;
    repairSuccess?: boolean;
    hasRepairedPlan?: boolean;
    failSafeActivated: boolean;
    stopShouldStop: boolean;
    repairReason?: string;
    usesWorkspace?: boolean;
    hasActiveProject?: boolean;
    projectMissing?: boolean;
};
