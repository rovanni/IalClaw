import { FlowDefinition, FlowStartContext, FlowStartDecision, FlowStartMatchResult } from '../../types/FlowStartTypes';

/**
 * Decisao de início de flow (START_FLOW).
 * Centraliza a heurística de matching que antes residia no FlowRegistry.
 * Segue o padrão Single Brain: o Orchestrator decide com base em fatos (disponibilidade de flows).
 */
export function decideFlowStart(context: FlowStartContext): FlowStartDecision {
    const { input, availableFlows } = context;
    const normalizedInput = input.toLowerCase().trim();

    // Ordenar por prioridade (maior primeiro)
    const sortedFlows = [...availableFlows].sort((a, b) => (b.priority || 0) - (a.priority || 0));

    const candidates: FlowStartMatchResult[] = [];
    let bestMatch: FlowStartMatchResult | undefined;

    for (const flow of sortedFlows) {
        // 1. Match por Trigger (Comando direto)
        const matchedTrigger = (flow.triggers || []).find((trigger) => 
            normalizedInput.includes(trigger.toLowerCase())
        );

        if (matchedTrigger) {
            const match: FlowStartMatchResult = {
                flowId: flow.id,
                matchType: 'trigger',
                score: 1.0,
                matchedTerms: [matchedTrigger]
            };
            candidates.push(match);
            if (!bestMatch) bestMatch = match;
            continue; // Continua para coletar outros possíveis (embora trigger seja forte)
        }

        // 2. Match por Tags (Sistema de pontuação)
        const tags = (flow.tags || []).filter(tag => tag.trim().length > 0);
        const matchedTags = tags.filter(tag => normalizedInput.includes(tag.toLowerCase()));
        
        const tagScore = matchedTags.length;
        const requiredScore = Math.min(2, tags.length);

        if (tags.length > 0 && tagScore >= requiredScore) {
            const score = tagScore / tags.length;
            const match: FlowStartMatchResult = {
                flowId: flow.id,
                matchType: 'tag',
                score,
                matchedTerms: [matchedTags.join(', ')]
            };
            candidates.push(match);
            if (!bestMatch || score > (bestMatch.score || 0)) {
                if (bestMatch?.matchType !== 'trigger') {
                    bestMatch = match;
                }
            }
        }
    }

    if (bestMatch) {
        return {
            flowId: bestMatch.flowId,
            match: bestMatch,
            candidates: candidates.filter(c => c.flowId !== bestMatch?.flowId), // Outros candidatos
            confidence: bestMatch.matchType === 'trigger' ? 1.0 : 0.9,
            reason: bestMatch.matchType === 'trigger' 
                ? `Matche de trigger direto: "${bestMatch.matchedTerms?.[0]}"`
                : `Matche por tags vinculadas: [${bestMatch.matchedTerms?.[0]}]`
        };
    }

    return {
        confidence: 0,
        reason: 'Nenhum matche de flow identificado para o input'
    };
}
