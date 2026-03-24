export interface PlanStep {
    id: number;
    type: 'tool';
    tool: string;
    input: Record<string, any>;
}

export interface ExecutionPlan {
    goal: string;
    steps: PlanStep[];
}