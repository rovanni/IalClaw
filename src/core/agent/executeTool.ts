import { toolRegistry } from '../tools/ToolRegistry';
import { getContext } from '../../shared/TraceContext';
import { emitDebug } from '../../shared/DebugBus';
import { SessionManager } from '../../shared/SessionManager';
import { validateToolInput } from '../../utils/validateToolInput';

export async function executeToolCall(toolName: string, input: any) {
    const tool = toolRegistry.get(toolName);
    const ctx = getContext();

    if (!tool) {
        emitDebug('agent:error', { trace_id: ctx.trace_id, error: `Tool ${toolName} nao encontrada` });
        throw new Error(`Tool ${toolName} nao encontrada`);
    }

    const session = SessionManager.getCurrentSession();
    const safeInput = input && typeof input === 'object' ? input : {};

    if (toolName === 'workspace_save_artifact' && !safeInput.project_id && session?.current_project_id) {
        safeInput.project_id = session.current_project_id;
        emitDebug('agent:thought', { type: 'thought', content: `[Auto-Heal] Injetando project_id esquecido da sessao: ${session.current_project_id}` });
    }

    let validatedInput;
    try {
        validatedInput = validateToolInput(toolName, safeInput);
    } catch (err: any) {
        emitDebug('tool_input_error', {
            trace_id: ctx.trace_id,
            tool: toolName,
            input: safeInput,
            error: err.message
        });
        throw new Error(`tool_input_error: ${err.message}`);
    }

    const start = Date.now();
    emitDebug('tool_call', { trace_id: ctx.trace_id, tool: toolName, input: validatedInput });
    emitDebug('agent:tool:start', { trace_id: ctx.trace_id, tool: toolName, input: validatedInput });

    let result;
    try {
        result = await tool.execute(validatedInput, ctx);
    } catch (err: any) {
        result = { success: false, error: err.message };
    }

    emitDebug('agent:tool:end', { trace_id: ctx.trace_id, tool: toolName, duration_ms: Date.now() - start, result });

    return result;
}
