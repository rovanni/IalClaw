# Pendente - Média

- [ ] KB-004 - Mover estado de capabilities para CognitiveState no SessionManager
  - Origem: ProposedChanges (fase 1)
  - Risco: Médio
  - Critério de pronto: sem Map interno em CapabilityRegistry

- [ ] KB-005 - SkillManager como executor puro (check/install)
  - Origem: ProposedChanges (fase 3)
  - Risco: Médio
  - Critério de pronto: sem SkillPolicy/ensure com decisao autonoma

- [ ] KB-006 - Expandir buildExecutionPlan para domínios operacionais restantes
  - Origem: checklist (o que ainda falta)
  - Risco: Médio
  - Critério de pronto: cobertura para file_search, file_conversion, system_operation, skill_installation

- [ ] KB-007 - Cobrir com testes os limites do guardrail de arquivo
  - Origem: checklist (o que ainda falta)
  - Risco: Médio
  - Critério de pronto: cenarios de borda validados em suite automatizada

- [ ] KB-008 - Publicar nota de arquitetura sobre papel do classificador
  - Origem: checklist (o que ainda falta)
  - Risco: Médio
  - Critério de pronto: documento em docs/architecture sem ambiguidade de autoridade

- [ ] KB-018 - Centralizar resolução e persistência de idioma
  - Origem: AntiPatterns + ProposedChanges (src/config)
  - Risco: Médio
  - Critério de pronto: idioma resolvido pelo cérebro central e sem persistência lateral crítica fora do SessionManager

- [ ] KB-019 - Remover decisionGate e tornar TaskClassifier pure signal
  - Origem: AntiPatterns + ProposedChanges (src/core/agent)
  - Risco: Médio
  - Critério de pronto: thresholds e confirmação ficam no Orchestrator; classificador só informa sinais

- [ ] KB-025 - Migrar schemas manuais para esquema tipado robusto
  - Origem: ProposedChanges (src/schemas)
  - Risco: Médio
  - Critério de pronto: contratos críticos validados por esquema tipado centralizado

- [ ] KB-026 - Centralizar definições de identidade e roteamento de bootstrap
  - Origem: ProposedChanges + AntiPatterns (src/scripts)
  - Risco: Médio
  - Critério de pronto: scripts deixam de embutir roteamento e prioridade cognitiva

- [ ] KB-028 - Unificar onboarding e estado dos services no cérebro central
  - Origem: ProposedChanges (src/services)
  - Risco: Médio
  - Critério de pronto: onboarding e reutilização de projeto deixam de ser decididos em serviÃ§os locais

- [ ] KB-029 - Reduzir decisões e acoplamentos em shared
  - Origem: ProposedChanges + CognitiveArchitectureMap (src/shared)
  - Risco: Médio
  - Critério de pronto: SessionManager sem mini-brain residual e TraceRecorder menos rígido

- [ ] KB-030 - Transformar resolução de skills em signal e mover estado pendente
  - Origem: ProposedChanges (src/skills)
  - Risco: Médio
  - Critério de pronto: SkillResolver não decide e pendingSkillList vive no CognitiveState

- [ ] KB-031 - Tornar telegram input/output puramente reativos
  - Origem: ProposedChanges (src/telegram)
  - Risco: Médio
  - Critério de pronto: onboarding, anexos e sanitização deixam de ser decididos no canal

- [ ] KB-032 - Parametrizar decisões embutidas nas tools
  - Origem: ProposedChanges (src/tools)
  - Risco: Médio
  - Critério de pronto: pesos, rigor e suspeitas deixam de ser hardcoded nas tools

- [ ] KB-033 - Externalizar decisões táticas e caches locais de utils
  - Origem: ProposedChanges (src/utils)
  - Risco: Médio
  - Critério de pronto: messageDedup, ollamaCheck e input repair deixam de decidir sozinhos

- [ ] KB-034 - Neutralizar dashboard como orquestrador secundário
  - Origem: ProposedChanges (src/dashboard)
  - Risco: Médio
  - Critério de pronto: dashboard apenas encaminha/comanda; estado e estratégia ficam centralizados

- [ ] KB-035 - Centralizar idioma e startup sistêmico em db/i18n
  - Origem: ProposedChanges (src/db e src/i18n)
  - Risco: Médio
  - Critério de pronto: idioma e ciclo de vida do sistema deixam de ficar fragmentados


- [ ] KB-038 - Fase A (derivada de KB-037): Extrair StepResultValidator do AgentLoop sem mudar comportamento
  - Origem: KB-037 (mapeamento de modularização)
  - Risco: Médio
  - dependência: nenhuma
  - Ordem sugerida: 1
  - Critério de pronto: validacao de step isolada em modulo dedicado, mantendo contratos de sinal e decisao final no Orchestrator

- [ ] KB-039 - Fase B (derivada de KB-037): Extrair ToolFallbackAdvisor do AgentLoop como recomendador puro
  - Origem: KB-037 (mapeamento de modularização)
  - Risco: Médio
  - dependência: KB-038
  - Ordem sugerida: 2
  - Critério de pronto: fallback de tool devolve somente sinais/recomendacoes, sem decisao final autonoma

- [ ] KB-040 - Fase C (derivada de KB-037): Extrair PlanLoopController e AnswerGroundingGuard do AgentLoop
  - Origem: KB-037 (mapeamento de modularização)
  - Risco: Médio
  - dependência: KB-039
  - Ordem sugerida: 3
  - Critério de pronto: controle de passo e guard de grounding separados, com fluxo deterministico preservado

- [ ] KB-041 - Fase D (derivada de KB-037): Modularizar AgentExecutor em runner/healing/repair/trace
  - Origem: KB-037 (mapeamento de modularização)
  - Risco: Médio
  - dependência: KB-040
  - Ordem sugerida: 4
  - Critério de pronto: executor reduzido a coordenacao tecnica, com retry/recovery governados por sinais do Orchestrator

- [ ] KB-042 - Fase E (derivada de KB-037): Modularizar AgentController em handlers e coordinators
  - Origem: KB-037 (mapeamento de modularização)
  - Risco: Médio
  - dependência: KB-041
  - Ordem sugerida: 5
  - Critério de pronto: controller atua como gateway; estrategia cognitiva permanece centralizada no Orchestrator

- [ ] KB-043 - Fase F (derivada de KB-037): Modularizar SkillRegistry por grupos de tools e politicas de seguranca
  - Origem: KB-037 (mapeamento de modularização)
  - Risco: Médio
  - dependência: KB-042
  - Ordem sugerida: 6
  - Critério de pronto: registro de tools desacoplado por dominio, sem mudanca de contratos e sem heuristica decisoria

- [ ] KB-044 - Fase G (derivada de KB-037): Separar TaskClassifier e planner deterministico em modulos dedicados
  - Origem: KB-037 (mapeamento de modularização)
  - Risco: Médio
  - dependência: KB-043
  - Ordem sugerida: 7
  - Critério de pronto: classificador retorna sinais puros e builder deterministico fica isolado, sem virar estrategia autonoma
