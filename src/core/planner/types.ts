export interface PlanStep {
    id: number;
    type: 'tool';
    tool: string;
    input: Record<string, any>;
    is_repair?: boolean;
}

export interface ExecutionPlan {
    goal: string;
    steps: PlanStep[];
}
