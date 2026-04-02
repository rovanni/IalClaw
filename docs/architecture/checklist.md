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

## O que esta em andamento
- Implementar consumo PASSIVO de signals no CognitiveOrchestrator (uma signal por vez)
- Manter AgentLoop decidindo normalmente (sem mudança de comportamento)
- Registrar/auditoria todos os signals consumidos pelo Orchestrator
- Preparar sequência de migração (StopContinue → Fallback → Validation → Route → FailSafe)
- Consolidar governança contextual do StopContinue em modo controlado (ETAPA 3.x), mantendo ajuste mínimo e reversível.

## O que ainda falta
- **Fase Ativa - StopContinue**: Fazer o CognitiveOrchestrator DECIDIR sobre shouldStop (ler o signal, não o AgentLoop)
- Consumo PASSIVO para Fallback, Validation, Route (na sequência)
- Migrar cada sinal uma por vez para modo ativo
- Remover loops de decisão residuais do AgentLoop (gradualmente)
- Unificar estado cognitivo no SessionManager para suportar decisões centralizadas
- Garantir trilha de auditoria ponta a ponta para todas as decisões cognitivas
- Testes de regressão pós-migração de cada signal
- ETAPA 4: iniciar modo ativo de FallbackSignal com o mesmo padrão de safe mode (um sinal por vez)

## O que NAO deve ser tocado agora
- ~~Não mover decisões para o Orchestrator nesta etapa.~~ **[MUDOU]** Estamos movendo UMA SINAL para modo passivo: StopContinue
- Nao mover MÚLTIPLAS decisoes simultaneamente—uma por vez apenas
- Nao unificar estado no SessionManager nesta etapa.
- Nao remover loops de decisao no AgentLoop nesta etapa.
- Nao alterar heuristicas existentes.
- Nao remover branches existentes.
- Nao introduzir fluxos paralelos ou logica duplicada.
- Nao deixar o AgentLoop decidir E o Orchestrator decidir sobre a mesma coisa (regra de ouro: um decisor por signal)
- Nao adicionar múltiplas regras contextuais de uma vez no StopContinue; manter apenas uma regra nova por etapa.

## Regra operacional obrigatoria (a partir de agora)
Toda correcao deve atualizar este checklist vivo com:
1. O que ja foi corrigido
2. O que esta em andamento
3. O que ainda falta
4. O que NAO deve ser tocado agora

## Atualizado em
- Data: 1 de abril de 2026
- Contexto: Agregacao de signals concluida (CognitiveSignalsState). Todos os 8 signals sao registrados automaticamente em currentSignals via getSignalsSnapshot(). Proximo passo: mover primeira decisao real para CognitiveOrchestrator.

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
