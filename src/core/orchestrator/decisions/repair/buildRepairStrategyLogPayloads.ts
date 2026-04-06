import type { RepairStrategySignal } from '../../../../engine/AgentLoopTypes';
import type {
    RepairResultIngestedPayload,
    RepairStrategySignalReceivedPayload
} from '../../types/RepairStrategyLogTypes';

export function buildRepairStrategySignalReceivedPayload(params: {
    sessionId: string;
    signal: Readonly<RepairStrategySignal>;
}): RepairStrategySignalReceivedPayload {
    const { sessionId, signal } = params;

    return {
        sessionId,
        hasActiveProject: signal.hasActiveProject,
        usesWorkspace: signal.usesWorkspace,
        hadCreateProject: signal.hadCreateProject,
        createProjectPosition: signal.createProjectPosition,
        projectMissing: signal.projectMissing,
        repairReason: signal.repairReason
    };
}

export function buildRepairResultIngestedPayload(params: {
    sessionId: string;
    result: Readonly<{ success: boolean; hasRepairedPlan: boolean }>;
}): RepairResultIngestedPayload {
    const { sessionId, result } = params;

    return {
        sessionId,
        success: result.success,
        hasRepairedPlan: result.hasRepairedPlan
    };
}
