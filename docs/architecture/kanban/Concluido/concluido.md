# Concluído

- [x] KB-048 - Memory Introspection + Final Gate (alinhamento com template + estabilizacao)
  - Data: 2026-04-06
  - Evidência: `IntentionResolver.isMemoryIntrospection(...)` ampliado para cobrir consultas abertas em PT-BR (incluindo variacoes sem acento/singular-plural), corrigindo classificacao de `MEMORY_QUERY`. `AgentController` ajustado para nao consumir `session.last_input_gap` antes do Orchestrator; consumo permanece centralizado no `consolidateAndReturn(...)` condicionado por `decision.usedInputGap`. Introspeccao manteve `usedInputGap: false`. Excecao arquitetural controlada formalizada em `docs/architecture/decisions/KB-048-exception.md`.

- [x] KB-047 - Governança de início de flows (Flow Start) centralizada
  - Data: 2026-04-06
  - Evidência: `matchByInput` removido do `FlowRegistry`. Lógica de decisão centralizada em `decideFlowStart.ts`. `CognitiveOrchestrator` agora é o único responsável por identificar e disparar novos flows, emitindo sinais de debug com detalhes do matching. Precedência corrigida para garantir que `Pending Action` tenha prioridade sobre o início de novos contextos. `tests/KB047_flow_start_governance.test.ts` validado com 100% de sucesso.

- [x] KB-046 - Modularizacao governada do CognitiveOrchestrator
  - Data: 2026-04-06
  - Evidencia: contratos compartilhados consolidados em fonte unica, duplicacao removida e compilacao validada com `npx.cmd tsc --noEmit`. Fase 6 concluida com recomposicao semantica do fluxo principal, recuperando navegabilidade e legibilidade sem alterar authority, heuristicas ou safe mode. Resultado final: complexidade estrutural reduzida, fluxo principal recomposto, fragmentacao controlada e nova diretriz institucionalizada de nao realizar micro-extracoes sem ganho real de legibilidade.

- [x] KB-017 - Externalizar capabilityFallback para signal puro
  - Data: 2026-04-05
  - Evidência: decisão local de capability fallback removida do `AgentExecutor`; resolução passou a depender somente de `CognitiveOrchestrator.decideCapabilityFallback(...)`, eliminando mini-brain residual no executor. Testes em `src/tests/run.ts` validam payload factual sem `strategy`, caminho governado e delegação segura quando o Orchestrator retorna `undefined`. Execução de `npm test` finalizou com `All tests passed`.

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
