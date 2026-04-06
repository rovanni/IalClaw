export type DecisionPrecedenceContextInput = {
    hasReactiveState: boolean;
    flowManagerInFlow: boolean;
    isInGuidedFlow: boolean;
    pendingActionExists: boolean;
    intent: string;
    isIntentRelatedToTopic: boolean;
};

export type DecisionPrecedenceContext = {
    hasReactiveState: boolean;
    hasActiveFlow: boolean;
    isFlowEscape: boolean;
    hasPendingAction: boolean;
    canEvaluateFlowStart: boolean;
};

/**
 * Organiza fatos de precedência para leitura do fluxo decisório.
 * Nao toma decisão final: apenas descreve contexto.
 */
export function buildDecisionPrecedenceContext(
    input: DecisionPrecedenceContextInput
): DecisionPrecedenceContext {
    const hasReactiveState = input.hasReactiveState;
    const hasActiveFlow = (input.flowManagerInFlow || input.isInGuidedFlow) && !hasReactiveState;
    const isFlowEscape =
        hasActiveFlow &&
        (input.intent === 'STOP' || input.intent === 'QUESTION' || input.intent === 'META') &&
        !input.isIntentRelatedToTopic;

    return {
        hasReactiveState,
        hasActiveFlow,
        isFlowEscape,
        hasPendingAction: input.pendingActionExists && !hasReactiveState,
        canEvaluateFlowStart: !hasReactiveState && !input.pendingActionExists && !hasActiveFlow
    };
}
