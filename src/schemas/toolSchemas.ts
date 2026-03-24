type ValidationResult =
    | { success: true; data: any }
    | { success: false; errors: Array<{ path: string[]; message: string }> };

type ToolSchema = {
    safeParse(input: any): ValidationResult;
};

function validateStringField(input: any, field: string): string | null {
    if (typeof input?.[field] !== 'string') {
        return `Expected string, received ${typeof input?.[field]}`;
    }

    if (input[field].trim().length < 1) {
        return 'String must contain at least 1 character';
    }

    return null;
}

function buildRequiredStringSchema(fields: string[]): ToolSchema {
    return {
        safeParse(input: any): ValidationResult {
            const candidate = input && typeof input === 'object' ? input : {};
            const errors = fields
                .map(field => {
                    const message = validateStringField(candidate, field);
                    return message ? { path: [field], message } : null;
                })
                .filter(Boolean) as Array<{ path: string[]; message: string }>;

            if (errors.length > 0) {
                return { success: false, errors };
            }

            return { success: true, data: candidate };
        }
    };
}

export const toolSchemas: Record<string, ToolSchema> = {
    workspace_create_project: {
        safeParse(input: any): ValidationResult {
            const candidate = input && typeof input === 'object' ? input : {};
            const errors: Array<{ path: string[]; message: string }> = [];
            const nameField = typeof candidate.name === 'string' && candidate.name.trim()
                ? 'name'
                : typeof candidate.project_name === 'string' && candidate.project_name.trim()
                    ? 'project_name'
                    : null;

            if (!nameField) {
                errors.push({ path: ['name'], message: 'Expected non-empty string in "name" or "project_name"' });
            }

            const typeMessage = validateStringField(candidate, 'type');
            if (typeMessage) {
                errors.push({ path: ['type'], message: typeMessage });
            }

            const promptMessage = validateStringField(candidate, 'prompt');
            if (promptMessage) {
                errors.push({ path: ['prompt'], message: promptMessage });
            }

            if (errors.length > 0) {
                return { success: false, errors };
            }

            return {
                success: true,
                data: {
                    ...candidate,
                    name: candidate.name || candidate.project_name
                }
            };
        }
    },
    workspace_save_artifact: buildRequiredStringSchema(['project_id', 'filename', 'content']),
    workspace_validate_project: buildRequiredStringSchema(['project_id']),
    workspace_run_project: buildRequiredStringSchema(['project_id'])
};

export type ToolName = keyof typeof toolSchemas;
