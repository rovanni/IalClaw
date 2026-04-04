# Checklist Vivo

Este arquivo foi reorganizado para reduzir a poluição da raiz de docs/architecture.

Local atual:
- docs/architecture/kanban/historico/checklist_vivo.md

Quadro operacional:
- docs/architecture/kanban/README.md

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
