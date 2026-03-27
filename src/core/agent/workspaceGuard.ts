// ── Workspace Guard ───────────────────────────────────────────────────────────
// Intercepts workspace_create_project calls and reuses an existing project
// when one with the same normalized name is already present on disk.
// This is a structural safety net — it enforces deduplication regardless of
// whether the LLM remembered to check workspace_list_projects first.

import { workspaceService } from '../../services/WorkspaceService';
import { SessionManager } from '../../shared/SessionManager';
import { emitDebug } from '../../shared/DebugBus';
import { getContext } from '../../shared/TraceContext';

function normalizeName(str: string): string {
    return str.toLowerCase().replace(/\s+/g, ' ').trim();
}

export type WorkspaceGuardResult =
    | { handled: false }
    | { handled: true; result: Record<string, unknown> };

/**
 * Guard called immediately before workspace_create_project executes.
 *
 * If a project with the same normalized name already exists, the guard
 * short-circuits creation, injects the existing project_id into the active
 * session, and returns the same success shape that the real tool would return.
 *
 * "LLM sugere, sistema garante."
 */
export function checkWorkspaceCreateGuard(input: any): WorkspaceGuardResult {
    const requestedName: unknown = input?.name ?? input?.project_name;

    if (!requestedName || typeof requestedName !== 'string' || !requestedName.trim()) {
        return { handled: false };
    }

    const ctx = getContext();
    const normalizedRequested = normalizeName(requestedName);

    let projects: ReturnType<typeof workspaceService.listProjects>;
    try {
        projects = workspaceService.listProjects();
    } catch {
        // Defensive: if listing fails, let the normal creation path handle it.
        return { handled: false };
    }

    const existing = projects.find(p => normalizeName(p.name) === normalizedRequested);
    if (!existing) {
        return { handled: false };
    }

    const session = SessionManager.getCurrentSession();
    if (session) {
        session.current_project_id = existing.project_id;
        session.last_action = `workspace_guard: reused project ${existing.project_id}`;
    }

    emitDebug('workspace_guard', {
        trace_id: ctx.trace_id,
        action: 'reuse_project',
        requested_name: requestedName,
        existing_project_id: existing.project_id,
        existing_project_name: existing.name
    });

    emitDebug('thought', {
        type: 'thought',
        content: `[WORKSPACE GUARD] Projeto "${existing.name}" ja existe (${existing.project_id}). Reutilizando em vez de criar duplicata.`
    });

    return {
        handled: true,
        result: {
            success: true,
            data: { project_id: existing.project_id },
            _guard: {
                action: 'reuse_project',
                message: `Projeto semelhante ja existe: ${existing.name} (${existing.project_id})`,
                project_id: existing.project_id
            }
        }
    };
}
