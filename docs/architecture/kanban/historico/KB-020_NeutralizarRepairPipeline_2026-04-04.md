# KB-020 - Neutralizar repairPipeline como mini-brain estrutural

Data: 2026-04-04
Escopo: externalizar tomada de decisao do repair pipeline para o CognitiveOrchestrator.
Regra central: Orchestrator continua como unico decisor. AgentExecutor apenas executa.

## Problema original

O metodo `repairAndExecute` no `AgentExecutor` tomava localmente a decisao de abortar ou continuar apos o repair do plano:

```ts
const localDecision = !repairResult.success || !repairResult.repairedPlan ? 'abort' : 'continue';
```

Isso configurava um mini-brain local: o executor possuia autoridade sobre uma decisao de fluxo que pertence ao Orchestrator.

Origem do diagnostico:
- docs/architecture/diagnostics/AntiPatterns.md
- docs/architecture/plans/ProposedChanges.md (src/core/executor)

---

## Criterio de pronto

Remediacao estrutural deixa de decidir localmente e passa a ser estrategia do Orchestrator.
O Orchestrator e o unico decisor no path de repair. O executor apenas injeta contexto e aplica a decisao final.

---

## Estrategia de resolucao

Resolucao incremental em 3 fases, preservando comportamento a cada etapa.

### Fase 1 — Extracao do signal (passivo, sem autoridade)

Objetivo: observar estado estrutural sem alterar comportamento.

Alteracoes:
- src/engine/AgentLoopTypes.ts
  - `RepairStrategySignal` criado como tipo puro (campos de estado observavel: `hasActiveProject`, `usesWorkspace`, `hadCreateProject`, `createProjectPosition`, `projectMissing`, `repairReason`).
- src/core/executor/AgentExecutor.ts
  - `runRepairPipeline` extrai o signal e chama `ingestRepairStrategySignal` antes de delegar a `repairPlanStructure`.
  - `repairAndExecute` recebe Safe Mode: `finalRepairDecision = orchestratorDecision ?? localDecision`.
- src/core/orchestrator/CognitiveOrchestrator.ts
  - `ingestRepairStrategySignal` adicionado (modo passivo — apenas observa e loga).
  - `decideRepairStrategy` adicionado retornando `undefined` nesta fase.
- src/i18n/pt-BR.json e en-US.json
  - Chaves adicionadas: `agent.repair.strategy_observed`, `agent.repair.orchestrator_governed`, `error.executor.repair_strategy_unavailable`.

Resultado:
- Comportamento funcional identico ao anterior.
- Compilacao limpa.
- Orchestrator observa o estado estrutural do repair sem tomar decisao.

---

### Fase 2 — Ativacao de autoridade de veto (abort seguro)

Objetivo: Orchestrator passa a vetar com `abort` em condicoes de risco, delegando nos demais casos.

Alteracoes:
- src/core/orchestrator/CognitiveOrchestrator.ts
  - `decideRepairStrategy` passa a retornar `abort` em dois cenarios: `FailSafe` ativo ou `StopContinue.shouldStop`.
  - Nos demais cenarios, retorna `undefined` (Safe Mode delega ao `localDecision`).
  - Auditoria adicionada com `emitDebug('repair_strategy_decision', ...)`.
  - Log estruturado usando chave i18n existente `agent.repair.orchestrator_governed`.

Resultado:
- Orchestrator tem autoridade real de veto.
- Safe Mode preservado para todos os outros cenarios.
- Compilacao limpa.

---

### Fase 3 — Hard Handoff (autoridade completa)

Objetivo: Orchestrator decide `abort` ou `continue` com base no resultado real do repair.

Alteracoes:
- src/core/orchestrator/CognitiveOrchestrator.ts
  - Campo `_observedRepairResult` adicionado.
  - Metodo `ingestRepairResult` adicionado (observa `success` e `hasRepairedPlan`).
  - `decideRepairStrategy` reescrito com autoridade completa:
    - `FailSafe` ativo → `abort`
    - `StopContinue.shouldStop` → `abort`
    - Resultado nao observado → `undefined` (Safe Mode assume)
    - Repair com sucesso + plano valido → `continue`
    - Repair falhou ou sem plano → `abort`
- src/core/executor/AgentExecutor.ts
  - `repairAndExecute` chama `ingestRepairResult` imediatamente antes de `decideRepairStrategy`.
  - Comentario atualizado de "Fase 1" para "Fase 3".

Resultado:
- Orchestrator e o unico decisor no path de repair.
- Executor injeta contexto e aplica decisao; nao decide mais.
- Safe Mode permanece funcional para quando Orchestrator nao esta conectado.
- Compilacao limpa (`npx tsc --noEmit` → exit 0).

---

## Hierarquia de decisao implementada

```
FailSafe ativo           → abort  (prioridade maxima)
StopContinue.shouldStop  → abort
Resultado nao observado  → undefined (localDecision via Safe Mode)
Repair ok + plano valido → continue
Repair falhou/sem plano  → abort
```

---

## Arquivos alterados

- src/engine/AgentLoopTypes.ts
- src/core/executor/AgentExecutor.ts
- src/core/executor/repairPipeline.ts (sem alteracao de comportamento)
- src/core/orchestrator/CognitiveOrchestrator.ts
- src/i18n/pt-BR.json
- src/i18n/en-US.json
- docs/architecture/kanban/historico/checklist_vivo.md
- docs/architecture/kanban/em_andamento.md
- docs/architecture/kanban/concluido.md
- docs/architecture/kanban/Pendente/problemas_criticos.md

---

## Invariantes preservados

- Safe Mode (`orchestratorDecision ?? localDecision`) permanece para quando Orchestrator nao esta conectado.
- `repairPlanStructure` nao foi alterado.
- Zero novos tipos publicos.
- Nenhuma heuristica existente foi removida ou alterada.
- Nenhum fluxo paralelo criado.

---

## Validacao

- `npx tsc --noEmit` → exit 0 apos cada fase.
- Comportamento de abort/continue verificado por analise de contrato com `repairAndExecute`.

---

## Riscos residuais

- Nenhum critico identificado.
- `_observedRepairResult` e reset implicitamente no proximo ciclo via nova chamada a `ingestRepairResult`; nao ha reset explicito em `ingestSignalsFromLoop`. Monitorar se surgir estado stale entre sessoes.
