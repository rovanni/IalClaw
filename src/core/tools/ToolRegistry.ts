import { ToolDefinition } from './types';
import { workspaceApplyDiffTool, workspaceCreateProjectTool, workspaceRunProjectTool, workspaceSaveArtifactTool, workspaceValidateProjectTool } from '../../tools/WorkspaceTools';
import { safeToolExecution } from './safeToolExecution';
    async execute(name: string, input: any, context?: any) {
        const tool = this.get(name);
        if (!tool) throw new Error(`Tool not found: ${name}`);
        return await safeToolExecution(tool.execute.bind(tool), input);
    }

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

toolRegistry.register(workspaceCreateProjectTool);
toolRegistry.register(workspaceSaveArtifactTool);
toolRegistry.register(workspaceApplyDiffTool);
toolRegistry.register(workspaceValidateProjectTool);
toolRegistry.register(workspaceRunProjectTool);
