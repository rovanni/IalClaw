# Search Module Refactoring Analysis - EXECUTIVE SUMMARY
## IalClaw Project | April 4, 2026

---

## DOCUMENTS IN THIS ANALYSIS

1. **SearchModuleStructure.md** ← START HERE
   - Complete module architecture overview
   - All files, classes, and methods documented
   - Decision points with code examples
   - Current anti-patterns identified

2. **SearchModuleDecisionMap.md** ← UNDERSTAND THE PROBLEM
   - What autonomous decisions SearchEngine makes
   - Where scoring/boosting/caching logic lives
   - Fallback & recovery decision points
   - Visual flowcharts of decision zones

3. **SearchModuleFileReference.md** ← QUICK LOOKUP
   - File-by-file reference table
   - Method signatures and autonomy levels
   - Code smell analysis
   - Integration status check

---

## CRITICAL FINDINGS

### 🚨 SearchEngine is an Autonomous Decision Maker, Not a Signal Provider

**Current Reality**:
```
┌─ User Query ────────────────────────────────────────┐
│                                                      │
├─ SearchEngine decides: EXPANSION STRATEGY          │
│  ├─ Synonym expansion? (flag-driven)                │
│  ├─ Graph expansion? (flag-driven)                  │
│  └─ Max terms to include? (hardcoded=20)            │
│                                                      │
├─ SearchEngine decides: SCORING WEIGHTS              │
│  ├─ titleMatch=10? (hardcoded)                      │
│  ├─ contentMatch=1? (hardcoded)                     │
│  └─ graphBoost=0.1? (hardcoded)                     │
│                                                      │
├─ SearchEngine decides: RERANKING STRATEGY           │
│  ├─ Use LLM rerank? (flag-driven)                   │
│  └─ What if LLM fails? (hardcoded fallback=5.0)     │
│                                                      │
└─ SearchEngine decides: FALLBACK BEHAVIOR            │
   ├─ Graph expansion failed? (warn & continue)       │
   └─ LLM tagging failed? (use heuristic)             │
                                                       ↓
                                            SearchResult[]
```

**Should Be**:
```
┌─ User Query ────────────────────────────────────────┐
│                                                      │
├─ Query Orchestrator: expansion strategy request    │
│  └─ Orchestrator decides: expandSynonyms, expandGraph
│                                                      │
├─ Query Orchestrator: scoring weights request        │
│  └─ Orchestrator decides: titleMatch, contentMatch, graphBoost
│                                                      │
├─ Query Orchestrator: reranking strategy request     │
│  └─ Orchestrator decides: rerankingMode, threshold
│                                                      │
├─ Query Orchestrator: fallback policy request        │
│  └─ Orchestrator decides: RETRY, SKIP, or FAIL     │
│                                                      │
└─ SearchEngine executes strategy & returns results   │
                                                       ↓
                                            SearchResult[]
```

---

## KEY METRICS

### Decision Points Found: **15+**

| Category | Count | Severity | Entry Point |
|----------|-------|----------|------------|
| Expansion decisions | 4 | 🔥 Critical | searchEngine.search() |
| Scoring decisions | 7 | 🔥 Critical | scorer.DEFAULT_WEIGHTS |
| Reranking decisions | 2 | 🟠 High | llmReranker.rerank() |
| Fallback decisions | 3 | 🟠 High | Multiple locations |
| **TOTAL** | **16** | | |

### Caches Found: **9**

| Cache | Owner | Size Limit | Persistence |
|-------|-------|-----------|-------------|
| documentCache | SearchEngine | Unlimited | ❌ Memory only |
| autoTagger.cache | AutoTagger | Unlimited | ❌ Memory only |
| termIndex | InvertedIndex | Unlimited | ❌ Memory only |
| expansionCache | SemanticGraphBridge | 1000 (LRU) | ❌ Memory only |
| enrichmentCache | SemanticGraphBridge | 1000 (LRU) | ❌ Memory only |
| + 4 more indices | InvertedIndex | Unlimited | ❌ Memory only |
| **TOTAL** | | | ❌ **ZERO PERSISTENCE** |

### Anti-Patterns Identified: **3 🔥 Critical**

1. **Isolated Decision System** — SearchEngine makes autonomous decisions on:
   - Query expansion strategy (synonym + graph)
   - Document scoring weights (10× title vs 1× content)
   - When to apply graph semantic boost (0.1× hardcoded)
   - When and how to rerank with LLM
   - Fallback behavior on LLM failures

2. **Volatile Cache Fragmentation** — 9 separate Map instances fragment state:
   - No coordination between caches
   - LRU cleanup only in GraphBridge
   - Unbounded size in 5 caches
   - NO persistence via SessionManager
   - Impossible to serialize search state for replay

3. **Hardcoded Heuristics Block Orchestrator** — Multipliers locked in code:
   - `titleMatch: 10` (why 10? why not 15 for SKILL_SEARCH?)
   - `positionBonus: 0.1` (why 0.1? Can't tune per task)
   - `semanticBoost: 0.1` (why this? Context-dependent?)
   - Scoring weights cannot be adjusted per query/domain

---

## INTEGRATION STATUS: ZERO ❌

### Evidence

```
src/search/         ← 0 imports of CognitiveOrchestrator
                     ← 0 signals emitted to DebugBus
                     ← 0 integration points with AgentLoop
                     ← 0 injection points for Orchestrator

src/core/orchestrator/  ← 0 imports of SearchEngine
                         ← 0 search-related decisions
                         ← 0 strategy methods for search

src/engine/AgentLoop.ts ← 0 references to search module
src/core/agent/        ← 0 references to search module
```

**Conclusion**: SearchEngine is a **completely standalone autonomous system** with no connection to CognitiveOrchestrator.

---

## REFACTORING IMPACT

### What Needs to Be Moved to Orchestrator

#### Priority 1: CRITICAL (Blocks Autonomy)

| Component | Lines | Impact | Effort |
|-----------|-------|--------|--------|
| EXPANSION DECISIONS | searchEngine.search() L188+L202 | Query strategy | 🟡 Medium |
| SCORING WEIGHTS | scorer.DEFAULT_WEIGHTS | Task-specific tuning | 🟡 Medium |
| GRAPH BOOST MULTIPLIER | semanticGraphBridge L240 | Context-dependent | 🟢 Low |

#### Priority 2: HIGH (Enables Flexibility)

| Component | Lines | Impact | Effort |
|-----------|-------|--------|--------|
| RERANKING STRATEGY | searchEngine.search() L237-260 | Relevance control | 🟡 Medium |
| FALLBACK POLICIES | autoTagger, llmReranker | Error recovery | 🟠 High |
| CACHE LIFECYCLE | Multiple Maps | State persistence | 🟠 High |

#### Priority 3: MEDIUM (Nice-to-Have)

| Component | Lines | Impact | Effort |
|-----------|-------|--------|--------|
| SYNONYM EXPANSION | searchEngine.expandWithSynonyms() | Query preprocessing | 🟢 Low |
| INDEX STATISTICS | searchEngine.getStats() | Monitoring | 🟢 Low |

---

## DECISORY BEHAVIOR CHECKLIST

### What SearchEngine Autonomously Decides (Move to Orchestrator)

- [ ] **Expand query with synonyms?**
  - Current: `expandSynonyms=true` flag
  - Should be: Orchestrator signal based on query complexity

- [ ] **Expand query with graph?**
  - Current: `expandWithGraph=true` flag
  - Should be: Orchestrator signal based on domain/task type

- [ ] **How many graph terms max?**
  - Current: `maxTerms=20` hardcoded
  - Should be: Orchestrator-injected config value

- [ ] **Apply what scoring weights?**
  - Current: `DEFAULT_WEIGHTS` hardcoded (titleMatch=10, etc.)
  - Should be: Orchestrator provides weights per task

- [ ] **Apply graph semantic boost?**
  - Current: `0.1×` hardcoded multiplier
  - Should be: Orchestrator dynamic multiplier

- [ ] **Use LLM reranking?**
  - Current: `useRerank=true` flag
  - Should be: Orchestrator decision after scoring

- [ ] **What to do if graph expansion fails?**
  - Current: "warn & continue" only
  - Should be: Orchestrator chooses RETRY/SKIP/FAIL

- [ ] **What to do if LLM tagging fails?**
  - Current: Fall back to heuristic
  - Should be: Orchestrator chooses strategy

- [ ] **What to do if LLM reranking fails?**
  - Current: Use fallback score 5.0
  - Should be: Orchestrator chooses SKIP/RETRY/FALLBACK

- [ ] **When to sync documents to graph?**
  - Current: `syncToGraph=true` flag
  - Should be: Orchestrator signal-driven

---

## FILES TO MODIFY

### Phase 1: Injection Interface (Week 1)

**Create**:
- [ ] `src/search/decision/SearchStrategyDecider.ts` — Interface for decisions

**Modify**:
- [ ] `src/search/pipeline/searchEngine.ts` — Add `setOrchestrator()` method

### Phase 2: Extract Logic (Week 2)

**Modify**:
- [ ] `src/search/ranking/scorer.ts` — Make weights configurable
- [ ] `src/search/graph/semanticGraphBridge.ts` — Make boost dynamic
- [ ] `src/search/llm/autoTagger.ts` — Make fallback orchestrated
- [ ] `src/search/llm/llmReranker.ts` — Make fallback orchestrated

### Phase 3: Migration (Week 3-4)

**Create**:
- [ ] `src/search/signals/SearchSignal.ts` — Signal definitions
- [ ] `src/search/cache/CacheManager.ts` — SessionManager integration

**Modify**:
- [ ] `src/search/pipeline/searchEngine.ts` — Query orchestrator in search()
- [ ] `src/core/orchestrator/CognitiveOrchestrator.ts` — Add search decisions

### Phase 4: Testing (Week 5)

**Create**:
- [ ] `tests/search-orchestrator-integration.test.ts`
- [ ] Tests for each decision point override

---

## NEXT STEPS (RECOMMENDATIONS)

### Immediate (This Sprint)

1. ✅ **Review this analysis** with team
2. ✅ **Validate findings** by running SearchEngine locally
3. 🟡 **Decide orchestration model**:
   - Option A: Inject Orchestrator directly into SearchEngine
   - Option B: Extract search into CognitiveOrchestrator as module
   - Option C: Create SeachSignalPublisher pattern

### Short-term (Next Sprint)

1. Create SearchStrategyDecider interface
2. Add `setOrchestrator()` to SearchEngine
3. Extract DEFAULT_WEIGHTS constant
4. Create first decision point (expansion strategy)

### Medium-term (After 2 Sprints)

1. Migrate all 15+ decision points
2. Move 9 caches to SessionManager
3. Add comprehensive testing
4. Update documentation

### Long-term (Future)

1. Monitor search performance metrics
2. Optimize weights based on data
3. Add machine learning for weights tuning
4. Implement search signal learning loop

---

## QUESTIONS FOR STAKEHOLDERS

1. **Orchestrator injection**: Should SearchEngine hold reference to orchestrator, or should Orchestrator hold SearchEngine?

2. **Decision timing**: Should strategy decisions be made once per session or per query?

3. **Fallback policy**: For LLM failures, should we retry immediately or use cached result?

4. **Cache persistence**: Should search caches survive session restart? (Requires DB)

5. **Backwards compatibility**: Should we support both modes (with/without orchestrator) during transition?

6. **Performance**: Would queryable orchestrator add latency? Need benchmarks?

---

## RELATED DOCUMENTATION

- `docs/architecture/diagnostics/AntiPatterns.md` — Lists this as critical anti-pattern
- `docs/architecture/maps/CognitiveArchitectureMap.md` — Shows SearchEngine as isolated
- `specs/search-system.md` — Current search specification

---

## SUMMARY

**Status**: 🔥 **CRITICAL REFACTORING NEEDED**

**Root Cause**: SearchEngine evolved as an autonomous system without integration hooks to CognitiveOrchestrator.

**Impact**: 
- Cannot centralize search strategy decisions
- Cannot adjust weights per task type
- Cannot implement unified fallback policy
- Cannot persist search state

**Solutions**:
1. Inject CognitiveOrchestrator into SearchEngine
2. Convert 15+ autonomous decisions to orchestrator queries
3. Extract hardcoded multipliers to configurable providers
4. Migrate 9 caches to SessionManager

**Effort**: 3-4 weeks (phased approach possible)

**Benefit**: Centralized search governance, context-aware tuning, unified error handling, persistent state

