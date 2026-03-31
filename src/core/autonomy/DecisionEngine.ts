// "Não basta saber o que fazer — precisa saber quando fazer sem pedir permissão."
import { getSecurityPolicy } from '../policy/SecurityPolicyProvider';
import { ExecutionRoute, TaskNature } from './ActionRouter';
import { ResolutionProposal } from './CapabilityResolver';
import { AggregatedConfidence, UncertaintyType } from './ConfidenceScorer';

export enum AutonomyDecision {
    EXECUTE = "execute",           // Executar automaticamente
    ASK = "ask",                   // Perguntar ao usuário (genérico)
    CONFIRM = "confirm",           // Confirmar antes de executar
    ASK_CLARIFICATION = "ask_clarification",     // Intenção obscura
    ASK_TOOL_SELECTION = "ask_tool_selection",   // Intenção clara, mas ferramenta incerta
    ASK_EXECUTION_STRATEGY = "ask_strategy",      // Conflito interno (intenção vs ação)
    EXECUTE_PENDING = "execute_pending",         // Executar ação pendente confirmada
    CANCEL = "cancel"                            // Cancelar ação pendente
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
    confidence?: number;       // Score depreciado (usar full confidence se disponível)
    aggregatedConfidence?: AggregatedConfidence; // NOVO: Diagnóstico completo
    autonomyLevel?: AutonomyLevel; // Nível de autonomia global
    intentSubtype?: string;    // command, suggestion, doubt
    route?: ExecutionRoute;    // Rota decidida pelo orquestrador/roteador
    nature?: TaskNature;       // Natureza da tarefa (informativa vs executável)
    capabilityGap?: ResolutionProposal; // Lacuna detectada pelo Resolver
    pendingAction?: any;       // Ação pendente atual
    suggestedIntent?: any;      // Intenção sugerida pelo IntentDetector
}

/**
 * Motor de decisão de autonomia evoluído com diagnósticos.
 * Decide: EXECUTAR | PERGUNTAR | CONFIRMAR | DIAGNÓSTICOS ESPECÍFICOS
 */
export function decideAutonomy(ctx: AutonomyContext): AutonomyDecision {
    const level = ctx.autonomyLevel || AutonomyLevel.BALANCED;
    const confidence = ctx.aggregatedConfidence?.score ?? ctx.confidence ?? 1.0;
    const diagnostics = ctx.aggregatedConfidence;

    // ═══════════════════════════════════════════════════════════════════
    // 🧠 PENDING ACTION CONTINUITY: Decidir baseado no intent detectado
    // ═══════════════════════════════════════════════════════════════════
    if (ctx.pendingAction && ctx.suggestedIntent) {
        const intent = ctx.suggestedIntent.type;

        if (intent === 'execute' || intent === 'continue') {
            return AutonomyDecision.EXECUTE_PENDING;
        }

        if (intent === 'stop' || intent === 'cancel') {
            return AutonomyDecision.CANCEL;
        }

        if (intent === 'question') {
            return AutonomyDecision.ASK; // Delegar para o LLM explicar
        }
    }

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
    // 🧠 DIAGNÓSTICO DE INCERTEZA (Confidence Decomposition in Action)
    // ═══════════════════════════════════════════════════════════════════
    if (diagnostics) {
        // 1. Conflito Interno: Sei o que quer, mas não como fazer (ou vice-versa)
        if (diagnostics.isConflict) {
            return AutonomyDecision.ASK_EXECUTION_STRATEGY;
        }

        // 2. Incerteza de Intenção: Não entendi bem o pedido
        if (diagnostics.uncertaintyType === UncertaintyType.INTENT || diagnostics.factors.classifier < 0.60) {
            return AutonomyDecision.ASK_CLARIFICATION;
        }

        // 3. Incerteza de Execução: Sei o que quer, mas a ferramenta/rota está obscura
        if (diagnostics.uncertaintyType === UncertaintyType.EXECUTION || diagnostics.factors.router < 0.60) {
            // Se o risco for baixo, podemos tentar EXECUTE no modo AGGRESSIVE, 
            // mas no BALANCED perguntamos a ferramenta.
            if (level !== AutonomyLevel.AGGRESSIVE) {
                return AutonomyDecision.ASK_TOOL_SELECTION;
            }
        }
    }

    // ═══════════════════════════════════════════════════════════════════
    // 🟠 CAPABILITY RESOLUTION (Self-Healing)
    // ═══════════════════════════════════════════════════════════════════
    if (ctx.capabilityGap?.hasGap) {
        // Cruzamento: Se a confiança na rota é baixa E tem gap, não sugerimos instalação direto
        if (diagnostics && diagnostics.factors.router < 0.70) {
            return AutonomyDecision.ASK_TOOL_SELECTION; // "Talvez nem precise dessa ferramenta"
        }

        // Se a tarefa é informativa, ignoramos o gap (regra anti-regressão)
        if (ctx.nature === TaskNature.INFORMATIVE) {
            return AutonomyDecision.EXECUTE;
        }

        // Se é uma lacuna bloqueante, sempre confirmar instalação
        if (ctx.capabilityGap.gap?.severity === 'blocking') {
            return AutonomyDecision.CONFIRM;
        }

        return AutonomyDecision.CONFIRM;
    }

    // [Mantendo lógica legada para compatibilidade se não houver diagnostics]
    if (ctx.intentSubtype === 'doubt') return AutonomyDecision.ASK;
    if (ctx.intentSubtype === 'suggestion') return ctx.riskLevel === 'low' ? AutonomyDecision.CONFIRM : AutonomyDecision.ASK;
    if (ctx.intentSubtype === 'uncertain' && ctx.intent !== 'conversation') return AutonomyDecision.ASK;

    // 🟡 BAIXA CONFIANÇA (Fallback)
    if (level === AutonomyLevel.BALANCED && confidence < 0.90 && ctx.riskLevel !== 'low') {
        if (ctx.route !== ExecutionRoute.DIRECT_LLM) {
            return AutonomyDecision.ASK;
        }
    }

    if (!ctx.hasAllParams && ctx.nature === TaskNature.EXECUTABLE) {
        return AutonomyDecision.ASK;
    }

    // 🟢 VERDE: Risco baixo ou Autonomia Agressiva → executar
    if (level === AutonomyLevel.AGGRESSIVE || ctx.riskLevel === 'low') {
        return AutonomyDecision.EXECUTE;
    }

    // 🟡 AMARELO: Risco médio → decidir baseado na confiança (BALANCED)
    if (ctx.riskLevel === 'medium') {
        return (confidence >= 0.95) ? AutonomyDecision.EXECUTE : AutonomyDecision.ASK;
    }

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
        nature?: TaskNature;
    } = {}
): AutonomyContext {
    return {
        intent,
        isContinuation: params.isContinuation ?? false,
        hasAllParams: params.hasAllParams ?? true,
        riskLevel: params.riskLevel ?? AutonomyHelpers.detectRisk(intent),
        isDestructive: params.isDestructive ?? AutonomyHelpers.isDestructiveCommand(intent),
        isReversible: params.isReversible ?? AutonomyHelpers.isReversibleAction(intent),
        route: params.route,
        nature: params.nature ?? TaskNature.EXECUTABLE
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