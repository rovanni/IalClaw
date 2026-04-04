# Concluído

- [x] KB-022 - Follow-up Skill Flow Single Brain
  - Data: 2026-04-04
  - Evidência: src/core/AgentController.ts (runWithSkill) migrou decisões ativas para applyActiveDecisions e passou a auditar consistência com auditSignalConsistency após ingestão/aplicação

- [x] KB-022 - Remover split-brain de AgentController e AgentRuntime
  - Data: 2026-04-04
  - Evidência: AgentRuntime não instancia mais CognitiveOrchestrator local; AgentController extraiu context building/system prompt e consolidou ACTIVE DECISIONs via applyActiveDecisions no Orchestrator

- [x] KB-003 - Simplificar AgentLoop para executor linear
  - Data: 2026-04-04
  - Evidência: heurísticas de stop/delta migradas para o StopContinueModule no Orchestrator; AgentLoop agora envia contexto e aplica decisão governada

- [x] KB-013 - Estabilização de REAL_TOOLS_ONLY sem falha dura em no-tool-call
  - Data: 2026-04-03
  - Evidência: AgentLoop ajustado + testes passando

- [x] KB-014 - Correção de falso positivo operacional por route TOOL_LOOP
  - Data: 2026-04-03
  - Evidência: requiresRealWorldAction passou a depender de taskType operacional

- [x] KB-015 - Compatibilidade de testes com assinatura atual do CognitiveOrchestrator
  - Data: 2026-04-03
  - Evidência: tests/flow_continuity_refined e tests/flow_final atualizados

- [x] KB-016 - Changelog de hotfix consolidado para PR
  - Data: 2026-04-03
  - Evidência: docs/architecture/kanban/historico/prs/PR_Changelog_2026-04-03_SingleBrain_Hotfix.md
- [x] KB-037 - Padronizar mapeamento de modularização para arquivos grandes (Single Brain)
  - Data: 2026-04-04
  - Evidência: docs/architecture/kanban/historico/KB-037_Mapeamento_Modularizacao_Arquivos_Grandes_2026-04-04.md
