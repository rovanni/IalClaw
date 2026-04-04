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
