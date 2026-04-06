import { CognitiveSignalsState } from '../../../engine/AgentLoopTypes';

export type IngestedSignalSummary = {
    hasStop: boolean;
    hasFallback: boolean;
    hasFallbackStrategy: boolean;
    hasValidation: boolean;
    hasRoute: boolean;
    hasFailSafe: boolean;
    hasLlmRetry: boolean;
    hasReclassification: boolean;
    hasPlanAdjustment: boolean;
    hasRealityCheckFacts: boolean;
    hasRealityCheck: boolean;
};

export type IngestSignalsSummaryContext = {
    signals: Readonly<CognitiveSignalsState>;
};
