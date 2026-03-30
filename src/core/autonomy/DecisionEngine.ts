// "Não basta saber o que fazer — precisa saber quando fazer sem pedir permissão."
import { getSecurityPolicy } from '../policy/SecurityPolicyProvider';
import { ExecutionRoute } from './ActionRouter';

export enum AutonomyDecision {
    EXECUTE = "execute",   // Executar automaticamente
    ASK = "ask",           // Perguntar ao usuário
    CONFIRM = "confirm"    // Confirmar antes de executar
}

export enum AutonomyLevel {
    SAFE = "safe",           // Sempre pergunta/confirma
    BALANCED = "balanced",   // Pergunta se houver risco ou dúvida
    AGGRESSIVE = "aggressive" // Executa direto se possível
}

export interface AutonomyContext {
    intent: string;           // Intenção: "git_push", "content_generation", etc.
    isContinuation: boolean;  // É continuação de tarefa anterior?
    hasAllParams: boolean;    // Tem todos os parâmetros necessários?
    riskLevel: 'low' | 'medium' | 'high';  // Nível de risco
    isDestructive: boolean;   // Ação destrutiva (delete, drop, etc.)?
    isReversible: boolean;     // Ação pode ser revertida?
    confidence?: number;       // Confiança na classificação/roteamento
    autonomyLevel?: AutonomyLevel; // Nível de autonomia global
    intentSubtype?: string;    // command, suggestion, doubt
    route?: ExecutionRoute;    // Rota decidida pelo orquestrador/roteador
}

/**
 * Motor de decisão de autonomia.
 * Decide: EXECUTAR | PERGUNTAR | CONFIRMAR
 */
export function decideAutonomy(ctx: AutonomyContext): AutonomyDecision {
    const level = ctx.autonomyLevel || AutonomyLevel.BALANCED;
    const confidence = ctx.confidence ?? 1.0;
    const isCommand = ctx.intentSubtype === 'command' || !ctx.intentSubtype;

    // ═══════════════════════════════════════════════════════════════════
    // 🔴 SAFE MODE: Sempre confirmação/pergunta
    // ═══════════════════════════════════════════════════════════════════
    if (level === AutonomyLevel.SAFE) {
        return ctx.hasAllParams ? AutonomyDecision.CONFIRM : AutonomyDecision.ASK;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🔴 ALTO RISCO: Destrutivo ou risco alto → confirmar SEMPRE
    // ═══════════════════════════════════════════════════════════════════
    if (ctx.isDestructive || ctx.riskLevel === 'high') {
        return AutonomyDecision.CONFIRM;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🟡 DUVIDA OU SUGESTÃO: Tratamento diferenciado
    // "acho que deveria mover" -> CONFIRM (mais natural)
    // "por que os arquivos estão aí?" -> ASK (precisa de info)
    // ═══════════════════════════════════════════════════════════════════
    if (ctx.intentSubtype === 'doubt') {
        return AutonomyDecision.ASK;
    }

    if (ctx.intentSubtype === 'suggestion') {
        // Sugestões de baixo risco podem ser confirmadas, não apenas perguntadas
        return ctx.riskLevel === 'low'
            ? AutonomyDecision.CONFIRM
            : AutonomyDecision.ASK;
    }

    // NOVO: Incerteza total → perguntar
    if (ctx.intentSubtype === 'uncertain' && ctx.intent !== 'conversation') {
        return AutonomyDecision.ASK;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🟡 BAIXA CONFIANÇA: Se < 0.98 em modo balanceado, perguntar por segurança
    // ──────── EXCEPT: Se a rota for DIRECT_LLM e risco baixo, permitimos.
    // ═══════════════════════════════════════════════════════════════════
    if (level === AutonomyLevel.BALANCED && confidence < 0.98 && ctx.riskLevel !== 'low') {
        if (ctx.route !== ExecutionRoute.DIRECT_LLM) {
            return AutonomyDecision.ASK;
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🟡 AMARELO: Falta informação → perguntar
    // ═══════════════════════════════════════════════════════════════════
    if (!ctx.hasAllParams) {
        return AutonomyDecision.ASK;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🟢 VERDE: Risco baixo ou Autonomia Agressiva → executar
    // ═══════════════════════════════════════════════════════════════════
    if (level === AutonomyLevel.AGGRESSIVE || ctx.riskLevel === 'low') {
        return AutonomyDecision.EXECUTE;
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🟡 AMARELO: Risco médio → decidir baseado na confiança (BALANCED)
    // ═══════════════════════════════════════════════════════════════════
    if (ctx.riskLevel === 'medium') {
        // Se a confiança for ultra-alta, podemos arriscar a execução automática
        return (confidence >= 0.95) ? AutonomyDecision.EXECUTE : AutonomyDecision.ASK;
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
        return getSecurityPolicy().detectRisk(intent);
    },

    /**
     * Detecta se o comando é destrutivo.
     */
    isDestructiveCommand(cmd: string): boolean {
        return getSecurityPolicy().isDestructive(cmd);
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
    },

    /**
     * NOVO: Detecta tarefas híbridas que precisam de LLM + Tools.
     * Ex: "crie um arquivo com esse conteúdo", "gere um script e salve"
     */
    isHybridTask(input: string): boolean {
        const hybridPatterns = [
            /crie?\s+(um|uma|o|a)?\s*(arquivo|script|módulo|arquivos)/i,
            /gere?\s+(um|uma|o|a)?\s*(arquivo|script|módulo|arquivos)/i,
            /salv[ae]?\s+(esse|este|o)?\s*(arquivo|conteúdo|script)/i,
            /escrev[ae]?\s+(um|uma|o|a)?\s*(arquivo|script|módulo)/i
        ];

        return hybridPatterns.some(p => p.test(input));
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
        route?: ExecutionRoute;
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