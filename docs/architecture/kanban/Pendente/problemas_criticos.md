# Pendente - Crítica

Data da validação: 2026-04-04

Legenda de status:
- Persiste: problema continua ativo sem mitigação relevante.
- Parcialmente mitigado: houve avanços, mas critério de pronto ainda não foi atendido.
- Resolvido: critério de pronto atendido e sem regressão observada.

- [ ] KB-017 - Externalizar capabilityFallback para signal puro
  - Origem: AntiPatterns + CognitiveArchitectureMap (src/capabilities)
  - Risco: Crítico
  - Status atual: Parcialmente mitigado
  - Evidência curta: fallback centralizado no modulo, mas ainda retorna mode/strategy (decisão embutida).
  - Criterio de pronto: fallback de capacidade retorna fatos/metadados; decisão fica no Orchestrator



