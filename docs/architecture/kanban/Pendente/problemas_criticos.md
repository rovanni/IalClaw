# Pendente - Crítica

Data da validação: 2026-04-04

Legenda de status:
- Persiste: problema continua ativo sem mitigação relevante.
- Parcialmente mitigado: houve avanços, mas critério de pronto ainda não foi atendido.
- Resolvido: critério de pronto atendido e sem regressão observada.

- [ ] KB-001 - Externalizar loop de healing do AgentExecutor para estratégia do Orchestrator
  - Origem: ProposedChanges (src/core/executor)
  - Risco: Crítico
  - Status atual: Parcialmente mitigado
  - Evidência curta: governança de retry existe, mas ainda com fallback decisório local no executor.
  - Criterio de pronto: executor executa passo atômico e retorna erro bruto; retry/replan decidido no Orchestrator

- [ ] KB-017 - Externalizar capabilityFallback para signal puro
  - Origem: AntiPatterns + CognitiveArchitectureMap (src/capabilities)
  - Risco: Crítico
  - Status atual: Parcialmente mitigado
  - Evidência curta: fallback centralizado no modulo, mas ainda retorna mode/strategy (decisão embutida).
  - Criterio de pronto: fallback de capacidade retorna fatos/metadados; decisão fica no Orchestrator

- [ ] KB-020 - Neutralizar repairPipeline como mini-brain estrutural
  - Origem: AntiPatterns + ProposedChanges (src/core/executor)
  - Risco: Crítico
  - Status atual: Parcialmente mitigado
  - Evidência curta: repair e replan de input continuam no executor, apesar de sinais para o Orchestrator.
  - Criterio de pronto: remediação estrutural deixa de decidir localmente e passa a ser estratégia do Orchestrator/planner

- [ ] KB-021 - Sincronizar FlowManager com SessionManager
  - Origem: AntiPatterns + ProposedChanges (src/core/flow)
  - Risco: Crítico
  - Status atual: Parcialmente mitigado
  - Evidência curta: SessionManager possui flow_state, mas FlowManager ainda guarda estado interno paralelo.
  - Criterio de pronto: fluxo guiado persistido e visível no CognitiveState

- [ ] KB-023 - Externalizar heurísticas táticas remanescentes do AgentLoop
  - Origem: AntiPatterns (src/engine)
  - Risco: Crítico
  - Status atual: Parcialmente mitigado
  - Evidência curta: parte dos sinais foi integrada, mas heuristicas de trust/reality-check/delta ainda ficam no loop.
  - Criterio de pronto: trust/reality-check, fallback tático e decisões residuais deixam de ser cérebro local

- [ ] KB-024 - Centralizar ranking e estado de memória no SessionManager
  - Origem: AntiPatterns + ProposedChanges (src/memory)
  - Risco: Crítico
  - Status atual: Parcialmente mitigado
  - Evidência curta: SessionManager centraliza parte do estado, mas ranking e executionMemory seguem locais no AgentLoop.
  - Criterio de pronto: sem ranking/merge decisório local e sem caches paralelos invisíveis à sessão

- [ ] KB-027 - Neutralizar Search como subsistema decisório isolado
  - Origem: AntiPatterns + ProposedChanges (src/search)
  - Risco: Crítico
  - Status atual: Persiste
  - Evidência curta: search segue com scoring, boosts e caches proprios fora da governança central.
  - Criterio de pronto: busca devolve sinais/metadados; estratégia e fallback ficam no Orchestrator
