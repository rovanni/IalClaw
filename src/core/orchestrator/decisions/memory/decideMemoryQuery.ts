import { CognitiveMemory } from '../../../../memory/CognitiveMemory';
import { CognitiveStrategy, CognitiveDecision } from '../../CognitiveOrchestrator';
import { t } from '../../../../i18n';
import { IntentType } from '../../../agent/IntentionResolver';
import { emitDebug } from '../../../../shared/DebugBus';

export interface MemoryIntrospectionContext {
    sessionId: string;
    input: string;
    intent: IntentType;
}

/**
 * decideMemoryQuery: Dedicated logic for memory introspection.
 * Differentiates between CHECK (status), QUERY (content), and STORE (persistence).
 */
export async function decideMemoryQuery(
    context: MemoryIntrospectionContext,
    memoryService: CognitiveMemory
): Promise<CognitiveDecision> {
    const { sessionId, input, intent } = context;
    
    // 1. HANDLE MEMORY_STORE (High-level perseverance strategy)
    if (intent === 'MEMORY_STORE') {
        const contentToStore = input.replace(/^(guarde|registre|anote|lembre-se\s+que|lembre\s+que)\s+/i, '').trim();
        
        // Orchestrator executes high-level strategy directly (Single Brain power)
        const nodeId = await memoryService.saveUserMemory(sessionId, contentToStore);

        return {
            strategy: CognitiveStrategy.LLM,
            confidence: 1.0,
            reason: 'memory_store_executed',
            memoryHits: [{ id: nodeId, name: 'new_memory', content: contentToStore, score: 1.0 }],
            usedInputGap: false
        };
    }

    const isCheck = intent === 'MEMORY_CHECK';
    
    // 2. Tries to find matching content in memory
    const searchResult = await memoryService.searchByContent(input, 3);
    const hasHits = searchResult && searchResult.length > 0;
    
    const reason = hasHits ? 'memory_introspection_hit' : 'memory_introspection_miss';
    
    // 3. Emit enriched debug payload for observability (KB-048 refinement)
    emitDebug('memory_introspection_decision', {
        sessionId,
        query: input,
        intent,
        matchedMemoryKeys: searchResult.map(h => h.id),
        confidence: 1.0,
        resultType: hasHits ? 'hit' : 'miss'
    });

    // 4. Formulate the response metadata
    return {
        strategy: CognitiveStrategy.LLM,
        confidence: 1.0,
        reason,
        memoryHits: searchResult,
        usedInputGap: false 
    };
}
