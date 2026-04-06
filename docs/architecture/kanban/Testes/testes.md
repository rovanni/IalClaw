# Validacao - Em andamento (teste em runtime)

Objetivo deste arquivo:
- Concentrar somente o que esta em andamento e depende de validacao em ambiente real.
- Registrar comportamento esperado, evidencias e exemplos praticos com IalClaw.

## 1) Itens em andamento que precisam de validacao de testes

- [x] KB-017 - Externalizar capabilityFallback para signal puro
  - Status: concluido em 2026-04-05 (Fase 3 e Fase 4 validadas).
  - Comportamento validado:
    - Branch decisoria local removida do executor; decisao de capability fallback centralizada no Orchestrator.
    - Quando nao ha decisao do Orchestrator, o executor retorna `undefined` para `fallbackDecision` (sem mini-brain residual local).
    - Payload de fallback permanece factual (`failureType`, `capability`, `retryPossible`, `severity`, `context`) e sem campo `strategy`.
  - Evidencias atuais:
    - Refactor em `src/core/executor/AgentExecutor.ts` removeu `getLocalCapabilityFallbackDecision(...)` e manteve apenas decisao orquestrada.
    - Suite `src/tests/run.ts` atualizada para validar contrato factual de fallback e comportamento governado/delegado.
    - Execucao de `npm test` com fechamento em `All tests passed`.

- [ ] KB-001 - Externalizar healing loop do executor para governanca do Orchestrator (Fase 1+2)
  - Status: implementado parcialmente e aguardando validacao runtime.
  - Comportamento esperado:
    - Decisao final de retry/abort segue governanca do Orchestrator com safe mode (`orchestratorDecision ?? executorDecision`).
    - Sem sinais suficientes, Orchestrator pode retornar `undefined` e manter fallback controlado.
    - Com fail-safe ativo, governanca deve forcar `abort` sem loop extra.
  - Evidencias para aprovar:
    - Evento `retry_decision` com `orchestratorDecision`, `executorDecision` e `finalDecision` coerentes.
    - Sem retries extras apos `fail_safe_activated`.

- [ ] KB-011 - Monitorar logs de short-circuit em producao
  - Status: em monitoramento.
  - Comportamento esperado:
    - Em intencao operacional real, short-circuit deve ser bloqueado e fluxo deve seguir no tool loop.
    - `DIRECT_LLM` deve ser bloqueado em `REAL_TOOLS_ONLY`.
  - Evidencias para aprovar:
    - Aumento relativo de `short_circuit_blocked` / `short_circuit_blocked_real_tools_only` em casos operacionais.
    - Reducao relativa de `short_circuit_activated` em casos operacionais equivalentes.

- [ ] KB-012 - Validar runtime de filesystem com meta.source
  - Status: aguardando rodada adicional em ambiente real.
  - Comportamento esperado:
    - `taskType=filesystem` deve usar `meta.source=deterministic_builder`.
    - Tipos sem builder registrado devem cair em `meta.source=legacy_forced_plan`.
    - Steps de filesystem devem ser executaveis (`tool` definido).
  - Evidencias para aprovar:
    - `source` correto por tipo de tarefa.
    - Em filesystem, 100% dos steps com `tool` preenchido.

- [ ] KB-024 - Centralizar ranking e estado de memoria no SessionManager (parcialmente mitigado)
  - Status: ETAPA KB-024.1 concluida; ETAPA KB-024.2 de autoridade ativa adiada para manter aderencia ao template nesta fase.

  - [ ] KB-024 ETAPA KB-024.2 - Ativar autoridade do Orchestrator em selecao de tool (adiada)
    - Status: nao ativada nesta fase para preservar migracao segura em safe mode.
    - Comportamento esperado:
      - `decideToolSelection()` no Orchestrator deve permanecer observacional (passivo).
      - decisao final deve continuar no loop enquanto a migracao de autoridade nao for concluida.
      - safe mode obrigatorio: `finalDecision = orchestratorDecision ?? loopDecision`.
    - Evidencias atuais:
      - ToolSelectionSignal emitido pelo loop e ingerido pelo Orchestrator para observabilidade.
      - fallback local permanece ativo no AgentLoop nesta etapa.
      - Suite de testes valida trilha de memoria por sessao e contrato de safe mode.
      - i18n adicionado com 3 chaves em pt-BR.json e en-US.json.
      - `node ./node_modules/typescript/bin/tsc --noEmit` sem diagnosticos em arquivos modificados.
  - Comportamento esperado:
    - execution memory deve ser persistida por sessao no SessionManager.
    - limite de entries deve respeitar janela maxima configurada.
    - reset de uma sessao nao deve afetar outra sessao.
    - selecao de tool deve emitir signal explicito e permitir decisao final do Orchestrator em safe mode.
  - Evidencias atuais:
    - APIs adicionadas em `src/shared/SessionManager.ts`: `getExecutionMemoryState`, `setExecutionMemoryState`, `appendExecutionMemoryEntry`, `resetExecutionMemoryState`.
    - `AgentLoop` passou a registrar/leitura de execution memory via SessionManager (estado session-scoped), removendo fonte local como autoridade.
    - `SessionManager` agora expõe snapshot factual de ranking por sessao (`getExecutionMemoryToolScores`, `getExecutionMemoryToolConfidence`, `getExecutionMemoryDecisionConfidence`, `getExecutionMemorySelectionSnapshot`), e o `AgentLoop` consome esse snapshot em vez de recalcular agregados a partir de entries locais.
    - Suite `src/tests/run.ts` recebeu teste dedicado KB-024 cobrindo isolamento entre sessoes, limite maxEntries, sobrescrita por set e reset por escopo.
    - Suite `src/tests/run.ts` passou a cobrir consolidacao de ranking por sessao, fallback global de confidence e `decisionConfidence` derivado do snapshot factual.
    - `AgentLoop` passou a emitir `ToolSelectionSignal` como fatos e consultar `CognitiveOrchestrator.decideToolSelection(...)` em safe mode.
    - `CognitiveOrchestrator.decideToolSelection(...)` permanece passivo nesta fase e retorna `undefined`, preservando a decisao local enquanto o signal e a trilha de auditoria sao estabilizados.
    - Suite `src/tests/run.ts` cobre que a selecao de tool permanece passiva no Orchestrator em 3 cenarios: com FailSafe ativo, com exploracao sugerida e com contexto positivo sem exploracao.
    - `node ./node_modules/typescript/bin/tsc --noEmit` sem diagnosticos no workspace.
    - `npx.cmd ts-node src/tests/run.ts` executado com fechamento em `All tests passed`.
  - [ ] Gate da proxima etapa
    - Concluir extracao facts-first e remover decisao local residual do AgentLoop.
    - So apos isso rodar regressao completa para avaliar fechamento do card.

- [x] KB-027 - Neutralizar Search como subsistema decisorio isolado (F3/F4)
  - Status: concluido em 5 de abril de 2026 com FASE 3 e FASE 4 validadas.
  - Comportamento esperado:
    - SearchEngine deve usar cache por sessao quando sessionId for informado, com fallback local controlado quando nao houver sessao.
    - Safe mode deve permanecer ativo nas decisoes de busca no padrao `orchestratorDecision ?? localDecision`.
    - Nao deve haver vazamento de cache entre sessoes diferentes.
  - Evidencias atuais:
    - Compilacao valida com `npx tsc --noEmit` apos refactor da T3.2-T3.5.
    - SearchEngine session-aware com cache por sessao em `src/search/pipeline/searchEngine.ts`.
    - InvertedIndex migrado para estado session-scoped em `src/search/index/invertedIndex.ts`.
    - SemanticGraphBridge com caches por sessao e sem singleton no caminho principal em `src/search/graph/semanticGraphBridge.ts`.
    - AutoTagger com cache por sessao em `src/search/llm/autoTagger.ts`.
    - Suite do projeto via `npm.cmd test -- --grep KB027` com saida `All tests passed`.
    - Suite isolada `node --require ts-node/register --test src/tests/KB027SearchSignals.test.ts` passou com cobertura explicita da T4.2 para query expansion, search weights, graph expansion, reranking e fallback strategy no padrao `orchestratorDecision ?? localDecision`.
    - T4.3 validada na mesma suite com reaproveitamento de cache na mesma sessao, isolamento entre sessoes e `clearIndex/resetVolatileState` respeitando escopo.
    - `npx tsc --noEmit` passou apos a ampliacao final da suite KB-027.
  - Pendencias para aprovar:
    - Nenhuma pendencia aberta no escopo do KB-027.

- [ ] KB-046 - Modularizacao governada do CognitiveOrchestrator
  - Status: em andamento em 6 de abril de 2026.
  - Comportamento esperado:
    - modularizacao sem alteracao de comportamento no `CognitiveOrchestrator`.
    - `CapabilityAwarePlan` e `PlanningStrategyContext` devem ter fonte unica compartilhada.
    - autoridade cognitiva deve permanecer no Orchestrator, sem mini-brains novos nos modulos extraidos.
  - Evidencias atuais:
    - plano formal criado em `docs/architecture/plans/KB-046-PLANO.md`.
    - contratos compartilhados extraidos para `src/core/orchestrator/types/PlanningTypes.ts`.
    - `CognitiveOrchestrator.ts` e `decidePlanningStrategy.ts` ajustados para reutilizar a mesma definicao de tipos.
    - validacao formal registrada no plano com secoes de inconsistencias, conflitos e autoridade.
    - `npx.cmd tsc --noEmit` executado sem diagnosticos em 6 de abril de 2026.
  - Pendencias para aprovar:
    - registrar fechamento do card quando a modularizacao atual for concluida no kanban final.

## 2) Roteiro pratico com IalClaw (site/jogo)

### Preparacao (Windows PowerShell)
- Rodar no diretorio do projeto:
  - `npm run dev:debug:tail`
- Opcional em outro terminal:
  - `node bin/ialclaw.js status`

### Teste A - KB-012 (filesystem)
- Prompt:
  - "crie pasta jogos e subpasta jogo-cobra"
- Esperado:
  - Plano com steps executaveis de filesystem (ex.: `create_directory`).
  - `meta.source=deterministic_builder`.

### Teste B - KB-011 (short-circuit operacional)
- Prompt:
  - "crie um site simples com html css e js no workspace e rode o projeto"
- Esperado:
  - Bloqueio de short-circuit para fluxo operacional.
  - Seguir para tool loop.

### Teste C - KB-001 (retry governado)
- Prompt principal:
  - "crie um jogo da cobrinha em html, css e js e execute"
- Prompt alternativo para provocar falha:
  - "converta o arquivo workspace/nao-existe.pdf para docx"
- Esperado:
  - `retry_decision` coerente com governanca.
  - Sem repeticao indefinida de retry apos fail-safe.

## 3) Consulta rapida de logs

- `source=deterministic_builder`
- `source=legacy_forced_plan`
- `short_circuit_blocked`
- `short_circuit_blocked_real_tools_only`
- `short_circuit_activated`
- `retry_decision`
- `fail_safe_activated`

## 4) Criterio de fechamento

- KB-001: fechar quando retries/aborts estiverem governados de forma coerente, sem loop indevido.
- KB-011: fechar quando short-circuit estiver bloqueado de forma consistente em cenarios operacionais, sem regressao conversacional.
- KB-012: fechar quando filesystem usar `deterministic_builder` e fallback sem builder usar `legacy_forced_plan` em runtime.
- KB-027: fechado em 5 de abril de 2026 com FASE 3 e FASE 4 completas, sem cache global/local como fonte primaria e com evidencias de compilacao e testes documentadas.
