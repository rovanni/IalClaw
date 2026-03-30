export type IntentType = 'TASK' | 'QUESTION' | 'META' | 'UNKNOWN';

export interface FlowStep {
    id: string;
    /**
     * Generates the prompt for this step.
     */
    prompt: (context: Record<string, any>) => string;
    /**
     * Validates user input for this step.
     */
    validate: (input: string, context: Record<string, any>) => boolean;
    /**
     * Processes the validated input and updates the context.
     */
    process: (input: string, context: Record<string, any>) => void;
}

export interface Flow {
    id: string;
    steps: FlowStep[];
    /**
     * Called when all steps are completed.
     */
    onComplete: (context: Record<string, any>) => Promise<any>;
    /**
     * Optional: Called when the flow is cancelled or exited prematurely.
     */
    onCancel?: (context: Record<string, any>) => void;
}

export interface FlowState {
    flowId: string;
    stepIndex: number;
    retryCount: number;
    confidence: number;
    context: Record<string, any>;
    lastInput?: string;
}

export interface FlowResponse {
    answer: string;
    completed: boolean;
    exited: boolean;
    result?: any;
}
