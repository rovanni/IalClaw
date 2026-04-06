# Mapa de Problemas do Sistema

Objetivo: concentrar no kanban o mapeamento completo dos problemas já diagnosticados no sistema, sem perder o vínculo com os documentos técnicos de origem.

Este arquivo é o índice operacional do quadro: cada componente aponta para os problemas conhecidos, para a origem técnica e para a coluna/prioridade em que o acompanhamento acontece.

## Fontes de verdade
- Diagnóstico bruto: docs/architecture/diagnostics/AntiPatterns.md
- Mapa arquitetural: docs/architecture/maps/CognitiveArchitectureMap.md
- Plano de correção estrutural: docs/architecture/plans/ProposedChanges.md
- Histórico técnico: docs/architecture/kanban/historico/checklist_vivo.md

## Radar de críticos (snapshot 2026-04-05)
- Persistem: KB-003
- Parcialmente mitigados: KB-001, KB-024
- Resolvidos: KB-002, KB-017, KB-020, KB-021, KB-022, KB-023, KB-027, KB-045
- Em monitoramento runtime (em andamento): KB-011, KB-012
- Em governanca estrutural (em andamento): KB-046


Observação:
- O padrão dominante atual e governaça parcial com fallback local (safe mode), especialmente em executor e loop.
- O critério de pronto dos críticos exige remoção da decisão local, não apenas encapsulamento ou consulta opcional ao Orchestrator.
- KB-020 resolvida em 3 fases (2026-04-04): Orchestrator agora é o único decisor no path de repair. Histórico: docs/architecture/kanban/historico/KB-020_NeutralizarRepairPipeline_2026-04-04.md
- KB-045 resolvida em 2026-04-04: início de flow agora é decidido no Orchestrator e executado pelo executor com persistência em `session.flow_state`. Histórico: docs/architecture/kanban/historico/KB-045_GovernancaInicioFlow_2026-04-04.md

## Mapeamento por componente

### src/capabilities
- Colunas e prioridades no quadro:
  - Crítico: KB-002
  - Concluído: KB-017
  - Médio: KB-004, KB-005
- Problemas mapeados:
  - stepCapabilities decide runtime sozinho
  - SkillManager decide instalação/autoremediação
  - CapabilityRegistry mantém estado paralelo
  - capabilityFallback decidia degradação fora do Orchestrator -> resolvido em KB-017
- Cards relacionados:
  - KB-002
  - KB-004
  - KB-005
  - KB-017

### src/config
- Colunas e prioridades no quadro:
  - Médio: KB-018
- Problemas mapeados:
  - languageConfig resolve precedência de idioma localmente
  - config.json mantém persistência lateral fora do SessionManager
- Cards relacionados:
  - KB-018

### src/core/agent
- Colunas e prioridades no quadro:
  - Médio: KB-019
- Problemas mapeados:
  - decisionGate decide execute/confirm/pass
  - TaskClassifier decide needsContext/contextQuestion
  - PendingActionTracker duplica intenção/confirmação
- Cards relacionados:
  - KB-019

### src/core/executor
- Colunas e prioridades no quadro:
  - Crítico: KB-001
  - Concluído: KB-020
- Problemas mapeados:
  - AgentExecutor mantém loop de self-healing/replan
  - repairPipeline decide correções estruturais localmente → resolvido em KB-020
  - executor mantém acesso cognitivo indevido ao LLM
- Cards relacionados:
  - KB-001
  - KB-020

### src/core/orchestrator
- Colunas e prioridades no quadro:
  - Medio: KB-046
- Problemas mapeados:
  - modularizacao do `CognitiveOrchestrator` sem plano formal quebrava o gate documental do template
  - `CapabilityAwarePlan` e `PlanningStrategyContext` estavam duplicados entre o Orchestrator e o modulo de decisao de planning
  - mitigacao em andamento: contratos compartilhados centralizados em `src/core/orchestrator/types/PlanningTypes.ts`, `src/core/orchestrator/types/CapabilityFallbackTypes.ts`, `src/core/orchestrator/types/RetryAfterFailureTypes.ts`, `src/core/orchestrator/types/ActiveDecisionsTypes.ts`, `src/core/orchestrator/types/IngestSignalsTypes.ts`, `src/core/orchestrator/types/SignalConflictTypes.ts`, `src/core/orchestrator/types/StopContinueGovernanceTypes.ts` e `src/core/orchestrator/types/ObservedSignalLogTypes.ts`
  - detector factual de conflitos de `auditSignalConsistency(...)` extraido para helper puro, mantendo no Orchestrator a emissao de auditoria e o controle do ciclo
  - payloads observacionais de `applyStopContinueGovernance(...)` extraidos para helpers puros, mantendo no Orchestrator a governanca contextual e a autoridade final
  - logs observacionais de `ingestSignalsFromLoop(...)` extraidos para builder puro, reduzindo verbosidade inline sem mover ingestao nem autoridade
- Cards relacionados:
  - KB-046

### src/core/flow
- Colunas e prioridades no quadro:
  - Concluído: KB-021, KB-045
- Problemas mapeados:
  - FlowManager mantém estado isolado fora do SessionManager → resolvido em KB-021
  - startFlow() desconectado do runtime → resolvido em KB-045
- Cards relacionados:
  - KB-021
  - KB-045

### src/core (AgentController / AgentRuntime)
- Colunas e prioridades no quadro:
  - Concluído: KB-022
- Problemas mapeados:
  - Split-brain neutralizado: AgentRuntime não instancia orquestrador próprio
  - Controller agora usa extrações de contexto/prompt e consolidação de decisões ativas no Orchestrator
- Cards relacionados:
  - KB-022

### src/engine
- Colunas e prioridades no quadro:
  - Crítico: KB-003
  - Concluído: KB-023
- Problemas mapeados:
  - AgentLoop ainda atua como mini-brain tático
  - fallback/reclassify/retry locais → mitigado em KB-023
  - guard de explicabilidade ainda local
- Cards relacionados:
  - KB-003
  - KB-023

### src/memory
- Colunas e prioridades no quadro:
  - Crítico: KB-024
- Problemas mapeados:
  - estado de execution memory no AgentLoop foi migrado para SessionManager por sessao
  - selecao de tool permanece em decisao local no AgentLoop, com ToolSelectionSignal observacional no Orchestrator
  - safe mode obrigatorio mantido: `orchestratorDecision ?? loopDecision`
  - pendente extracao facts-first para remover decisao local residual antes de fechamento
- Cards relacionados:
  - KB-024

### src/schemas
- Colunas e prioridades no quadro:
  - Médio: KB-025
- Problemas mapeados:
  - validaÃ§Ã£o manual extensa e difÃ­cil de manter
- Cards relacionados:
  - KB-025

### src/scripts
- Colunas e prioridades no quadro:
  - Médio: KB-026
- Problemas mapeados:
  - bootstrap com roteamento/identidade hardcoded
- Cards relacionados:
  - KB-026

### src/search
- Colunas e prioridades no quadro:
  - Concluído: KB-027
- Problemas mapeados:
  - pipeline de busca com decisão semântica própria → mitigado com governança por signals e Safe Mode no Orchestrator
  - múltiplos caches/índices fora da sessão → resolvido com `search_cache` por sessão
- Cards relacionados:
  - KB-027

### src/services
- Colunas e prioridades no quadro:
  - Médio: KB-028
- Problemas mapeados:
  - onboarding e estado local isolado
  - WorkspaceService decide reutilização/abertura
- Cards relacionados:
  - KB-028

### src/shared
- Colunas e prioridades no quadro:
  - Médio: KB-029
- Problemas mapeados:
  - SessionManager ainda contém fragmentos decisórios
  - dependências cíclicas com core
  - TraceRecorder com filtragem hardcoded
- Cards relacionados:
  - KB-029

### src/skills
- Colunas e prioridades no quadro:
  - Médio: KB-030
- Problemas mapeados:
  - SkillResolver como mini-brain
  - pendingSkillList fora do CognitiveState
  - regex de intenção duplicada
- Cards relacionados:
  - KB-030

### src/telegram
- Colunas e prioridades no quadro:
  - Médio: KB-031
- Problemas mapeados:
  - onboarding, permissão e anexos decididos no canal
  - sanitização de saída fora do Orchestrator
- Cards relacionados:
  - KB-031

### src/tools
- Colunas e prioridades no quadro:
  - Médio: KB-032
- Problemas mapeados:
  - pesos e validações hardcoded nas tools
  - detecção de anomalia e runtime ainda local
- Cards relacionados:
  - KB-032

### src/utils
- Colunas e prioridades no quadro:
  - Médio: KB-033
- Problemas mapeados:
  - caches voláteis e decisões tÃ¡ticas de infra/input
- Cards relacionados:
  - KB-033

### src/dashboard
- Colunas e prioridades no quadro:
  - Médio: KB-034
- Problemas mapeados:
  - dashboard atua como orquestrador secundário do canal web
  - cancelamento, onboarding, confiança e configuração fora do cérebro central
- Cards relacionados:
  - KB-034

### src/db e src/i18n
- Colunas e prioridades no quadro:
  - Médio: KB-035
- Problemas mapeados:
  - idioma fragmentado
  - inicialização sistêmica procedural e acoplada
- Cards relacionados:
  - KB-035

### Rastreamento transversal (checklist e governanca documental)
- Colunas e prioridades no quadro:
  - Medio: KB-006, KB-007, KB-008
  - Baixo: KB-009, KB-010, KB-036
- Problemas mapeados:
  - cobertura incompleta do builder deterministico para dominios operacionais remanescentes
  - ausencia de suite dedicada para bordas do guardrail de arquivo
  - falta de nota arquitetural consolidando o papel do classificador
  - observabilidade ainda sem indexacao padrao de eventos de auditoria
  - linguagem e terminologia da documentacao sem revisao completa e uniforme
  - pequenas duplicacoes de intencao/confirmacao ainda dispersas
- Cards relacionados:
  - KB-006
  - KB-007
  - KB-008
  - KB-009
  - KB-010
  - KB-036

### docs/architecture/templates
- Colunas e prioridades no quadro:
  - Médio: KB-037
- Problemas mapeados:
  - falta padrao unico para mapear modularizacao de arquivos grandes sem perder o principio Single Brain
  - analises ad hoc podem deslocar decisao para modulos auxiliares por ausencia de checklist de integridade
- Cards relacionados:
  - KB-037


### Programa de execução derivado do KB-037 (modularização segura)
- Ordem recomendada de implementação:
  - 1) KB-038 - AgentLoop (StepResultValidator)
  - 2) KB-039 - AgentLoop (ToolFallbackAdvisor)
  - 3) KB-040 - AgentLoop (PlanLoopController + AnswerGroundingGuard)
  - 4) KB-041 - AgentExecutor (runner/healing/repair/trace)
  - 5) KB-042 - AgentController (handlers/coordinators)
  - 6) KB-043 - SkillRegistry (tools por dominio + politicas)
  - 7) KB-044 - TaskClassifier (classification/planning split)
- Restrições obrigatórias:
  - sem mover decisao final para fora do Orchestrator
  - sem novas heuristicas locais de estrategia
  - sem reescrita total; apenas extracao incremental por contrato
- Evidencia base:
  - docs/architecture/kanban/historico/KB-037_Mapeamento_Modularizacao_Arquivos_Grandes_2026-04-04.md
### Rastreabilidade por componente (fases KB-038..KB-044)
- src/engine/AgentLoop.ts: KB-038, KB-039, KB-040
- src/core/executor/AgentExecutor.ts: KB-041
- src/core/AgentController.ts: KB-042
- src/engine/SkillRegistry.ts: KB-043
- src/core/agent/TaskClassifier.ts: KB-044


## Cards já resolvidos neste ciclo
- KB-013
- KB-014
- KB-015
- KB-016

## Regra operacional
- Novo problema encontrado deve ser registrado primeiro aqui e depois convertido em card na coluna apropriada.
- Se um problema já existir em documento técnico, o kanban deve referenciar a origem em vez de duplicar análise longa.
- A leitura primária do quadro deve começar por este arquivo; os arquivos de coluna detalham execução e acompanhamento.






