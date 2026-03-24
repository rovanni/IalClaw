import { workspaceService, ProjectType } from '../services/WorkspaceService';
import { ToolDefinition } from '../core/tools/types';
import { getContext } from '../shared/TraceContext';
import { emitDebug } from '../shared/DebugBus';

export const workspaceCreateProjectTool: ToolDefinition = {
    name: 'workspace_create_project',
    description: 'Cria um novo projeto estruturado no disco. OBRIGATÓRIO chamar antes de salvar arquivos.',
    input_schema: {
        type: 'object',
        properties: {
            name: { type: 'string', description: 'Nome do projeto' },
            type: { type: 'string', description: 'code | slides | game | document | automation' },
            prompt: { type: 'string', description: 'O que o projeto deve fazer' }
        },
        required: ['name', 'type', 'prompt']
    },
    execute: async (input, context) => {
        const trace_id = context?.trace_id || getContext().trace_id;
        
        emitDebug('tool', { name: 'workspace_create:start', trace_id, input });

        try {
            const projectId = workspaceService.createProject(
                input.name,
                input.type as ProjectType,
                context?.agent_id || 'agent_core',
                input.prompt
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
    description: 'Salva um arquivo físico dentro de um projeto existente.',
    input_schema: {
        type: 'object',
        properties: {
            project_id: { type: 'string', description: 'ID retornado pela tool workspace_create_project' },
            filename: { type: 'string', description: 'Nome e extensão (ex: src/index.js)' },
            content: { type: 'string', description: 'Conteúdo integral (não resumido) do arquivo' }
        },
        required: ['project_id', 'filename', 'content']
    },
    execute: async (input, context) => {
        const trace_id = context?.trace_id || getContext().trace_id;
        
        if (!input.project_id) return { success: false, error: "project_id é obrigatório" };
        if (!/^[a-z0-9\-]+-\d+$/.test(input.project_id)) return { success: false, error: "project_id inválido. Formato esperado: slug-timestamp" };

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