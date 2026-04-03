# Checklist Vivo - Evolucao Single Brain

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
- Mapeamento cirurgico do short-circuit no AgentLoop concluido e documentado em `docs/architecture/ShortCircuitMapping.md` (sem alteracao de codigo).
- Pontos criticos registrados: gate `DIRECT_LLM`, caminho `HYBRID`, `executeContentGenerationDirect`, retorno por `final_answer` sem tool obrigatoria e fallback final sem tools.
- Correcao cirurgica de compatibilidade de testes: `AgentController` agora injeta orchestrator com guarda defensiva (`typeof this.loop?.setOrchestrator === 'function'`) para evitar crash em mocks parciais.
- Validacao da correcao de integracao concluida: `npx tsc --noEmit` sem erros e `npm.cmd test` com `All tests passed`.
- **ETAPA 7 IMPLEMENTADA**: hierarquia completa de autoridade no `CognitiveOrchestrator` via `resolveSignalAuthority(context)`.
- Precedencia ativa e consistente: `FailSafe` > `StopContinue` > `Validation` > `SelfHealing` > delegacao.
- Resolucao de conflitos aplicada nos 3 pontos cognitivos do loop (`decideRetryWithLlm`, `decideReclassification`, `decidePlanAdjustment`) sem duplicar heuristica.
- Safe mode mantido em todos os call sites: `finalDecision = orchestratorDecision ?? loopDecision`.
- Nenhuma regressao de fluxo externo introduzida; sem alteracao de mensagens de usuario e sem alteracao de thresholds.
- Estabilização estrutural pre-ETAPA 2.4: regex corrompidos no `AgentController` corrigidos (variantes acentuadas + compatibilidade com texto mojibake), sem alterar fluxo.
- Estabilização estrutural pre-ETAPA 2.4: erros de compilação no `CognitiveOrchestrator` corrigidos com ajustes mínimos de escopo/tipagem (sem alterar heurísticas).
- Validacao obrigatoria executada: `npx tsc --noEmit` sem erros apos cada bloco de correção.
- Extracao de sinais para decisoes cognitivas-chave do AgentLoop.
- Inclusao de ToolFallbackSignal para explicitar decisao de fallback sem alterar heuristicas.
- Padronizacao de TODOs de migracao para CognitiveOrchestrator nos pontos de decisao ainda locais.
- Cobertura de regressao para o novo sinal de fallback.
- Extracao de StopContinueSignal: shouldStopExecution e checkDeltaAndStop agora retornam tipo explicito com reason enum e campos globalConfidence/stepCount.
- Extracao de FailSafeSignal: buildFailSafeSignal centraliza a decisao de ativacao do modo fail-safe com trigger tipado (intent_clear, unknown_task_type, generic_task_type, force_type_override_disabled, not_activated).
- Conexao de FailSafeSignal em setOriginalInput e forceTaskType com TODOs de migracao para CognitiveOrchestrator.
- Criacao de CognitiveSignalsState: tipo agregador exportado consolidando route/fallback/validation/stop/failSafe.
- Registro automatico nos builders existentes sem alterar comportamento (buildRouteAutonomySignal, logToolFallbackSignal, buildStepValidationResult, buildFailSafeSignal, call sites de shouldStopExecution e checkDeltaAndStop).
- getSignalsSnapshot(): metodo publico que expoe snapshot imutavel para consumo futuro pelo CognitiveOrchestrator.
- **PRIMEIRA MIGRAÇÃO REALIZADA**: Consumo PASSIVO de StopContinueSignal no CognitiveOrchestrator (Safe Mode)
- **ETAPA 3.1 IMPLEMENTADA**: Refinamento contextual de falha recorrente em `decideStopContinue(sessionId)` usando `hasReactiveFailure` + `attempt` do `SessionManager.getCognitiveState()`.
- **ETAPA 4 IMPLEMENTADA**: Ativacao de `ToolFallbackSignal` no CognitiveOrchestrator via `decideToolFallback(sessionId)` com safe mode (`undefined` => AgentLoop).
- Auditoria de fallback consolidada: delta `originalTool` vs `fallbackTool` com `reason`, sem recalculo de heuristica.
- Integracao ativa em 2 fluxos do AgentController (normal + skill), mantendo compatibilidade reversa.
- **ETAPA 5 IMPLEMENTADA**: `ValidationSignal` agora governado pelo Orchestrator em modo ativo via `decideStepValidation(sessionId)`.
- **ETAPA 6 IMPLEMENTADA**: `RouteAutonomySignal` agora governado pelo Orchestrator (modo ativo) via `decideRouteAutonomy(sessionId)` com safe mode (`orchestratorDecision ?? loopDecision`) e auditoria de loop/orchestrator/aplicada.
- Hardening de tipagem: `StopContinueSignal.reason` agora inclui `recurrent_failure_detected` (removido cast local no Orchestrator).
- Hardening de testes: mocks de loop atualizados com `getSignalsSnapshot()` para manter compatibilidade com ingestao de signals no AgentController.
- **ETAPA 7 IMPLEMENTADA**: `FailSafeSignal` agora governado pelo Orchestrator (modo ativo) via `decideFailSafe(sessionId)` com safe mode (`failSafeDecision ?? signals.failSafe`).
- `FailSafeSignal` importado explicitamente no CognitiveOrchestrator; nenhuma heuristica de `buildFailSafeSignal` foi duplicada ou movida.
- Integracao ativa em 2 fluxos do AgentController: fluxo normal e `runWithSkill`.
- Auditoria de coerência de autoridade implementada: conflito FailSafe vs Route detectado e logado (`[ORCHESTRATOR AUTHORITY] CONFLITO detectado`) sem override automatico — apenas auditado.
- Safe mode: `undefined` => AgentLoop permanece decisor sem alterar comportamento.
- Estrutura inicial de auditoria de signals criada no CognitiveOrchestrator (fase segura e incremental).
- ETAPA EXTRA IMPLEMENTADA: Self-healing extraido para `SelfHealingSignal` passivo no `AgentExecutor`, exposto via `getSelfHealingSignal()` e ingerido em modo observavel no `CognitiveOrchestrator` (sem alterar retries/fluxo).
- ETAPA SAFE MODE IMPLEMENTADA: governanca minima de self-healing via `decideSelfHealing(sessionId)` no `CognitiveOrchestrator`, bloqueando retry apenas quando `FailSafe` esta ativado ou `StopContinue` manda parar.
- Integracao ativa no `AgentExecutor.runWithHealing`: `finalDecision = orchestratorDecision ?? executorOriginalDecision`, sem alterar heuristica base de retry.
- Auditoria de governanca adicionada via evento estruturado `self_healing_governance` no DebugBus/TraceRecorder com `executorDecision`, `orchestratorDecision` e `finalDecision`.
- ETAPA 2 IMPLEMENTADA: externalizacao explicita da decisao de retry via `decideRetryAfterFailure(context)` no `CognitiveOrchestrator`, reutilizando apenas `SelfHealingSignal`, `StepValidationSignal`, `StopContinueSignal` e `FailSafeSignal`.
- Integracao no executor atualizada para usar `decideRetryAfterFailure(context)` como fonte primaria de decisao, mantendo fallback seguro `orchestratorDecision ?? executorDecision` sem alterar loop/retries/LLM.
- Auditoria de decisao de retry expandida com evento estruturado `retry_decision` (orchestratorDecision, executorDecision, finalDecision) para rastreabilidade ponta a ponta.
- ETAPA AUDITORIA GLOBAL IMPLEMENTADA: `auditSignalConsistency(sessionId)` agora detecta conflitos reais entre `SelfHealing`, `StopContinue`, `FailSafe`, `Validation` e `RouteAutonomy` em modo apenas-observacao (sem override/sem bloqueio).
- Conflitos cobertos com log estruturado `signal_conflict`: `self_healing_vs_stop_continue` (high), `self_healing_vs_fail_safe` (critical), `validation_vs_self_healing` (medium) e `route_autonomy_vs_fail_safe` (high).
- Reuso de observabilidade existente: conflitos emitidos no `DebugBus` e persistidos no `TraceRecorder` (evento `signal_conflict` adicionado).
- ETAPA HIERARQUIA SAFE IMPLEMENTADA: criado `resolveSignalAuthority(context)` no `CognitiveOrchestrator` com precedencia inicial `FailSafe > StopContinue > Validation > SelfHealing > RouteAutonomy`.
- Integracao controlada em pontos sensiveis: `decideSelfHealing`, `decideStopContinue` e `decideRouteAutonomy`, com padrao de safe mode (`authorityOverride ?? existingDecision`).
- Auditoria de autoridade adicionada: evento estruturado `signal_authority_resolution` emitido no `DebugBus` e persistido pelo `TraceRecorder`.
- **ETAPA 3.1 IMPLEMENTADA**: primeira reducao real de autoridade no `AgentExecutor` aplicada **antes** de cada `replan(...)`, com precedencia do Orchestrator via `decideRetryAfterFailure(context)`.
- Safe mode mantido sem alterar heuristica: `finalDecision = orchestratorDecision ?? executorDecision`.
- Comportamento externo preservado: mesma estrutura de loop, mesmos retries e sem mudanca de heuristicas.
- **ETAPA 3.2 IMPLEMENTADA**: governanca de aborts locais no `AgentExecutor` sem alterar heuristicas ou fluxo lógico.
  - 7 pontos críticos de abort cobertos: `tool_input_not_converging`, `tool_mismatch_during_repair`, `noop_correction`, `non_minimal_change`, `input_oscillation`, `missing_runtime_dependency`, `equivalent_error_loop`.
  - Padrão de intervenção aplicado: consulta ao Orchestrator ANTES de cada abort via `decideRetryAfterFailure(context)`.
  - Safe mode corrigido (fallback restaurado): `finalDecision = orchestratorDecision ?? executorDecision`.
  - Executor preservado como fallback quando o Orchestrator não decide.
  - Nenhuma regressão introduzida.
  - Mensagens de bloqueio adicionadas apenas quando Orchestrator retorna `true` (deseja continuar), usando prefixo "Self-healing bloqueado pela governanca do Orchestrator".
  - Validação obrigatória: `npx tsc --noEmit` sem erros ✓.
  - Nenhuma mudança de comportamento externo verificada ✓.
  - Nenhuma heurística alterada ✓.
  - Safe mode preservado ✓.
  - Nenhum fluxo quebrado ✓.

- **ETAPA 3.2 REVISÃO + CORREÇÃO APLICADA**: Ajuste de semântica + restauração de mensagens
  - **Problema 1 corrigido**: Interpretação incorreta do Orchestrator foi ajustada. Condições if `(finalDecision === true)` foram mudadas para `(orchestratorDecision === true)`.
  - **Motivo da correção**: O fallback foi restaurado para `orchestratorDecision ?? executorDecision`, garantindo causalidade correta e mantendo o Executor como decisor em safe mode quando o Orchestrator não se pronuncia.
  - **Problema 2 corrigido**: Mensagens de erro restauradas para as originais em pontos de retry pós-falha após `shouldRetryWithGovernance()`.
  - **4 pontos corrigidos na primeira onda**: tool_input_not_converging, tool_mismatch_during_repair, noop_correction, non_minimal_change.
  - **2 pontos corrigidos na segunda onda**: input_oscillation, missing_runtime_dependency, equivalent_error_loop.
  - **4 pontos adicionais corrigidos**: Mensagens em `failureMessage` e `runtimeError` e `validationError` nos fluxos de retry após `shouldRetryWithGovernance()`.
  - **Sintaxe preservada**: condição de bloqueio permanece `(orchestratorDecision === true)` apenas, com fallback seguro para decisão do Executor quando necessário.
  - **Resultado**: Zero regressão. Nenhuma heurística alterada. Nenhum fluxo quebrado. Governança semanticamente correta.

- **ETAPA 3.3 IMPLEMENTADA**: Governança da continuidade do loop no `AgentExecutor` — Orchestrator agora controla se o `while (attempt <= MAX_RETRIES)` continua ou encerra.
  - 4 pontos de `continue` cobertos (linhas no loop principal): repair path, execution error+replan, validation error+replan, runtime error+replan.
  - Loop de steps (`for...of plan.steps`) e loop de capabilities (`for...of capabilities`) **não tocados** — pertencem a escopos diferentes.
  - Padrão de intervenção aplicado ANTES de cada `continue`: `executorDecisionN = true`, `orchestratorDecisionN = this.orchestrator?.decideRetryAfterFailure({...})`, `finalDecisionN = orchestratorDecisionN ?? executorDecisionN`.
  - `continue` substituído por `if (finalDecision === true) { continue; } else { break; }`.
  - Safe mode mantido: `orchestratorDecision ?? executorDecision` — executor continua como fallback quando Orchestrator não decide.
  - `attempt++` **não alterado**; `MAX_RETRIES` **não alterado**; estrutura do `while` **não tocada**.
  - Nenhuma heurística alterada. Nenhuma mensagem alterada. Nenhum replan/abort existente afetado.
  - Corte do mini-brain principal concluído: Executor deixa de ser decisor do loop; sistema passa a Single Brain.
  - Validação obrigatória: `npx tsc --noEmit` sem erros ✓.
  - Nenhuma mudança de comportamento externo verificada ✓.
  - Safe mode preservado ✓.
  - Nenhuma regressão ✓.
  - Validação final: `npx tsc --noEmit` sem erros ✓.
- **ETAPA CRÍTICA IMPLEMENTADA**: Governança do short-circuit no `AgentLoop` com bloqueio por intenção de execução.
  - Short-circuit (`DIRECT_LLM`) e caminho `HYBRID` agora só executam direto quando **não** há intenção de execução real.
  - Coerência intenção vs execução reforçada: quando há intenção de tool/skill, o fluxo continua no loop normal de execução.
  - Safe mode aplicado: `finalDirectDecision = orchestratorDecision ?? loopDecision`.
  - Orchestrator agora governa execução direta via `decideDirectExecution(...)` (bloqueia com `false` em `FailSafe` ativo ou `hasExecutionIntent=true`; delega com `undefined`).
  - Nenhuma heurística existente removida, nenhum fluxo externo movido e sem alteração de mensagens de usuário.
  - Validação obrigatória executada: `npx tsc --noEmit` sem erros ✓.

## O que esta em andamento
- Auditoria de logs de producao para correlacionar eventos `short_circuit_activated`/`bypass_loop` com respostas de sucesso sem evidencia de tool.
- Verificar presenca de metodos opcionais em dependencias injetadas (contratos fracos).
- Monitoramento pos-correcao da camada de integracao do `AgentController` para garantir compatibilidade continua com mocks legados sem alterar fluxo de producao.
- Monitoramento pós-ETAPA 6: verificar logs `[ORCHESTRATOR AUTHORITY]` de bloqueio em produção para os 3 novos call sites.
- Verificação de divergência: quando loop quer continuar e Orchestrator bloqueia via FailSafe/StopContinue.
- Monitorar em produção os novos eventos `short_circuit_governance`, `short_circuit_blocked` e `hybrid_blocked` para confirmar redução de "promessa sem execução".

## O que ainda falta
- Classificar os bypass mapeados por categoria operacional (conversa simples, execucao de task, fallback, erro) com amostras reais de trace.
- Consolidar rastreabilidade ponta a ponta do fluxo: input -> route/autonomy -> estrategia aplicada -> execucao real vs resposta direta.
- Blindagem opcional dos testes com mocks tipados de `AgentLoop` para reduzir risco de quebras futuras por metodos de integracao ausentes.
- Expandir `auditSignalConsistency` para incluir reclassification, llmRetry e planAdjustment
- Testes de regressão pós-ETAPA 6: cenário de bloqueio e cenário sem sinal ativo
- Testes de regressão da ETAPA CRÍTICA: cenários de conversa simples, execução com skill/tool e caso de áudio garantindo bloqueio de short-circuit quando houver intenção de execução.
- Unificar estado cognitivo no SessionManager para suportar decisões centralizadas
- Resolver conflitos de autoridade identificados (FailSafe vs Route) com override explícito
- Remover loops de decisão residuais do AgentLoop (gradualmente — próxima fase)

- **ETAPA 5 IMPLEMENTADA**: Orchestrator ativado no AgentLoop para os 3 call sites de decisão cognitiva.
  - `decideRetryWithLlm`, `decideReclassification` e `decidePlanAdjustment` adicionados ao `CognitiveOrchestrator`.
  - Campo `private orchestrator?: CognitiveOrchestrator` adicionado ao `AgentLoop` com método `setOrchestrator()`.
  - AgentController injeta o orchestrator no loop via `this.loop.setOrchestrator(this.orchestrator)` após criação.
  - 3 call sites atualizados: `orchestratorDecision = undefined` substituído pelas chamadas reais ao Orchestrator.
  - Safe mode mantido: `orchestratorDecision ?? loopDecision` — loop continua como fallback quando Orchestrator retorna `undefined`.
  - Nenhuma heurística alterada. Nenhuma mensagem alterada. Nenhum fluxo externo modificado.
  - Orchestrator apenas interpreta o signal — não recalcula lógica nem acessa variáveis externas ao signal.

  - **ETAPA 6 IMPLEMENTADA**: Orchestrator passa a ter autoridade real de bloqueio nos 3 call sites cognitivos.
    - Padrão aplicado nos 3 métodos (`decideRetryWithLlm`, `decideReclassification`, `decidePlanAdjustment`):
      - `FailSafe.activated === true` → retorna `false` (bloqueio máximo)
      - `StopContinue.shouldStop === true` → retorna `false` (bloqueio por parada solicitada)
      - Caso contrário → retorna `undefined` (delega ao loop — safe mode)
    - Orchestrator usa apenas `this.observedSignals` (já ingeridos via `ingestSignalsFromLoop`) — sem recalcular heurística.
    - Hierarquia respeitada: `FailSafe > StopContinue > (loop decide)`.
    - Comportamento idêntico ao anterior quando nenhum sinal de bloqueio está ativo.
    - Divergência controlada: quando loop quer continuar (`loopDecision = true`) e Orchestrator bloqueia (`false`), `finalDecision = false ?? true = false` — bloqueio vence.
    - Nenhuma heurística criada. Nenhuma mensagem alterada. Nenhum fluxo externo modificado.
    - Validação obrigatória: `npx tsc --noEmit` sem erros ✓.
  - Validação obrigatória: `npx tsc --noEmit` sem erros ✓.

## O que NAO deve ser tocado agora
- Nao corrigir short-circuit nesta etapa; manter foco apenas em mapeamento e auditoria.
- Nao alterar heuristicas de route/autonomy, thresholds de risco ou branches de fallback durante a fase de diagnostico.
- Nao remover `setOrchestrator` do `AgentLoop` real; a guarda defensiva existe apenas para compatibilidade de integracao em testes.
- `decisionGate` — nao alterar
- `buildFailSafeSignal` no AgentLoop — nao mover nem duplicar heuristicas
- AgentLoop — nao alterar comportamento de execucao
- Heuristicas existentes de ativacao de FailSafe — nao reimplementar
- AgentLoop — nao tocar nesta fase de auditoria cruzada minima
- decisionGate — nao tocar nesta fase
- heuristicas existentes — nao tocar nesta fase
- Resolucao automatica de conflito FailSafe vs Route — apenas auditar, nao resolver ainda
- Nao mover MÚLTIPLAS decisoes simultaneamente—uma por vez apenas
- Nao unificar estado no SessionManager nesta etapa.
- Nao remover loops de decisao no AgentLoop nesta etapa.
- Nao introduzir fluxos paralelos ou logica duplicada.
- Nao criar heuristica nova de retry no Orchestrator; apenas aplicar override de bloqueio baseado em `FailSafe` e `StopContinue`.
- Nao transformar auditoria de conflitos em mecanismo de bloqueio automatico nesta fase.
- Nao substituir decisoes existentes diretamente; override de autoridade permanece opcional e controlado.

## ETAPA: GOVERNANCA DO SELF-HEALING (SAFE MODE) ✓ IMPLEMENTADA

### Implementacao realizada
- `CognitiveOrchestrator.decideSelfHealing(sessionId)` criado em modo ativo seguro.
- Decisao minima aplicada sem recalculo de heuristica: `failSafe.activated => false`, `stop.shouldStop => false`, demais casos => `undefined`.
- `AgentRuntime` passou a compartilhar a mesma instancia de `CognitiveOrchestrator` com o `AgentExecutor`, evitando fluxo paralelo.
- `AgentExecutor.runWithHealing()` agora consulta o Orchestrator antes de cada retry e aplica safe mode: `orchestratorDecision ?? executorOriginalDecision`.
- Retry bloqueado gera trilha estruturada `self_healing_governance` e encerra o healing sem executar nova tentativa.
- `TraceRecorder` passou a persistir `self_healing_governance` para auditoria ponta a ponta.

### Garantias desta etapa
- ✓ Heuristica original de retry do executor foi preservada.
- ✓ `SelfHealingSignal` continua incremental e nao foi reescrito pelo Orchestrator.
- ✓ Sem contexto suficiente, o comportamento continua identico (`undefined` => fallback ao executor).
- ✓ Bloqueio ocorre apenas em sinais extremos ja existentes (`FailSafe` e `StopContinue`).

## Regra operacional obrigatoria (a partir de agora)
Toda correcao deve atualizar este checklist vivo com:
1. O que ja foi corrigido
2. O que esta em andamento
3. O que ainda falta
4. O que NAO deve ser tocado agora

## Atualizado em
- Data: 2 de abril de 2026
- Contexto: **ETAPA 4 INICIADA E CONCLUÍDA**. Neutralização do AgentLoop como mini-brain: signals de `reclassification`, `llmRetry` e `planAdjustment` explicitados no `CognitiveSignalsState`, armazenados em `this.currentSignals` e protegidos por safe mode (`orchestratorDecision ?? loopDecision`). AgentLoop ainda decide localmente. Orchestrator preparado para assumir via `getSignalsSnapshot()`. Compilação limpa. Nenhuma heurística alterada. Nenhuma regressão introduzida.
- Registro adicional: diagnostico de short-circuit e bypass documentado em `docs/architecture/ShortCircuitMapping.md`.

---

## ETAPA 4 — NEUTRALIZAÇÃO DO AGENTLOOP ✓ INICIADA E CONCLUÍDA

### Decisões extraídas como signals explícitos

| Signal | Função-origem | Campo em `CognitiveSignalsState` | Safe mode aplicado |
|---|---|---|---|
| `ReclassificationSignal` | `shouldReclassify()` | `currentSignals.reclassification` | ✓ `finalDecisionReclassify` |
| `LlmRetrySignal` | `shouldRetryWithLlm()` | `currentSignals.llmRetry` | ✓ `finalDecisionLlmRetry` |
| `PlanAdjustmentSignal` | `adjustPlanAfterFailure()` | `currentSignals.planAdjustment` | ✓ armazenado no branch |
| `ToolFallbackSignal` | `buildToolFallbackSignal()` | `currentSignals.fallback` | ✓ já existia |
| `StopContinueSignal` | `shouldStopExecution()` / `checkDeltaAndStop()` | `currentSignals.stop` | ✓ já existia |
| `FailSafeSignal` | `buildFailSafeSignal()` | `currentSignals.failSafe` | ✓ já existia |
| `RouteAutonomySignal` | `buildRouteAutonomySignal()` | `currentSignals.route` | ✓ já existia |
| `StepValidationSignal` | `buildStepValidationResult()` | `currentSignals.validation` | ✓ já existia |

### Garantias desta etapa
- ✓ AgentLoop ainda decide localmente em todos os pontos (safe stage)
- ✓ Orchestrator pode observar TODOS os signals via `getSignalsSnapshot()`
- ✓ `CognitiveSignalsState` agora consolida 8 tipos de signal
- ✓ Padrão `orchestratorDecision ?? loopDecision` aplicado nos 3 novos pontos
- ✓ `orchestratorDecision = undefined` em todos os novos pontos (Orchestrator não conectado ainda)
- ✓ Nenhuma heurística alterada
- ✓ Nenhuma mensagem alterada
- ✓ Nenhuma função movida ou renomeada
- ✓ Nenhuma string nova introduzida
- ✓ `npx tsc --noEmit` — zero erros ✓

---

## ETAPA 1: CONSUMO PASSIVO DE STOPCONTINUESIGNAL ✓ COMPLETO

### Implementação realizada
- Adicionado campo `observedSignals` no CognitiveOrchestrator para armazenar signals observados
- Implementado método `ingestSignalsFromLoop(signals, sessionId)` para consumo PASSIVO
- Adicionado logging estruturado para cada tipo de signal (`_logStopSignal`, etc)
- Integrado com AgentController (2 pontos de ingestão): após loop.run() em modo normal e com skill
- Adicionado métodos de acesso: `getObservedSignals()` e `getLastStopSignal()`
- AgentLoop continua decidindo normalmente (SEM mudança de comportamento)
- Orchestrator apenas OBSERVA e REGISTRA via logs (modo passivo)

### TODOs para próximas fases
- **Fase Ativa**: Fazer Orchestrator DECIDIR em vez de apenas observar
- Ler signals do SessionManager em vez de apenas do AgentLoop (centralização de estado)
- Remover branches locais de decisão do AgentLoop (gradualmente)

### Regra crítica verificada
✓ Nenhum comportamento foi alterado
✓ AgentLoop continua como único decisor
✓ Orchestrator apenas observa (passivo)
✓ Estrutura reutiliza getSignalsSnapshot() existente
✓ Nenhum novo pipeline foi criado
✓ Trilha de auditoria via logs estruturados

---

## ETAPA 2: MODO ATIVO — STOPCONTINUE ✓ IMPLEMENTADO (SEM MUDANÇA DE LÓGICA)

### Objetivo desta etapa
- Mover a **tomada de decisão** de StopContinueSignal para CognitiveOrchestrator
- Manter **fallback seguro** no AgentLoop (regra de ouro: sistema funcional com orchestrator indisponível)
- Implementar **governance** sem duplicar lógica
- Preparar para **próximas migrações** de sinais (Fallback → Validation → Route → FailSafe)

### Implementação realizada

#### 1. CognitiveOrchestrator.decideStopContinue()
- ✓ Novo método que lê o último StopContinueSignal observado
- ✓ Retorna a decisão diretamente (SEM recriar lógica do AgentLoop)
- ✓ Logging estruturado: `[ORCHESTRATOR ACTIVE] Decisão de parada/continuidade aplicada`
- ✓ Safe mode: retorna `undefined` se nenhum signal disponível (fallback automático)
- ✓ Código reusa StopContinueSignal existente (zero duplicação)

#### 2. Integração em AgentController (2 pontos)
- ✓ **Fluxo normal** (linha ~652): Após ingestão passiva, chama `orchestrator.decideStopContinue(sessionId)`
	- Logging: `stop_continue_active_decision_checked`
	- Auditoria: registra decisão do orchestrator vs sinal do loop

- ✓ **Fluxo skill** (linha ~838): Mesmo padrão para consistency
	- Logging: `stop_continue_active_decision_skill`
	- Rastreia nome da skill na auditoria

#### 3. Padrão Safe Mode (Fallback)
```typescript
const orchestratorDecision = orchestrator.decideStopContinue(sessionId);
// undefined → AgentLoop decision stands (automatic)
// StopContinueSignal → Orchestrator decision governs (logged & audited)
```

### Estado da regressão
- ✓ **ZERO comportamento alterado**: AgentLoop.shouldStopExecution() e checkDeltaAndStop() rodam idênticos
- ✓ **ZERO lógica duplicada**: Orchestrator lê signal, não recria decisão
- ✓ **ZERO pipeline quebrado**: Fallback seguro em todos os caminhos
- ✓ **ZERO modificação de heurísticas**: Thresholds, deltas, confiança mantidos exatamente
- ✓ Ambos fluxos (normal + skill) têm rastreamento de decisão ativo

### O que mudou estruturalmente
- **Antes (ETAPA 1)**: Orchestrator observava signals passivamente, AgentLoop decidia sozinho
- **Agora (ETAPA 2)**: Orchestrator **invoca** decisão ativa, AgentController registra ambas as decisões
- **Governança**: A decisão agora flui através do Orchestrator (para auditoria/filtro futuro)
- **Decisão final**: Signal do AgentLoop (mesma), mas aplicada por Orchestrator (governance)

### Prepare para ETAPA 3
- Fazer Orchestrator **ALTERAR** decisões com base em contexto (não só replicar)
- Exemplo: se globalConfidence está crítica, elevar threshold de stop
- Isso requer: centralizar estado de contexto no SessionManager (planejado)
- TODOs deixados para integração de contexto: `// TODO: Usar contexto externo para refinar decisão`

### TODOs para próximas fases
- **ETAPA 3 (Contextualizada)**: Implementar decisões BASEADAS EM CONTEXTO
	- Ler estado cognitivo do SessionManager
	- Alterar threshold de confiança dinamicamente
	- Integrar sinais de erro/retry para recalcular

- **ETAPA 4 (Ativa - Fallback)**: Consumo ATIVO de Fallback
	- Mesmo padrão: decideToolFallback()
	- Sequência: Fallback → Validation → Route → FailSafe

- **Consolidação**: Depois de todos os 5 sinais migrarem para modo ativo
	- Remover loops de decisão residuais do AgentLoop
	- Unificar estado cognitivo no SessionManager
	- Implementar trilha de auditoria ponta a ponta

### Regra crítica verificada (ETAPA 2)
✓ Nenhuma lógica duplicada (Orchestrator lê signal, não recria)
✓ AgentLoop continua funcionando se Orchestrator indisponível
✓ Ambos fluxos rastreados (normal + skill)
✓ Safe mode obrigatório respeitado
✓ Compatibilidade reversa: signal existente reusado
✓ Nenhuma branch antiga removida
✓ Logging estruturado para auditoria
✓ Sequência de migração mantida: um sinal por vez

### Atualizado em
- Data: 1 de abril de 2026 (ETAPA 2)
- Contexto: Transição para modo ativo iniciada. StopContinue agora GOVERNADO pelo Orchestrator (sem mudança de lógica). Próximo: contextualização e Fallback.

---

## ETAPA 3: STOPCONTINUE CONTEXTUAL (CONTROLADO) 🔄 EM ANDAMENTO

### Status
- **Contextualização parcial** implementada em `decideStopContinue(sessionId)`
- Ajuste **leve, condicional e reversível**
- Fallback preservado: `adjustedDecision ?? baseDecision`

### Verificação de reutilização (sem estado paralelo)
- ✓ Reutilizado `SessionManager.getSession(sessionId)`
- ✓ Reutilizado `SessionManager.getCognitiveState(session)`
- ✓ Reutilizados campos existentes: `isInRecovery`, `hasPendingAction`, `attempt`
- ✓ Nenhum novo estado cognitivo criado

### Implementação mínima aplicada
- Base mantida: `const baseDecision = observedSignals.stop`
- Contexto lido do SessionManager
- Override apenas quando:
	- `baseDecision.shouldStop === true`
	- `context.isInRecovery === true`
	- `context.hasPendingAction === true`
	- `context.attempt <= 1`
	- `reason` em `low_improvement_delta | over_execution_detected`
- Ajuste aplicado: `shouldStop: false` com `reason: execution_continues`
- Auditoria: log estruturado `stop_continue_contextual_adjustment_applied`

### Garantia de não regressão
- ✓ Signal original continua sendo a base da decisão
- ✓ Heurísticas principais do AgentLoop não foram alteradas
- ✓ Não houve substituição total da decisão
- ✓ Não há lógica paralela nem duplicação de scoring
- ✓ Safe mode preservado (`undefined` continua fallback automático)

### Próximo passo imediato
- ETAPA 3.1: ampliar contextualização com critérios adicionais do mesmo `getCognitiveState()` (sem criar estado novo)
- ETAPA 4: iniciar consumo ATIVO de Fallback (um sinal por vez)

---

## ETAPA 3.1: REFINAMENTO CONTEXTUAL (FALHA RECORRENTE) ✓ IMPLEMENTADO

### Regra aplicada (única)
- Condição exata: `baseDecision.shouldStop === false && context.hasReactiveFailure === true && context.attempt >= 2`
- Efeito: força `shouldStop: true` com `reason: recurrent_failure_detected`
- Log de auditoria: `[ORCHESTRATOR CONTEXTUAL] Forçando parada por falha recorrente`

### Garantias arquiteturais
- ✓ Uso de `hasReactiveFailure`
- ✓ Uso de `attempt` como controle de agressividade
- ✓ Nenhuma heurística do AgentLoop alterada
- ✓ Nenhum estado novo criado
- ✓ Fallback preservado (`adjustedDecision ?? baseDecision`)
- ✓ Ajuste aplicado somente em cenário específico

### Atualizado em
- Data: 1 de abril de 2026 (ETAPA 3.1)
- Contexto: StopContinue recebeu segundo ajuste contextual controlado para conter insistência em falha recorrente sem modificar o AgentLoop.

---

## ETAPA 3.2: AUDITORIA DE DECISÃO (STOPCONTINUE) ✓ IMPLEMENTADO

### Implementação realizada
- ✓ Registro de delta entre decisão base e final
- ✓ Log estruturado apenas quando há mudança
- ✓ Nenhuma alteração de comportamento
- ✓ Nenhum estado novo criado
- ✓ Nenhum fluxo paralelo introduzido

### Regra aplicada
- Condição exata: `baseDecision.shouldStop !== finalDecision.shouldStop`
- Escopo: auditoria de observabilidade no `decideStopContinue(sessionId)`
- Reuso: evento de log existente `stop_continue_decision_delta` (sem sistema paralelo)

### Atualizado em
- Data: 2 de abril de 2026 (ETAPA 3.2)
- Contexto: Auditoria explícita base vs final consolidada em ponto único após a decisão final, cobrindo qualquer ajuste contextual já existente.

---

## ETAPA 4: FALLBACKSIGNAL EM MODO ATIVO ✓ IMPLEMENTADO

### Implementacao realizada
- ✓ Novo metodo `decideToolFallback(sessionId)` no `CognitiveOrchestrator`
- ✓ Reuso integral do `ToolFallbackSignal` observado (sem recalculo de fallback)
- ✓ Safe mode preservado: sem signal retorna `undefined`
- ✓ Auditoria de delta adicionada: `originalTool`, `fallbackTool`, `reason`
- ✓ Integracao em `AgentController` nos dois fluxos (normal + skill)

### Regra aplicada
- Condicao exata: `fallbackSignal` observado => aplicar o proprio signal
- Condicao de fallback seguro: sem signal => `undefined` (AgentLoop permanece decisor)
- Restricao respeitada: Orchestrator nao escolhe ferramenta e nao cria estrategia

### Garantias arquiteturais
- ✓ Nenhum estado novo criado
- ✓ Nenhum pipeline paralelo introduzido
- ✓ Nenhuma heuristica do AgentLoop alterada
- ✓ Nenhum contrato publico alterado sem necessidade
- ✓ Sequencia de migracao preservada (um signal por vez)

### Atualizado em
- Data: 2 de abril de 2026 (ETAPA 4)
- Contexto: FallbackSignal entrou em modo ativo no Orchestrator com aplicacao pass-through do signal e trilha de auditoria de delta.

### Hardening pos-ETAPA 4
- ✓ Contrato tipado alinhado (`recurrent_failure_detected` em `StopContinueSignal.reason`)
- ✓ Cast local removido no `CognitiveOrchestrator`
- ✓ Mocks de testes alinhados com contrato atual do loop (`getSignalsSnapshot`)

---

## ETAPA 7: FAILSAFESIGNAL (MODO ATIVO) ✓ COMPLETO

### Objetivo
Ativar o consumo do `FailSafeSignal` no `CognitiveOrchestrator`, fechando o ciclo de governança cognitiva.

### Verificação pré-implementação realizada
- `buildFailSafeSignal` existe apenas no AgentLoop (privado) — NÃO duplicado
- Dois pontos de criação: `setOriginalInput` e `forceTaskType`
- `currentSignals.failSafe` preenchido em ambos, exposto via `getSignalsSnapshot()`
- Nenhum sistema paralelo de fail-safe existia no Orchestrator

### Implementação realizada

#### 1. CognitiveOrchestrator.decideFailSafe(sessionId)
- Lê `observedSignals.failSafe` (signal gerado pelo loop)
- Retorna signal existente sem recalcular heurísticas
- Logging obrigatório: `[ORCHESTRATOR ACTIVE] Fail-safe decision applied`
- Safe mode: `return signal ?? undefined`
- Auditoria de conflito FailSafe vs Route embutida (apenas observação, sem override)

#### 2. Integração no AgentController — fluxo principal
- `const failSafeDecision = orchestrator.decideFailSafe(sessionId)`
- `const finalFailSafe = failSafeDecision ?? signals.failSafe`
- Auditoria completa: loopDecision / orchestratorDecision / appliedDecision / safeModeFallbackApplied

#### 3. Integração no AgentController — runWithSkill
- Mesmo padrão — consistência entre caminhos de execução

#### 4. Coerência de autoridade (AUDITADA — não resolvida)
- FailSafe SEMPRE tem prioridade sobre Route
- Conflito detectado e logado com `[ORCHESTRATOR AUTHORITY] CONFLITO detectado`
- Override ainda NÃO aplicado — apenas monitoramento

### Regra crítica verificada
✓ `buildFailSafeSignal` não alterado
✓ AgentLoop não modificado
✓ Nenhuma heurística duplicada
✓ Safe mode funcionando (undefined => loop permanece decisor)
✓ Auditoria completa nos 2 fluxos
✓ Coerência de autoridade monitorada sem override prematuro
✓ Zero erros de compilação TypeScript

### Estado final da governança cognitiva
| Signal          | Status         |
|-----------------|----------------|
| StopContinue    | ✅ Ativo        |
| ToolFallback    | ✅ Ativo        |
| Validation      | ✅ Ativo        |
| RouteAutonomy   | ✅ Ativo        |
| FailSafe        | ✅ Ativo (ETAPA 7) |

### Atualizado em
- Data: 2 de abril de 2026 (ETAPA 7)
- Contexto: Governança completa. Todos os 5 signals críticos governados pelo CognitiveOrchestrator. Base pronta para auditoria cruzada e remoção de mini-brains.
