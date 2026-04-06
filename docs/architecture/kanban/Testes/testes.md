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

- [x] KB-046 - Modularizacao governada do CognitiveOrchestrator
  - Status: concluido em 6 de abril de 2026.
  - Comportamento esperado:
    - modularizacao sem alteracao de comportamento no `CognitiveOrchestrator`.
    - `CapabilityAwarePlan` e `PlanningStrategyContext` devem ter fonte unica compartilhada.
    - autoridade cognitiva deve permanecer no Orchestrator, sem mini-brains novos nos modulos extraidos.
    - recomposicao do fluxo principal deve reduzir a complexidade cognitiva percebida sem reverter os ganhos estruturais da Fase 1.
  - Evidencias atuais:
    - plano formal criado em `docs/architecture/plans/KB-046-PLANO.md`.
    - contratos compartilhados extraidos para `src/core/orchestrator/types/PlanningTypes.ts`.
    - `CognitiveOrchestrator.ts` e `decidePlanningStrategy.ts` ajustados para reutilizar a mesma definicao de tipos.
    - `CapabilityAwarePlan` passou a expor `hasGap`, permitindo que o `CognitiveOrchestrator` consuma a derivacao do modulo de planning sem recalculo local.
    - contrato de `decideCapabilityFallback(...)` centralizado em `src/core/orchestrator/types/CapabilityFallbackTypes.ts`, removendo contexto inline no modulo auxiliar.
    - contrato de `decideRetryAfterFailure(...)` centralizado em `src/core/orchestrator/types/RetryAfterFailureTypes.ts`, removendo contexto inline do path extraido.
    - derivacao estrutural de retry apos falha movida para `src/core/orchestrator/decisions/retry/decideRetryAfterFailure.ts`, enquanto `CognitiveOrchestrator.ts` preserva authority resolution, telemetria e safe mode.
    - contrato de `ActiveDecisionsResult` centralizado em `src/core/orchestrator/types/ActiveDecisionsTypes.ts`, preservando compatibilidade via reexport no `CognitiveOrchestrator`.
    - montagem estrutural de `ActiveDecisionsResult` movida para `src/core/orchestrator/decisions/active/buildActiveDecisionsResult.ts`, enquanto `CognitiveOrchestrator.ts` preserva as chamadas `decide*` e o ponto final de governanca.
    - contrato de `IngestedSignalSummary` centralizado em `src/core/orchestrator/types/IngestSignalsTypes.ts`.
    - resumo factual inicial de `ingestSignalsFromLoop(...)` movido para `src/core/orchestrator/decisions/signals/buildIngestedSignalSummary.ts`, enquanto `CognitiveOrchestrator.ts` preserva a mutacao de `observedSignals`, o reset de ciclo e os logs observacionais por signal.
    - contrato de conflitos de signals centralizado em `src/core/orchestrator/types/SignalConflictTypes.ts`.
    - detector factual de conflitos de `auditSignalConsistency(...)` movido para `src/core/orchestrator/decisions/signals/detectSignalConflicts.ts`, enquanto `CognitiveOrchestrator.ts` preserva `_reportSignalConflict(...)` e o controle do flag `routeVsFailSafeConflictLoggedInCycle`.
    - contratos de governanca observacional de stop/continue centralizados em `src/core/orchestrator/types/StopContinueGovernanceTypes.ts`.
    - builders puros dos payloads de `signal_authority_resolution`, `stop_continue_decision_delta`, `stop_continue_contextual_adjustment_applied`, `stop_continue_recurrent_failure_forced_stop` e `stop_continue_active_decision` movidos para `src/core/orchestrator/decisions/stopContinue/buildStopContinueGovernanceAuditPayloads.ts`, enquanto `CognitiveOrchestrator.ts` preserva o ajuste contextual, a resolucao de authority e a decisao final.
    - contratos de logs observacionais de signals centralizados em `src/core/orchestrator/types/ObservedSignalLogTypes.ts`.
    - builders puros dos logs observacionais de `ingestSignalsFromLoop(...)` movidos para `src/core/orchestrator/decisions/signals/buildObservedSignalLogEntries.ts`, enquanto `CognitiveOrchestrator.ts` preserva a ingestao, `_logStopSignal(...)`, a mutacao de `observedSignals` e a emissao final dos logs.
    - builder puro dos logs observacionais de `_logStopSignal(...)` movido para `src/core/orchestrator/decisions/signals/buildObservedStopSignalLogEntries.ts`, enquanto `CognitiveOrchestrator.ts` preserva a emissao final em ordem.
    - contratos de debug de planning centralizados em `src/core/orchestrator/types/PlanningDebugTypes.ts`.
    - builders puros dos payloads de `capability_gap_detected`, `capability_vs_route_conflict` e `planning_strategy_selected` movidos para `src/core/orchestrator/decisions/planning/buildPlanningDebugPayloads.ts`, enquanto `CognitiveOrchestrator.ts` preserva as condicoes e a ordem dos `emitDebug(...)`.
    - contratos de debug de retry apos falha centralizados em `src/core/orchestrator/types/RetryAfterFailureDebugTypes.ts`.
    - builders puros dos payloads de `signal_authority_resolution`, `retry_decision` e `self_healing_active_decision` movidos para `src/core/orchestrator/decisions/retry/buildRetryAfterFailureDebugPayloads.ts`, enquanto `CognitiveOrchestrator.ts` preserva a authority resolution, a decisao final e a ordem dos eventos.
    - contratos de debug de route autonomy centralizados em `src/core/orchestrator/types/RouteAutonomyDebugTypes.ts`.
    - builders puros do payload de `signal_authority_resolution` e do log `route_active_decision` movidos para `src/core/orchestrator/decisions/route/buildRouteAutonomyDebugPayloads.ts`, enquanto `CognitiveOrchestrator.ts` preserva a authority resolution, a emissao final em ordem e a mutacao de estado aplicada.
    - contratos de debug de repair strategy centralizados em `src/core/orchestrator/types/RepairStrategyDebugTypes.ts`.
    - builders puros do payload de `repair_strategy_decision` e do log `repair_strategy_active_decision` movidos para `src/core/orchestrator/decisions/repair/buildRepairStrategyDebugPayloads.ts`, enquanto `CognitiveOrchestrator.ts` preserva a heuristica, a emissao final em ordem e a decisao retornada.
    - contratos de debug de decisao final recomendada centralizados em `src/core/orchestrator/types/FinalDecisionDebugTypes.ts`.
    - builder puro do payload de `final_decision_recommended` movido para `src/core/orchestrator/decisions/final/buildFinalDecisionRecommendedPayload.ts`, enquanto `CognitiveOrchestrator.ts` preserva o timing de emissao e o encadeamento decisorio.
    - contratos de logs passivos de repair centralizados em `src/core/orchestrator/types/RepairStrategyLogTypes.ts`.
    - builders puros dos logs `repair_strategy_signal_received` e `repair_result_ingested` movidos para `src/core/orchestrator/decisions/repair/buildRepairStrategyLogPayloads.ts`, enquanto `CognitiveOrchestrator.ts` preserva a ingestao dos fatos e a emissao final dos eventos.
    - contratos de logs passivos de self-healing centralizados em `src/core/orchestrator/types/SelfHealingLogTypes.ts`.
    - builder puro do log `signal_self_healing_observed` movido para `src/core/orchestrator/decisions/retry/buildSelfHealingLogPayloads.ts`, enquanto `CognitiveOrchestrator.ts` preserva a ingestao do fato e a emissao final do evento.
    - risco arquitetural adicional registrado no plano: fragmentacao sem reducao equivalente da complexidade percebida do fluxo principal.
    - proxima rodada redefinida no plano como Fase 2 de recomposicao do fluxo do `CognitiveOrchestrator`, interrompendo novas micro-extracoes de builders enquanto a legibilidade do arquivo principal nao melhorar.
    - validacao formal registrada no plano com secoes de inconsistencias, conflitos e autoridade.
    - validacao critica adicional da Fase 6 registrada no plano: equilibrio entre modularizacao, autoridade e legibilidade humana do fluxo principal.
    - Fase 6 consolidada com 4 evidencias arquiteturais: remocao de ruido residual em JSDoc, reagrupamento semantico de `decide*` antes de `decide()`, banners de navegacao por dominio e recuperacao da linearidade de leitura do fluxo.
    - regra operacional reforcada: interromper micro-extracoes quando nao houver ganho real de legibilidade no arquivo principal.
    - `npx.cmd tsc --noEmit` executado sem diagnosticos em 6 de abril de 2026.
    - regressao comportamental coberta em `src/tests/run.ts` com 3 cenarios KB-046: (1) prioridade `pending > flow start`, (2) preservacao de `last_input_gap` em retorno antecipado, (3) consumo de `last_input_gap` apenas quando usado no ramo normal.
    - `npm.cmd test` executado em 6 de abril de 2026 com fechamento em `All tests passed`.
  - Pendencias para aprovar:
    - nenhuma no escopo do KB-046.

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
