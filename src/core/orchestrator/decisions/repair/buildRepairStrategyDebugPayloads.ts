import type { FailSafeSignal, RepairStrategySignal, StopContinueSignal } from '../../../../engine/AgentLoopTypes';
import type {
    RepairStrategyActiveDecisionPayload,
    RepairStrategyDecisionPayload,
    RepairStrategyDecisionReason,
    RepairStrategyDecisionValue
} from '../../types/RepairStrategyDebugTypes';

export function buildRepairStrategyDecisionPayload(params: {
    sessionId: string;
    orchestratorDecision: RepairStrategyDecisionValue;
    reason: RepairStrategyDecisionReason;
    repairSignal?: RepairStrategySignal;
    repairResult?: { success: boolean; hasRepairedPlan: boolean };
    failSafeSignal?: FailSafeSignal;
    stopSignal?: StopContinueSignal;
}): RepairStrategyDecisionPayload {
    const { sessionId, orchestratorDecision, reason, repairSignal, repairResult, failSafeSignal, stopSignal } = params;

    return {
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
    };
}

export function buildRepairStrategyActiveDecisionPayload(params: {
    sessionId: string;
    reason: RepairStrategyDecisionReason;
    orchestratorDecision: RepairStrategyDecisionValue;
    repairSignal?: RepairStrategySignal;
    repairResult?: { success: boolean; hasRepairedPlan: boolean };
    failSafeSignal?: FailSafeSignal;
    stopSignal?: StopContinueSignal;
}): RepairStrategyActiveDecisionPayload {
    const { sessionId, reason, orchestratorDecision, repairSignal, repairResult, failSafeSignal, stopSignal } = params;

    return {
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
    };
}
