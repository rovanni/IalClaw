import { workspaceService, ProjectType } from '../services/WorkspaceService';
import { ToolDefinition } from '../core/tools/types';
import { getContext } from '../shared/TraceContext';
import { emitDebug } from '../shared/DebugBus';
import { workspaceValidateProjectTool } from './workspaceValidateProject';
import { workspaceRunProjectTool } from './workspaceRunProject';
import { applyDiff, validateDiff, validateDiffOperations, DiffOperation, WorkspaceApplyDiffInput } from './workspaceDiff';

function normalizeCreateProjectInput(input: any) {
    const normalizedName = input?.project_name || input?.name || `project_${Date.now()}`;
    const normalizedType = input?.type || 'code';
    const normalizedPrompt = input?.prompt || input?.goal || normalizedName;

    return {
        name: normalizedName,
        type: normalizedType,
        prompt: normalizedPrompt
    };
}

export const workspaceCreateProjectTool: ToolDefinition = {
    name: 'workspace_create_project',
    description: 'Cria um novo projeto estruturado no disco. OBRIGATORIO chamar antes de salvar arquivos.',
    input_schema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Nome do projeto' },
            project_name: { type: 'string', description: 'Alias aceito para nome do projeto' },
            type: { type: 'string', description: 'code | slides | game | document | automation' },
            prompt: { type: 'string', description: 'O que o projeto deve fazer' }
        },
        required: ['type', 'prompt']
    },
    execute: async (input: any, context?: any) => {
        const trace_id = context?.trace_id || getContext().trace_id;
        const normalizedInput = normalizeCreateProjectInput(input);

        emitDebug('tool', { name: 'workspace_create:start', trace_id, input: normalizedInput });

        try {
            const projectId = workspaceService.createProject(
                normalizedInput.name,
                normalizedInput.type as ProjectType,
                context?.agent_id || 'agent_core',
                normalizedInput.prompt
            );

            emitDebug('tool', { name: 'workspace_create:success', trace_id, project_id: projectId });
            return { success: true, data: { project_id: projectId } };
        } catch (err: any) {
            emitDebug('tool', { name: 'workspace_create:error', trace_id, error: err.message });
            return { success: false, error: err.message };
        }
    }
};

export const workspaceSaveArtifactTool: ToolDefinition = {
    name: 'workspace_save_artifact',
    description: 'Salva um arquivo fisico dentro de um projeto existente.',
    input_schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string', description: 'ID retornado pela tool workspace_create_project' },
            filename: { type: 'string', description: 'Nome e extensao (ex: src/index.js)' },
            content: { type: 'string', description: 'Conteudo integral do arquivo' }
        },
        required: ['project_id', 'filename', 'content']
    },
    execute: async (input: any, context?: any) => {
        const trace_id = context?.trace_id || getContext().trace_id;

        if (!input.project_id) return { success: false, error: 'project_id e obrigatorio' };
        if (!/^[a-z0-9\-]+-\d+$/.test(input.project_id)) {
            return { success: false, error: 'project_id invalido. Formato esperado: slug-timestamp' };
        }

        emitDebug('tool', { name: 'workspace_save:start', trace_id, project_id: input.project_id, filename: input.filename });

        try {
            const savedPath = workspaceService.saveArtifact(
                input.project_id,
                input.filename,
                input.content
            );

            emitDebug('tool', { name: 'workspace_save:success', trace_id, path: savedPath });
            return { success: true, data: { path: savedPath } };
        } catch (err: any) {
            emitDebug('tool', { name: 'workspace_save:error', trace_id, error: err.message });
            return { success: false, error: err.message };
        }
    }
};

export const workspaceApplyDiffTool: ToolDefinition = {
    name: 'workspace_apply_diff',
    description: 'Aplica um patch textual minimo e seguro em um arquivo existente usando ancora textual unica ou multiplas ancoras ranqueadas.',
    input_schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string', description: 'ID do projeto ativo' },
            filename: { type: 'string', description: 'Arquivo-alvo dentro do output' },
            filePath: { type: 'string', description: 'Alias aceito para filename' },
            operations: {
                type: 'array',
                description: 'Lista de operacoes de diff por ancora textual, com suporte a anchors alternativas'
            },
            validation: {
                type: 'object',
                description: 'Regras de validacao do patch'
            }
        },
        required: ['project_id', 'operations', 'validation']
    },
    execute: async (input: any, context?: any) => {
        const trace_id = context?.trace_id || getContext().trace_id;
        const normalizedInput: WorkspaceApplyDiffInput = {
            project_id: input.project_id,
            filename: input.filename || input.filePath,
            operations: input.operations,
            validation: input.validation
        };

        if (!normalizedInput.project_id) return { success: false, error: 'project_id e obrigatorio' };
        if (!normalizedInput.filename) return { success: false, error: 'filename e obrigatorio' };
        if (!/^[a-z0-9\-]+-\d+$/.test(normalizedInput.project_id)) {
            return { success: false, error: 'project_id invalido. Formato esperado: slug-timestamp' };
        }

        const operations = normalizedInput.operations as DiffOperation[];
        if (!validateDiffOperations(operations)) {
            return { success: false, error: 'operations invalidas para workspace_apply_diff' };
        }

        emitDebug('tool', {
            name: 'workspace_diff:start',
            trace_id,
            project_id: normalizedInput.project_id,
            filename: normalizedInput.filename,
            operations_count: operations.length
        });

        try {
            const currentContent = workspaceService.readArtifact(normalizedInput.project_id, normalizedInput.filename);
            if (currentContent === null) {
                return { success: false, error: 'arquivo alvo nao encontrado para diff' };
            }

            const resolvedOperations = validateDiff({
                original: currentContent,
                operations,
                validation: normalizedInput.validation,
                onAnchorResolved: (data) => emitDebug('anchor_resolved', {
                    trace_id,
                    filename: normalizedInput.filename,
                    ...data
                }),
                onAnchorResolutionFailed: (data) => emitDebug('anchor_resolution_failed', {
                    trace_id,
                    filename: normalizedInput.filename,
                    ...data
                })
            });

            const updatedContent = applyDiff(currentContent, resolvedOperations);
            if (!updatedContent || updatedContent.length < currentContent.length * 0.3) {
                return { success: false, error: 'DIFF_RESULT_SUSPICIOUS' };
            }

            const savedPath = workspaceService.saveArtifact(normalizedInput.project_id, normalizedInput.filename, updatedContent);

            emitDebug('tool', { name: 'workspace_diff:success', trace_id, path: savedPath });
            return { success: true, data: { path: savedPath, operations_applied: operations.length } };
        } catch (err: any) {
            emitDebug('tool', { name: 'workspace_diff:error', trace_id, error: err.message });
            return { success: false, error: err.message };
        }
    }
};

export const workspaceListFilesTool: ToolDefinition = {
    name: 'workspace_list_files',
    description: 'Lista todos os arquivos dentro do output de um projeto. Util para verificar o que ja foi criado antes de editar ou criar novos arquivos.',
    input_schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string', description: 'ID do projeto ativo' },
            subdir: { type: 'string', description: 'Subdiretorio opcional dentro do output para filtrar a listagem' }
        },
        required: ['project_id']
    },
    execute: async (input: any, context?: any) => {
        const trace_id = context?.trace_id || getContext().trace_id;

        if (!input.project_id) return { success: false, error: 'project_id e obrigatorio' };
        if (!/^[a-z0-9\-]+-\d+$/.test(input.project_id)) {
            return { success: false, error: 'project_id invalido. Formato esperado: slug-timestamp' };
        }

        emitDebug('tool', { name: 'workspace_list:start', trace_id, project_id: input.project_id });

        try {
            const files = workspaceService.listArtifacts(input.project_id, input.subdir);
            emitDebug('tool', { name: 'workspace_list:success', trace_id, count: files.length });
            return { success: true, data: { files } };
        } catch (err: any) {
            emitDebug('tool', { name: 'workspace_list:error', trace_id, error: err.message });
            return { success: false, error: err.message };
        }
    }
};

export const workspaceReadArtifactTool: ToolDefinition = {
    name: 'workspace_read_artifact',
    description: 'Le o conteudo de um arquivo existente dentro do output de um projeto.',
    input_schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string', description: 'ID do projeto ativo' },
            filename: { type: 'string', description: 'Caminho relativo do arquivo dentro do output (ex: src/index.js)' }
        },
        required: ['project_id', 'filename']
    },
    execute: async (input: any, context?: any) => {
        const trace_id = context?.trace_id || getContext().trace_id;

        if (!input.project_id) return { success: false, error: 'project_id e obrigatorio' };
        if (!input.filename) return { success: false, error: 'filename e obrigatorio' };
        if (!/^[a-z0-9\-]+-\d+$/.test(input.project_id)) {
            return { success: false, error: 'project_id invalido. Formato esperado: slug-timestamp' };
        }

        emitDebug('tool', { name: 'workspace_read:start', trace_id, project_id: input.project_id, filename: input.filename });

        try {
            const content = workspaceService.readArtifact(input.project_id, input.filename);
            if (content === null) {
                return { success: false, error: 'arquivo nao encontrado' };
            }
            emitDebug('tool', { name: 'workspace_read:success', trace_id, filename: input.filename });
            return { success: true, data: { content } };
        } catch (err: any) {
            emitDebug('tool', { name: 'workspace_read:error', trace_id, error: err.message });
            return { success: false, error: err.message };
        }
    }
};

export { workspaceValidateProjectTool };
export { workspaceRunProjectTool };
