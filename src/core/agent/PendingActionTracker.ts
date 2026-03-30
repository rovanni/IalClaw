import { PendingAction, SessionContext } from '../../shared/SessionManager';

const PENDING_ACTION_TTL_MS = 10 * 60 * 1000; // 10 minutos
const MAX_PENDING_ACTIONS = 3;

export function setPendingAction(
    session: SessionContext,
    action: {
        type: PendingAction['type'];
        payload: PendingAction['payload'];
    }
): PendingAction {
    const now = Date.now();
    cleanupExpiredPendingActions(session, now);

    // Dedupe por tipo+payload para evitar duplicatas no mesmo fluxo.
    session.pending_actions = session.pending_actions.filter(existing => {
        if (existing.type !== action.type) return true;
        if (existing.type === 'install_skill') {
            const existingName = existing.payload.skillName?.toLowerCase() || '';
            const actionName = action.payload.skillName?.toLowerCase() || '';
            return existingName !== actionName;
        }
        if (existing.type === 'install_capability') {
            const existingCap = existing.payload.capability?.toLowerCase() || '';
            const actionCap = action.payload.capability?.toLowerCase() || '';
            return existingCap !== actionCap;
        }
        return true;
    });

    const pending: PendingAction = {
        id: `pending_${now}_${Math.random().toString(36).slice(2, 8)}`,
        type: action.type,
        status: 'awaiting_confirmation',
        payload: action.payload,
        timestamp: now,
        expires_at: now + PENDING_ACTION_TTL_MS,
        createdAt: now
    };

    session.pending_actions.push(pending);
    if (session.pending_actions.length > MAX_PENDING_ACTIONS) {
        session.pending_actions = session.pending_actions.slice(-MAX_PENDING_ACTIONS);
    }

    return pending;
}

export function getPendingAction(session: SessionContext, now: number = Date.now()): PendingAction | null {
    cleanupExpiredPendingActions(session, now);
    if (!session.pending_actions.length) return null;
    return session.pending_actions[session.pending_actions.length - 1] || null;
}

export function clearPendingAction(session: SessionContext, actionId?: string): void {
    if (!actionId) {
        session.pending_actions = [];
        return;
    }

    session.pending_actions = session.pending_actions.filter(action => action.id !== actionId);
}

export function isConfirmation(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized || normalized.length > 80) return false;
    if (normalized.includes('?')) return false;

    const strong = /^(sim|yes|ok|okay|pode|pode sim|instala|instalar|instale|pode instalar|pode instalar sim|go ahead|manda ver|confirmo|confirmado|pode prosseguir|prosseguir)$/i;
    if (strong.test(normalized)) return true;

    const permissive = /\b(sim|yes|ok|instala|instalar|instale|go ahead|prosseguir|pode)\b/i;
    return permissive.test(normalized);
}

export function isDecline(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized || normalized.length > 80) return false;

    return /^(nao|não|no|cancelar|cancela|cancel|parar|pare|deixa|deixa pra la|deixa pra lá|melhor nao|melhor não)$/i.test(normalized);
}

export function shouldDropPendingActionOnTopicShift(text: string): boolean {
    const normalized = normalizeText(text);
    if (!normalized) return false;

    if (isConfirmation(normalized) || isDecline(normalized)) return false;

    // Indica mudança explícita de assunto.
    return /\b(mudar de assunto|outro assunto|esquece isso|deixa isso|agora outra coisa|voltando|na verdade)\b/i.test(normalized);
}

function cleanupExpiredPendingActions(session: SessionContext, now: number): void {
    session.pending_actions = session.pending_actions.filter(action => {
        // Ações expiradas (TTL padrão)
        if (action.expires_at <= now) return false;

        // Ações completadas há mais de 30 segundos
        if (action.status === 'completed' && action.completedAt) {
            if (now - action.completedAt > 30000) return false;
        }

        return true;
    });
}

function normalizeText(text: string): string {
    return String(text || '').trim().toLowerCase();
}
