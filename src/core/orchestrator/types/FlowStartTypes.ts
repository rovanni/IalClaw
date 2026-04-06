export interface FlowDefinition {
    id: string;
    tags?: string[];
    triggers?: string[];
    priority?: number;
    description?: string;
}

export interface FlowStartContext {
    sessionId: string;
    input: string;
    availableFlows: FlowDefinition[];
}

export interface FlowStartMatchResult {
    flowId?: string;
    matchType?: 'trigger' | 'tag' | 'exact';
    score?: number;
    matchedTerms?: string[];
}

export interface FlowStartDecision {
    flowId?: string;
    match?: FlowStartMatchResult;
    candidates?: FlowStartMatchResult[];
    confidence: number;
    reason: string;
}
