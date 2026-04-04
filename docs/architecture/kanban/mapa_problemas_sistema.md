# Mapa de Problemas do Sistema

Objetivo: concentrar no kanban o mapeamento completo dos problemas jÃ¡ diagnosticados no sistema, sem perder o vÃ­nculo com os documentos tÃ©cnicos de origem.

Este arquivo Ã© o Ã­ndice operacional do quadro: cada componente aponta para os problemas conhecidos, para a origem tÃ©cnica e para a coluna/prioridade em que o acompanhamento acontece.

## Fontes de verdade
- DiagnÃ³stico bruto: docs/architecture/diagnostics/AntiPatterns.md
- Mapa arquitetural: docs/architecture/maps/CognitiveArchitectureMap.md
- Plano de correÃ§Ã£o estrutural: docs/architecture/plans/ProposedChanges.md
- HistÃ³rico tÃ©cnico: docs/architecture/kanban/historico/checklist_vivo.md

## Radar de criticos (snapshot 2026-04-04)
- Persistem: KB-002, KB-003, KB-027
- Parcialmente mitigados: KB-001, KB-017, KB-020, KB-021, KB-022, KB-023, KB-024
- Resolvidos: nenhum

Observacao:
- O padrao dominante atual e governanca parcial com fallback local (safe mode), especialmente em executor e loop.
- O criterio de pronto dos criticos exige remocao da decisao local, nao apenas encapsulamento ou consulta opcional ao Orchestrator.

## Mapeamento por componente

### src/capabilities
- Colunas e prioridades no quadro:
  - CrÃ­tico: KB-002, KB-017
  - MÃ©dio: KB-004, KB-005
- Problemas mapeados:
  - stepCapabilities decide runtime sozinho
  - SkillManager decide instalaÃ§Ã£o/autoremediaÃ§Ã£o
  - CapabilityRegistry mantÃ©m estado paralelo
  - capabilityFallback decide degradaÃ§Ã£o fora do Orchestrator
- Cards relacionados:
  - KB-002
  - KB-004
  - KB-005
  - KB-017

### src/config
- Colunas e prioridades no quadro:
  - MÃ©dio: KB-018
- Problemas mapeados:
  - languageConfig resolve precedÃªncia de idioma localmente
  - config.json mantÃ©m persistÃªncia lateral fora do SessionManager
- Cards relacionados:
  - KB-018

### src/core/agent
- Colunas e prioridades no quadro:
  - MÃ©dio: KB-019
- Problemas mapeados:
  - decisionGate decide execute/confirm/pass
  - TaskClassifier decide needsContext/contextQuestion
  - PendingActionTracker duplica intenÃ§Ã£o/confirmaÃ§Ã£o
- Cards relacionados:
  - KB-019

### src/core/executor
- Colunas e prioridades no quadro:
  - CrÃ­tico: KB-001, KB-020
- Problemas mapeados:
  - AgentExecutor mantÃ©m loop de self-healing/replan
  - repairPipeline decide correÃ§Ãµes estruturais localmente
  - executor mantÃ©m acesso cognitivo indevido ao LLM
- Cards relacionados:
  - KB-001
  - KB-020

### src/core/flow
- Colunas e prioridades no quadro:
  - CrÃ­tico: KB-021
- Problemas mapeados:
  - FlowManager mantÃ©m estado isolado fora do SessionManager
- Cards relacionados:
  - KB-021

### src/core (AgentController / AgentRuntime)
- Colunas e prioridades no quadro:
  - CrÃ­tico: KB-022
- Problemas mapeados:
  - AgentController retÃ©m orquestraÃ§Ã£o pesada e fluxos paralelos
  - AgentRuntime decide Replan/Repair/Direct em paralelo ao Orchestrator
- Cards relacionados:
  - KB-022

### src/engine
- Colunas e prioridades no quadro:
  - CrÃ­tico: KB-003, KB-023
- Problemas mapeados:
  - AgentLoop ainda atua como mini-brain tÃ¡tico
  - fallback/reclassify/retry locais
  - guard de explicabilidade ainda local
- Cards relacionados:
  - KB-003
  - KB-023

### src/memory
- Colunas e prioridades no quadro:
  - CrÃ­tico: KB-024
- Problemas mapeados:
  - ranking e merge cognitivos fora do Orchestrator
  - caches e memÃ³rias paralelas fora do SessionManager
- Cards relacionados:
  - KB-024

### src/schemas
- Colunas e prioridades no quadro:
  - MÃ©dio: KB-025
- Problemas mapeados:
  - validaÃ§Ã£o manual extensa e difÃ­cil de manter
- Cards relacionados:
  - KB-025

### src/scripts
- Colunas e prioridades no quadro:
  - MÃ©dio: KB-026
- Problemas mapeados:
  - bootstrap com roteamento/identidade hardcoded
- Cards relacionados:
  - KB-026

### src/search
- Colunas e prioridades no quadro:
  - CrÃ­tico: KB-027
- Problemas mapeados:
  - pipeline de busca com decisÃ£o semÃ¢ntica prÃ³pria
  - mÃºltiplos caches/Ã­ndices fora da sessÃ£o
- Cards relacionados:
  - KB-027

### src/services
- Colunas e prioridades no quadro:
  - MÃ©dio: KB-028
- Problemas mapeados:
  - onboarding e estado local isolado
  - WorkspaceService decide reutilizaÃ§Ã£o/abertura
- Cards relacionados:
  - KB-028

### src/shared
- Colunas e prioridades no quadro:
  - MÃ©dio: KB-029
- Problemas mapeados:
  - SessionManager ainda contÃ©m fragmentos decisÃ³rios
  - dependÃªncias cÃ­clicas com core
  - TraceRecorder com filtragem hardcoded
- Cards relacionados:
  - KB-029

### src/skills
- Colunas e prioridades no quadro:
  - MÃ©dio: KB-030
- Problemas mapeados:
  - SkillResolver como mini-brain
  - pendingSkillList fora do CognitiveState
  - regex de intenÃ§Ã£o duplicada
- Cards relacionados:
  - KB-030

### src/telegram
- Colunas e prioridades no quadro:
  - MÃ©dio: KB-031
- Problemas mapeados:
  - onboarding, permissÃ£o e anexos decididos no canal
  - sanitizaÃ§Ã£o de saÃ­da fora do Orchestrator
- Cards relacionados:
  - KB-031

### src/tools
- Colunas e prioridades no quadro:
  - MÃ©dio: KB-032
- Problemas mapeados:
  - pesos e validaÃ§Ãµes hardcoded nas tools
  - detecÃ§Ã£o de anomalia e runtime ainda local
- Cards relacionados:
  - KB-032

### src/utils
- Colunas e prioridades no quadro:
  - MÃ©dio: KB-033
- Problemas mapeados:
  - caches volÃ¡teis e decisÃµes tÃ¡ticas de infra/input
- Cards relacionados:
  - KB-033

### src/dashboard
- Colunas e prioridades no quadro:
  - MÃ©dio: KB-034
- Problemas mapeados:
  - dashboard atua como orquestrador secundÃ¡rio do canal web
  - cancelamento, onboarding, confianÃ§a e configuraÃ§Ã£o fora do cÃ©rebro central
- Cards relacionados:
  - KB-034

### src/db e src/i18n
- Colunas e prioridades no quadro:
  - MÃ©dio: KB-035
- Problemas mapeados:
  - idioma fragmentado
  - inicializaÃ§Ã£o sistÃªmica procedural e acoplada
- Cards relacionados:
  - KB-035

### docs/architecture/templates
- Colunas e prioridades no quadro:
  - Medio: KB-037
- Problemas mapeados:
  - falta padrao unico para mapear modularizacao de arquivos grandes sem perder o principio Single Brain
  - analises ad hoc podem deslocar decisao para modulos auxiliares por ausencia de checklist de integridade
- Cards relacionados:
  - KB-037


### Programa de execucao derivado do KB-037 (modularizacao segura)
- Ordem recomendada de implementacao:
  - 1) KB-038 - AgentLoop (StepResultValidator)
  - 2) KB-039 - AgentLoop (ToolFallbackAdvisor)
  - 3) KB-040 - AgentLoop (PlanLoopController + AnswerGroundingGuard)
  - 4) KB-041 - AgentExecutor (runner/healing/repair/trace)
  - 5) KB-042 - AgentController (handlers/coordinators)
  - 6) KB-043 - SkillRegistry (tools por dominio + politicas)
  - 7) KB-044 - TaskClassifier (classification/planning split)
- Restricoes obrigatorias:
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


## Cards jÃ¡ resolvidos neste ciclo
- KB-013
- KB-014
- KB-015
- KB-016

## Regra operacional
- Novo problema encontrado deve ser registrado primeiro aqui e depois convertido em card na coluna apropriada.
- Se um problema jÃ¡ existir em documento tÃ©cnico, o kanban deve referenciar a origem em vez de duplicar anÃ¡lise longa.
- A leitura primÃ¡ria do quadro deve comeÃ§ar por este arquivo; os arquivos de coluna detalham execuÃ§Ã£o e acompanhamento.






