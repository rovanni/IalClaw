# Pendente - Critica

Data da validacao: 2026-04-04

Legenda de status:
- Persiste: problema continua ativo sem mitigacao relevante.
- Parcialmente mitigado: houve avancos, mas criterio de pronto ainda nao foi atendido.
- Resolvido: criterio de pronto atendido e sem regressao observada.

- [ ] KB-001 - Externalizar loop de healing do AgentExecutor para estrategia do Orchestrator
  - Origem: ProposedChanges (src/core/executor)
  - Risco: Critico
  - Status atual: Parcialmente mitigado
  - Evidencia curta: governanca de retry existe, mas ainda com fallback decisorio local no executor.
  - Criterio de pronto: executor executa passo atomico e retorna erro bruto; retry/replan decidido no Orchestrator

- [ ] KB-002 - Refatorar stepCapabilities para Pure Signals (sem decisao)
  - Origem: ProposedChanges (fase 2)
  - Risco: Critico
  - Status atual: Persiste
  - Evidencia curta: resolveRuntimeModeForPlan ainda decide skip/runtime localmente.
  - Criterio de pronto: stepCapabilities retorna fatos; decisoes de skip/runtime ficam no Orchestrator

- [ ] KB-017 - Externalizar capabilityFallback para signal puro
  - Origem: AntiPatterns + CognitiveArchitectureMap (src/capabilities)
  - Risco: Critico
  - Status atual: Parcialmente mitigado
  - Evidencia curta: fallback centralizado no modulo, mas ainda retorna mode/strategy (decisao embutida).
  - Criterio de pronto: fallback de capacidade retorna fatos/metadados; decisao fica no Orchestrator

- [ ] KB-020 - Neutralizar repairPipeline como mini-brain estrutural
  - Origem: AntiPatterns + ProposedChanges (src/core/executor)
  - Risco: Critico
  - Status atual: Parcialmente mitigado
  - Evidencia curta: repair e replan de input continuam no executor, apesar de sinais para o Orchestrator.
  - Criterio de pronto: remediação estrutural deixa de decidir localmente e passa a ser estratégia do Orchestrator/planner

- [ ] KB-021 - Sincronizar FlowManager com SessionManager
  - Origem: AntiPatterns + ProposedChanges (src/core/flow)
  - Risco: Critico
  - Status atual: Parcialmente mitigado
  - Evidencia curta: SessionManager possui flow_state, mas FlowManager ainda guarda estado interno paralelo.
  - Criterio de pronto: fluxo guiado persistido e visível no CognitiveState

- [ ] KB-022 - Remover split-brain de AgentController e AgentRuntime
  - Origem: AntiPatterns + ProposedChanges (src/core)
  - Risco: Critico
  - Status atual: Parcialmente mitigado
  - Evidencia curta: ambos ainda inicializam/operam com orquestracao propria em caminhos paralelos.
  - Criterio de pronto: controller vira gateway e runtime deixa de competir com o Orchestrator

- [ ] KB-023 - Externalizar heurísticas táticas remanescentes do AgentLoop
  - Origem: AntiPatterns (src/engine)
  - Risco: Critico
  - Status atual: Parcialmente mitigado
  - Evidencia curta: parte dos sinais foi integrada, mas heuristicas de trust/reality-check/delta ainda ficam no loop.
  - Criterio de pronto: trust/reality-check, fallback tático e decisões residuais deixam de ser cérebro local

- [ ] KB-024 - Centralizar ranking e estado de memória no SessionManager
  - Origem: AntiPatterns + ProposedChanges (src/memory)
  - Risco: Critico
  - Status atual: Parcialmente mitigado
  - Evidencia curta: SessionManager centraliza parte do estado, mas ranking e executionMemory seguem locais no AgentLoop.
  - Criterio de pronto: sem ranking/merge decisório local e sem caches paralelos invisíveis à sessão

- [ ] KB-027 - Neutralizar Search como subsistema decisório isolado
  - Origem: AntiPatterns + ProposedChanges (src/search)
  - Risco: Critico
  - Status atual: Persiste
  - Evidencia curta: search segue com scoring, boosts e caches proprios fora da governanca central.
  - Criterio de pronto: busca devolve sinais/metadados; estratégia e fallback ficam no Orchestrator
