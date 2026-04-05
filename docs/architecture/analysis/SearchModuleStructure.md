# Search Module Structure Analysis
## IalClaw Project - April 4, 2026

---

## 1. MODULE OVERVIEW

**Location**: `src/search/`

**Current Architecture**: Pipeline-based search engine with autonomous decision-making

**Status**: ⚠️ **Critical Refactoring Target** (Isolated Decision System)

---

## 2. DIRECTORY STRUCTURE

```
src/search/
├── core/                      # Text processing primitives
│   ├── normalizer.ts         # Text normalization (accents, stopwords, stemming)
│   └── tokenizer.ts          # Text tokenization + phrase extraction
├── index/                     # Indexing layer
│   └── invertedIndex.ts      # Inverted index data structure (term→document mapping)
├── ranking/                   # Scoring layer
│   └── scorer.ts             # Multi-weighted document scoring
├── graph/                     # Semantic expansion
│   ├── graphAdapter.ts       # Graph adapter interface
│   ├── semanticGraphBridge.ts # Graph-based term expansion and enrichment
│   └── index.ts              # Exports
├── llm/                       # LLM-powered enhancements
│   ├── autoTagger.ts         # Semantic structure generation (tokens, keywords, tags)
│   ├── llmReranker.ts        # LLM-powered relevance reranking
│   └── promptBuilder.ts      # Prompt construction utilities
├── pipeline/                  # Main search orchestration
│   └── searchEngine.ts       # SearchEngine class (main orchestrator)
└── index.ts                  # Module exports
```

---

## 3. MAIN ENTRY POINTS & FUNCTIONS

### 3.1 **SearchEngine** (`pipeline/searchEngine.ts`)
**Primary Class**: Coordinates all search operations

**Constructor Options**:
```typescript
{
  useLLM?: boolean;           // Enable LLM tagging during indexing
  useRerank?: boolean;        // Enable LLM-based reranking
  synonyms?: SynonymMap;      // Custom synonym mappings
  useGraphExpansion?: boolean; // Enable semantic graph term expansion
}
```

**Main Public Methods**:

| Method | Purpose | Decision Point |
|--------|---------|--------|
| `indexDocument(doc, syncToGraph?)` | Index single doc w/ semantic tagging | **Decides**: LLM vs fallback tagging; graph sync |
| `indexDocuments(docs)` | Batch indexing | Loops `indexDocument` |
| `search(query, options)` | Execute search pipeline | **CORE DECISION LOGIC** (see 3.1.1) |
| `removeDocument(docId)` | Remove from index | Simple deletion |
| `clearIndex()` | Full index reset | Clears all caches |
| `setSynonyms(synonyms)` | Override synonym map | State mutation |
| `setWeights(weights)` | Override scoring weights | **DECISORY**: Changes boost behavior |
| `setRerankEnabled(enabled)` | Toggle LLM reranking | **DECISORY**: Changes ranking strategy |
| `setGraphExpansionEnabled(enabled)` | Toggle graph expansion | **DECISORY**: Changes query expansion |
| `getStats()` | Return index statistics | Read-only |

#### 3.1.1 **SearchEngine.search() - CORE DECISION PIPELINE**

```
INPUT: query, SearchOptions
  ↓
[1] NORMALIZATION & TOKENIZATION
  - normalize(query, {removeAccents: true})
  - tokenize(normalizedQuery)
  ↓
[2] EXPANSION LAYER (Options-driven decisions)
  ├─→ expandSynonyms() if expandSynonyms=true
  │    Decision: Expand query with DEFAULT_SYNONYMS or custom
  │    Caches: None (rebuilds each time)
  │
  └─→ graphBridge.expandWithGraph() if expandWithGraph=true
       Decision: Max 20 terms from graph
       Caches: expansionCache (Map)
       Fallback: Continue without expansion on error
  ↓
[3] INVERTED INDEX SEARCH
  - index.search(queryTokens) → Map<term, {docIds, type}>
  ↓
[4] SCORING & FILTERING
  - scorer.scoreDocuments() with DEFAULT_WEIGHTS
  - Filter by minScore threshold
  - Slice by offset/limit
  ↓
[5] DEBUG ENRICHMENT (if debug=true)
  - Calculate graphRelationScore
  - Add semanticBoost (fixed: graphScore * 0.1)
  - Attach debugInfo
  ↓
[6] OPTIONAL RERANKING
  - if useRerank=true && results.length > 1
  - llmReranker.rerank() → LLM decision-making
  - Re-sort by LLM scores
  ↓
OUTPUT: SearchResult[] with scores and match details
```

**Autonomous Decisions Made**:
1. ✅ **When to use LLM vs fallback** (indexing)
2. ✅ **Whether to sync to graph** (after indexing)
3. ✅ **How many graph terms to expand** (maxTerms=20)
4. ✅ **When to continue despite expansion failure** (warn & continue)
5. ✅ **Apply semanticBoost multiplier** (0.1, hardcoded)
6. ✅ **Apply DEFAULT_WEIGHTS scoring** (titleMatch=10, contentMatch=1, etc.)
7. ✅ **Apply minScore filtering**
8. ✅ **Whether to rerank** (if useRerank flag)

---

## 4. SCORING, BOOSTING, & CACHING LOGIC

### 4.1 **Scoring System** (`ranking/scorer.ts`)

**Class**: `Scorer`

**Default Weights** (hardcoded):
```typescript
const DEFAULT_WEIGHTS: ScoringWeights = {
    titleMatch: 10,          // 10× multiplier for title matches
    contentMatch: 1,         // 1× for content matches
    tagMatch: 5,             // 5× for tag matches
    categoryMatch: 3,        // 3 points for category match
    keywordMatch: 2,         // 2× for keyword matches
    positionBonus: 0.1,      // 0.1× bonus per position in query
    graphRelationMatch: 2    // 2× for graph-connected documents
};
```

**Scoring Algorithm**:
```
For each matched term:
  - Calculate term weight based on token position
  - Switch by match type:
    - TITLE: score += titleMatch × termWeight
    - TAG: score += tagMatch × termWeight
    - CATEGORY: score += categoryMatch (fixed)
    - CONTENT: score += contentMatch × termFrequency

Final score = sum of all matches, normalized to 2 decimals
```

**Mutation Points**:
- `setWeights(partial)` → Allows Orchestrator to adjust weights
- Position bonus calculation is implicit (not configurable)

### 4.2 **Graph Scoring** (`graph/semanticGraphBridge.ts`)

**Graph Extensions**:
- `expandWithGraph()` → expands query terms via related nodes
- `calculateGraphScore()` → scores docs by graph relation matches
- `semanticBoost = graphRelationScore × 0.1` (hardcoded multiplier)

**Caching**:
- `expansionCache` (Map) → stores expanded terms per query
- `enrichmentCache` (Map) → stores graph enrichment per document
- MAX_CACHE_SIZE: 1000 entries (LRU cleanup at 50%)

**Decisions Made**:
- ✅ When to apply semantic boost (0.1 multiplier—hardcoded)
- ✅ Max depth for graph traversal (default=1)
- ✅ Max related terms to include (maxTerms, default=20)
- ✅ When to exclude certain terms (excludeTerms list)

### 4.3 **LLM Reranking** (`llm/llmReranker.ts`)

**Class**: `LlmReranker`

**Decision Points**:
1. ✅ **Whether to skip reranking** (if disabled)
2. ✅ **Documents to rerank** (maxDocs=10)
3. ✅ **Score filtering** (minScore=0)
4. ✅ **Fallback on error** → Returns default score 5.0 if LLM fails
5. ✅ **Score normalization** (0-10 range clamp)

**LLM Prompt** (system + user):
- Fixed templates: `RERANK_SYSTEM` + `RERANK_USER`
- Asks LLM for relevanceScore (0-10) per document

**Error Handling**:
- Catches LLM failures and returns fallback scores (logs as warning)

### 4.4 **Semantic Tagging** (`llm/autoTagger.ts`)

**Class**: `AutoTagger`

**Caching**:
- `cache` (Map) → stores generated SemanticStructure per document
- Cache key: `"${doc.id}:${doc.content.slice(0, 100)}"` (First 100 chars)

**Decision Points**:
1. ✅ **Use LLM or fallback** (useLLM flag)
2. ✅ **When to fallback** (on LLM error)
3. ✅ **Max keywords** (maxKeywords=10)
4. ✅ **Max tags** (maxTags=7)

**LLM Prompt**:
- Extracts tokens, keywords, tags, category, subcategory, relations
- Fixed system prompt + user prompt

**Fallback Strategy**:
- Tokenize all text
- Calculate word frequency
- Take top 10 words as keywords
- Guess category via keyword pattern matching

---

## 5. WHERE AUTONOMOUS SEARCH DECISIONS ARE MADE

### **Decision Zone Map**

| Location | Decision | Current Owner | Should Move To |
|----------|----------|----------------|-----------------|
| `searchEngine.search()` line 188 | Use synonym expansion | SearchEngine | Orchestrator signal |
| `searchEngine.search()` line 202 | Use graph expansion | SearchEngine | Orchestrator signal |
| `searchEngine.search()` line 233 | Apply minScore filter | SearchEngine | Orchestrator signal |
| `searchEngine.search()` line 237-260 | Rerank with LLM | SearchEngine | Orchestrator decision |
| `scorer.scoreDocuments()` | Apply weight multipliers | SearchEngine (weights) | Orchestrator-injected weights |
| `scorer.calculateTermWeight()` | Position bonus factor | SearchEngine | Orchestrator bonus config |
| `semanticGraphBridge.expandWithGraph()` | Max terms to include | SearchEngine | Orchestrator config |
| `semanticGraphBridge.calculateGraphScore()` | Semantic boost (0.1×) | SemanticGraphBridge | Orchestrator multiplier |
| `autoTagger.generateSemanticStructure()` | LLM vs heuristic fallback | AutoTagger | Orchestrator strategy |
| `llmReranker.rerank()` | LLM request + error fallback | LlmReranker | Orchestrator command |
| `indexDocument()` | Graph sync decision | SearchEngine | Orchestrator sync signal |

---

## 6. CACHING ARCHITECTURE

### **5 Separate Caches** (Volatile Memory Fragments)

| Cache | Type | Owner | Content | Lifetime |
|-------|------|-------|---------|----------|
| `SearchEngine.documentCache` | Map | SearchEngine | Full SearchDocument objects | Until clearIndex() |
| `AutoTagger.cache` | Map | AutoTagger | SemanticStructure (keys, tags, tokens) | Until clearCache() |
| `InvertedIndex.termIndex` | Map | InvertedIndex | Term→DocIds mapping | Until removeDoc/clearIndex |
| `InvertedIndex.titleIndex` | Map | InvertedIndex | Title terms→DocIds | Until clearIndex() |
| `InvertedIndex.tagIndex` | Map | InvertedIndex | Tag terms→DocIds | Until clearIndex() |
| `InvertedIndex.categoryIndex` | Map | InvertedIndex | Category→DocIds | Until clearIndex() |
| `InvertedIndex.termFrequency` | Map | InvertedIndex | Term frequency per doc | Until clearIndex() |
| `SemanticGraphBridge.expansionCache` | Map | SemanticGraphBridge | Expanded terms (cached) | LRU cleanup at 1000 size |
| `SemanticGraphBridge.enrichmentCache` | Map | SemanticGraphBridge | Graph enrichment results | LRU cleanup at 1000 size |

**Problems**:
- ❌ No persistence mechanism (SessionManager not used)
- ❌ No coordination between caches
- ❌ LRU cleanup logic only in GraphBridge (others unbounded)
- ❌ Impossible to serialize complete search state

---

## 7. INTEGRATION POINTS WITH COGNITIVEORCHESTRATOR

### **Current Status: ZERO INTEGRATION** ❌

**Evidence**:
- ❌ No imports of `CognitiveOrchestrator` in search module
- ❌ No signals emitted to orchestrator
- ❌ No orchestrator decision signals consumed
- ❌ SearchEngine is standalone autonomous system
- ❌ No injection points for orchestrator control

**What Should Exist**:
1. SearchEngine should receive Orchestrator instance
2. Before search decisions, query orchestrator for strategy
3. Emit search signals (query_expanded, reranking_applied, graph_decision)
4. Accept Orchestrator override for weights/strategy

---

## 8. "DECISORY BEHAVIOR" TO MOVE TO ORCHESTRATOR

### **Phase 1: Strategy Selection** (HIGH PRIORITY)

| Decision | Current Logic | Should Become |
|----------|---------------|-----------------|
| Use synonym expansion? | `expandSynonyms=true` (flag) | Orchestrator signal based on query complexity |
| Use graph expansion? | `expandWithGraph=true` (flag) | Orchestrator signal based on domain |
| Graph max terms? | `graphMaxTerms=20` (hardcoded) | Orchestrator-injected config |
| Apply reranking? | `useRerank=true` (flag) | Orchestrator decision after scoring |

### **Phase 2: Scoring Strategy** (HIGH PRIORITY)

| Decision | Current Logic | Should Become |
|----------|---------------|-----------------|
| titleMatch weight | DEFAULT_WEIGHTS.titleMatch = 10 | Orchestrator adjusts per task type |
| contentMatch weight | DEFAULT_WEIGHTS.contentMatch = 1 | Orchestrator adjusts per relevance threshold |
| tagMatch weight | DEFAULT_WEIGHTS.tagMatch = 5 | Orchestrator adjusts per domain |
| categoryMatch weight | DEFAULT_WEIGHTS.categoryMatch = 3 | Orchestrator adjusts per context |
| Position bonus | 0.1× (hardcoded) | Orchestrator dynamic multiplier |
| Graph bonus | 0.1× (hardcoded) | Orchestrator dynamic multiplier |

### **Phase 3: Fallback & Recovery** (MEDIUM PRIORITY)

| Decision | Current Logic | Should Become |
|----------|---------------|-----------------|
| Graph expansion fails? | Warn + continue without expansion | Orchestrator decides: retry/skip/fail |
| LLM tagging fails? | Fall back to heuristic | Orchestrator decides: use cached/default/retry |
| LLM reranking fails? | Use fallback score 5.0 | Orchestrator decides: skip/retry/fallback |
| Min score too high? | Return empty results | Orchestrator adjusts threshold dynamically |

### **Phase 4: Persistence & State** (LOW PRIORITY)

| Decision | Current Logic | Should Become |
|----------|---------------|-----------------|
| Cache invalidation? | Manual `clearIndex()` only | Orchestrator manages cache lifecycle |
| Graph sync after index? | `syncToGraph=true` (flag) | Orchestrator signal-driven sync |
| Cache hit strategy? | Always use cache if available | Orchestrator decides: cache/recompute |

---

## 9. KEY FUNCTIONS BY FILE

### **src/search/core/normalizer.ts**
```typescript
normalize(text, options)        // Remove accents, stopwords, stem
removeAccentsFromText(text)     // Accent decomposition
isStopword(word)                // Check Portuguese stopwords
getStopwords()                  // Return all stopwords
```

### **src/search/core/tokenizer.ts**
```typescript
tokenize(text, options)         // Split to tokens (min length, max length)
tokenizeWithPositions(text)     // Return {token, start, end}
extractPhrases(text, minWords, maxWords) // Extract n-grams
```

### **src/search/index/invertedIndex.ts**
```typescript
InvertedIndex.addDocument(doc)  // Index with all term variants
InvertedIndex.search(tokens)    // Query: return Map<term, docIds>
InvertedIndex.removeDocument(docId)
InvertedIndex.getDocuments()    // Return internal doc map
InvertedIndex.getIndexStats()   // Return {docCount, uniqueTerms, avgTokens}
```

### **src/search/ranking/scorer.ts**
```typescript
Scorer.scoreDocuments(query, results, documents)
  // Main scoring: apply weights to term matches
Scorer.calculateTermWeight(term, queryTokens)
  // Position-based term importance
Scorer.countTermMatches(term, doc)
  // Term frequency in doc (max 10)
Scorer.countKeywordMatches(queryTokens, keywords)
  // How many keywords match query tokens
Scorer.setWeights(partial)      // Override DEFAULT_WEIGHTS
Scorer.getWeights()             // Read current weights
```

### **src/search/graph/semanticGraphBridge.ts**
```typescript
SemanticGraphBridge.expandWithGraph(terms, options)
  // Expand query terms via graph; returns {originalTerms, expandedTerms, graphTerms, graphNodes}
SemanticGraphBridge.enrichDocument(docId, docTags, docKeywords, docRelations)
  // Add graph context to document
SemanticGraphBridge.calculateGraphScore(docTags, graphTerms, graphNodes)
  // Score based on graph connections
SemanticGraphBridge.syncDocumentRelations(docId, tags, relations)
  // Push doc relations to graph
SemanticGraphBridge.setEnabled(enabled)
  // Toggle graph expansion
SemanticGraphBridge.getCacheStats()
  // Return cache sizes
```

### **src/search/llm/autoTagger.ts**
```typescript
AutoTagger.generateSemanticStructure(doc, options)
  // LLM or heuristic: extract {tokens, keywords, tags, categoria, subcategoria, relacoes}
AutoTagger.generateWithLLM(doc)
  // Call LLM with SEMANTIC_ANALYSIS system+user prompts
AutoTagger.generateFallback(doc)
  // Heuristic: word freq → keywords, pattern match → category
AutoTagger.guessCategory(content)
  // Keyword pattern matching for category guess
AutoTagger.clearCache()
AutoTagger.getCacheSize()
```

### **src/search/llm/llmReranker.ts**
```typescript
LlmReranker.rerank(query, documents, options)
  // LLM: re-order docs by relevance score 0-10
  // Fallback to 5.0 if LLM fails
LlmReranker.setEnabled(enabled)
LlmReranker.isEnabled()
```

### **src/search/llm/promptBuilder.ts**
```typescript
buildPrompt(template, variables, options)
  // Substitute {{var}} placeholders
validateTemplate(template)
  // Check for mismatched placeholders
extractVariables(template)
  // Return list of {{variables}}
hasUnresolvedPlaceholders(text)
checkPromptSafety(prompt)       // Validate LLM input
```

### **src/search/pipeline/searchEngine.ts**
```typescript
SearchEngine constructor(options)
SearchEngine.indexDocument(doc, syncToGraph?)
SearchEngine.search(query, options)      // MAIN ENTRY
SearchEngine.expandWithSynonyms(tokens)
SearchEngine.getSearchDocument(indexedDoc)
SearchEngine.removeDocument(docId)
SearchEngine.clearIndex()
SearchEngine.setSynonyms(map)
SearchEngine.setWeights(weights)         // Orchestrator entry point
SearchEngine.setRerankEnabled(enabled)
SearchEngine.setGraphExpansionEnabled(enabled)
SearchEngine.isGraphExpansionEnabled()
SearchEngine.getGraphBridge()
SearchEngine.getStats()
```

---

## 10. EXECUTION FLOW EXAMPLE

**User Query**: `"como instalar IA"`

```
SearchEngine.search("como instalar IA", {
  limit: 10,
  expandSynonyms: true,
  expandWithGraph: true,
  useRerank: false,
  minScore: 0,
  debug: false
})
  │
  ├─ normalize() → "como instalar ia"
  ├─ tokenize() → ["como", "instalar", "ia"]
  │
  ├─ expandWithSynonyms()
  │   └─ " IA " → + ["inteligência artificial", "machine learning", "ml", "deep learning"]
  │   └─ tokenized → ["inteligencia", "artificial", "machine", "learning", "ml", "deep", "learning"]
  │   └─ dedupe → ["como", "instalar", "ia", "inteligencia", "artificial", "machine", "learning", "ml", "deep"]
  │
  ├─ graphBridge.expandWithGraph(tokens, {maxTerms: 20})
  │   └─ For each token, call graphAdapter.getRelatedTerms()
  │   └─ Result: expansionResult {
  │       originalTerms: ["como", ...],
  │       expandedTerms: [...],
  │       graphTerms: ["framework", "instalacao", "ambiente"],
  │       graphNodes: [...]
  │     }
  │   └─ Merge graphTerms into queryTokens
  │
  ├─ index.search(queryTokens) → Map<term, {docIds, type}>
  │
  ├─ scorer.scoreDocuments(query, searchResults, documents)
  │   └─ For each document:
  │       - Count title matches × 10
  │       - Count content matches × 1
  │       - Count tag matches × 5
  │       - Check category match
  │       - Count keyword matches
  │   └─ Return sorted ScoredDocument[]
  │
  ├─ Filter by minScore, slice(offset, limit)
  │
  ├─ Return SearchResult[] with scores + matchDetails
```

---

## 11. REFACTORING RECOMMENDATIONS

### **Priority 1: Inject Orchestrator (CRITICAL)**
```typescript
// SearchEngine should accept orchestrator
class SearchEngine {
  private orchestrator?: CognitiveOrchestrator;
  
  setOrchestrator(orch: CognitiveOrchestrator): void {
    this.orchestrator = orch;
  }
  
  async search(query, options) {
    // Ask orchestrator before each decision
    const strategy = await this.orchestrator?.decideSearchStrategy(query);
    // Use strategy.expandSynonyms, strategy.expandGraph, strategy.weights
  }
}
```

### **Priority 2: Externalize Weights (HIGH)**
```typescript
// Move from DEFAULT_WEIGHTS to Orchestrator config
// Allow dynamic adjustment per session/task
interface SearchWeightsConfig {
  titleMatch: number;
  contentMatch: number;
  tagMatch: number;
  categoryMatch: number;
  keywordMatch: number;
  positionBonus: number;
  graphRelationMatch: number;
  graphSemanticBoost: number; // Currently hardcoded 0.1
}
```

### **Priority 3: Migrate Caches to SessionManager (HIGH)**
```typescript
// Move from volatile Maps to SessionManager persistence
// Keys like: 
// - search_expansion_cache:${sessionId}:${query}
// - search_semantic_structure:${docId}
// - search_enrichment_cache:${docId}
```

### **Priority 4: Emit Search Signals (MEDIUM)**
```typescript
// Emit signal-like information to Orchestrator
interface SearchSignal {
  type: 'expansion' | 'rerank' | 'fallback' | 'graph_expansion';
  query: string;
  termsExpanded: number;
  docsReranked: number;
  fallbackReason?: string;
}
```

### **Priority 5: Make Fallback Orchestrated (MEDIUM)**
```typescript
// Instead of "warn & continue", ask Orchestrator
if (graphExpansionFailed) {
  const decision = await orchestrator?.decideGraphExpansionFailure({
    sessionId, query, error
  });
  // decision.action: SKIP | RETRY | FAIL
}
```

---

## 12. INTEGRATION CHECKLIST FOR REFACTORING

- [ ] Create `SearchSignal` interface (emit decisions to Orchestrator)
- [ ] Add `setOrchestrator()` to SearchEngine
- [ ] Add `decideSearchStrategy()` to CognitiveOrchestrator
- [ ] Move DEFAULT_WEIGHTS to external config
- [ ] Create `SearchWeightsProvider` interface for dynamic weights
- [ ] Migrate 5 Maps to SessionManager (prefix-based keys)
- [ ] Replace hardcoded multipliers (0.1 graph boost) with config
- [ ] Create fallback decision points (rerank fail, graph fail, etc.)
- [ ] Add SearchEngine signals to CognitiveSignalsState
- [ ] Update logging to show orchestrator decisions vs search decisions
- [ ] Create tests for orchestrator-driven search behavior

---

## SUMMARY TABLE

| Aspect | Current | Issue | Action |
|--------|---------|-------|--------|
| **Entry Point** | SearchEngine.search() | Autonomous decisions | Inject Orchestrator |
| **Scoring** | DEFAULT_WEIGHTS hardcoded | No dynamic adjustment | Externaliz config |
| **Graph Boost** | 0.1× (hardcoded) | Fixed strategy | Orchestrator multiplier |
| **Reranking** | useRerank flag only | Binary toggle | Strategy decision |
| **Fallbacks** | Warn & continue | No orchestrated recovery | Ask Orchestrator |
| **Caching** | 5 volatile Maps | No persistence | SessionManager store |
| **Graph Sync** | manual syncToGraph flag | fire-and-forget | Signal-driven |
| **Expansion** | synonym + graph auto | No selective control | Per-signal decision |
| **Error Handling** | Silent fallback | Hidden failures | Emit signals |

