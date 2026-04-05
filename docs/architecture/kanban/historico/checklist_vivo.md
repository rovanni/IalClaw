# Checklist Vivo - Evolucao Single Brain

Status operacional centralizado no quadro Kanban:
- docs/architecture/kanban/README.md

## Objetivo
Manter visibilidade continua da refatoracao para evitar:
- retrabalho
- regressao silenciosa
- refatoracao duplicada
- perda de contexto cognitivo

## 🧠 1. Decisoes cognitivas extraidas (AgentLoop)

### Concluido
- [x] shouldRetryWithLlm -> LlmRetrySignal
- [x] adjustPlanAfterFailure -> PlanAdjustmentSignal
- [x] shouldReclassify -> ReclassificationSignal
- [x] Route/autonomia -> RouteAutonomySignal
- [x] validateStepResult -> StepValidationSignal
- [x] tool fallback -> ToolFallbackSignal
- [x] stop/continue loop -> StopContinueSignal
- [x] fail-safe automatico -> FailSafeSignal

Nota: neste estagio, os signals foram extraidos, mas a aplicacao ainda ocorre localmente no AgentLoop.

## O que ja foi corrigido
- Abril/2026: KB-023 concluído. Fase 4 de limpeza controlada aplicada no fallback tático residual com decisão ativa no Orchestrator (`decideFallbackStrategy`) e fluxo unificado em safe mode no AgentLoop; duplicação residual removida sem regressão. Validação final: `npx.cmd tsc --noEmit` e `npm.cmd test` (All tests passed).
- Abril/2026: generalizacao do `FlowRegistry` para multiplos flows com metadados (`tags`, `triggers`, `priority`) e matching centralizado por entrada (`matchByInput`), reduzindo acoplamento cognitivo no Orchestrator. `decideFlowStart()` deixou de referenciar `html_slides` diretamente e passou a consultar o registry como source of truth.
- Abril/2026: cobertura de contrato do registry adicionada em `src/tests/run.ts` para `registerDefinition`, `registerMany`, `listDefinitions`, `has` e `matchByInput`.
- Abril/2026: KB-045 concluído. `CognitiveOrchestrator.decide()` agora avalia `decideFlowStart()` e pode retornar `START_FLOW`; `CognitiveActionExecutor.executeStartFlow()` passou a resolver o flow via `FlowRegistry.get(flowId)`, chamar `flowManager.startFlow(...)` sem heurística local e persistir `session.flow_state` no início. `HtmlSlidesFlow.id` foi alinhado com o registry (`html_slides`) para permitir reidratação consistente. `npm.cmd test` passou com regressão cobrindo `START_FLOW` + persistência do estado do flow.
- Abril/2026: KB-045 Fase 1 iniciada. Contrato minimo de iniciacao de flow adicionado em `CognitiveOrchestrator`: `CognitiveStrategy.START_FLOW`, campo `flowId?: string` em `CognitiveDecision` e metodo `decideFlowStart(sessionId, text)` retornando `undefined` em safe mode. Nenhuma integracao funcional ativada, nenhuma heuristica alterada e compilacao `npx.cmd tsc --noEmit` limpa.
- Abril/2026: KB-021 concluído. `getCognitiveState()` em `SessionManager` expandido com `isInGuidedFlow` e `guidedFlowState` (lidos de `session.flow_state`); `CognitiveOrchestrator.decide()` seção 2.2 atualizada para usar `cognitiveState.isInGuidedFlow` como fonte de verdade (with `flowManager` como fallback em memória). Fluxo guiado agora persistido e visível no CognitiveState. Compilação limpa.
- Abril/2026: KB-020 Fase 3 (Hard Handoff) concluída. `ingestRepairResult` adicionado ao `CognitiveOrchestrator` (campo `_observedRepairResult`); `decideRepairStrategy` agora retorna `continue` quando repair teve sucesso com plano válido, `abort` quando falhou ou sem plano, e `undefined` apenas quando resultado não foi observado (Safe Mode). `AgentExecutor.repairAndExecute` injeta `ingestRepairResult` antes de `decideRepairStrategy`. Compilação `npx tsc --noEmit` limpa. KB-020 totalmente concluída.
- Abril/2026: KB-020 Fase 2 concluída. `decideRepairStrategy` no `CognitiveOrchestrator` passou de passivo para decisão segura de veto (retorna `abort` em `FailSafe` ativo ou `StopContinue.shouldStop` e delega via `undefined` nos demais cenários), com auditoria `emitDebug('repair_strategy_decision', ...)` e log i18n reaproveitando `agent.repair.orchestrator_governed`. Safe Mode preservado em `repairAndExecute` (`finalRepairDecision = orchestratorDecision ?? localDecision`). Compilação limpa.
- Abril/2026: KB-002 concluído de forma estrutural. `stepCapabilities` ficou restrito a sinais puros (`extractPlanRuntimeSignals`), funções legadas de decisão de runtime foram removidas do módulo de capabilities e o `AgentExecutor` passou a exigir decisão de runtime via Orchestrator (sem fallback decisório local).
- Abril/2026: KB-038 concluído. Validação heurística de resultado de step extraída para `StepResultValidator` (paridade 1:1 de padrões/fluxo), com suíte dedicada + parity check; imports tipados pós-extração migrados para `AgentLoopTypes` em AgentController/CognitiveOrchestrator/FailSafeModule/StopContinueModule; ajuste de tipagem TS18048 no Orchestrator e suíte principal estabilizada.
- Abril/2026: KB-022 follow-up (skill flow) aplicado em `runWithSkill`: removidas chamadas manuais de decide* no controller e consolidacao via `applyActiveDecisions(sessionId)`; auditoria `auditSignalConsistency(sessionId)` restaurada no mesmo estagio logico do fluxo principal, preservando safe mode e sem alteracao funcional.
- Abril/2026: KB-022 concluído. Split-brain entre AgentController e AgentRuntime removido: AgentRuntime deixou de instanciar CognitiveOrchestrator local e passou a aceitar injeção externa; AgentController isolou context building/system prompt e consolidou ACTIVE DECISIONs no Orchestrator via applyActiveDecisions.
- Abril/2026: heuristicas de stop/continue por confianca e delta foram migradas do AgentLoop para avaliacao contextual no Orchestrator (StopContinueModule), mantendo governanca central e aplicacao tecnica no loop.
- Abril/2026: reality-check de claims de execucao no AgentLoop foi extraido para `RealityCheckSignal` e passou a ter autoridade final do Orchestrator em safe mode (`orchestratorDecision ?? loopDecision`), sem mudanca funcional do fallback.
- Abril/2026: correção de falso positivo em governança operacional no AgentLoop; `requiresRealWorldAction` deixou de depender apenas de `route=TOOL_LOOP` e passou a considerar somente `taskType` operacional, evitando bloqueio indevido de cenários conversacionais com tool opcional.
- Abril/2026: estabilizacao do AgentLoop em REAL_TOOLS_ONLY sem falha dura quando nao ha tool call no ciclo; o fluxo agora aplica governanca/reality-check e segue auditavel (sem alterar heuristicas de classificacao/roteamento).
- Abril/2026: compatibilidade dos testes de fluxo restaurada com o contrato atual do CognitiveOrchestrator (assinatura do construtor e `decide` com `sessionId`).
- Abril/2026: suite principal estabilizada para o sufixo de reality-check com acento (`não`) em `src/tests/run.ts`, aceitando variacao acentuada sem reduzir cobertura funcional.
- Historico detalhado preservado a partir deste ponto no arquivo original movido para kanban/historico.
- Abril/2026: KB-027 FASE 5-6 concluída. Implementação de lógica real nos 5 métodos `decide*` do `CognitiveOrchestrator`: `decideQueryExpansion` (ativa em exploração estável), `decideSearchWeights` (ajusta com taskConfidence > 0.8), `decideGraphExpansion` (ativa em research/analysis estável, maxTerms=15 boost=1.3), `decideReranking` (bloqueia em recovery/attempt>2), `decideSearchFallbackStrategy` (tagging='warn', recovery='abort', estável='use_default'). Bug de state mutation em `searchEngine.ts` corrigido, variável não utilizada removida. Compilação global limpa. Safe Mode preservado.

## O que esta em andamento
- KB-027 movido formalmente para `docs/architecture/kanban/em_andamento.md`, com status por fase consolidado no card operacional (F1/F2/F5/F6 concluídas; F3 parcial; F4 iniciada).
- KB-027 (85% concluído): FASE 3 T3.2-T3.5 (migração de 9 caches para SessionManager centralizado) pausada por requerer refactor de injeção de SessionManager no SearchEngine; FASE 4 (testes de integração SearchSignals + SafeMode) iniciada em `src/tests/KB027SearchSignals.test.ts`.
- KB-023 concluído e movido para histórico de correções; manter apenas monitoramento passivo de logs de auditoria para regressão.
- KB-001 (Fase 1 + Fase 2 concluidas): fallback decisorio local removido do healing loop no `AgentExecutor`. Consultas a `decideRetryAfterFailure` reduzidas de 8 para 4 por ciclo (cache no bloco repair e no bloco runtime). Teste legado `stepCapabilities.test.ts` migrado para API atual (`extractPlanRuntimeSignals` + `decidePlanRuntimeMode`). Compilacao global limpa (`TSC_EXIT=0`). Aguardando validacao em runtime para marcar KB-001 como concluido.
- Validacao dirigida da FASE 2.2 em runtime para confirmar `meta.source=deterministic_builder` no caso `filesystem` e `legacy_forced_plan` nos tipos sem builder registrado.
- Monitoramento da FASE 2.1 em runtime para confirmar que planos de `filesystem` entram sempre como steps executáveis (`tool` definido em 100% dos steps).
- Validacao dirigida do fluxo de update em ambientes reais (Windows e Linux) para confirmar UX da pergunta de reinicio em cenarios com daemon e sem daemon ativo.
- Monitoramento dirigido dos logs de runtime para confirmar estabilidade da nova rota de execução de filesystem em produção (sem regressão no fluxo conversacional).

## O que ainda falta
- Expandir `buildExecutionPlan(taskType, userInput)` para outros domínios operacionais.
- Cobrir com teste dedicado de contrato a prioridade entre intent `EXPLORATION` e sinais de recovery/flow/pending no Orchestrator.
- Publicar nota de arquitetura da integração descrevendo que o classificador apenas informa contexto e não executa/decide fluxo fora do Orchestrator.
- Adicionar opcao por flag para automacao de CI/scripts: `--auto-start` e `--no-start` no update.

## O que NAO deve ser tocado agora
- Nao criar resposta direta no `AgentController` baseada em `intent.mode`.
- Nao duplicar logica de decisao de intent no `AgentLoop`, `TaskClassifier` ou executores.
- Nao alterar heuristicas de route/autonomy, thresholds de risco ou branches de fallback durante fases de diagnostico.
- Nao introduzir fluxos paralelos ou logica duplicada.

## Regra operacional obrigatoria
Toda correcao deve atualizar este checklist vivo com:
1. O que ja foi corrigido
2. O que esta em andamento
3. O que ainda falta
4. O que NAO deve ser tocado agora

## Atualizado em
- Data: 4 de abril de 2026 (última atualização: KB-027 movido para Em andamento com status por fase consolidado no card)
