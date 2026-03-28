// ── DecisionEngine: Motor de Autonomia ───────────────────────────────────────
// Decide quando o agente deve EXECUTAR, PERGUNTAR ou CONFIRMAR.
// "Não basta saber o que fazer — precisa saber quando fazer sem pedir permissão."

export enum AutonomyDecision {
    EXECUTE = "execute",   // Executar automaticamente
    ASK = "ask",           // Perguntar ao usuário
    CONFIRM = "confirm"    // Confirmar antes de executar
}

export interface AutonomyContext {
    intent: string;           // Intenção: "git_push", "content_generation", etc.
    isContinuation: boolean;  // É continuação de tarefa anterior?
    hasAllParams: boolean;    // Tem todos os parâmetros necessários?
    riskLevel: 'low' | 'medium' | 'high';  // Nível de risco
    isDestructive: boolean;   // Ação destrutiva (delete, drop, etc.)?
    isReversible: boolean;     // Ação pode ser revertida?
}

/**
 * Motor de decisão de autonomia.
 * Decide: EXECUTAR | PERGUNTAR | CONFIRMAR
 */
export function decideAutonomy(ctx: AutonomyContext): AutonomyDecision {
    // ═══════════════════════════════════════════════════════════════════
    // 🔴 VERMELHO: Alto risco ou destrutivo → confirmar SEMPRE
    // ═══════════════════════════════════════════════════════════════════
    if (ctx.isDestructive || ctx.riskLevel === 'high') {
        return AutonomyDecision.CONFIRM;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🟡 AMARELO: Falta informação → perguntar
    // ═══════════════════════════════════════════════════════════════════
    if (!ctx.hasAllParams) {
        return AutonomyDecision.ASK;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🟢 VERDE: Continuação + seguro → executar automaticamente
    // ═══════════════════════════════════════════════════════════════════
    if (ctx.isContinuation && ctx.riskLevel === 'low') {
        return AutonomyDecision.EXECUTE;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🟢 VERDE: Risco baixo → executar automaticamente
    // ═══════════════════════════════════════════════════════════════════
    if (ctx.riskLevel === 'low') {
        return AutonomyDecision.EXECUTE;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🟡 AMARELO: Risco médio → perguntar por segurança
    // ═══════════════════════════════════════════════════════════════════
    if (ctx.riskLevel === 'medium') {
        return AutonomyDecision.ASK;
    }

    // ═══════════════════════════════════════════════════════════════════
    // FALLBACK: Perguntar se não houver certeza
    // ═══════════════════════════════════════════════════════════════════
    return AutonomyDecision.ASK;
}

/**
 * Helpers para detectar risco e destrutividade.
 */
export const AutonomyHelpers = {
    /**
     * Detecta nível de risco baseado na intenção.
     */
    detectRisk(intent: string): 'low' | 'medium' | 'high' {
        const highRiskPatterns = [
            /delete/i, /remove/i, /drop/i, /truncate/i, /format/i,
            /uninstall/i, /purge/i, /destroy/i, /reset/i
        ];

        const mediumRiskPatterns = [
            /install/i, /write/i, /create/i, /update/i,
            /push/i, /deploy/i, /publish/i
        ];

        if (highRiskPatterns.some(p => p.test(intent))) {
            return 'high';
        }

        if (mediumRiskPatterns.some(p => p.test(intent))) {
            return 'medium';
        }

        return 'low';
    },

    /**
     * Detecta se o comando é destrutivo.
     */
    isDestructiveCommand(cmd: string): boolean {
        const destructivePatterns = [
            /rm\s+/i, /del\s+/i, /drop\s+/i, /truncate/i,
            /format/i, /erase/i, /wipe/i, /delete/i,
            /uninstall/i, /purge/i, /destroy/i
        ];

        return destructivePatterns.some(p => p.test(cmd));
    },

    /**
     * Detecta se a ação é reversível.
     */
    isReversibleAction(intent: string): boolean {
        const reversiblePatterns = [
            /git\s+push/i, /git\s+commit/i, /create/i, /write/i,
            /install/i, /generate/i, /build/i
        ];

        return reversiblePatterns.some(p => p.test(intent));
    },

    /**
     * Detecta continuação de tarefa anterior.
     */
    isContinuation(input: string, lastIntent?: string): boolean {
        const continuationIndicators = [
            /^e\s+/i, /^e\s+para/i, /^usar/i, /^utilizar/i,
            /^com\s+esse/i, /^agora\s+com/i, /^usando/i
        ];

        if (continuationIndicators.some(p => p.test(input))) {
            return true;
        }

        // Se tem última intenção e input é curto, provavelmente continuação
        if (lastIntent && input.split(/\s+/).length < 10) {
            return true;
        }

        return false;
    }
};

/**
 * Cria contexto de autonomia para uma ação.
 */
export function createAutonomyContext(
    intent: string,
    params: {
        isContinuation?: boolean;
        hasAllParams?: boolean;
        riskLevel?: 'low' | 'medium' | 'high';
        isDestructive?: boolean;
        isReversible?: boolean;
    } = {}
): AutonomyContext {
    return {
        intent,
        isContinuation: params.isContinuation ?? false,
        hasAllParams: params.hasAllParams ?? true,
        riskLevel: params.riskLevel ?? AutonomyHelpers.detectRisk(intent),
        isDestructive: params.isDestructive ?? AutonomyHelpers.isDestructiveCommand(intent),
        isReversible: params.isReversible ?? AutonomyHelpers.isReversibleAction(intent)
    };
}

/**
 * Logger de decisão de autonomia (útil para debug).
 */
export function logAutonomyDecision(
    ctx: AutonomyContext,
    decision: AutonomyDecision,
    logger?: { info: (msg: string, data?: any) => void }
): void {
    const logData = {
        intent: ctx.intent,
        decision,
        riskLevel: ctx.riskLevel,
        isDestructive: ctx.isDestructive,
        isContinuation: ctx.isContinuation,
        hasAllParams: ctx.hasAllParams
    };

    if (logger) {
        logger.info(`[AUTONOMY] Decision: ${decision}`, logData);
    } else {
        console.log(`[AUTONOMY] Decision: ${decision}`, JSON.stringify(logData));
    }
}