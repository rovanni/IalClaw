# KB-023 - Externalizar heurísticas táticas remanescentes do AgentLoop

Data: 2026-04-04
Escopo: remover o papel de mini-brain tático do `AgentLoop`, mantendo o loop como executor técnico com autoridade primária no `CognitiveOrchestrator`.
Regra central: decisões táticas ficam no Orchestrator; o loop extrai sinais/fatos, aplica decisão e preserva safe mode de contingência.

## Problema original

O `AgentLoop` concentrava heurísticas residuais de fallback/reclassificação/retry/ajuste de plano/reality-check/delta.
Mesmo com pontos de integração existentes, ainda havia decisão local relevante no executor do loop.

Isso gerava risco de split-brain tático, duplicação de governança e dificuldade de auditoria consistente por autoridade central.

## Critério de pronto

- trust/reality-check, fallback tático e decisões residuais deixam de ser cérebro local
- estado de delta sai de cache local e fica centralizado na sessão
- decisão primária por bloco passa a ser feita no Orchestrator
- safe mode preservado: `finalDecision = orchestratorDecision ?? loopDecision`
- validação objetiva sem regressão em build/testes

## Implementação

### Fase 0 — mapeamento de reuso e fronteira de autoridade

- matriz Loop x Orchestrator consolidada por bloco tático
- identificação de blocos já em safe mode e lacunas de decisão residual
- priorização por fases:
  - P1: fallback tático residual
  - P2: delta/stop e reality-check
  - P3: reclassificação/retry/plan-adjustment

### Fase 1 — extração estrutural sem ativar decisão nova

- criação de `FallbackStrategySignal` para ramos residuais (`consecutive_tool_failures`, `max_iterations_reached`, `fail_safe_direct_attempt`)
- ingestão passiva no Orchestrator via `ingestSignalsFromLoop`
- estado de delta centralizado em `SessionManager.delta_state` (`getDeltaState`, `setDeltaState`, `resetDeltaState`)
- extração de fatos de reality-check para `RealityCheckFacts`
- geração de signal por fatos via `buildRealityCheckSignalFromFacts`
- deduplicação de ingestão por `syncSignalsWithOrchestrator()`
- padronização de safe mode com `resolveSafeModeBooleanDecision()`
- extração de helpers por bloco:
  - `decideReclassificationWithSafeMode`
  - `decideRetryWithLlmSafeMode`
  - `decidePlanAdjustmentWithSafeMode`

### Fase 2 — ativação de decisão primária no Orchestrator

- decisão ativa para reclassificação via `decideReclassification`
- decisão ativa para retry LLM via `decideRetryWithLlm`
- decisão ativa para ajuste de plano via `decidePlanAdjustment`
- decisão ativa para fallback tático residual via `decideFallbackStrategy(sessionId)`
- loop permanece em safe mode: `orchestratorDecision ?? loopDecision`

### Fase 4 — limpeza controlada de duplicação residual

- remoção da duplicação residual no fluxo de fallback direto no loop
- manutenção de logs e trilha de auditoria
- manutenção de fallback seguro no loop em caso de `undefined` no Orchestrator

## Rastreabilidade de fases (template)

### Fase 1 — extração (sem decisão nova)

- signals/facts extraídos no loop (`FallbackStrategySignal`, `RealityCheckFacts`, delta em sessão)
- ingestão passiva no Orchestrator (`ingestSignalsFromLoop`)
- safe mode preservado com fallback local

### Fase 2 — ativação (com decisão governada)

- ativação de decisão no Orchestrator para reclassificação, retry LLM e ajuste de plano
- ativação de decisão no Orchestrator para fallback estratégico (`decideFallbackStrategy`)
- safe mode preservado em todos os blocos: `finalDecision = orchestratorDecision ?? loopDecision`

### Validação incremental registrada

- compilação e testes executados ao fim de marcos críticos de fase (extração, ativação e limpeza)
- validação final objetiva:
  - `npx.cmd tsc --noEmit` ✅
  - `npm.cmd test` ✅

## Arquivos alterados

- src/engine/AgentLoopTypes.ts
- src/engine/AgentLoop.ts
- src/core/validation/StepResultValidator.ts
- src/core/orchestrator/CognitiveOrchestrator.ts
- src/shared/SessionManager.ts
- docs/architecture/kanban/Pendente/problemas_criticos.md
- docs/architecture/kanban/concluido.md
- docs/architecture/kanban/mapa_problemas_sistema.md
- docs/architecture/kanban/historico/checklist_vivo.md

## Invariantes preservados

- sem nova heurística local fora do Orchestrator
- sem remover branch legado antes da etapa prevista
- sem bypass da governança central
- sem quebrar safe mode
- loop mantido como executor técnico com aplicação de decisão

## Validação

- `npx.cmd tsc --noEmit` -> sucesso
- `npm.cmd test` -> sucesso (All tests passed)

## Conflitos reais auditados

- Route vs FailSafe: coberto em `auditSignalConsistency`
- Validation vs StopContinue: conflitos correlatos mantidos em auditoria
- Fallback vs Route: conflito mantido em auditoria

## Resultado

KB-023 concluído com handoff tático para o Orchestrator, sem regressão funcional observada e com registro canônico no kanban (remoção de pendente, entrada em concluído e histórico técnico dedicado).
