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
