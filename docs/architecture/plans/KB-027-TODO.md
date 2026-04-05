# KB-027 TODO - O que falta para fechar

Data: 5 de abril de 2026
Status do projeto: 100% completo | KB-027 fechado
Ultimo atualizado: fechamento da FASE 4

---

## FASE 3 - Cache centralizado

Objetivo: concluir a migracao estrutural dos caches de busca para SearchCache por sessao.

### T3.1 - Base ja concluida

- [x] SearchCache existe em src/shared/SessionManager.ts
- [x] SessionContext ja expoe search_cache

### T3.2 - SearchEngine session-aware

- [x] aceitar dependencia/session-aware access sem quebrar call sites atuais
- [x] propagar sessionId nos fluxos de indexacao que dependem de cache
- [x] migrar documentCache para getter baseado em search_cache
- [x] manter fallback controlado apenas onde nao houver sessionId

### T3.3 - InvertedIndex session-scoped

- [x] migrar termIndex, titleIndex, tagIndex, categoryIndex e termFrequency
- [x] garantir coerencia entre indices e documents
- [x] adaptar addDocument, removeDocument, search e clear

### T3.4 - SemanticGraphBridge sem cache global compartilhado

- [x] remover o singleton stateful do caminho principal
- [x] migrar expansionCache e enrichmentCache para escopo por sessao
- [x] preservar comportamento de graph expansion e estatisticas

### T3.5 - AutoTagger cache por sessao

- [x] migrar cache local para autoTaggerCache
- [x] propagar sessionId no fluxo de generateSemanticStructure
- [x] validar reaproveitamento na mesma sessao e isolamento entre sessoes

### Validacao da FASE 3

- [x] npx tsc --noEmit
- [x] testes de busca sem regressao atribuivel ao KB-027
- [x] nenhum cache local/global continua como fonte primaria

---

## FASE 4 - Testes de fechamento

Objetivo: provar que o KB-027 esta fechado com Safe Mode e cache session-scoped.

### T4.1 - Consolidar KB027SearchSignals.test.ts

- [x] cobrir SEARCH_QUERY com assert de payload (originalQuery, expandedTerms, graphExpansion)
- [x] cobrir SEARCH_SCORING com assert de pesos (titleMatch, contentMatch, tagMatch, semanticBoost)
- [x] cobrir SEARCH_RERANKER com assert de decisao (shouldRerank=true, confidence>0)
- [x] cobrir SEARCH_FALLBACK com assert de estrategia (offendingComponent, fallbackStrategy, errorSummary)

### T4.2 - Safe Mode end-to-end

- [x] testar query expansion com override do Orchestrator e fallback local
- [x] testar search weights com undefined no Orchestrator
- [x] testar graph expansion, reranking e fallback strategy no padrao orchestratorDecision ?? localDecision

### T4.3 - Persistencia e isolamento por sessao

- [x] mesma sessao reaproveita cache
- [x] sessoes diferentes nao compartilham estado
- [x] clear/reset respeitam o escopo certo

### Validacao da FASE 4

- [x] npx tsc --noEmit
- [x] npm.cmd test ou suites equivalentes
- [x] evidencias registradas no kanban

---

## Nao tocar agora

- [ ] nao alterar heuristicas de busca
- [ ] nao recalibrar scoring/boosts
- [ ] nao reabrir FASE 1, FASE 2, FASE 5 ou FASE 6
- [ ] nao misturar KB-027 com outras Kbs criticas

---

## Encerramento do KB-027

- [x] FASE 3 concluida
- [x] FASE 4 concluida
- [x] kanban sincronizado
- [x] evidencias objetivas anexadas
