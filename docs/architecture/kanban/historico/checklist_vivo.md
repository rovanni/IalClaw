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
- Abril/2026: heuristicas de stop/continue por confianca e delta foram migradas do AgentLoop para avaliacao contextual no Orchestrator (StopContinueModule), mantendo governanca central e aplicacao tecnica no loop.
- Abril/2026: reality-check de claims de execucao no AgentLoop foi extraido para `RealityCheckSignal` e passou a ter autoridade final do Orchestrator em safe mode (`orchestratorDecision ?? loopDecision`), sem mudanca funcional do fallback.
- Abril/2026: correção de falso positivo em governança operacional no AgentLoop; `requiresRealWorldAction` deixou de depender apenas de `route=TOOL_LOOP` e passou a considerar somente `taskType` operacional, evitando bloqueio indevido de cenários conversacionais com tool opcional.
- Abril/2026: estabilizacao do AgentLoop em REAL_TOOLS_ONLY sem falha dura quando nao ha tool call no ciclo; o fluxo agora aplica governanca/reality-check e segue auditavel (sem alterar heuristicas de classificacao/roteamento).
- Abril/2026: compatibilidade dos testes de fluxo restaurada com o contrato atual do CognitiveOrchestrator (assinatura do construtor e `decide` com `sessionId`).
- Abril/2026: suite principal estabilizada para o sufixo de reality-check com acento (`não`) em `src/tests/run.ts`, aceitando variacao acentuada sem reduzir cobertura funcional.
- Historico detalhado preservado a partir deste ponto no arquivo original movido para kanban/historico.

## O que esta em andamento
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
- Data: 4 de abril de 2026
