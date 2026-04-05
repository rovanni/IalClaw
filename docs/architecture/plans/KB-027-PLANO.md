# 🎯 PLANO DE RESOLUÇÃO — KB-027

**Data**: 4 de abril de 2026  
**Status**: Planejamento  
**Risco**: Crítico  
**Escopo**: Neutralizar Search como subsistema decisório isolado  

---

## 🧠 CONTEXTO

O módulo `SearchEngine` (src/search) toma **15+ decisões autônomas** que deveriam ser governadas pelo `CognitiveOrchestrator`:

- ✗ Estratégia de expansão de query (sinônimos, grafo)
- ✗ Pesos de scoring (aplicados hardcoded)
- ✗ Multiplicadores semânticos (10×, 0.1×, 0.5×)
- ✗ Decisão de reranking com LLM
- ✗ Tratamento de falhas (warns, defaults)
- ✗ Caches voláteis (9 Maps desacopladas do SessionManager)

**Critério de pronto** (do KB-027):
> Busca devolve sinais/metadados; estratégia e fallback ficam no Orchestrator

---

## ⚙️ ESTRATÉGIA GERAL

### Princípios invioláveis

1. **Refatoração estrutural**, não funcional (comportamento idêntico)
2. **Função por função** (incrementalidade obrigatória)
3. **Separação cognitiva/técnica** (decisão vs execução)
4. **Safe Mode em 100%** (orchestrator decision ?? loop decision)
5. **Signals como representação de intenção**, não lógica nova
6. **Sem duplicação**, sem fluxos paralelos

### Fases

```
FASE 1: Instrumentação (Signals + Ingestão)
   ↓
FASE 2: Migração de decisões (função por função)
   ↓
FASE 3: Cache centralizado (SessionManager)
   ↓
FASE 4: Validação + Estabilização
```

---

## 📋 FASE 1: INSTRUMENTAÇÃO (Signals + Ingestão)

### Objetivo
Criar infraestrutura mínima para que SearchEngine possa relatar suas decisões ao Orchestrator.

### Tarefas

#### T1.1 — Criar signals para decisões de Search

**Arquivo**: `src/shared/signals/SearchSignals.ts` (novo)

```typescript
// SearchQuerySignal: informar estratégia de expansão aplicada
interface SearchQuerySignal {
  type: 'SEARCH_QUERY';
  originalQuery: string;
  expandedTerms?: string[];
  graphExpansion?: boolean;
  reasoningContext?: string;
}

// SearchScoringSignal: informar estratégia de scoring
interface SearchScoringSignal {
  type: 'SEARCH_SCORING';
  weights: Record<string, number>;
  semanticBoost: number;
  reasoningContext?: string;
}

// SearchRerankerSignal: informar decisão de reranking
interface SearchRerankerSignal {
  type: 'SEARCH_RERANKER';
  shouldRerank: boolean;
  confidence: number;
  reasoningContext?: string;
}

// SearchFallbackSignal: informar estratégia de fallback
interface SearchFallbackSignal {
  type: 'SEARCH_FALLBACK';
  offendingComponent: string; // 'expansion', 'scoring', 'reranking', 'tagging'
  errorSummary: string;
  fallbackStrategy: 'use_default' | 'warn_and_continue' | 'abort';
  reasoningContext?: string;
}

export type SearchSignal = 
  | SearchQuerySignal 
  | SearchScoringSignal 
  | SearchRerankerSignal 
  | SearchFallbackSignal;
```

**Validação**: TypeScript compila sem erros

---

#### T1.2 — Adicionar methods de ingestão no CognitiveOrchestrator

**Arquivo**: `src/core/orchestrator/CognitiveOrchestrator.ts`

```typescript
private _observedSearchSignals: SearchSignal[] = [];

ingestSearchSignal(sessionId: string, signal: SearchSignal): void {
  // Registra sinal observado para decisão subsequente
  this._observedSearchSignals.push(signal);
  this.emitDebug('search_signal_ingested', {
    sessionId,
    signalType: signal.type,
    timestamp: Date.now(),
  });
}

getLastSearchSignal(): SearchSignal | undefined {
  return this._observedSearchSignals[this._observedSearchSignals.length - 1];
}

clearSearchSignals(): void {
  this._observedSearchSignals = [];
}
```

**Validação**: TypeScript compila sem erros

---

#### T1.3 — i18n obrigatório para novos logs

**Arquivo**: `src/i18n/pt-BR.json` e `en-US.json`

```json
{
  "search": {
    "query": {
      "orchestrator_expansion": "Estratégia de expansão de query definida pelo Orchestrator: {strategy}",
      "ingested_signal": "Sinal de query recebido e registrado"
    },
    "scoring": {
      "orchestrator_weights": "Pesos de scoring aplicados via Orchestrator: {weights}",
      "custom_boost": "Multiplicador semântico ajustado: {boost}"
    },
    "reranking": {
      "orchestrator_decision": "Decisão de reranking governada pelo Orchestrator: {decision}"
    },
    "fallback": {
      "strategy_applied": "Estratégia de fallback aplicada: {strategy}"
    }
  }
}
```

**Validação**: `npx tsc --noEmit` sem erros

---

### Checklist FASE 1

- [ ] SearchSignals.ts criado com TypeScript compilável
- [ ] CognitiveOrchestrator.ingestSearchSignal() implementado
- [ ] i18n adicionado em pt-BR.json e en-US.json
- [ ] `npm test` sem regressão
- [ ] Nenhuma lógica de decisão alterada (mesmo comportamento)

---

## 📋 FASE 2: MIGRAÇÃO DE DECISÕES (Função por Função)

### Objetivo
Extrair decisões autônomas de SearchEngine e representá-las como signals puros.

### Ordem obrigatória de funções

1. **`SearchEngine.search()` — Query expansion**
2. **`SearchEngine.scoreResults()` — Scoring weights**
3. **`SemanticGraphBridge.expandTerms()` — Graph expansion**
4. **`SearchEngine.rerank()` — Reranking decision**
5. **`AutoTagger.tagWithLLM()` — Fallback strategy**

### Formato de cada refatoração

Para cada função:

```
[FUNÇÃO] X
├─ Lógica técnica (permanecer no local)
├─ Lógica cognitiva (extrair para signal)
├─ TODO de migração futura (executar no Orchestrator)
└─ Safe Mode (orchestrator decision ?? local decision)
```

---

#### T2.1 — SearchEngine.search() — Query expansion

**Função atual** (src/search/SearchEngine.ts, linha ~169):

```typescript
// ANTES:
private async search(
  query: string,
  config?: SearchConfig
): Promise<SearchResult[]> {
  let expandedQuery = query;
  
  // DECISÃO COGNITIVA (autonoma):
  if (config?.synonymExpansion ?? DEFAULT_EXPANSION_ENABLED) {
    expandedQuery = this.expandSynonyms(query);
  }
  
  // mais código técnico...
}
```

**Após refatoração**:

```typescript
private async search(
  query: string,
  config?: SearchConfig,
  sessionId?: string
): Promise<SearchResult[]> {
  let expandedQuery = query;
  const expandedTerms: string[] = [];
  
  // LÓGICA TÉCNICA: aplicar decisão (agora vinda de fora)
  const shouldExpand = config?.synonymExpansion ?? 
    this.orchestrator?.decideQueryExpansion(sessionId) ?? 
    DEFAULT_EXPANSION_ENABLED;
  
  if (shouldExpand) {
    expandedQuery = this.expandSynonyms(query);
    expandedTerms.push(...expandedQuery.split(/\s+/));
    
    // SIGNAL PURO: registrar o que foi expandido
    if (this.orchestrator && sessionId) {
      this.orchestrator.ingestSearchSignal(sessionId, {
        type: 'SEARCH_QUERY',
        originalQuery: query,
        expandedTerms,
        graphExpansion: false,
        reasoningContext: `Query expansion applied: ${expandedTerms.length} terms`
      });
    }
  }
  
  // TODO: FASE 3 — Mover decisão shouldExpand completamente para Orchestrator
  //       decideQueryExpansion() deverá ser consultado sempre (sem fallback local)
  
  // mais código técnico...
}
```

**Validação**:
- [ ] Comportamento idêntico (mesmos resultados)
- [ ] Signal emitido e registrado no Orchestrator
- [ ] `npx tsc --noEmit` sem erros
- [ ] `npm test` sem regressão

---

#### T2.2 — SearchEngine.scoreResults() — Scoring weights

**Função atual** (src/search/SearchEngine.ts, linha ~280):

```typescript
// ANTES:
private scoreResults(results: any[]): Scored[] {
  const weights = DEFAULT_WEIGHTS; // AUTONOMA
  
  return results.map(r => ({
    item: r,
    score: calculateScore(r, weights)
  }));
}
```

**Após refatoração**:

```typescript
private scoreResults(
  results: any[],
  sessionId?: string
): Scored[] {
  // DECISÃO VINDA DO EXTERNOGENOUS (Safe Mode)
  const weights = this.orchestrator?.decideSearchWeights(sessionId) ?? 
    DEFAULT_WEIGHTS;
  
  // SIGNAL: registrar pesos aplicados
  if (this.orchestrator && sessionId) {
    this.orchestrator.ingestSearchSignal(sessionId, {
      type: 'SEARCH_SCORING',
      weights,
      semanticBoost: 1.0,
      reasoningContext: `Scoring weights applied`
    });
  }
  
  return results.map(r => ({
    item: r,
    score: calculateScore(r, weights)
  }));
  
  // TODO: FASE 3 — Orchestrator deve calcular/decisionar pesos antes da busca
}
```

**Validação**:
- [ ] Pesos aplicados corretamente (scores idênticos)
- [ ] Signal emitido
- [ ] Safe Mode funcionando

---

#### T2.3 — SemanticGraphBridge.expandTerms() — Graph expansion

**Decisões autonomas**:
- Graph expansion enabled/disabled
- Max terms (20 hardcoded)
- Semantic boost multiplier (0.1×)

**Após refatoração**:

```typescript
// ANTES:
async expandTerms(terms: string[]): Promise<string[]> {
  const shouldExpandGraph = true; // AUTONOMOUS
  const maxTerms = 20; // HARDCODED
  
  if (shouldExpandGraph) {
    const expanded = await this.buildSemanticGraph(terms, maxTerms);
    return expanded;
  }
}

// DEPOIS:
async expandTerms(
  terms: string[],
  sessionId?: string,
  orchestratorDecision?: { enabled: boolean; maxTerms: number; boost: number }
): Promise<string[]> {
  // Safe Mode
  const decision = orchestratorDecision ?? {
    enabled: true,
    maxTerms: 20,
    boost: 0.1
  };
  
  if (decision.enabled) {
    const expanded = await this.buildSemanticGraph(
      terms, 
      decision.maxTerms,
      decision.boost
    );
    
    // SIGNAL
    if (sessionId) {
      this.orchestrator?.ingestSearchSignal(sessionId, {
        type: 'SEARCH_QUERY',
        originalQuery: terms.join(' '),
        expandedTerms: expanded,
        graphExpansion: true,
        reasoningContext: `Graph expansion: +${expanded.length - terms.length} terms`
      });
    }
    
    return expanded;
  }
  
  return terms;
}
```

---

#### T2.4 — SearchEngine.rerank() — Reranking decision

**Decisão autonoma**: shouldRerank with LLM

**Após refatoração**:

```typescript
// ANTES:
async rerank(results: Scored[], query: string): Promise<Scored[]> {
  const shouldRerank = results.length > RERANK_THRESHOLD; // AUTONOMOUS
  
  if (shouldRerank) {
    return await this.llmReranker.rerank(results, query);
  }
  return results;
}

// DEPOIS:
async rerank(
  results: Scored[],
  query: string,
  sessionId?: string,
  orchestratorDecision?: boolean
): Promise<Scored[]> {
  // Safe Mode
  const shouldRerank = orchestratorDecision ?? 
    results.length > RERANK_THRESHOLD;
  
  if (shouldRerank) {
    const reranked = await this.llmReranker.rerank(results, query);
    
    // SIGNAL
    if (sessionId) {
      this.orchestrator?.ingestSearchSignal(sessionId, {
        type: 'SEARCH_RERANKER',
        shouldRerank: true,
        confidence: 0.8,
        reasoningContext: `LLM reranking applied: ${results.length} results`
      });
    }
    
    return reranked;
  }
  
  return results;
}
```

---

#### T2.5 — AutoTagger.tagWithLLM() — Fallback strategy

**Decisões autonomas**:
- Warn and continue on LLM failure
- Fallback to heuristic tagging

**Após refatoração**:

```typescript
// ANTES:
async tagWithLLM(doc: Document): Promise<string[]> {
  try {
    return await this.llm.tag(doc);
  } catch (error) {
    console.warn('LLM tagging failed, using heuristic'); // AUTONOMOUS FALLBACK
    return this.fallbackToHeuristicTags(doc);
  }
}

// DEPOIS:
async tagWithLLM(
  doc: Document,
  sessionId?: string,
  orchestratorFallbackStrategy?: 'use_default' | 'warn_and_continue' | 'abort'
): Promise<string[]> {
  try {
    return await this.llm.tag(doc);
  } catch (error) {
    const strategy = orchestratorFallbackStrategy ?? 'warn_and_continue';
    
    // SIGNAL: LLM falhou
    if (sessionId) {
      this.orchestrator?.ingestSearchSignal(sessionId, {
        type: 'SEARCH_FALLBACK',
        offendingComponent: 'tagging',
        errorSummary: error.message,
        fallbackStrategy: strategy,
        reasoningContext: `LLM tagging error, applying fallback: ${strategy}`
      });
    }
    
    if (strategy === 'abort') {
      throw error;
    }
    
    return this.fallbackToHeuristicTags(doc);
  }
}
```

---

### Checklist FASE 2

- [ ] T2.1 — SearchEngine.search() refatorado
  - [ ] Signal emitido para query expansion
  - [ ] Safe Mode funcionando
  - [ ] Comportamento idêntico
  
- [ ] T2.2 — SearchEngine.scoreResults() refatorado
  - [ ] Signal emitido para scoring
  - [ ] Pesos corretos aplicados
  
- [ ] T2.3 — SemanticGraphBridge.expandTerms() refatorado
  - [ ] Graph expansion decision via orchestrator
  - [ ] Signal emitido
  
- [ ] T2.4 — SearchEngine.rerank() refatorado
  - [ ] Reranking decision centralizado
  - [ ] Signal emitido
  
- [ ] T2.5 — AutoTagger.tagWithLLM() refatorado
  - [ ] Fallback strategy via orchestrator
  - [ ] Signal emitido

- [ ] `npx tsc --noEmit` sem erros
- [ ] `npm test` sem regressão
- [ ] Nenhuma integração funcional ativada (Safe Mode apenas)

---

## 📋 FASE 3: CACHE CENTRALIZADO (SessionManager)

### Objetivo
Migrar 9 caches voláteis desacopladas para SessionManager.

### Problema atual
- `documentCache` (SearchEngine)
- `autoTagger.cache` (AutoTagger)
- `termIndex, titleIndex, tagIndex, categoryIndex, termFrequency` (InvertedIndex)
- `expansionCache, enrichmentCache` (SemanticGraphBridge)

Nenhuma persistência, nenhuma auditoria, nenhuma sincronização com CognitiveState.

### Solução

#### T3.1 — Criar contrato de SearchCache no SessionManager

```typescript
// src/memory/SessionManager.ts

interface SearchCache {
  documentCache: Map<string, any>;
  invertedIndexes: {
    termIndex: Map<string, string[]>;
    titleIndex: Map<string, string[]>;
    tagIndex: Map<string, string[]>;
    categoryIndex: Map<string, string[]>;
    termFrequency: Map<string, number>;
  };
  semanticCache: {
    expansionCache: Map<string, string[]>;
    enrichmentCache: Map<string, any>;
  };
  autoTaggerCache: Map<string, string[]>;
}

// No Session model:
search_cache?: SearchCache;
```

#### T3.2 — Migrar caches existentes para SessionManager

SearchEngine e componentes dependentes deixam de manter caches próprias e consultam SessionManager.

```typescript
// Em SearchEngine:
getDocumentCache(sessionId: string): Map<string, any> {
  const session = this.sessionManager.getSession(sessionId);
  if (!session.search_cache) {
    session.search_cache = { /* ... */ };
  }
  return session.search_cache.documentCache;
}
```

---

### Checklist FASE 3

- [ ] SearchCache interface adicionada a Session model
- [ ] SearchEngine migrado para usar SessionManager.search_cache
- [ ] AutoTagger migrado para usar SessionManager.search_cache
- [ ] InvertedIndex migrado para usar SessionManager.search_cache
- [ ] SemanticGraphBridge migrado para usar SessionManager.search_cache
- [ ] Caches persistem entre requests
- [ ] `npm test` sem regressão

---

## 📋 FASE 4: VALIDAÇÃO + ESTABILIZAÇÃO

### Objetivo
Garantir que KB-027 está 100% resolvido e pronto para ativação de decisão no Orchestrator.

### Cobertura de testes

#### T4.1 — Teste de contrato SearchSignals

```typescript
// src/tests/SearchSignals.test.ts

describe('SearchSignals', () => {
  it('should emit SEARCH_QUERY signal on query expansion', () => {
    // Verificar que signal foi emitido
  });
  
  it('should emit SEARCH_SCORING signal on weight application', () => {
    // Verificar que signal foi registrado
  });
  
  it('should emit SEARCH_RERANKER signal on reranking', () => {
    // Verificar que signal foi emitido
  });
  
  it('should emit SEARCH_FALLBACK signal on error', () => {
    // Verificar que estratégia de fallback foi registrada
  });
});
```

#### T4.2 — Teste de SafeMode

```typescript
describe('SearchEngine SafeMode', () => {
  it('should use orchestrator decision when available', () => {
    // Verificar que decision do Orchestrator é usada
  });
  
  it('should fall back to local decision when orchestrator returns undefined', () => {
    // Verificar fallback
  });
  
  it('should never duplicate decisions', () => {
    // Verificar que não há duplicação
  });
});
```

#### T4.3 — Teste de persistência de cache

```typescript
describe('SearchCache Persistence', () => {
  it('should persist search cache in SessionManager', () => {
    // Verificar que cache persiste
  });
  
  it('should synchronize cache across requests', () => {
    // Verificar que múltiplas requisições veem a mesma cache
  });
});
```

---

### Checklist FASE 4

- [ ] SearchSignals tests adicionados
- [ ] SafeMode tests adicionados
- [ ] Cache persistence tests adicionados
- [ ] `npm test` sem regressão
- [ ] Cobertura de código >= 85%
- [ ] Audit logs mostram signals sendo emitidos corretamente
- [ ] Nenhuma regressão funcional em runtime

---

## 🚀 PRÓXIMA ETAPA (Pós-KB-027)

Após FASE 4 estar 100% completa:

1. **FASE 5** — Ativar decisões no Orchestrator
   - Implementar `decideQueryExpansion()`
   - Implementar `decideSearchWeights()`
   - Implementar `decideGraphExpansion()`
   - Implementar `decideReranking()`
   - Implementar política de fallback

2. **FASE 6** — Remover fallbacks locais
   - Remover `DEFAULT_EXPANSION_ENABLED`
   - Remover `DEFAULT_WEIGHTS`
   - Remover `RERANK_THRESHOLD`
   - SearchEngine passa a ser 100% guiado pelo Orchestrator

---

## 📍 COMO ATUALIZAR O CHECKLIST VIVO

Após cada FASE completada:

```markdown
## O que já foi corrigido
- Abril/2026: KB-027 FASE X concluída. [DESCRIÇÃO BREVE]

## O que está em andamento
- KB-027 FASE Y: [DESCRIÇÃO]

## O que ainda falta
- KB-027 FASE Z
- [...]
```

---

## 🔍 VALIDAÇÃO OBRIGATÓRIA

Antes de marcar cada FASE como "Concluída":

```bash
# 1. Compilação TypeScript
npx tsc --noEmit

# 2. Testes
npm test

# 3. Audit de signals (grep para debug logs)
grep -r "search_signal_ingested" logs/

# 4. Verificar SafeMode está ativo
grep -r "orchestratorDecision ??" src/search/ | wc -l
# Deve ser >= 5 (uma por função refatorada)
```

---

## 📊 MÉTRICAS DE SUCESSO

| Métrica | Baseline | Alvo (KB-027) |
|---------|----------|------------------|
| Decisões autonomas em Search | 15+ | 0 |
| Caches voláteis desacopladas | 9 | 0 |
| Signals emitidos por search() | 0 | >= 2 |
| Integração com Orchestrator | 0 imports | >= 4 decision points |
| Teste de fallback | N/A | 100% cobertura |
| Persistência de cache | Nenhuma | SessionManager |

---

**Status**: � FASE 2 Completa — Safe Mode Implementado  
**Próximo passo**: Implementar FASE 3 (Cache Centralizado) e FASE 4 (Testes)

---

## 📍 PROGRESSO ATUAL (Abril 4, 2026 — Continuação)

### O que já foi corrigido
- ✅ Abril/2026: KB-027 FASE 1 completa — SearchSignals criados, ingestão no Orchestrator implementada, i18n adicionado
- ✅ Abril/2026: KB-027 FASE 2 completa — Safe Mode implementado em 5 tarefas (query expansion, scoring weights, graph expansion, reranking, fallback strategy)
  - T2.1: `SearchEngine.search()` agora consulta `decideQueryExpansion()` com Safe Mode
  - T2.2: `SearchEngine.scoreResults()` agora consulta `decideSearchWeights()` com Safe Mode
  - T2.3: `SemanticGraphBridge.expandWithGraph()` agora consulta `decideGraphExpansion()` com Safe Mode e fallback estratégico
  - T2.4: `SearchEngine.rerank()` agora consulta `decideReranking()` com Safe Mode
  - T2.5: `AutoTagger.tagWithLLM()` agora consulta `decideSearchFallbackStrategy()` para tagging com Safe Mode
  - ✅ `npx tsc --noEmit` sem erros
  - ✅ `npm test` sem regressão

---

## O que está em andamento
- KB-027 FASE 3: T3.1 COMPLETO - Interface SearchCache criada. T3.2-T3.5 em pausa (requer refatoração arquitetural)
- KB-027 FASE 4: Testes iniciados - SearchSignals validados com node:test

---

## O que ainda falta
- KB-027 FASE 3: T3.2-T3.5 (Migração de caches — requer injeção de SessionManager em componentes)
- KB-027 FASE 4: Testes adicionais de SafeMode e Cache Persistence
- KB-027 FASE 5: Ativar decisões reais no Orchestrator (implementar lógica dos métodos decide*)
- KB-027 FASE 6: Remover fallbacks locais e consolidar autoridade no Orchestrator

---

**Status**: 🟡 FASE 3-4 em Progresso — Infrastructure + Testes Iniciais OK  
**Próximo passo**: Continuar com T3.2-T3.5 OU saltar para FASE 5 (ativar decisões reais)
