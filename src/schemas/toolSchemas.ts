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

function buildWorkspaceApplyDiffSchema(): ToolSchema {
    return {
        safeParse(input: any): ValidationResult {
            const candidate = input && typeof input === 'object' ? input : {};
            const errors: Array<{ path: string[]; message: string }> = [];

            const filenameValue = candidate.filename || candidate.filePath;
            const projectIdMessage = validateStringField(candidate, 'project_id');
            if (projectIdMessage) {
                errors.push({ path: ['project_id'], message: projectIdMessage });
            }

            if (typeof filenameValue !== 'string' || filenameValue.trim().length < 1) {
                errors.push({ path: ['filename'], message: 'Expected non-empty filename string' });
            }

            if (!Array.isArray(candidate.operations) || candidate.operations.length === 0) {
                errors.push({ path: ['operations'], message: 'Expected non-empty operations array' });
            } else {
                candidate.operations.forEach((operation: any, index: number) => {
                    if (!operation || typeof operation !== 'object') {
                        errors.push({ path: ['operations', String(index)], message: 'Expected object operation' });
                        return;
                    }

                    if (!['replace', 'insert', 'append'].includes(operation.type)) {
                        errors.push({ path: ['operations', String(index), 'type'], message: 'Invalid diff operation type' });
                    }

                    if (operation.type !== 'append') {
                        const hasAnchor = typeof operation.anchor === 'string' && operation.anchor.trim().length > 0;
                        const hasAnchors = Array.isArray(operation.anchors) && operation.anchors.some((anchor: any) => typeof anchor === 'string' && anchor.trim().length > 0);

                        if (!hasAnchor && !hasAnchors) {
                            errors.push({ path: ['operations', String(index), 'anchor'], message: 'Expected non-empty anchor string or anchors array' });
                        }

                        if (operation.anchors !== undefined) {
                            if (!Array.isArray(operation.anchors) || operation.anchors.length === 0) {
                                errors.push({ path: ['operations', String(index), 'anchors'], message: 'Expected non-empty anchors array' });
                            } else {
                                operation.anchors.forEach((anchor: any, anchorIndex: number) => {
                                    if (typeof anchor !== 'string' || anchor.trim().length < 1) {
                                        errors.push({
                                            path: ['operations', String(index), 'anchors', String(anchorIndex)],
                                            message: 'Expected non-empty anchor string'
                                        });
                                    }
                                });
                            }
                        }
                    }

                    if (operation.type === 'insert' && !['before', 'after'].includes(operation.position)) {
                        errors.push({ path: ['operations', String(index), 'position'], message: 'Expected "before" or "after"' });
                    }

                    if (typeof operation.content !== 'string' || operation.content.length < 2) {
                        errors.push({ path: ['operations', String(index), 'content'], message: 'Expected non-empty content string' });
                    }
                });
            }

            if (!candidate.validation || typeof candidate.validation !== 'object') {
                errors.push({ path: ['validation'], message: 'Expected validation object' });
            } else {
                if (typeof candidate.validation.requireAnchorMatch !== 'boolean') {
                    errors.push({ path: ['validation', 'requireAnchorMatch'], message: 'Expected boolean requireAnchorMatch' });
                }

                if (
                    candidate.validation.maxReplacements !== undefined
                    && (!Number.isInteger(candidate.validation.maxReplacements) || candidate.validation.maxReplacements < 1)
                ) {
                    errors.push({ path: ['validation', 'maxReplacements'], message: 'Expected positive integer maxReplacements' });
                }
            }

            if (errors.length > 0) {
                return { success: false, errors };
            }

            return {
                success: true,
                data: {
                    ...candidate,
                    filename: filenameValue
                }
            };
        }
    };
}

export const toolSchemas: Record<string, ToolSchema> = {
    workspace_create_project: buildRequiredStringSchema(['name', 'type', 'prompt']),
    workspace_save_artifact: buildRequiredStringSchema(['project_id', 'filename', 'content']),
    workspace_apply_diff: buildWorkspaceApplyDiffSchema(),
    workspace_validate_project: buildRequiredStringSchema(['project_id']),
    workspace_run_project: buildRequiredStringSchema(['project_id'])
};

export type ToolName = keyof typeof toolSchemas;
