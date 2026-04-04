# Pendente - Media

- [ ] KB-004 - Mover estado de capabilities para CognitiveState no SessionManager
  - Origem: ProposedChanges (fase 1)
  - Risco: Medio
  - Criterio de pronto: sem Map interno em CapabilityRegistry

- [ ] KB-005 - SkillManager como executor puro (check/install)
  - Origem: ProposedChanges (fase 3)
  - Risco: Medio
  - Criterio de pronto: sem SkillPolicy/ensure com decisao autonoma

- [ ] KB-006 - Expandir buildExecutionPlan para dominos operacionais restantes
  - Origem: checklist (o que ainda falta)
  - Risco: Medio
  - Criterio de pronto: cobertura para file_search, file_conversion, system_operation, skill_installation

- [ ] KB-007 - Cobrir com testes os limites do guardrail de arquivo
  - Origem: checklist (o que ainda falta)
  - Risco: Medio
  - Criterio de pronto: cenarios de borda validados em suite automatizada

- [ ] KB-008 - Publicar nota de arquitetura sobre papel do classificador
  - Origem: checklist (o que ainda falta)
  - Risco: Medio
  - Criterio de pronto: documento em docs/architecture sem ambiguidade de autoridade

- [ ] KB-018 - Centralizar resoluÃ§Ã£o e persistÃªncia de idioma
  - Origem: AntiPatterns + ProposedChanges (src/config)
  - Risco: Medio
  - Criterio de pronto: idioma resolvido pelo cÃ©rebro central e sem persistÃªncia lateral crÃ­tica fora do SessionManager

- [ ] KB-019 - Remover decisionGate e tornar TaskClassifier pure signal
  - Origem: AntiPatterns + ProposedChanges (src/core/agent)
  - Risco: Medio
  - Criterio de pronto: thresholds e confirmaÃ§Ã£o ficam no Orchestrator; classificador sÃ³ informa sinais

- [ ] KB-025 - Migrar schemas manuais para esquema tipado robusto
  - Origem: ProposedChanges (src/schemas)
  - Risco: Medio
  - Criterio de pronto: contratos crÃ­ticos validados por esquema tipado centralizado

- [ ] KB-026 - Centralizar definiÃ§Ãµes de identidade e roteamento de bootstrap
  - Origem: ProposedChanges + AntiPatterns (src/scripts)
  - Risco: Medio
  - Criterio de pronto: scripts deixam de embutir roteamento e prioridade cognitiva

- [ ] KB-028 - Unificar onboarding e estado dos services no cÃ©rebro central
  - Origem: ProposedChanges (src/services)
  - Risco: Medio
  - Criterio de pronto: onboarding e reutilizaÃ§Ã£o de projeto deixam de ser decididos em serviÃ§os locais

- [ ] KB-029 - Reduzir decisÃµes e acoplamentos em shared
  - Origem: ProposedChanges + CognitiveArchitectureMap (src/shared)
  - Risco: Medio
  - Criterio de pronto: SessionManager sem mini-brain residual e TraceRecorder menos rÃ­gido

- [ ] KB-030 - Transformar resoluÃ§Ã£o de skills em signal e mover estado pendente
  - Origem: ProposedChanges (src/skills)
  - Risco: Medio
  - Criterio de pronto: SkillResolver nÃ£o decide e pendingSkillList vive no CognitiveState

- [ ] KB-031 - Tornar telegram input/output puramente reativos
  - Origem: ProposedChanges (src/telegram)
  - Risco: Medio
  - Criterio de pronto: onboarding, anexos e sanitizaÃ§Ã£o deixam de ser decididos no canal

- [ ] KB-032 - Parametrizar decisÃµes embutidas nas tools
  - Origem: ProposedChanges (src/tools)
  - Risco: Medio
  - Criterio de pronto: pesos, rigor e suspeitas deixam de ser hardcoded nas tools

- [ ] KB-033 - Externalizar decisÃµes tÃ¡ticas e caches locais de utils
  - Origem: ProposedChanges (src/utils)
  - Risco: Medio
  - Criterio de pronto: messageDedup, ollamaCheck e input repair deixam de decidir sozinhos

- [ ] KB-034 - Neutralizar dashboard como orquestrador secundÃ¡rio
  - Origem: ProposedChanges (src/dashboard)
  - Risco: Medio
  - Criterio de pronto: dashboard apenas encaminha/comanda; estado e estratÃ©gia ficam centralizados

- [ ] KB-035 - Centralizar idioma e startup sistÃªmico em db/i18n
  - Origem: ProposedChanges (src/db e src/i18n)
  - Risco: Medio
  - Criterio de pronto: idioma e ciclo de vida do sistema deixam de ficar fragmentados


- [ ] KB-038 - Fase A (derivada de KB-037): Extrair StepResultValidator do AgentLoop sem mudar comportamento
  - Origem: KB-037 (mapeamento de modularizacao)
  - Risco: Medio
  - Dependencia: nenhuma
  - Ordem sugerida: 1
  - Criterio de pronto: validacao de step isolada em modulo dedicado, mantendo contratos de sinal e decisao final no Orchestrator

- [ ] KB-039 - Fase B (derivada de KB-037): Extrair ToolFallbackAdvisor do AgentLoop como recomendador puro
  - Origem: KB-037 (mapeamento de modularizacao)
  - Risco: Medio
  - Dependencia: KB-038
  - Ordem sugerida: 2
  - Criterio de pronto: fallback de tool devolve somente sinais/recomendacoes, sem decisao final autonoma

- [ ] KB-040 - Fase C (derivada de KB-037): Extrair PlanLoopController e AnswerGroundingGuard do AgentLoop
  - Origem: KB-037 (mapeamento de modularizacao)
  - Risco: Medio
  - Dependencia: KB-039
  - Ordem sugerida: 3
  - Criterio de pronto: controle de passo e guard de grounding separados, com fluxo deterministico preservado

- [ ] KB-041 - Fase D (derivada de KB-037): Modularizar AgentExecutor em runner/healing/repair/trace
  - Origem: KB-037 (mapeamento de modularizacao)
  - Risco: Medio
  - Dependencia: KB-040
  - Ordem sugerida: 4
  - Criterio de pronto: executor reduzido a coordenacao tecnica, com retry/recovery governados por sinais do Orchestrator

- [ ] KB-042 - Fase E (derivada de KB-037): Modularizar AgentController em handlers e coordinators
  - Origem: KB-037 (mapeamento de modularizacao)
  - Risco: Medio
  - Dependencia: KB-041
  - Ordem sugerida: 5
  - Criterio de pronto: controller atua como gateway; estrategia cognitiva permanece centralizada no Orchestrator

- [ ] KB-043 - Fase F (derivada de KB-037): Modularizar SkillRegistry por grupos de tools e politicas de seguranca
  - Origem: KB-037 (mapeamento de modularizacao)
  - Risco: Medio
  - Dependencia: KB-042
  - Ordem sugerida: 6
  - Criterio de pronto: registro de tools desacoplado por dominio, sem mudanca de contratos e sem heuristica decisoria

- [ ] KB-044 - Fase G (derivada de KB-037): Separar TaskClassifier e planner deterministico em modulos dedicados
  - Origem: KB-037 (mapeamento de modularizacao)
  - Risco: Medio
  - Dependencia: KB-043
  - Ordem sugerida: 7
  - Criterio de pronto: classificador retorna sinais puros e builder deterministico fica isolado, sem virar estrategia autonoma
