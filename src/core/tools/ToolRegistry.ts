import { ToolDefinition } from './types';
import { workspaceApplyDiffTool, workspaceCreateProjectTool, workspaceListFilesTool, workspaceListProjectsTool, workspaceReadArtifactTool, workspaceRunProjectTool, workspaceSaveArtifactTool, workspaceValidateProjectTool } from '../../tools/WorkspaceTools';

class ToolRegistry {
    private tools = new Map<string, ToolDefinition>();

    register(tool: ToolDefinition) {
        this.tools.set(tool.name, tool);
    }

    get(name: string): ToolDefinition | undefined {
        return this.tools.get(name);
    }

    list(): ToolDefinition[] {
        return Array.from(this.tools.values());
    }
}

export const toolRegistry = new ToolRegistry();

toolRegistry.register(workspaceListProjectsTool);
toolRegistry.register(workspaceListFilesTool);
toolRegistry.register(workspaceReadArtifactTool);
toolRegistry.register(workspaceCreateProjectTool);
toolRegistry.register(workspaceSaveArtifactTool);
toolRegistry.register(workspaceApplyDiffTool);
toolRegistry.register(workspaceValidateProjectTool);
toolRegistry.register(workspaceRunProjectTool);
