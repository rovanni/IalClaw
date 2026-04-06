# Mapeamento do CognitiveOrchestrator - Fase 1

## Objetivo

Mapear blocos coesos e contratos pequenos do `CognitiveOrchestrator` para modularizacao incremental.

Escopo deste mapeamento:

- somente leitura e classificacao estrutural
- nenhuma mudanca de heuristica, fluxo ou decisao final
- alinhamento direto com a regra do KB-046: extrair blocos coesos dentro de funcoes grandes, nao funcoes grandes inteiras

Arquivo analisado:

- `src/core/orchestrator/CognitiveOrchestrator.ts`

---

## Regra de leitura deste mapa

Cada candidata abaixo foi classificada com a seguinte logica:

- `Bloco coeso`: trecho interno que deriva dados, monta contexto ou aplica log observacional
- `Contrato pequeno`: contexto/shape pequeno que pode virar fonte unica em `types/`
- `Risco`: impacto estrutural se a extracao for feita agora
- `Acao sugerida`: proxima microetapa segura ou motivo para adiar

Este mapa nao recomenda mover:

- `decide()` inteiro
- `resolveSignalAuthority`
- `auditSignalConsistency`
- funcoes grandes inteiras apenas por volume de linhas

---

## Panorama estrutural

| Dominio | Metodos principais | Perfil | Risco |
|---|---|---|---|
| Planning | `decidePlanningStrategy` | medio com bloco puro | baixo |
| Ingestao de signals | `ingestSignalsFromLoop` | grande com varios blocos observacionais | medio |
| Repair / Retry | `decideRepairStrategy`, `decideRetryAfterFailure` | medio com regras puras + authority posterior | medio |
| Auditoria de conflitos | `auditSignalConsistency`, `_reportSignalConflict` | medio com regras repetitivas | medio |
| Authority | `resolveSignalAuthority` | pequeno e central | alto |
| Active decisions snapshot | `applyActiveDecisions` | medio com composicao pura | baixo |
| Stop/Continue | `decideStopContinue*`, `applyStopContinueGovernance` | grande com contexto e governanca | alto |
| Macro decisao | `decide` | muito grande com varios blocos internos | alto |
| Search governance | `decideQueryExpansion`, `decideSearchWeights`, `decideGraphExpansion`, `decideReranking`, `decideSearchFallbackStrategy` | medio, repetitivo e session-aware | baixo a medio |
| Signal application | `decideRetryWithLlm`, `decideReclassification`, `decidePlanAdjustment`, `decideRealityCheck` | medio com padrao repetido | medio |
| Tool selection | `decideToolSelection` | medio com regra pequena e signal-local | medio |
| Direct execution | `decideDirectExecution` | pequeno com gate de risco | alto |

---

## Blocos coesos mapeados

### 1. `ingestSignalsFromLoop(...)`

Local:

- `src/core/orchestrator/CognitiveOrchestrator.ts:252`

Blocos coesos identificados:

1. snapshot inicial e reset do ciclo
2. logging observacional por tipo de signal
3. delegacao isolada de stop para `_logStopSignal(...)`

Contratos pequenos candidatos:

- `IngestedSignalSummary`
- `ObservedSignalLogContext`

Leitura arquitetural:

- o metodo e grande, mas nao decide autoridade
- a maior parte do volume esta no logging factual por signal
- existe fronteira clara entre:
  - persistencia do snapshot observado
  - reset do ciclo
  - logs passivos por categoria

Acao sugerida:

- extrair primeiro um helper puro para derivar o resumo factual do ciclo
- depois avaliar um helper observacional para montar payloads de log por signal
- manter no Orchestrator a chamada explicita de cada log e a mutacao de `observedSignals`

Risco:

- medio

Status:

- candidata valida para microetapa futura, mas nao e a primeira

---

### 2. `auditSignalConsistency(...)`

Local:

- `src/core/orchestrator/CognitiveOrchestrator.ts:625`

Blocos coesos identificados:

1. captura local dos signals relevantes
2. regras repetidas de conflito `if (...) => _reportSignalConflict(...)`
3. derivacao de `routeWantsExecution`

Contratos pequenos candidatos:

- `SignalConflictCandidate`
- `SignalConflictRuleContext`

Leitura arquitetural:

- nao decide estrategia final do sistema
- contem varias regras simples e independentes
- o padrao repetitivo favorece extracao de detector puro que retorne conflitos

Acao sugerida:

- extrair apenas a derivacao de conflitos para helper puro que retorne lista de conflitos
- manter no Orchestrator:
  - leitura de `observedSignals`
  - chamada de `_reportSignalConflict(...)`
  - controle de `routeVsFailSafeConflictLoggedInCycle`

Risco:

- medio

Status:

- boa candidata apos mais uma rodada de contratos pequenos

---

### 3. `applyActiveDecisions(...)`

Local:

- `src/core/orchestrator/CognitiveOrchestrator.ts:1112`

Blocos coesos identificados:

1. composicao do snapshot `loop`
2. composicao do snapshot `orchestrator`
3. merge `applied`
4. derivacao factual de `safeModeFallbackApplied`

Contratos pequenos candidatos:

- `AppliedDecisionSnapshots`
- `SafeModeFallbackAppliedSummary`

Leitura arquitetural:

- e um metodo com composicao fortemente estrutural
- nao cria heuristica nova
- usa um contrato ja exportado: `ActiveDecisionsResult`

Acao sugerida:

- candidata alta para extrair helper puro de montagem do resultado
- manter no Orchestrator apenas as chamadas `decide*` e o ponto de retorno final

Risco:

- baixo

Status:

- candidata de alta prioridade

---

### 4. `applyStopContinueGovernance(...)`

Local:

- `src/core/orchestrator/CognitiveOrchestrator.ts:1182`

Blocos coesos identificados:

1. recuperacao de contexto de sessao
2. ajuste contextual de recovery continuation
3. ajuste contextual de recurrent failure escalation
4. payload de auditoria `signal_authority_resolution`
5. payload de delta `stop_continue_decision_delta`

Contratos pequenos candidatos:

- `StopContinueGovernanceContext`
- `StopContinueAdjustmentAuditPayload`

Leitura arquitetural:

- metodo grande com fronteiras internas reais
- porem toca governanca contextual e interage com authority
- nao deve ser modularizado por inteiro agora

Acao sugerida:

- nao extrair a funcao inteira
- se houver rodada futura, extrair apenas payload builders puros de auditoria
- manter no Orchestrator a decisao final, o ajuste contextual e a resolucao de authority

Risco:

- alto

Status:

- adiar nesta fase

---

### 5. `decide(...)`

Local:

- `src/core/orchestrator/CognitiveOrchestrator.ts:1297` 

Blocos coesos identificados:

1. recuperacao de estado de sessao e pending action
2. gate de recovery
3. gate de flow ativo / interrupcao de flow
4. gate de pending action
5. preparacao da decisao normal:
   - classificacao
   - route
   - memory hits
   - capability gap
   - planning strategy
   - aggregated confidence
   - autonomia
6. mapeamento final de estrategia para `CognitiveDecision`

Contratos pequenos candidatos:

- `NormalDecisionInputs`
- `NormalDecisionComputation`
- `StrategyRecommendationContext`
- `PrecedenceGateContext`

Leitura arquitetural:

- e o maior hub do arquivo e concentra autoridade real
- mas contem blocos internos nitidos, especialmente:
  - preparacao de insumos da decisao normal
  - mapeamento final de estrategia

Acao sugerida:

- nao mover `decide()` inteiro
- priorizar apenas blocos internos sem authority propria
- melhores candidatas dentro dele:
  - helper puro para montar insumos da decisao normal
  - helper puro para mapear `autonomyDecision + routeDecision + capabilityAwarePlan` em recomendacao final

Risco:

- alto se o escopo crescer
- medio se limitado a builders puros

Status:

- candidata futura importante, mas somente por blocos internos pequenos

---

### 6. `decideRetryWithLlm(...)`, `decideReclassification(...)`, `decidePlanAdjustment(...)`

Locais:

- `src/core/orchestrator/CognitiveOrchestrator.ts:1618`
- `src/core/orchestrator/CognitiveOrchestrator.ts:1676`
- `src/core/orchestrator/CognitiveOrchestrator.ts:1735`

Blocos coesos identificados:

1. guard clause `if (!signal) return undefined`
2. bloqueio por authority
3. logging de bloqueio por fail-safe / stop
4. aplicacao factual do signal quando liberado

Contratos pequenos candidatos:

- `AuthorityBlockedSignalContext`
- `SignalApplicationResult<TSignal>`

Leitura arquitetural:

- os tres metodos compartilham o mesmo esqueleto
- porem uma abstracao prematura pode misturar dominios distintos

Acao sugerida:

- evitar genericona agora
- se modularizar, fazer por bloco pequeno:
  - helper de log de bloqueio
  - helper puro de derivacao do retorno aplicado

Risco:

- medio

Status:

- candidata secundaria, nao prioritaria

---

### 7. `decideRealityCheck(...)`

Local:

- `src/core/orchestrator/CognitiveOrchestrator.ts:1793`

Blocos coesos identificados:

1. guard clause de signal ausente
2. logging factual da aplicacao
3. persistencia em `_orchestratorAppliedDecisions`

Contratos pequenos candidatos:

- `RealityCheckApplicationContext`

Leitura arquitetural:

- pequeno e coeso
- baixo ganho arquitetural isolado

Acao sugerida:

- nao priorizar enquanto houver alvos mais reaproveitaveis

Risco:

- baixo

Status:

- adiar

---

### 8. Grupo Search: `decideQueryExpansion(...)`, `decideSearchWeights(...)`, `decideGraphExpansion(...)`, `decideReranking(...)`, `decideSearchFallbackStrategy(...)`

Locais:

- `src/core/orchestrator/CognitiveOrchestrator.ts:1866`
- `src/core/orchestrator/CognitiveOrchestrator.ts:1908`
- `src/core/orchestrator/CognitiveOrchestrator.ts:1957`
- `src/core/orchestrator/CognitiveOrchestrator.ts:2011`
- `src/core/orchestrator/CognitiveOrchestrator.ts:2063`

Blocos coesos identificados:

1. aquisicao repetida de `session` e `cognitiveState`
2. derivacoes puras por contexto de busca
3. logging contextual quando a feature e ativada ou bloqueada

Contratos pequenos candidatos:

- `SearchDecisionSessionContext`
- `SearchFallbackStrategyContext`
- `GraphExpansionDecision`

Leitura arquitetural:

- o grupo e modularizavel por contexto compartilhado
- cada metodo e relativamente pequeno, mas a repeticao de session lookup e um smell claro

Acao sugerida:

- boa candidata para contrato pequeno compartilhado de contexto search-aware
- manter cada decisao separada; extrair apenas a aquisicao factual de estado ou pequenos avaliadores puros

Risco:

- baixo a medio

Status:

- candidata valida, mas secundaria em relacao a `applyActiveDecisions(...)`

---

### 9. `decideToolSelection(...)`

Local:

- `src/core/orchestrator/CognitiveOrchestrator.ts:2118`

Blocos coesos identificados:

1. logging observacional inicial
2. construcao de `recommendation`
3. regra de prioridade `exploration > positive > undefined`

Contratos pequenos candidatos:

- `ToolSelectionRecommendation`
- `ToolSelectionDecisionContext`

Leitura arquitetural:

- a regra interna e pequena e clara
- porem este dominio ainda esta em migracao de authority no KB-024

Acao sugerida:

- nao modularizar antes de estabilizar a autoridade do card KB-024

Risco:

- medio

Status:

- adiar por dependencia de outro card

---

### 10. `decideDirectExecution(...)`

Local:

- `src/core/orchestrator/CognitiveOrchestrator.ts:2185`

Blocos coesos identificados:

1. bloqueio por fail-safe
2. bloqueio por `hasExecutionIntent`

Contratos pequenos candidatos:

- `DirectExecutionGuardContext`

Leitura arquitetural:

- pequeno, mas sensivel
- qualquer mudanca aqui toca short-circuit operacional

Acao sugerida:

- nao priorizar no KB-046

Risco:

- alto

Status:

- adiar

---

## Contratos pequenos ja consolidados nesta fase

Fonte unica ja criada:

- `PlanningTypes.ts`
- `CapabilityFallbackTypes.ts`
- `RetryAfterFailureTypes.ts`

Padrao validado:

- extrair contrato pequeno
- extrair helper ou decisao pura correspondente
- manter authority, safe mode, telemetria e override final no `CognitiveOrchestrator`

---

## Ordem recomendada de modularizacao a partir deste mapa

1. `applyActiveDecisions(...)`
   - motivo: composicao pura, baixo risco e diff pequeno

2. `ingestSignalsFromLoop(...)` apenas no bloco de resumo factual do ciclo
   - motivo: reduz volume do metodo sem tocar na mutacao principal nem em authority

3. `auditSignalConsistency(...)` apenas no detector puro de conflitos
   - motivo: regras repetitivas e observacionais, mantendo emissao e estado no Orchestrator

4. `decide(...)` apenas em um builder puro da fase de preparacao da decisao normal
   - motivo: alto impacto estrutural, mas somente quando os contratos menores anteriores estiverem estabilizados

5. Grupo Search por contrato compartilhado de contexto
   - motivo: repeticao clara, mas fora da trilha principal do KB-046

---

## O que nao tocar agora

- `decide()` inteiro
- `resolveSignalAuthority`
- `applyStopContinueGovernance(...)` como funcao inteira
- `decideToolSelection(...)` antes de estabilizar KB-024
- `decideDirectExecution(...)`
- qualquer abstracao generica unica para todos os `decide*` baseados em signal

---

## Checklist rapido para a proxima microetapa

- o alvo e um bloco coeso, nao uma funcao grande inteira
- o bloco nao decide sozinho
- o bloco nao altera authority
- o diff previsto cabe em uma rodada pequena e reversivel
- existe limpeza imediata da origem sem duplicacao residual
- `npx.cmd tsc --noEmit` fecha limpo apos a extracao

---

## Proxima sugestao concreta

Melhor proxima microetapa do KB-046:

- extrair um helper puro para montar o `ActiveDecisionsResult` em `applyActiveDecisions(...)`

Motivo:

- usa contrato ja existente
- nao toca heuristica nem authority
- reduz ru ruido estrutural do Orchestrator
- segue exatamente a regra nova de modularizar bloco coeso pequeno dentro de funcao maior
