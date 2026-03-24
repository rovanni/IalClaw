import { toolRegistry } from '../tools/ToolRegistry';
import { getContext } from '../../shared/TraceContext';
import { emitDebug } from '../../shared/DebugBus';
import { SessionManager } from '../../shared/SessionManager';

export async function executeToolCall(toolName: string, input: any) {
    const tool = toolRegistry.get(toolName);
    const ctx = getContext();

    if (!tool) {
        emitDebug('agent:error', { trace_id: ctx.trace_id, error: `Tool ${toolName} não encontrada` });
        throw new Error(`Tool ${toolName} não encontrada`);
    }

    const session = SessionManager.getCurrentSession();

    // Auto-Heal: LLM esqueceu o project_id, mas acabou de criar um
    if (toolName === 'workspace_save_artifact' && !input.project_id && session?.current_project_id) {
        input.project_id = session.current_project_id;
        emitDebug('agent:thought', { type: 'thought', content: `[Auto-Heal] Injetando project_id esquecido da sessão: ${session.current_project_id}` });
    }

    const start = Date.now();
    emitDebug('agent:tool:start', { trace_id: ctx.trace_id, tool: toolName, input });


    // Executa blindado
    let result;
    try {
        result = await tool.execute(input, ctx);
    } catch (err: any) {
        result = { success: false, error: err.message };
    }

    emitDebug('agent:tool:end', { trace_id: ctx.trace_id, tool: toolName, duration_ms: Date.now() - start, result });

    return result;
}