# ✅ KB-027 TODO — O Que Falta (Checklist Executável)

**Data**: 4 de abril de 2026  
**Status do Projeto**: 40% Completo | 60% Pendente  
**Último Atualizado**: Após FASE 2 completa com Safe Mode

---

## 📋 FASE 3 — CACHE CENTRALIZADO (2 horas)

**Objetivo**: Migrar 9 Maps desacopladas para SessionManager

### T3.1 — Criar interface SearchCache

**Arquivo**: `src/memory/SessionManager.ts`

**Ação**:
1. Abrir `src/memory/SessionManager.ts`
2. Localizar interface `SessionContext` 
3. Adicionar:
```typescript
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
```
4. Em `SessionContext`, adicionar: `search_cache?: SearchCache;`

**Checklist**:
- [ ] Interface criada sem erros TS
- [ ] SessionContext atualizado

---

### T3.2 — Migrar SearchEngine.documentCache

**Arquivo**: `src/search/pipeline/searchEngine.ts`

**Ação**:
1. Remover: `private documentCache: Map<string, SearchDocument>;` (linha ~87)
2. Substituir getter:
```typescript
private getDocumentCache(sessionId?: string): Map<string, SearchDocument> {
  if (!sessionId || !this.sessionManager) {
    return new Map(); // Fallback
  }
  const session = this.sessionManager.getSession(sessionId);
  if (!session.search_cache) {
    session.search_cache = { /* inicializar estrutura completa */ };
  }
  return session.search_cache.documentCache;
}
```
3. Substituir todas as referências: `this.documentCache` → `this.getDocumentCache(sessionId)`

**Checklist**:
- [ ] `documentCache` removido como campo
- [ ] Getter criado
- [ ] Todas as referências migradas
- [ ] `npx tsc --noEmit` passa

---

### T3.3 — Migrar InvertedIndex caches

**Arquivo**: `src/search/index/invertedIndex.ts`

**Ação**:
1. Remover 5 campos:
   - `private termIndex: Map<...>`
   - `private titleIndex: Map<...>`
   - `private tagIndex: Map<...>`
   - `private categoryIndex: Map<...>`
   - `private termFrequency: Map<...>`

2. Adicionar SessionManager injeção no constructor
3. Criar getter: `private getIndexes(sessionId?: string)` que retorna do SessionManager
4. Migrar todas as referências

**Checklist**:
- [ ] 5 Maps removidos
- [ ] SessionManager injetado
- [ ] Getter criado
- [ ] Referências migradas
- [ ] `npm test` passa

---

### T3.4 — Migrar SemanticGraphBridge caches

**Arquivo**: `src/search/graph/semanticGraphBridge.ts`

**Ação**:
1. Remover 2 campos:
   - `private expansionCache: Map<...>`
   - `private enrichmentCache: Map<...>`

2. Criar getter: `private getSemanticCache(sessionId?: string)`
3. Migrar todas as referências

**Checklist**:
- [ ] 2 caches removidos
- [ ] Getter criado
- [ ] Referências migradas

---

### T3.5 — Migrar AutoTagger.cache

**Arquivo**: `src/search/llm/autoTagger.ts`

**Ação**:
1. Remover: `private cache: Map<string, SemanticStructure>;`
2. Criar getter: `private getCache(sessionId?: string)`
3. Migrar referências em `generateSemanticStructure()`

**Checklist**:
- [ ] `cache` removido
- [ ] Getter criado
- [ ] Referências migradas
- [ ] `npm test` passa

---

### VALIDAÇÃO FASE 3

```bash
# 1. Compilação
npx tsc --noEmit

# 2. Testes
npm test

# 3. Verificar que caches persistem
grep -r "session.search_cache" src/search/ | wc -l
# Deve ter +10 ocorrências
```

---

## 📋 FASE 4 — TESTES (2 horas)

**Objetivo**: Cobertura 100% de SearchSignals e SafeMode

### T4.1 — Criar SearchSignals.test.ts

**Arquivo**: `src/tests/SearchSignals.test.ts` (novo)

```typescript
describe('SearchSignals', () => {
  describe('SEARCH_QUERY signal', () => {
    it('should emit signal on synonym expansion', async () => {
      // Arrange
      const engine = new SearchEngine();
      const orchestrator = new CognitiveOrchestrator(...);
      engine.setOrchestrator(orchestrator);
      
      // Act
      await engine.search('test query', { expandSynonyms: true, sessionId: 'session1' });
      
      // Assert
      const signal = orchestrator.getLastSearchSignal();
      expect(signal?.type).toBe('SEARCH_QUERY');
      expect(signal?.graphExpansion).toBe(false);
    });

    it('should emit signal on graph expansion', async () => {
      // Similar para graph expansion
      // Verificar: graphExpansion === true
    });
  });

  describe('SEARCH_SCORING signal', () => {
    it('should emit signal with weights', async () => {
      // Verificar que weights estão sendo emitidos
    });
  });

  describe('SEARCH_RERANKER signal', () => {
    it('should emit signal when reranking', async () => {
      // Verificar shouldRerank === true
    });
  });

  describe('SEARCH_FALLBACK signal', () => {
    it('should emit signal on graph expansion error', async () => {
      // Forçar erro no graph bridge
      // Verificar fallbackStrategy emitido
    });
  });
});
```

**Checklist**:
- [ ] Arquivo criado em `src/tests/`
- [ ] 5+ testes implementados
- [ ] Todos passam com `npm test`

---

### T4.2 — Criar SearchEngineIntegration.test.ts

**Arquivo**: `src/tests/SearchEngineIntegration.test.ts` (novo)

```typescript
describe('SearchEngine SafeMode Integration', () => {
  it('should use orchestrator decision when provided', async () => {
    // Mock orchestrator que retorna true/false
    // Verificar que decision foi aplicada
  });

  it('should fall back to local decision when orchestrator undefined', async () => {
    // engine.setOrchestrator(undefined)
    // Verificar que comportamento padrão é usado
  });

  it('should produce identical scores with/without orchestrator', async () => {
    // Buscar com orchestrator.decideSearchWeights() = undefined
    // Buscar sem orchestrator
    // Verificar scores são iguais
  });
});
```

**Checklist**:
- [ ] 3+ testes implementados
- [ ] Validam Safe Mode
- [ ] Todos passam

---

### T4.3 — Criar SearchCachePersistence.test.ts

**Arquivo**: `src/tests/SearchCachePersistence.test.ts` (novo)

```typescript
describe('SearchCache Persistence', () => {
  it('should persist cache between requests in same session', async () => {
    // Requisição 1: indexar documento A
    // Requisição 2: verificar que documento A está no cache
  });

  it('should isolate cache between different sessions', async () => {
    // Session 1: indexar doc A
    // Session 2: indexar doc B
    // Verificar que Session 1 não vê doc B
  });
});
```

**Checklist**:
- [ ] 2+ testes implementados
- [ ] Validam isolamento de sessão
- [ ] Todos passam

---

### VALIDAÇÃO FASE 4

```bash
# Coverage deve estar >= 85%
npm test -- --coverage

# Todos os 3 arquivos criados
ls src/tests/Search*.test.ts
```

---

## 📋 FASE 5 — ATIVAR DECISÕES REAIS (1-2 horas)

**Objetivo**: Implementar lógica real nos 5 métodos de decisão

### T5.1 — decideQueryExpansion()

**Arquivo**: `src/core/orchestrator/CognitiveOrchestrator.ts`

**Mudar de**:
```typescript
public decideQueryExpansion(sessionId?: string): boolean | undefined {
  return undefined; // TODO: implementar
}
```

**Para**:
```typescript
public decideQueryExpansion(sessionId?: string): boolean | undefined {
  if (!sessionId) return undefined;
  
  const cognitiveState = this.getCognitiveState(sessionId);
  const lastSearchSignal = this.getLastSearchSignal();
  
  // Lógica: expandir se confiança > 70%
  const confidence = cognitiveState?.confidence ?? 0;
  return confidence > 0.7 ? true : undefined;
}
```

**Checklist**:
- [ ] Implementado com lógica real
- [ ] Retorna boolean ou undefined
- [ ] `npm test` passa

---

### T5.2-T5.5 — Outros 4 métodos

**Padrão similar** para:
- `decideSearchWeights()` → retornar pesos personalizados baseado em contexto
- `decideGraphExpansion()` → retornar config semântica
- `decideReranking()` → retornar bool baseado em confiança de resultados
- `decideSearchFallbackStrategy()` → retornar estratégia baseada em criticidade

**Cada um**:
- [ ] Lógica implementada
- [ ] Usa CognitiveState ou contexto relevante
- [ ] Testes passam

---

## 📋 FASE 6 — CLEANUP & CONSOLIDAÇÃO (30 min)

**Objetivo**: SearchEngine 100% governado pelo Orchestrator

### T6.1 — Remover defaults locais

**Arquivo**: `src/search/pipeline/searchEngine.ts`

**Remover**:
```typescript
// Remover estas linhas:
const DEFAULT_EXPANSION_ENABLED = true;
const DEFAULT_WEIGHTS = { ... };
```

**Resultado**: SearchEngine NUNCA toma decisão local quando falha Orchestrator

**Checklist**:
- [ ] Constantes removidas
- [ ] Safe Mode continua funcionando (undefined passa)
- [ ] `npm test` passa

---

## 🎯 ORDEM DE EXECUÇÃO RECOMENDADA

```
DIA 1 (4h):
  ├─ FASE 3: T3.1-T3.5 (2h) + validação
  └─ FASE 4: T4.1-T4.3 (2h) + validação

DIA 2 (2-3h):
  ├─ FASE 5: T5.1-T5.5 (1-2h)
  └─ FASE 6: T6.1 (30min)

TOTAL: 6-7 horas para 100% completo
```

---

## 🚀 COMO COMEÇAR AGORA

**Opção 1**: Começar por FASE 3 (recomendado)
```bash
# Abrir arquivo
code src/memory/SessionManager.ts

# Começar com T3.1 — criar interface SearchCache
```

**Opção 2**: Começar por FASE 4 (testes)
```bash
# Criar arquivo de testes
code src/tests/SearchSignals.test.ts

# Começar a escrever testes
```

**Minha recomendação**: **FASE 3 → FASE 4 → FASE 5 → FASE 6**

---

## 📊 MÉTRICAS FINAIS (após tudo completo)

| Métrica | Baseline | Alvo | Status |
|---------|----------|------|--------|
| Decisões autonomas em Search | 15+ | 0 | ⏳ |
| Caches voláteis | 9 | 0 | ⏳ |
| Signals emitidos | N/A | 100% | ✅ |
| Safe Mode ativo | N/A | 5 pontos | ✅ |
| Testes | N/A | 100% cobertura | ⏳ |
| Governança Orchestrator | 0% | 100% | ⏳ |

---

**Próximo passo**: Escolher começar por FASE 3 ou FASE 4?
