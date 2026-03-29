import { toolRegistry } from '../tools/ToolRegistry';
import { getContext } from '../../shared/TraceContext';
import { emitDebug } from '../../shared/DebugBus';
import { SessionManager } from '../../shared/SessionManager';
import { validateToolInput } from '../../utils/validateToolInput';

function extractIssuesFromMessage(msg: string) {
    return [{ path: '', message: msg, expected: null, received: null }];
}

function sanitizeInput(input: any, toolName: string): any {
    if (!input || typeof input !== 'object') {
        return {};
    }
    
    const sanitized: any = { ...input };
    
    if (sanitized.path && typeof sanitized.path === 'string') {
        sanitized.path = sanitized.path.replace(/[<>:"|?*]/g, '_');
        
        if (sanitized.path.includes('..')) {
            sanitized.path = sanitized.path.replace(/\.\./g, '_');
        }
    }
    
    if (sanitized.content && typeof sanitized.content === 'string') {
        const maxContentSize = 500000;
        if (sanitized.content.length > maxContentSize) {
            sanitized.content = sanitized.content.slice(0, maxContentSize) + '\n[... conteúdo truncado]';
        }
    }
    
    return sanitized;
}

function validatePermissions(toolName: string, input: any): void {
    const dangerousTools = ['system.exec', 'run_command', 'shell_exec'];
    
    if (dangerousTools.includes(toolName)) {
        if (input?.command) {
            const cmdLower = input.command.toLowerCase();
            const blocked = ['rm -rf', 'del /', 'format', 'mkfs', 'dd if='];
            for (const block of blocked) {
                if (cmdLower.includes(block)) {
                    throw new Error(`Permissão negada: comando perigoso detectado`);
                }
            }
        }
    }
}

function restrictPaths(toolName: string, input: any): any {
    if (!input?.path) {
        return input;
    }
    
    const restrictedPatterns = [
        /^\/etc\/passwd/i,
        /^\/etc\/shadow/i,
        /^[A-Z]:\\windows\\system32/i,
        /^[A-Z]:\\boot/i,
    ];
    
    for (const pattern of restrictedPatterns) {
        if (pattern.test(input.path)) {
            throw new Error(`Acesso negado: caminho restrito`);
        }
    }
    
    return input;
}

export async function executeToolCall(toolName: string, input: any) {
    const ctx = getContext();
    const traceId = ctx?.trace_id;
    
    let safeInput = input && typeof input === 'object' ? input : {};
    
    safeInput = sanitizeInput(safeInput, toolName);
    
    restrictPaths(toolName, safeInput);
    
    validatePermissions(toolName, safeInput);
    
    const tool = toolRegistry.get(toolName);

    if (!tool) {
        emitDebug('agent:error', { trace_id: traceId, error: `Tool ${toolName} nao encontrada` });
        throw new Error(`Tool ${toolName} nao encontrada`);
    }

    const session = SessionManager.getCurrentSession();

    if (toolName === 'workspace_save_artifact' && !safeInput.project_id && session?.current_project_id) {
        safeInput.project_id = session.current_project_id;
        emitDebug('agent:thought', { type: 'thought', content: `[Auto-Heal] Injetando project_id esquecido da sessao: ${session.current_project_id}` });
    }

    let validatedInput;
    try {
        validatedInput = validateToolInput(toolName, safeInput);
    } catch (err: any) {
        const issues = err?.issues || extractIssuesFromMessage(err.message);
        const errorPayload = {
            type: 'tool_input',
            tool: toolName,
            issues,
            received_input: safeInput || null
        };

        emitDebug('tool_input_error', {
            trace_id: traceId,
            ...errorPayload
        });
        emitDebug('thought', {
            type: 'error',
            content: `[TOOL_INPUT] ${toolName} rejeitou input. Issues: ${issues.map((issue: any) => `${issue.path || '<root>'}: ${issue.message}`).join(' | ')}`
        });
        throw new Error(`tool_input_error::${JSON.stringify(errorPayload)}`);
    }

    const start = Date.now();
    emitDebug('tool_call', { trace_id: traceId, tool: toolName, input: validatedInput });
    emitDebug('agent:tool:start', { trace_id: traceId, tool: toolName, input: validatedInput });

    let result;
    try {
        result = await tool.execute(validatedInput, ctx);
    } catch (err: any) {
        result = { success: false, error: err.message };
    }

    emitDebug('agent:tool:end', { trace_id: traceId, tool: toolName, duration_ms: Date.now() - start, result });

    return result;
}
