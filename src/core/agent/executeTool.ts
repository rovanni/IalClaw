import { toolRegistry } from '../tools/ToolRegistry';
import { getContext } from '../../shared/TraceContext';
import { emitDebug } from '../../shared/DebugBus';

interface ExecutionState {
    current_project_id?: string;
    steps: number;
}

// Memória de execução viva amarrada ao Trace ID
const activeStates = new Map<string, ExecutionState>();

export async function executeToolCall(toolName: string, input: any) {
    const tool = toolRegistry.get(toolName);
    const ctx = getContext();

    if (!activeStates.has(ctx.trace_id)) activeStates.set(ctx.trace_id, { steps: 0 });
    const state = activeStates.get(ctx.trace_id)!;

    if (!tool) {
        emitDebug('agent:error', { trace_id: ctx.trace_id, error: `Tool ${toolName} não encontrada` });
        throw new Error(`Tool ${toolName} não encontrada`);
    }

    // Auto-Heal: LLM esqueceu o project_id, mas acabou de criar um
    if (toolName === 'workspace_save_artifact' && !input.project_id && state.current_project_id) {
        input.project_id = state.current_project_id;
        emitDebug('agent:thought', { type: 'thought', content: `[Auto-Heal] Injetando project_id esquecido: ${state.current_project_id}` });
    }

    const start = Date.now();
    emitDebug('agent:tool:start', { trace_id: ctx.trace_id, tool: toolName, input });

    
    // Executa blindado
    let result;
    try {
        result = await tool.execute(input, ctx);
        if (toolName === 'workspace_create_project' && result.success) {
            state.current_project_id = result.data.project_id; // Atualiza a memória de execução
        }
    } catch (err: any) {
        result = { success: false, error: err.message };
    }

    emitDebug('agent:tool:end', { trace_id: ctx.trace_id, tool: toolName, duration_ms: Date.now() - start, result });

    return result;
}