import { IngestedSignalSummary, IngestSignalsSummaryContext } from '../../types/IngestSignalsTypes';

export function buildIngestedSignalSummary(context: IngestSignalsSummaryContext): IngestedSignalSummary {
    const { signals } = context;

    return {
        hasStop: !!signals.stop,
        hasFallback: !!signals.fallback,
        hasFallbackStrategy: !!signals.fallbackStrategy,
        hasValidation: !!signals.validation,
        hasRoute: !!signals.route,
        hasFailSafe: !!signals.failSafe,
        hasLlmRetry: !!signals.llmRetry,
        hasReclassification: !!signals.reclassification,
        hasPlanAdjustment: !!signals.planAdjustment,
        hasRealityCheckFacts: !!signals.realityCheckFacts,
        hasRealityCheck: !!signals.realityCheck
    };
}
