import { toolSchemas } from '../schemas/toolSchemas';

function normalizeAliases(tool: string, input: any) {
    if (!input || typeof input !== 'object') return input;

    if (tool === 'workspace_create_project' && input.project_name && !input.name) {
        return {
            ...input,
            name: input.project_name
        };
    }

    return input;
}

export function validateToolInput(tool: string, input: any): any {
    const normalized = normalizeAliases(tool, input);
    const schema = toolSchemas[tool];

    if (!schema) {
        return normalized || {};
    }

    const result = schema.safeParse(normalized || {});

    if (!result.success) {
        const issues = result.errors
            .map(issue => ({
                path: issue.path.join('.'),
                message: issue.message,
                expected: null,
                received: null
            }))
            .sort((a, b) => a.path.localeCompare(b.path));

        const err: any = new Error(`Invalid input for tool "${tool}"`);
        err.issues = issues;
        throw err;
    }

    return result.data;
}
