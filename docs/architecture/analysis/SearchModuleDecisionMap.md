# Search Module: Decision-Making Map 
## Quick Reference for Refactoring

---

## 🎯 DECISORY POINTS (What SearchEngine Decides Alone)

### Search Pipeline Decisions

```
┌─ SEARCH INITIATED ──────────────────────────────────────┐
│                                                          │
├─ [1] EXPANSION STRATEGY DECISION                        │
│      Question: Should we expand this query?             │
│      Current: Hardcoded flags (expandSynonyms, expandWithGraph)
│      Owner: SearchEngine                                │
│      Should Be: CognitiveOrchestrator                   │
│      Signal: search_expansion_strategy                  │
│                                                          │
├─ [2] GRAPH MAX TERMS DECISION                           │
│      Question: How many graph terms to include?         │
│      Current: maxTerms=20 (hardcoded)                   │
│      Owner: SearchEngine                                │
│      Should Be: Orchestrator config per task            │
│      Signal: graph_expansion_config                     │
│                                                          │
├─ [3] GRAPH EXPANSION FAILURE DECISION                   │
│      Question: What to do if graph fails?               │
│      Current: "warn & continue"                         │
│      Owner: SearchEngine (no choice)                    │
│      Should Be: Orchestrator (retry/skip/fail)          │
│      Signal: graph_expansion_failed                     │
│                                                          │
├─ [4] SCORE THRESHOLD DECISION                           │
│      Question: What minScore cutoff?                    │
│      Current: minScore option (default=0)               │
│      Owner: SearchEngine                                │
│      Should Be: Orchestrator based on context           │
│      Signal: score_filtering_config                     │
│                                                          │
├─ [5] RERANKING DECISION                                 │
│      Question: Should we rerank with LLM?               │
│      Current: useRerank flag                            │
│      Owner: SearchEngine                                │
│      Should Be: Orchestrator (based on query type)      │
│      Signal: reranking_strategy                         │
│                                                          │
├─ [6] RERANKING FAILURE DECISION                         │
│      Question: What if LLM reranking fails?             │
│      Current: Use fallback score 5.0                    │
│      Owner: LlmReranker (hardcoded)                     │
│      Should Be: Orchestrator (retry/fallback/skip)      │
│      Signal: reranking_failed                           │
│                                                          │
└─ [7] RESULT ORDERING DECISION                           │
       Question: How to order final results?              │
       Current: Descending by score                       │
       Should Be: Configurable strategy                   │
       Signal: result_ordering_strategy                   │
```

---

## 📊 SCORING DECISIONS (DefaultWeights)

### Current Owner: `Scorer` class with hardcoded `DEFAULT_WEIGHTS`

```typescript
DEFAULT_WEIGHTS = {
  titleMatch: 10,            ← Can 10× boost help query matching?
  contentMatch: 1,           ← Should title really be 10x content?
  tagMatch: 5,               ← When is 5× reasonable?
  categoryMatch: 3,          ← Fixed 3 points—inflexible
  keywordMatch: 2,           ← Keyword importance = 2× content?
  positionBonus: 0.1,        ← 10% bonus per position (implicit)
  graphRelationMatch: 2      ← Graph matches worth 2×?
};
```

### Who Should Decide

```
Query Type          Should titleMatch Be    Should graphRelationMatch Be
─────────────────   ───────────────────     ────────────────────────
Installation guide  20 (exact title match)  0 (less important)
FAQ search          5 (partial match ok)    3 (related questions help)
Code lookup         15 (exact name)         2 (related APIs matter)
Skill finder        10 (default)            5 (related skills matter)
```

**Owner**: CognitiveOrchestrator (via `SearchWeightsProvider`)

---

## 💾 CACHING DECISIONS

### Current Caches (Fragmented, Volatile)

| Cache | Location | Decision It Makes | Should Be |
|-------|----------|------------------|-----------|
| `documentCache` | SearchEngine | Cache full doc? | SessionManager (per-session) |
| `autoTagger.cache` | AutoTagger | Cache semantic structure? | SessionManager (lifecycle-aware) |
| `expansionCache` | SemanticGraphBridge | Cache graph expansions? | SessionManager + invalidation signal |
| `enrichmentCache` | SemanticGraphBridge | Cache enrichments? | SessionManager + TTL |
| All invert indices | InvertedIndex | Keep in memory? | SessionManager (milestone-based) |

### Decision Framework

```
CURRENT BEHAVIOR:
  - Each cache decides independently
  - No coordination
  - LRU cleanup only in GraphBridge
  - No serialization
  - Lost on restart

SHOULD BE:
  - SessionManager owns all cache lifecycle
  - Orchestrator signals when to invalidate
  - TTL-based expiry
  - Persistent key-value store
  - Query result contains cache_hit/cache_miss metadata
```

---

## 🔄 FALLBACK DECISIONS

### LLM Tagging Fallback

```
[IndexDocument] ──→ autoTagger.generateSemanticStructure()
                        │
                        ├─ Try: LLM extraction
                        │        └─ Success? Return structure
                        │        └─ Error? (WHO DECIDES?)
                        │
                        └─ Fallback: Heuristic word frequency
                           ├─ Tokenize all text
                           ├─ Rank by frequency
                           ├─ Pattern-match category
                           └─ Return structure
                           
DECISION: When LLM fails, fall back automatically
OWNER: AutoTagger (no choice given)
SHOULD BE: Orchestrator chooses:
  - USE_CACHED_PREVIOUS
  - USE_HEURISTIC_FALLBACK
  - RETRY_WITH_SHORTER_CONTENT
  - FAIL_AND_SKIP_DOCUMENT
```

### Graph Expansion Fallback

```
[Search] ──→ graphBridge.expandWithGraph()
                  │
                  ├─ Query graph adapter
                  │        └─ Success? Return expanded terms
                  │        └─ Error? (WHO DECIDES?)
                  │
                  └─ Continue with original terms only (implicit)
                  
DECISION: "Warn & continue" when graph fails
OWNER: SearchEngine (hardcoded)
SHOULD BE: Orchestrator chooses:
  - SKIP_GRAPH_EXPANSION
  - RETRY_WITH_SHORTER_TIMEOUT
  - FAIL_AND_RETURN_ERROR
  - USE_CACHED_EXPANSION
```

### LLM Reranking Fallback

```
[Search] ──→ llmReranker.rerank()
                  │
                  ├─ Call LLM for scores
                  │        └─ Success? Apply new scores
                  │        └─ Error? (WHO DECIDES?)
                  │
                  └─ Use original scores (fallback)
                     └─ Return score 5.0 per doc
                     
DECISION: Fallback to 5.0 when LLM fails
OWNER: LlmReranker (hardcoded)
SHOULD BE: Orchestrator chooses:
  - USE_ORIGINAL_SCORES
  - RETURN_ERROR_TO_USER
  - RETRY_RERANKING
  - USE_CACHED_RERANK_RESULT
```

---

## 🔌 SEMANTIC STRUCTURE DECISIONS (AutoTagger)

### AutoTagger.generateSemanticStructure()

```
Decisions Made:
  1. useLLM? (option flag)
  2. maxKeywords = 10 (hardcoded)
  3. maxTags = 7 (hardcoded)
  4. fallbackToTokenize? (option flag)
  5. guessCategory() heuristic (pattern matching)

OWNER: AutoTagger
SHOULD BE: Orchestrator:
  - MAX_KEYWORDS per domain
  - MAX_TAGS per task type
  - FALLBACK_STRATEGY on LLM fail
  - CATEGORY_DICT per context
```

---

## 📡 SIGNALS THAT SHOULD EXIST BUT DON'T

### Emitted by Search Engine (Currently Missing)

```typescript
interface SearchSignal {
  query: string;
  timestamp: number;
  
  // Expansion decisions
  expansionApplied: {
    querySynonyms: boolean;
    graphExpansion: boolean;
    originalTerms: number;
    expandedTerms: number;
  };
  
  // Scoring decisions
  scoringConfig: {
    weights: ScoringWeights;
    minScore: number;
    rerankingApplied: boolean;
  };
  
  // Fallback decisions
  fallbacs: {
    graphExpansionFailed?: boolean;
    rerankingFailed?: boolean;
    autoTaggerFailed?: boolean;
  };
  
  // Result metadata
  result: {
    count: number;
    rerankCount: number;
    cacheHit: boolean;
  };
}
```

**These signals should be:**
1. Emitted to DebugBus
2. Aggregated in TraceRecorder
3. Visible in CognitiveState
4. Used by Orchestrator to learn query patterns

---

## 🎛️ CONFIGURATION POINTS (Currently Hardcoded)

### Priority 1: Externalizable (Critical)

```
SearchWeightsConfig {
  titleMatch: number;          // Default 10
  contentMatch: number;        // Default 1
  tagMatch: number;            // Default 5
  categoryMatch: number;       // Default 3
  keywordMatch: number;        // Default 2
  positionBonus: number;       // Default 0.1
  graphRelationMatch: number;  // Default 2
  semanticGraphBoost: number;  // Default 0.1 (HARDCODED!)
}

AutoTaggerConfig {
  maxKeywords: number;         // Default 10
  maxTags: number;             // Default 7
  useLLMByDefault: boolean;    // Default true
}

GraphExpansionConfig {
  maxDepth: number;            // Default 1
  maxTerms: number;            // Default 20
  includeTypes?: string[];
  excludeTerms?: string[];
}

LLMRerankerConfig {
  enabled: boolean;            // Default true
  maxDocs: number;             // Default 10
  minScore: number;            // Default 0
}
```

### Priority 2: Dynamically Configurable (Important)

```
SearchStrategyOptions {
  expandSynonyms: boolean;       // Per query
  expandWithGraph: boolean;      // Per query
  rerankingStrategy: 'none' | 'llm' | 'heuristic';  // Per query
  scoreThreshold: number;        // Per query
}
```

---

## 🔀 SYNCHRONIZATION POINTS WITH ORCHESTRATOR

### Entry Points for Orchestrator Injection

```typescript
// 1. SearchEngine constructor
searchEngine = new SearchEngine({
  orchestrator: cognitiveOrchestrator,  // NEW
  useLLM: true,
  useRerank: true
});

// 2. Before indexing
searchEngine.setIndexingStrategy(
  orchestrator.decideIndexingStrategy()  // NEW
);

// 3. Before search
const searchSignals = {
  strategy: orchestrator.decideSearchStrategy(query),  // NEW
  weights: orchestrator.getSearchWeights(taskType),    // NEW
  fallbackPolicies: orchestrator.getRetryPolicies()    // NEW
};
searchEngine.search(query, { ...options, ...searchSignals });

// 4. Before reranking
if (searchSignals.strategy.rerankingEnabled) {
  const reranked = await orchestrator.decideReranking(
    results,
    query,
    { confidence: searchSignals.strategy.confidence }
  );
  results = reranked;
}
```

---

## 📋 REFACTORING CHECKLIST

### Phase 1: Observation (Week 1)
- [ ] Map all decision points in SearchEngine
- [ ] Log each decision with sessionId
- [ ] Send logs to DebugBus
- [ ] View in Dashboard CognitiveState

### Phase 2: Injection (Week 2)
- [ ] Add `setOrchestrator()` to SearchEngine
- [ ] Create `SearchWeightsProvider` interface
- [ ] Move DEFAULT_WEIGHTS to external config
- [ ] Create `SearchStrategyDecision` signal

### Phase 3: Migration (Week 3)
- [ ] Migrate documentCache → SessionManager
- [ ] Migrate autoTagger.cache → SessionManager
- [ ] Migrate GraphBridge caches → SessionManager
- [ ] Add cache invalidation signals

### Phase 4: Fallback Control (Week 4)
- [ ] Create `FailureRecoveryStrategy` signal
- [ ] Replace hardcoded fallbacks with signal consumption
- [ ] Test each fallback path with orchestrator override

### Phase 5: Verification (Week 5)
- [ ] Test old behavior (no orchestrator injected)
- [ ] Test new behavior (orchestrator injected)
- [ ] Benchmark: score changes, rerank changes
- [ ] Update documentation

---

## 🚨 CRITICAL ANTI-PATTERNS FOUND

| Anti-Pattern | Location | Severity | Fix |
|---|---|---|---|
| Isolated Decision System | SearchEngine.search() | 🔥 Critical | Inject Orchestrator |
| Volatile Caches | 5× Map instances | 🔥 Critical | SessionManager persist |
| Hardcoded Multipliers | scorer.ts, semanticGraphBridge.ts | 🟠 High | External config |
| Binary Strategy Flags | SearchEngine constructor | 🟠 High | Signal-driven decisions |
| Silent Fallback | autoTagger, llmReranker | 🟡 Medium | Emit failure signals |
| No Integration Path | No imports of CognitiveOrchestrator | 🟡 Medium | Create injection interface |

