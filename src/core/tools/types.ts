export interface ToolDefinition {
    name: string;
    description: string;
    input_schema: {
        type: 'object';
        properties: Record<string, any>;
        required?: string[];
    };
    execute: (input: any, context?: any) => Promise<{ success: boolean; data?: any; error?: string }>;
}
