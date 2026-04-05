# PLANO DE CONCLUSAO - KB-027

Data: 5 de abril de 2026
Status: Replanejado para fechamento
Risco: Critico
Escopo: concluir KB-027 sem reabrir fases ja encerradas

---

## CONTEXTO

O KB-027 nasceu para neutralizar o Search como subsistema decisorio isolado e alinhar o pacote src/search ao modelo Single Brain.

Estado real validado antes deste plano:

- FASE 1 concluida: SearchSignals existem e sao ingeridos pelo CognitiveOrchestrator.
- FASE 2 concluida: Safe Mode esta aplicado nas decisoes de busca com padrao orchestratorDecision ?? localDecision.
- FASE 5 concluida: os metodos decideQueryExpansion, decideSearchWeights, decideGraphExpansion, decideReranking e decideSearchFallbackStrategy possuem logica real contextualizada no Orchestrator.
- FASE 6 concluida: autoridade cognitiva ja foi consolidada nessas decisoes sem regressao funcional conhecida.
- FASE 3 parcial: a interface SearchCache ja existe em src/shared/SessionManager.ts, mas os componentes de busca ainda mantem caches locais.
- FASE 4 iniciada: existe cobertura inicial em src/tests/KB027SearchSignals.test.ts, mas ainda nao cobre Safe Mode completo nem persistencia/isolamento de cache por sessao.

Critico: a pendencia restante nao e conceitual. Ela e estrutural. O SearchEngine ainda instancia dependencias com estado proprio, inclusive InvertedIndex via new e SemanticGraphBridge via singleton global, o que impede fechar a centralizacao de cache apenas trocando Maps por getters.

---

## REGRA CRITICA - VERIFICAR ANTES DE IMPLEMENTAR

Antes de qualquer alteracao:

- Verificar se a logica ja existe em src/search, src/shared/SessionManager.ts e src/core/orchestrator/CognitiveOrchestrator.ts.
- Reutilizar SearchCache existente em vez de criar nova estrutura paralela.
- Reutilizar o padrao de Safe Mode ja adotado no SearchEngine e no Orchestrator.
- Confirmar se a decisao pertence a busca ou se ja esta governada pelo Orchestrator.

Proibido nesta etapa:

- duplicar cache fora de SessionManager
- recriar signals de busca
- mudar heuristicas de scoring, query expansion, graph expansion, reranking ou fallback
- remover branches locais sem manter Safe Mode

---

## PLANO ESTRATEGICO DE FECHAMENTO

Arquivo oficial deste plano:

- D:/IA/IalClaw/docs/architecture/plans/KB-027-PLANO.md

Objetivo de pronto do KB-027:

- busca devolve sinais e metadados
- estrategia e fallback ficam no Orchestrator
- caches de busca deixam de ser estado volatil desacoplado e passam a ser session-scoped
- cobertura de testes prova Safe Mode, persistencia por sessao e ausencia de regressao estrutural

Sequencia obrigatoria para concluir:

1. fechar a injecao estrutural do SessionManager no pacote de busca
2. migrar caches locais funcao por funcao e componente por componente
3. ampliar testes para Safe Mode e persistencia de cache
4. validar compilacao, testes e sincronizacao do kanban

---

## ESTRATEGIA DE REFATORACAO

A refatoracao continua sendo estrutural, nao funcional. O comportamento deve permanecer equivalente.

Granularidade obrigatoria:

- refatorar por componente e por metodo de acesso ao cache
- nao reescrever arquivos inteiros de uma vez

Ordem obrigatoria por funcao:

1. identificar o estado compartilhado local
2. separar logica tecnica de acesso do cache da logica cognitiva ja existente
3. manter a logica cognitiva atual intacta
4. substituir o armazenamento local por acesso ao SearchCache da sessao
5. preservar Safe Mode nos pontos decisorios
6. adicionar TODO explicito apenas se a etapa seguinte depender de outra migracao real

Restricoes desta etapa:

- nao ativar decisoes novas no Orchestrator
- nao recalibrar pesos, thresholds ou boosts
- nao trocar singleton global por outro global equivalente

---

## ESCOPO DESTA ETAPA

Implementar apenas o que falta para concluir KB-027:

- FASE 3 restante: T3.2 a T3.5
- FASE 4 restante: consolidacao da cobertura de testes para SearchSignals, Safe Mode e SearchCache session-scoped
- sincronizacao documental do kanban e checklist historico ao final

Fora de escopo agora:

- alterar heuristicas do SearchEngine
- redesenhar o GraphAdapter
- mexer em outras Kbs criticas
- otimizar performance alem do necessario para remover estado local

---

## FASE 3 - CACHE CENTRALIZADO (PENDENCIA REAL)

### Diagnostico tecnico

Os bloqueios reais desta fase sao:

- SearchEngine nao recebe SessionManager nem sessionId nos caminhos de indexacao.
- InvertedIndex mantem documentos e indices em memoria propria.
- SemanticGraphBridge mantem expansionCache e enrichmentCache em instancia propria e ainda possui acesso via singleton global getSemanticGraphBridge().
- AutoTagger mantem cache local sem escopo de sessao.

Conclusao: antes de trocar Maps, e necessario tornar o pacote de busca session-aware de forma incremental.

### T3.2 - Introduzir SessionManager no SearchEngine como dependencia estrutural

Objetivo:

- permitir que SearchEngine resolva caches por sessionId sem fallback destrutivo

Acoes:

- ajustar constructor de SearchEngine para aceitar SessionManager ou resolver uma facade equivalente, sem quebrar call sites atuais
- propagar sessionId para indexDocument e indexDocuments quando a operacao depender de cache session-scoped
- criar getters internos de cache no SearchEngine, sem mudar ainda a heuristica da busca
- preservar fallback local temporario apenas onde sessionId nao existir, documentando que esse caminho nao fecha a fase

Checklist:

- [ ] SearchEngine consegue resolver search_cache da sessao
- [ ] indexDocument e indexDocuments aceitam sessionId opcional quando necessario
- [ ] documentCache local deixa de ser fonte primaria
- [ ] nenhum call site existente quebra por assinatura

### T3.3 - Migrar InvertedIndex para dados session-scoped

Objetivo:

- retirar os 5 indices locais como fonte de verdade para sessoes reais

Acoes:

- permitir que InvertedIndex receba acesso a SearchCache da sessao sem mudar a API publica alem do necessario
- migrar termIndex, titleIndex, tagIndex, categoryIndex e termFrequency para a estrutura existente em SessionManager
- decidir explicitamente como documents sera tratado: manter local temporariamente com TODO curto ou inclui-lo no SearchCache se a consistencia exigir
- adaptar search, addDocument, removeDocument e clear para operarem no cache da sessao

Risco principal:

- misturar documentos globais com indices por sessao gera inconsistencia silenciosa

Checklist:

- [ ] indices invertidos usam SearchCache da sessao
- [ ] documents tem fonte de verdade coerente com os indices
- [ ] addDocument/removeDocument/search continuam equivalentes
- [ ] clear limpa estado da sessao correta

### T3.4 - Remover dependencia de singleton global no SemanticGraphBridge

Objetivo:

- impedir compartilhamento de expansionCache e enrichmentCache entre sessoes diferentes

Acoes:

- substituir o uso obrigatorio de getSemanticGraphBridge() por injecao controlada no SearchEngine
- manter createSemanticGraphBridge para testes e composicao explicita
- mover expansionCache e enrichmentCache para o SearchCache da sessao ou para estrutura claramente session-scoped ligada ao SearchEngine
- garantir que clearCaches, reset e getCacheStats reflitam o estado da sessao ativa ou explicitem o escopo usado

Checklist:

- [ ] SearchEngine nao depende mais de singleton global para estado de cache
- [ ] expansionCache e enrichmentCache deixam de vazar entre sessoes
- [ ] estatisticas de cache continuam validas
- [ ] comportamento de graph expansion permanece identico

### T3.5 - Migrar cache do AutoTagger

Objetivo:

- eliminar cache sem escopo de sessao na geracao de estrutura semantica

Acoes:

- substituir cache local por acesso ao autoTaggerCache do SearchCache
- propagar sessionId em generateSemanticStructure nos fluxos de indexacao que precisarem persistir cache
- manter fallback atual governado por Safe Mode sem alteracoes

Checklist:

- [ ] cache do AutoTagger passa a ser session-scoped
- [ ] indexacao com mesma sessao reaproveita cache
- [ ] sessoes diferentes nao compartilham entradas
- [ ] fallback de tagging permanece intacto

### Criterio de pronto da FASE 3

- nenhum cache de busca relevante permanece como fonte primaria em memoria global ou de instancia compartilhada
- a sessao passa a ser a unidade explicita de persistencia do estado de busca
- a API publica continua compatível ou com mudancas controladas e refletidas nos call sites

---

## FASE 4 - VALIDACAO E TESTES (PENDENCIA REAL)

### Diagnostico tecnico

O arquivo src/tests/KB027SearchSignals.test.ts prova emissao basica de signals, mas ainda nao fecha o criterio de pronto do KB-027 porque nao valida:

- Safe Mode com decisao do Orchestrator versus fallback local
- persistencia de cache entre operacoes da mesma sessao
- isolamento entre sessoes diferentes
- ausencia de vazamento do singleton do SemanticGraphBridge

### T4.1 - Consolidar suite KB027SearchSignals

Acoes:

- manter o arquivo existente como base
- ampliar para cobrir SEARCH_QUERY, SEARCH_SCORING, SEARCH_RERANKER e SEARCH_FALLBACK com asserts mais precisos
- validar que o Orchestrator recebe signals coerentes com a execucao observada

Checklist:

- [ ] suite cobre os 4 tipos principais de signal
- [ ] asserts verificam payload e nao apenas existencia
- [ ] testes passam sem depender de side effects globais

### T4.2 - Criar testes de Safe Mode do SearchEngine

Acoes:

- validar o padrao orchestratorDecision ?? localDecision para query expansion
- validar o padrao orchestratorDecision ?? localDecision para scoring weights
- validar o padrao orchestratorDecision ?? localDecision para graph expansion, reranking e fallback
- garantir equivalencia funcional quando o Orchestrator devolve undefined

Checklist:

- [ ] Safe Mode coberto nas 5 decisoes de busca
- [ ] comportamento local permanece igual com orchestrator undefined
- [ ] override do Orchestrator e respeitado quando presente

### T4.3 - Criar testes de persistencia e isolamento de cache

Acoes:

- validar reuso do documentCache/search_cache na mesma sessao
- validar isolamento entre sessionId diferentes
- validar que reset/clear nao apagam outra sessao
- se o SemanticGraphBridge permanecer com abstracao propria, testar que ela nao compartilha cache entre sessoes

Checklist:

- [ ] persistencia na mesma sessao comprovada
- [ ] isolamento entre sessoes comprovado
- [ ] limpeza de cache respeita o escopo da sessao

### Criterio de pronto da FASE 4

- npx tsc --noEmit sem erros
- npm.cmd test ou suites equivalentes sem regressao atribuivel ao KB-027
- evidencias registradas no kanban

---

## CHECKLIST KANBAN

Fonte oficial:

- D:/IA/IalClaw/docs/architecture/kanban/README.md
- D:/IA/IalClaw/docs/architecture/kanban/Em_Andamento/em_andamento.md

Ao concluir cada bloco, atualizar:

- o que ja foi corrigido: F1, F2, F5 e F6
- o que esta em andamento: F3 e F4
- o que ainda falta: migracao estrutural de cache e testes de fechamento
- o que nao deve ser tocado agora: heuristicas de busca e outras Kbs criticas

Antes de mover o card para concluido:

- registrar evidencia objetiva de compilacao e testes
- sincronizar mapa geral e historico, se houver mudanca de status

---

## REGRAS ARQUITETURAIS

- Orchestrator continua sendo o unico decisor
- signals continuam representando intencao observada, nao logica nova duplicada
- SearchEngine nao deve recuperar mini-brain local durante a migracao de cache
- nenhuma heuristica existente deve ser removida antes da validacao completa
- Safe Mode permanece obrigatorio em todos os pontos de decisao

---

## I18N - OBRIGATORIO

Se a conclusao da FASE 3 ou FASE 4 introduzir novas mensagens visiveis, logs externos ou erros:

- [ ] adicionar chaves em src/i18n/pt-BR.json
- [ ] adicionar chaves em src/i18n/en-US.json
- [ ] substituir strings hardcoded por t()
- [ ] validar npx tsc --noEmit apos a alteracao

Se nao houver nova mensagem visivel, registrar explicitamente que a etapa foi estrutural e nao exigiu chaves novas.

---

## SAFE MODE - OBRIGATORIO

Padrao que deve continuar verdadeiro durante todo o fechamento:

finalDecision = orchestratorDecision ?? localDecision

Aplicacao obrigatoria no escopo do KB-027:

- query expansion
- search weights
- graph expansion
- reranking
- fallback strategy

---

## REGRA DE IMPLEMENTACAO

Executar incrementalmente:

1. ajustar construtor e pontos de injecao
2. compilar
3. migrar um cache por componente
4. compilar
5. ampliar teste daquele componente
6. compilar e testar

Proibido:

- migrar todos os caches de uma vez
- misturar refactor estrutural com tuning de busca
- fechar a FASE 3 sem testes de isolamento por sessao

---

## VALIDACAO OBRIGATORIA

### 1. Inconsistencias

- existe algum cache local ainda sendo a fonte real em runtime?
- existe divergencia entre documentos indexados e indices consultados?

### 2. Duplicacoes

- algum cache passou a existir tanto no SearchCache quanto na instancia local?
- o singleton global do grafo ainda segura estado relevante?

### 3. Melhorias seguras

- algum ponto restante pode ser centralizado depois sem mudar comportamento?

### 4. Riscos arquiteturais

- ainda existe bypass do Orchestrator em decisoes de busca?
- ainda existe compartilhamento de estado entre sessoes?

### 5. Coerencia de autoridade

- quem decide query expansion, scoring, graph expansion, reranking e fallback?
- existe algum segundo decisor introduzido pela migracao?

### 6. Verificacao de conflitos reais

- Route vs FailSafe
- Validation vs StopContinue
- Fallback vs Route
- Search fallback local vs decisao do Orchestrator

---

## CRITERIO FINAL DE ENCERRAMENTO DO KB-027

O KB-027 so pode sair de Em Andamento quando todos os itens abaixo forem verdadeiros:

- [ ] FASE 3 concluida sem caches locais como fonte primaria
- [ ] FASE 4 concluida com cobertura de Safe Mode e session-scoped cache
- [ ] npx tsc --noEmit validado
- [ ] npm.cmd test validado ou falhas preexistentes isoladas e documentadas
- [ ] kanban sincronizado com evidencias objetivas
- [ ] nenhum bypass novo do Orchestrator introduzido

---

## ORDEM EXECUTAVEL RECOMENDADA

1. Refatorar SearchEngine para aceitar sessao e dependencia de cache.
2. Refatorar InvertedIndex para operar sobre estado session-scoped coerente.
3. Remover singleton stateful do caminho principal do SemanticGraphBridge.
4. Migrar cache do AutoTagger.
5. Fechar testes de signals, Safe Mode e persistencia por sessao.
6. Rodar compilacao, testes e sincronizar kanban.
