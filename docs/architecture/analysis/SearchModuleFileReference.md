# Search Module: File & Function Reference
## Complete Index for Refactoring

---

## FILES & THEIR ROLES

### **Tier 1: Entry Point & Orchestration**

**File**: `src/search/pipeline/searchEngine.ts` (390 lines)
**Class**: `SearchEngine`
**Role**: Main orchestrator for all search operations

| Method | Line Range | Purpose | Input | Output | Autonomy |
|--------|-----------|---------|-------|--------|----------|
| `constructor(options)` | 86-96 | Initialize engine | `{useLLM?, useRerank?, synonyms?, useGraphExpansion?}` | N/A | Configures initial behavior |
| `~indexDocument(doc, syncToGraph)` | 100-161 | Index one doc w/ semantic tagging | `SearchDocument, boolean?` | `void` (async) | **DECIDES**: LLM vs heuristic, graph sync |
| `~indexDocuments(docs)` | 163-167 | Batch indexing | `SearchDocument[]` | `void` (async) | Loops indexDocument |
| `~search(query, options)` | 169-364 | **MAIN PIPELINE** | `string, SearchOptions?` | `SearchResult[]` | **HIGH**: Expansion, scoring, reranking |
| `expandWithSynonyms(tokens)` | 366-379 | Synonym expansion | `string[]` | `string[]` | **DECIDES**: Which synonyms to add |
| `~getSearchDocument(indexedDoc)` | 381-388 | Document cache lookup | `IndexedDocument` | `SearchDocument` | Cache hit/miss |
| `removeDocument(docId)` | 390-393 | Remove from index | `string` | `void` | Index mutation |
| `clearIndex()` | 395-399 | Full reset | N/A | `void` | Clears all caches |
| `setSynonyms(synonyms)` | 401-403 | Update synonym map | `SynonymMap` | `void` | **POTENTIAL ORCHESTRATOR ENTRY** |
| `setWeights(weights)` | 405-407 | Update scoring weights | `Partial<ScoringWeights>` | `void` | **POTENTIAL ORCHESTRATOR ENTRY** |
| `setRerankEnabled(enabled)` | 409-411 | Toggle reranking | `boolean` | `void` | **POTENTIAL ORCHESTRATOR ENTRY** |
| `setGraphExpansionEnabled(enabled)` | 413-416 | Toggle graph expansion | `boolean` | `void` | **POTENTIAL ORCHESTRATOR ENTRY** |
| `isGraphExpansionEnabled()` | 418-420 | Get graph status | N/A | `boolean` | Read-only |
| `getGraphBridge()` | 422-424 | Get graph component | N/A | `SemanticGraphBridge` | Read-only |
| `getStats()` | 426-437 | Return index stats | N/A | `{documentCount, uniqueTerms, avgTokens, ...}` | Read-only |

---

### **Tier 2: Text Processing (Utilities)**

**File**: `src/search/core/normalizer.ts` (90 lines)
**Role**: Normalize text by removing accents, stopwords, stemming

| Function | Purpose | Input | Output | Configuration |
|----------|---------|-------|--------|---------------|
| `normalize(text, options)` | Main normalizer | string | string | removeAccents?, removeStopwords?, stem? |
| `removeAccentsFromText(text)` | Accent decomposition | string | string | Fixed ACCENT_MAP |
| `isStopword(word)` | Check stopword | string | boolean | Fixed STOPWORDS set |
| `getStopwords()` | List all stopwords | N/A | string[] | Fixed (Portuguese) |

**Stopwords**: Portuguese set of ~100 words (articles, prepositions, pronouns, common verbs)

---

**File**: `src/search/core/tokenizer.ts` (60 lines)
**Role**: Split text into tokens

| Function | Purpose | Input | Output | Configuration |
|----------|---------|-------|--------|---------------|
| `tokenize(text, options)` | Main tokenizer | string | string[] | minLength?, maxLength?, preserveCase? |
| `tokenizeWithPositions(text)` | Token positions | string | `{token, start, end}[]` | N/A |
| `extractPhrases(text, minWords, maxWords)` | N-gram extraction | string | string[] | minWords=2, maxWords=4 |

---

### **Tier 3: Indexing & Lookup**

**File**: `src/search/index/invertedIndex.ts` (150 lines)
**Class**: `InvertedIndex`
**Role**: Store term→document mappings (in-memory)

| Method | Purpose | Line | Autonomy |
|--------|---------|------|----------|
| `addDocument(doc)` | Index doc with all variants | 45-78 | Tokenizes all fields (title, content, tags, category) |
| `search(tokens)` | Query index | 80-110 | Searches all indices (term, title, tag, category) |
| `removeDocument(docId)` | Remove doc | 112-125 | Removes from all indices |
| `clear()` | Clear all indices | 127-134 | Full reset |
| `getDocuments()` | Access doc store | 136-138 | Read-only |
| `getIndexStats()` | Statistics | 140+ | Read-only |

**Internal Indices**:
- `termIndex`: Main term→docIds
- `titleIndex`: Title-specific terms
- `tagIndex`: Tag system
- `categoryIndex`: Category system
- `termFrequency`: Term frequency per doc

---

### **Tier 4: Scoring & Ranking**

**File**: `src/search/ranking/scorer.ts` (180 lines)
**Class**: `Scorer`
**Role**: Score documents based on matches + weights

| Method | Purpose | Line | Autonomy |
|--------|---------|------|----------|
| `scoreDocuments(query, results, documents)` | **MAIN SCORING** | 60-120 | **DECIDES**: Apply DEFAULT_WEIGHTS |
| `calculateTermWeight(term, queryTokens)` | Position bonus | 122-130 | **DECIDES**: 0.1× multiplier per position |
| `countTermMatches(term, doc)` | Term frequency | 132-145 | **DECIDES**: Max cap of 10 |
| `countKeywordMatches(queryTokens, keywords)` | Keyword matching | 147-160 | Simple loop |
| `setWeights(weights)` | Override weights | 162-164 | **POTENTIAL ORCHESTRATOR ENTRY** |
| `getWeights()` | Read weights | 166-168 | Read-only |

**DEFAULT_WEIGHTS** (HARDCODED):
```
titleMatch: 10
contentMatch: 1
tagMatch: 5
categoryMatch: 3
keywordMatch: 2
positionBonus: 0.1
graphRelationMatch: 2
```

---

### **Tier 5: Semantic Expansion**

**File**: `src/search/graph/semanticGraphBridge.ts` (300 lines)
**Class**: `SemanticGraphBridge`
**Role**: Expand queries via semantic graph

| Method | Purpose | Line | Autonomy |
|--------|---------|------|----------|
| `expandWithGraph(terms, options)` | **MAIN EXPANSION** | 80-150 | **DECIDES**: maxTerms=20, maxDepth=1 |
| `enrichDocument(docId, tags, keywords, relations)` | Add graph context | 152-200 | Calls graph adapter |
| `calculateGraphScore(tags, graphTerms, nodes)` | Score graph matches | 202-230 | **DECIDES**: semanticBoost=0.1× |
| `syncDocumentRelations(docId, tags, relations)` | Push to graph | 232-260 | async, fire-and-forget |
| `setEnabled(enabled)` | Toggle expansion | 62-64 | **POTENTIAL ORCHESTRATOR ENTRY** |
| `isEnabled()` | Check status | 66-68 | Read-only |
| `getCacheStats()` | Cache metrics | 270-280 | Read-only |

**Caches**:
- `expansionCache` (Map): Expanded query terms
- `enrichmentCache` (Map): Document enrichments
- **MAX_CACHE_SIZE**: 1000 entries (LRU cleanup)

---

### **Tier 6: LLM Components**

**File**: `src/search/llm/autoTagger.ts` (250 lines)
**Class**: `AutoTagger`
**Role**: Generate semantic structure (tokens, tags, keywords) via LLM or heuristic

| Method | Purpose | Line | Autonomy |
|--------|---------|------|----------|
| `generateSemanticStructure(doc, options)` | **MAIN** | 80-130 | **DECIDES**: LLM vs heuristic fallback |
| `generateWithLLM(doc)` | Call LLM | 132-180 | Calls ProviderFactory.generate() |
| `generateFallback(doc)` | Heuristic fallback | 182-210 | Word frequency + pattern matching |
| `guessCategory(content)` | Category detection | 212-250 | **DECIDES**: Pattern-based rules |
| `clearCache()` | Clear semantics cache | 252-254 | Cache management |
| `getCacheSize()` | Cache size | 256-258 | Read-only |

**Cache**: `cache` Map with key `"${doc.id}:${doc.content.slice(0, 100)}"`

**Fallback Strategy**: Word frequency + category pattern matching

---

**File**: `src/search/llm/llmReranker.ts` (170 lines)
**Class**: `LlmReranker`
**Role**: Re-order search results via LLM relevance scoring

| Method | Purpose | Line | Autonomy |
|--------|---------|------|----------|
| `rerank(query, documents, options)` | **MAIN** | 60-145 | **DECIDES**: LLM call + error fallback |
| `setEnabled(enabled)` | Toggle reranking | 147-149 | **POTENTIAL ORCHESTRATOR ENTRY** |
| `isEnabled()` | Check status | 151-153 | Read-only |

**Error Handling**: Returns fallback score 5.0 per doc if LLM fails

---

**File**: `src/search/llm/promptBuilder.ts` (140 lines)
**Role**: Construct/validate LLM prompts

| Function | Purpose |
|----------|---------|
| `buildPrompt(template, variables, options)` | Substitute `{{var}}` placeholders |
| `validateTemplate(template)` | Check placeholders |
| `extractVariables(template)` | List required vars |
| `hasUnresolvedPlaceholders(text)` | Check completeness |
| `checkPromptSafety(prompt)` | Validate input |

---

## DECISION MATRIX: WHO DECIDES WHAT

### Priority 1: Currently SearchEngine, Should Be Orchestrator

| Decision | Current Location | Current Mechanism | Should Move To | Reason |
|----------|------------------|------------------|----------------|--------|
| Use synonym expansion? | SearchEngine.search() | `expandSynonyms` flag | Orchestrator signal | Per-query strategy |
| Use graph expansion? | SearchEngine.search() | `expandWithGraph` flag | Orchestrator signal | Domain-dependent |
| Max graph terms? | SemanticGraphBridge.expandWithGraph() | `maxTerms=20` hardcoded | Orchestrator config | Task-dependent |
| Apply minScore filter? | SearchEngine.search() | `minScore` option | Orchestrator signal | Context-dependent |
| Use LLM reranking? | SearchEngine.search() | `useRerank` flag | Orchestrator decision | Confidence-driven |
| Scoring weights | Scorer |`DEFAULT_WEIGHTS` hardcoded | Orchestrator provider | Task-specific |
| Graph semantic boost | SemanticGraphBridge | `0.1×` hardcoded | Orchestrator multiplier | Domain-specific |

### Priority 2: Fallback & Recovery

| Decision | Current Location | Current Mechanism | Should Move To | Reason |
|----------|------------------|------------------|----------------|--------|
| Graph expansion fails? | SemanticGraphBridge | "warn & continue" | Orchestrator | Retry/skip/fail option |
| LLM tagging fails? | AutoTagger | Fall to heuristic | Orchestrator | Retry/cache/default |
| LLM reranking fails? | LlmReranker | Use score 5.0 | Orchestrator | Use cache/skip/retry |
| Index/cache invalidation | Manual clearIndex() | No signal | Orchestrator | Lifecycle management |

---

## CODE SMELL ANALYSIS

### Anti-Pattern 1: Hardcoded Multipliers

```typescript
// ❌ BAD: Multipliers hardcoded everywhere
export const DEFAULT_WEIGHTS: ScoringWeights = {
    titleMatch: 10,              // Why 10? Will never change for task type?
    contentMatch: 1,             // Why 1? Locked in?
    graphRelationMatch: 2,       // Why 2? What about edge cases?
    positionBonus: 0.1,          // Why 0.1? No way to tune?
};

// ✅ GOOD: Via Orchestrator provider
const weights = orchestrator.getSearchWeights({
    taskType: 'SKILL_SEARCH',    // Different weights per task
    confidence: 0.85,             // Adjust based on confidence
    domain: 'installation'        // Domain-specific tuning
});
```

### Anti-Pattern 2: Autonomous Fallback

```typescript
// ❌ BAD: Silently falling back
if (graphExpansionFailed) {
    this.logger.warn(...)        // Just warn, no choice
    // Continue with original query (implicit)
}

// ✅ GOOD: Ask orchestrator
if (graphExpansionFailed) {
    const policy = orchestrator.getRecoveryPolicy('graph_expansion');
    switch (policy.action) {
        case 'SKIP': break;              // Don't expand
        case 'RETRY': return expandWithGraph(...);
        case 'FAIL': throw error;        // Fail the search
    }
}
```

### Anti-Pattern 3: Volatile Caches

```typescript
// ❌ BAD: 5 separate Maps, no persistence
class SearchEngine {
    private documentCache: Map<string, SearchDocument>;    // Volatile
}
class AutoTagger {
    private cache: Map<string, SemanticStructure>;        // Volatile
}
class SemanticGraphBridge {
    private expansionCache: Map<string, string[]>;        // Volatile
    private enrichmentCache: Map<string, GraphEnrichmentResult>; // Volatile
}

// ✅ GOOD: Unified SessionManager
const cache = SessionManager.get(sessionId, 'search_expansion_cache');
const fromCache = cache?.get(query);
if (fromCache) return fromCache;  // Use cached, reduce LLM calls
```

### Anti-Pattern 4: Binary Flags

```typescript
// ❌ BAD: On/off only
const engine = createSearchEngine({
    useRerank: true,    // Either full LLM reranking or none
    useLLM: true,       // All-or-nothing
});

// ✅ GOOD: Strategic decisions
const strategy = orchestrator.decideSearchStrategy(query);
// {
//   expandSynonyms: true,
//   expandWithGraph: true,
//   rerankingMode: 'selective',  // Rerank top 5 only when high confidence
//   rerankingThreshold: 0.85,    // Only if score > 0.85
//   fallbackPolicy: 'retry_once' // Retry once before skipping
// }
```

---

## EXPORT SURFACE

**File**: `src/search/index.ts` (25 lines)

**Exported**:
```typescript
// Core processors
export { tokenize, tokenizeWithPositions, extractPhrases } from './core/tokenizer';
export { normalize, removeAccentsFromText, isStopword, getStopwords } from './core/normalizer';

// Indexing
export { InvertedIndex, createInvertedIndex } from './index/invertedIndex';

// Ranking
export { Scorer, createScorer } from './ranking/scorer';

// LLM
export { buildPrompt, validateTemplate, extractVariables, ... } from './llm/promptBuilder';
export { AutoTagger, createAutoTagger } from './llm/autoTagger';
export { LlmReranker, createLlmReranker } from './llm/llmReranker';

// Main entry
export { SearchEngine, createSearchEngine } from './pipeline/searchEngine';
```

**Not Exported**:
- SemanticGraphBridge (accessible via `SearchEngine.getGraphBridge()` only)
- GraphAdapter (tightly coupled to GraphBridge)

---

## INTEGRATION POINTS

### Where SearchEngine is Used (Unknown - No Grep Hits)

**Status**: NOT INTEGRATED ANYWHERE YET ❌

- [ ] No imports found in `src/engine/*`
- [ ] No imports found in `src/core/orchestrator/*`
- [ ] No imports found in `src/core/agent/*`
- [ ] Not used by AgentController
- [ ] Not used by CognitiveOrchestrator

**Conclusion**: Search module is **completely autonomous** with no orchestrator connection.

---

## REFACTORING ROADMAP

### Phase 1: Add Orchestrator Injection Interface
**Files to Modify**:
- `src/search/pipeline/searchEngine.ts`
  - Add `private orchestrator?: CognitiveOrchestrator`
  - Add `setOrchestrator(orch: CognitiveOrchestrator): void`

### Phase 2: Extract Decisions
**Files to Create**:
- `src/search/decision/SearchStrategyDecider.ts`
  - Interface for orchestrator to decide expansion/reranking
- `src/search/decision/SearchWeightsProvider.ts`
  - Interface for orchestrator to provide weights

### Phase 3: Migrate Caches
**Files to Modify**:
- `src/search/pipeline/searchEngine.ts`
  - Replace `documentCache` → SessionManager
- `src/search/llm/autoTagger.ts`
  - Replace `cache` → SessionManager
- `src/search/graph/semanticGraphBridge.ts`
  - Replace `expansionCache`, `enrichmentCache` → SessionManager

### Phase 4: Emit Signals
**Files to Create**:
- `src/search/signals/SearchSignal.ts`
  - Define SearchSignal interface
- `src/search/signals/SearchSignalEmitter.ts`
  - Emit to DebugBus

### Phase 5: Update Orchestrator
**Files to Modify**:
- `src/core/orchestrator/CognitiveOrchestrator.ts`
  - Add `decideSearchStrategy()` method
  - Add `getSearchWeights()` method
  - Add recovery policy methods

