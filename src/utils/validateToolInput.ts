import { toolSchemas } from '../schemas/toolSchemas';

export function validateToolInput(tool: string, input: any): any {
    const schema = toolSchemas[tool];

    if (!schema) {
        return input || {};
    }

    const result = schema.safeParse(input || {});

    if (!result.success) {
        const issues = result.errors
            .map(issue => `${issue.path.join('.')}: ${issue.message}`)
            .join(', ');

        throw new Error(`Invalid input for tool "${tool}": ${issues}`);
    }

    return result.data;
}
