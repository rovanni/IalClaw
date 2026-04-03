# Mapeamento do CognitiveOrchestrator - Fase 1

## Objetivo
Mapear blocos cognitivos, dependências e zonas de risco antes da modularização.

Escopo deste mapeamento:
- Somente leitura e classificação estrutural.
- Nenhuma mudança de heurística, fluxo ou decisão final.

Arquivo analisado:
- src/core/orchestrator/CognitiveOrchestrator.ts

## Blocos Cognitivos Identificados

| Dominio | Metodos principais | Tamanho | Risco |
|---|---|---|---|
| Ingestao de Signals | ingestSignalsFromLoop, ingestSelfHealingSignal | Medio | Baixo |
| Retry Governado | decideRetryAfterFailure, decideSelfHealing | Medio | Medio |
| Auditoria de Conflitos | auditSignalConsistency, _reportSignalConflict, _logStopSignal | Medio | Baixo |
| Resolucao de Autoridade | resolveSignalAuthority | Pequeno | Alto |
| Route Autonomy | decideRouteAutonomy | Medio | Medio |
| FailSafe | decideFailSafe | Pequeno | Baixo |
| Step Validation | decideStepValidation | Pequeno | Baixo |
| Tool Fallback | decideToolFallback | Pequeno | Medio |
| Stop Continue | decideStopContinue | Grande | Alto |
| Retry LLM | decideRetryWithLlm | Pequeno | Medio |
| Reclassification | decideReclassification | Pequeno | Medio |
| Plan Adjustment | decidePlanAdjustment | Pequeno | Medio |
| Direct Execution | decideDirectExecution | Pequeno | Alto |
| Macro decisao cognitiva | decide | Grande | Alto |

## Pontos de Decisao por Signal

| Signal | Metodo decisor | Tipo de retorno |
|---|---|---|
| FailSafeSignal | decideFailSafe | FailSafeSignal ou undefined |
| StopContinueSignal | decideStopContinue | StopContinueSignal ou undefined |
| ToolFallbackSignal | decideToolFallback | ToolFallbackSignal ou undefined |
| StepValidationSignal | decideStepValidation | StepValidationSignal ou undefined |
| RouteAutonomySignal | decideRouteAutonomy | RouteAutonomySignal ou undefined |
| LlmRetrySignal | decideRetryWithLlm | boolean ou undefined |
| ReclassificationSignal | decideReclassification | boolean ou undefined |
| PlanAdjustmentSignal | decidePlanAdjustment | boolean ou undefined |
| SelfHealingSignal | decideRetryAfterFailure | boolean ou undefined |

## Zonas Perigosas (Nao modularizar primeiro)

1. Cadeia de autoridade e conflito cruzado:
   - resolveSignalAuthority
   - auditSignalConsistency
   - decideRetryAfterFailure

2. Decisao com ajuste contextual local:
   - decideStopContinue
   - Possui ajustes contextuais e delta de auditoria.

3. Short-circuit e execucao direta:
   - decideDirectExecution
   - Integrado com intencao de execucao e FailSafe.

4. Hub macro de roteamento:
   - decide
   - Combina intencao, flow, pending action, classificacao, route e autonomia.

## Dependencias Entre Dominios

Dependencias observadas para ordem de extração segura:

- FailSafe -> RouteAutonomy (conflito auditado)
- FailSafe -> Retry LLM
- FailSafe -> Reclassification
- FailSafe -> PlanAdjustment
- FailSafe -> DirectExecution
- StopContinue -> Retry LLM
- StopContinue -> Reclassification
- StopContinue -> PlanAdjustment
- StopContinue -> RetryAfterFailure
- Validation -> RetryAfterFailure
- SelfHealing -> RetryAfterFailure
- ToolFallback -> Auditoria de conflitos com FailSafe, Retry, Replan e DirectExecution

Dependencias de infra:

- Todos os decide* dependem de observedSignals e ingestSignalsFromLoop.
- resolveSignalAuthority depende de SessionManager.getCognitiveState.
- auditSignalConsistency depende da composicao simultanea de multiplos signals.

## Candidatos de Modulizacao (Fase 1 em diante)

Ordem recomendada de extração:

1. FailSafe
2. StopContinue
3. Retry (RetryAfterFailure + RetryWithLlm)
4. ToolFallback
5. DirectExecution
6. ConflictResolver (resolveSignalAuthority + auditoria de conflitos)
7. Audit (logs e report de conflitos)

Justificativa:

- FailSafe e pequeno, de baixo risco e com fronteira clara de signal.
- StopContinue ja e governado e central para precedencia.
- Retry depende de FailSafe e StopContinue.
- ToolFallback e sensivel por atravessar varios conflitos.
- DirectExecution impacta short-circuit e risco de regressao funcional.
- ConflictResolver e Audit por ultimo para evitar romper governanca transversal cedo.

## O que Nao Tocar Agora

- Nao alterar logica de decide.
- Nao alterar short-circuit em decideDirectExecution.
- Nao mover resolveSignalAuthority nesta fase.
- Nao alterar regras de auditoria em auditSignalConsistency.
- Nao alterar safe mode de nenhum decide*.

## Preparacao para Modulizacao Fase 1

FailSafe esta apto para delegacao progressiva por wrapper:

- Adicionar FailSafeModule com decide(signal) retornando null inicialmente.
- Em decideFailSafe, consultar modulo e manter fallback para logica local inalterada.
- Sem mover blocos reais nesta fase.

## Observacoes de Risco Estrutural

- Existem trechos comentados com texto residual de merge em comentarios de decideFailSafe, decideStepValidation e decideToolFallback.
- Esses trechos nao foram alterados neste mapeamento.
- Recomenda-se limpeza estrutural dedicada antes de modularizacoes maiores, mas fora desta fase.
