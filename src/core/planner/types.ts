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

export interface PlannerSignals {
    parseRecovered: boolean;
    validationPassed: boolean;
    hallucinatedToolDetected: boolean;
    sessionConsistency: number;
    fileTargetConfidence: number;
}

export interface PlannerDiagnostics extends PlannerSignals {
    /** @deprecated Use ConfidenceScorer instead for final decision score */
    confidenceScore: number;
}

export interface PlannerOutput {
    plan?: ExecutionPlan;
    diagnostics: PlannerDiagnostics;
}
