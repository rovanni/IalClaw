import { workspaceService, ProjectType } from '../services/WorkspaceService';

export const workspaceCreateTool = {
    name: 'workspace_create_project',
    description: 'Cria um novo projeto estruturado no workspace. Retorna o ID único do projeto para uso posterior.',
    parameters: {
        name: 'string (ex: Snake Game)',
        type: 'string (code | slides | game | document | automation)',
        prompt: 'string (descrição completa do que o usuário pediu)'
    },
    execute: async (args: { name: string; type: string; prompt: string }) => {
        // Aciona o serviço cognitivo e reserva a pasta no disco
        const projectId = workspaceService.createProject(args.name, args.type as ProjectType, 'agent_core', args.prompt);
        return `[SUCCESS] Projeto criado com sucesso. O ID do projeto é: ${projectId}. Use este ID na tool workspace_save_artifact.`;
    }
};

export const workspaceSaveTool = {
    name: 'workspace_save_artifact',
    description: 'Salva um arquivo de código, texto ou marcação dentro do projeto especificado.',
    parameters: {
        project_id: 'string (O ID retornado pela tool workspace_create_project)',
        filename: 'string (Nome com a extensão. Ex: index.html ou src/main.js)',
        content: 'string (O conteúdo integral e limpo do arquivo)'
    },
    execute: async (args: { project_id: string; filename: string; content: string }) => {
        // Grava no disco na subpasta correspondente ao projeto
        const savedPath = workspaceService.saveArtifact(args.project_id, args.filename, args.content);
        return `[SUCCESS] Arquivo salvo fisicamente em: ${savedPath}`;
    }
};
