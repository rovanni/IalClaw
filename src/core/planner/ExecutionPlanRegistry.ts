export type ExecutionStep = {
    tool: string;
    params: Record<string, unknown>;
};

export type ExecutionPlanBuilder = (input: string) => ExecutionStep[] | null;

export class ExecutionPlanRegistry {
    private static builders: Record<string, ExecutionPlanBuilder> = {};

    static register(taskType: string, builder: ExecutionPlanBuilder): void {
        this.builders[taskType] = builder;
    }

    static get(taskType: string): ExecutionPlanBuilder | null {
        return this.builders[taskType] || null;
    }
}
