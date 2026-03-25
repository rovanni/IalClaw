export interface PlanStep {
    id: number;
    type: 'tool';
    tool: string;
    input: Record<string, any>;
    capabilities?: {
        requiresDOM?: boolean;
    };
    is_repair?: boolean;
}

export interface ExecutionPlan {
    goal: string;
    steps: PlanStep[];
}

export interface PlannerDiagnostics {
    parseRecovered: boolean;
    validationPassed: boolean;
    hallucinatedToolDetected: boolean;
    sessionConsistency: number;
    fileTargetConfidence: number;
    confidenceScore: number;
}

export interface PlannerOutput {
    plan?: ExecutionPlan;
    diagnostics: PlannerDiagnostics;
}
