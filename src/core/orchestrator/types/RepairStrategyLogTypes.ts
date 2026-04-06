export type RepairStrategySignalReceivedPayload = {
    sessionId: string;
    hasActiveProject?: boolean;
    usesWorkspace?: boolean;
    hadCreateProject?: boolean;
    createProjectPosition?: number | null;
    projectMissing?: boolean;
    repairReason?: string;
};

export type RepairResultIngestedPayload = {
    sessionId: string;
    success: boolean;
    hasRepairedPlan: boolean;
};
