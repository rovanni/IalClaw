# Concluído

- [x] KB-027 - Neutralizar Search como subsistema decisorio isolado (Fases 1-6)
  - Data: 2026-04-05
  - Evidência: SearchEngine, InvertedIndex, SemanticGraphBridge e AutoTagger passaram a usar `search_cache` por sessão como fonte primária quando há `sessionId`, preservando Safe Mode nas 5 decisões de busca com padrão `orchestratorDecision ?? localDecision`. A suite `src/tests/KB027SearchSignals.test.ts` cobre payloads de signals, override/delegação do Orchestrator, reaproveitamento de cache na mesma sessão, isolamento entre sessões e limpeza por escopo via `clearIndex/resetVolatileState`. Validação com `npx tsc --noEmit` e suite isolada `node --require ts-node/register --test src/tests/KB027SearchSignals.test.ts` sem falhas.

- [x] KB-023 - Externalizar heurísticas táticas remanescentes do AgentLoop
  - Data: 2026-04-04
  - Evidência: trust/reality-check, fallback tático e decisões residuais do loop foram externalizados para signals/facts com decisão ativa no `CognitiveOrchestrator` e aplicação em safe mode (`orchestratorDecision ?? loopDecision`) no `AgentLoop`; estado de delta centralizado em `SessionManager.delta_state`; validação com `npx.cmd tsc --noEmit` e `npm.cmd test` sem falhas.

- [x] KB-045 - Governança de iniciação de flow pelo Orchestrator
  - Data: 2026-04-04
  - Evidência: `CognitiveOrchestrator.decide()` agora pode retornar `CognitiveStrategy.START_FLOW` via `decideFlowStart()` reaproveitando `FlowRegistry.list()`. `CognitiveActionExecutor` ganhou `executeStartFlow()` com `FlowRegistry.get(flowId)` + `flowManager.startFlow(...)` sem heurística local, persistindo `session.flow_state` no início. `HtmlSlidesFlow.id` foi alinhado para `html_slides`, evitando estado órfão na reidratação via registry. `npm.cmd test` passou com regressão cobrindo decisão `START_FLOW`, prompt inicial e persistência de `session.flow_state`.

- [x] KB-021 - Sincronizar FlowManager com SessionManager
  - Data: 2026-04-04
  - Evidência: `getCognitiveState()` em `SessionManager` expandido com `isInGuidedFlow` (Boolean de `session.flow_state`) e `guidedFlowState` (referência ao `FlowState` da sessão). `CognitiveOrchestrator.decide()` seção 2.2 atualizada para `(this.flowManager.isInFlow() || cognitiveState.isInGuidedFlow) && !reactiveState` com `flowState = this.flowManager.getState() ?? cognitiveState.guidedFlowState`. Session é agora a fonte de verdade; flowManager mantido como fallback em memória. Compilação limpa.

- [x] KB-020 - Neutralizar repairPipeline como mini-brain estrutural (Fase 3 — Hard Handoff)
  - Data: 2026-04-04
  - Evidência: `ingestRepairResult` adicionado ao `CognitiveOrchestrator` (`_observedRepairResult`); `decideRepairStrategy` assume autoridade completa — retorna `continue` (repair ok + plano válido), `abort` (falha ou sem plano), `undefined` quando resultado não injetado (Safe Mode). `AgentExecutor.repairAndExecute` injeta `ingestRepairResult` antes de `decideRepairStrategy`. Orchestrator é o único decisor no path de repair. Compilação limpa.

- [x] KB-038 - Modularizar validação de StepResult e corrigir imports tipados pós-extração
  - Data: 2026-04-04
  - Evidência: `StepResultValidator` criado e integrado; imports de tipos migrados para `AgentLoopTypes` em AgentController/CognitiveOrchestrator/FailSafeModule/StopContinueModule; correção TS18048 aplicada em CognitiveOrchestrator; suíte `npm.cmd test` validada sem regressão funcional.

- [x] KB-002 - Refatorar stepCapabilities para Pure Signals (sem decisão)
  - Data: 2026-04-04
  - Evidência: stepCapabilities agora extrai apenas PlanRuntimeSignals; decisão de skip/runtime centralizada no CognitiveOrchestrator via decidePlanRuntimeMode; fallback legado removido do AgentExecutor.

- [x] KB-022 - Remover split-brain de AgentController e AgentRuntime
  - Data: 2026-04-04
  - Evidência: AgentRuntime não instancia mais CognitiveOrchestrator local; AgentController extraiu context building/system prompt e consolidou ACTIVE DECISIONs via applyActiveDecisions no Orchestrator

- [x] KB-003 - Simplificar AgentLoop para executor linear
  - Data: 2026-04-04
  - Evidência: heurísticas de stop/delta migradas para o StopContinueModule no Orchestrator; AgentLoop agora envia contexto e aplica decisão governada

- [x] KB-013 - Estabilização de REAL_TOOLS_ONLY sem falha dura em no-tool-call
  - Data: 2026-04-03
  - Evidência: AgentLoop ajustado + testes passando

- [x] KB-014 - Correção de falso positivo operacional por route TOOL_LOOP
  - Data: 2026-04-03
  - Evidência: requiresRealWorldAction passou a depender de taskType operacional

- [x] KB-015 - Compatibilidade de testes com assinatura atual do CognitiveOrchestrator
  - Data: 2026-04-03
  - Evidência: tests/flow_continuity_refined e tests/flow_final atualizados

- [x] KB-016 - Changelog de hotfix consolidado para PR
  - Data: 2026-04-03
  - Evidência: docs/architecture/kanban/historico/prs/PR_Changelog_2026-04-03_SingleBrain_Hotfix.md
- [x] KB-037 - Padronizar mapeamento de modularização para arquivos grandes (Single Brain)
  - Data: 2026-04-04
  - Evidência: docs/architecture/kanban/historico/KB-037_Mapeamento_Modularizacao_Arquivos_Grandes_2026-04-04.md
