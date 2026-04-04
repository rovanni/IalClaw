# KB-037 - Mapeamento de Modularizacao de Arquivos Grandes (Single Brain)

Data: 2026-04-04
Escopo: analise arquitetural sem alteracao de comportamento.
Regra central: Orchestrator continua como unico decisor.

## Metodo
- Arquivos analisados por tamanho e impacto arquitetural no fluxo cognitivo.
- Foco em responsabilidades, acoplamento, pontos de quebra e risco de regressao.
- Sem proposta de reescrita total; somente extracao incremental por responsabilidade.

## Arquivos analisados
1. src/engine/AgentLoop.ts (~3217 linhas)
2. src/core/executor/AgentExecutor.ts (~1695 linhas)
3. src/core/orchestrator/CognitiveOrchestrator.ts (~1361 linhas)
4. src/core/AgentController.ts (~1313 linhas)
5. src/engine/SkillRegistry.ts (~994 linhas)
6. src/core/agent/TaskClassifier.ts (~889 linhas)

---

## 1) src/engine/AgentLoop.ts

### 1. Analise estrutural
- Tamanho: ~3217 linhas.
- Blocos principais: classificacao e contexto de tarefa, roteamento/autonomia, loop de execucao, fallback de tool, validacao de passo, reclassificacao, memoria de execucao, sanitizacao final.
- Metodos longos (estimativa): `runInternal` (nucleo principal), `validateStepResult`, `registerExecutionMemory`, `reclassifyAndAdjustPlan`, `addPlanningGuidanceToMessages`.

### 2. Responsabilidades identificadas
1. Gerenciar contexto e continuidade da tarefa.
2. Classificar task type e acionar fail-safe.
3. Decidir estrategia de execucao/short-circuit (com safe fallback).
4. Construir/ajustar plano e avancar passos.
5. Selecionar tool/fallback e ranking por memoria.
6. Validar resultado de passo por heuristica textual.
7. Persistir memoria de execucao e confianca.
8. Sanear resposta ao usuario e checar grounding.

### 3. Problemas
- Mistura forte de decisao e execucao no mesmo arquivo.
- Heuristicas taticas locais (fallback, reclassificacao, validacao) com risco de mini-brain.
- Dependencias implicitas com SessionManager, TaskClassifier, DecisionMemory e Orchestrator.
- Alto risco de regressao por metodo central muito extenso.

### 4. Sugestao de modulos
- `engine/loop_context/`
  - `TaskContextCoordinator.ts` -> continuidade, reset e contexto (sem decidir estrategia global).
- `engine/loop_flow/`
  - `PlanLoopController.ts` -> avancar passo, marcar falha, estado do plano.
- `engine/loop_validation/`
  - `StepResultValidator.ts` -> regras de validacao de passo, somente sinal.
- `engine/loop_fallback/`
  - `ToolFallbackAdvisor.ts` -> ranking e sugestao de fallback, somente recomendacao.
- `engine/loop_memory/`
  - `ExecutionMemoryRecorder.ts` -> registrar historico e estatisticas.
- `engine/loop_response/`
  - `AnswerGroundingGuard.ts` -> reality check e sanitizacao final.

### 5. Integridade arquitetural dos modulos
- Todos os modulos sugeridos tomam decisao final? NAO.
- Dependem do Orchestrator para decisao final? SIM (recebem/retornam sinais).
- Risco de mini-brain? MEDIO se `Advisor/Validator` retornar acao final em vez de sinal.

### 6. Preservacao do Single Brain
- Nenhuma decisao final deve sair do Orchestrator.
- Modulos do loop devem emitir sinais estruturados, nao escolher estrategia final.
- Fluxo permanece deterministico se contratos forem `input -> signal`.

### 7. Risco da refatoracao
- Classificacao: ALTO.
- Pode quebrar: continuidade de sessao, fallback de tool, bloqueio de short-circuit indevido.
- Cuidado principal: manter ordem das avaliacoes dentro de `runInternal`.

### 8. Plano incremental
1. Extrair `StepResultValidator` sem alterar chamadas.
2. Extrair `ToolFallbackAdvisor` apenas com API de recomendacao.
3. Extrair `PlanLoopController` (estado de passo).
4. Extrair `AnswerGroundingGuard`.
5. Reduzir `runInternal` para orquestracao e delegacao.

---

## 2) src/core/executor/AgentExecutor.ts

### 1. Analise estrutural
- Tamanho: ~1695 linhas.
- Blocos principais: execucao de plano, self-healing/retry, repair pipeline, replan por LLM, capability checks, diff-aware save, trace e learning.
- Metodos longos (estimativa): `runWithHealing`, `replan`, `tryApplyDiffAwareSave`, `ensureStepCapabilities`, `executeWithTrace`.

### 2. Responsabilidades identificadas
1. Executar passos atomicos de plano.
2. Fazer retry/healing e abort conditions.
3. Reparar plano/input com LLM.
4. Garantir capacidades antes da execucao.
5. Aplicar estrategia de persistencia diff/overwrite.
6. Registrar telemetria e aprendizado operacional.

### 3. Problemas
- Mistura de executor com politicas de recuperacao (governanca local extensa).
- Dependencia implicita de estado de sessao e regras de fallback.
- Multiplicacao de regras de abort/retry em varios ramos.
- Risco alto de regressao em tratamento de erro.

### 4. Sugestao de modulos
- `core/executor/run/`
  - `PlanStepRunner.ts` -> executa passo atomico e retorna erro bruto.
- `core/executor/healing/`
  - `SelfHealingCoordinator.ts` -> ciclo de tentativas orientado por sinal.
- `core/executor/repair/`
  - `ToolInputRepairService.ts` -> correcao de input e normalizacao.
  - `PlanReplanner.ts` -> replanejamento de plano.
- `core/executor/capabilities/`
  - `StepCapabilityGuard.ts` -> validacao de capability e fallback informativo.
- `core/executor/observability/`
  - `ExecutionTraceEmitter.ts` -> traces e learning records.

### 5. Integridade arquitetural dos modulos
- Tomam decisao final? NAO (devem expor sugestao/sinal).
- Dependem do Orchestrator? SIM para permitir/nega retry/recovery.
- Risco de mini-brain? ALTO no `SelfHealingCoordinator` se mantiver politicas finais locais.

### 6. Preservacao do Single Brain
- Executor precisa virar camada de execucao deterministica.
- Retry/replan/recovery final deve ser aprovado no Orchestrator.
- Nenhuma regra nova de autonomia no executor.

### 7. Risco da refatoracao
- Classificacao: ALTO.
- Pode quebrar: convergencia de repair, limites de tentativa, tratamento de erro de tools.
- Cuidado principal: manter semantica de abort atual e codigos de erro.

### 8. Plano incremental
1. Extrair `ExecutionTraceEmitter` (baixo risco).
2. Extrair `StepCapabilityGuard` com mesma assinatura.
3. Extrair `ToolInputRepairService` mantendo mesmas mensagens de erro.
4. Extrair `SelfHealingCoordinator` com decisao final ainda delegada.
5. Consolidar `runWithHealing` como fluxo fino.

---

## 3) src/core/orchestrator/CognitiveOrchestrator.ts

### 1. Analise estrutural
- Tamanho: ~1361 linhas.
- Blocos principais: ingestao de sinais, resolucao de autoridade, decisoes active mode, estrategia cognitiva, precedencia (recovery/flow/pending/normal), execucao de decisao.
- Metodos longos (estimativa): `decide`, `decideStopContinue`, `auditSignalConsistency`, `resolveSignalAuthority`.

### 2. Responsabilidades identificadas
1. Hub de decisao central do sistema.
2. Auditoria de conflitos entre sinais.
3. Precedencia de estrategia cognitiva.
4. Aplicacao de governanca em retry/failsafe/route/stop.
5. Planejamento capability-aware em modo seguro.

### 3. Problemas
- Arquivo concentra responsabilidades corretas de decisao, mas com volume alto.
- Repeticao de padrao `signal -> authority -> finalDecision -> log` em varios metodos.
- Acoplamento com muitos modulos e tipos vindos de AgentLoop.

### 4. Sugestao de modulos
- `core/orchestrator/signals/`
  - `SignalAuthorityEngine.ts` -> resolve autoridade e bloqueios.
  - `SignalConflictAuditor.ts` -> auditoria de conflitos.
- `core/orchestrator/strategy/`
  - `StrategyPrecedenceEngine.ts` -> recovery/flow/pending/normal.
  - `CapabilityAwarePlanner.ts` -> estrategia capability-aware.
- `core/orchestrator/decisions/`
  - `RetryDecisionService.ts`
  - `FailSafeDecisionService.ts`
  - `StopContinueDecisionService.ts`

### 5. Integridade arquitetural dos modulos
- Tomam decisao? SIM, mas por design este e o dominio legitimo de decisao central.
- Dependem do Orchestrator? SIM (sao submodulos internos da mesma autoridade).
- Risco de mini-brain? BAIXO se permanecer tudo dentro do namespace do Orchestrator.

### 6. Preservacao do Single Brain
- Modularizacao aqui e interna ao cerebro central, nao distribuicao de autoridade.
- Decisao final continua no Orchestrator.
- Fluxo deterministico preservado via ordem de precedencia unica.

### 7. Risco da refatoracao
- Classificacao: MEDIO.
- Pode quebrar: ordem de precedencia e conflitos de signal.
- Cuidado principal: manter contratos e logs de auditoria.

### 8. Plano incremental
1. Extrair `SignalConflictAuditor` sem mudar comportamento.
2. Extrair `SignalAuthorityEngine`.
3. Extrair `StrategyPrecedenceEngine`.
4. Separar `decisions/*` por tipo de signal.
5. Validar parity por logs comparativos.

---

## 4) src/core/AgentController.ts

### 1. Analise estrutural
- Tamanho: ~1313 linhas.
- Blocos principais: entrada Telegram/Web, gestao de sessao, skill resolution, chamada de orquestrador, ciclo unificado com loop, memoria de ciclo de vida, progress tracking.
- Metodos longos (estimativa): `runConversation`, `runWithSkill`, `handleMessage`.

### 2. Responsabilidades identificadas
1. Adapter de canais (telegram/web).
2. Orquestracao de ciclo de conversa e sessao.
3. Integracao com skills e pending actions.
4. Integracao com memoria e contexto.
5. Telemetria e status de progresso.

### 3. Problemas
- Mistura de transporte, aplicacao e governanca num unico arquivo.
- Duplicacao de fluxo entre caminho normal e caminho de skill.
- Acoplamento elevado com muitos subsistemas.

### 4. Sugestao de modulos
- `core/controller/channels/`
  - `TelegramMessageHandler.ts`
  - `WebMessageHandler.ts`
- `core/controller/conversation/`
  - `ConversationCoordinator.ts` -> pipeline principal.
  - `SkillConversationCoordinator.ts` -> fluxo de skill.
- `core/controller/context/`
  - `ContextHydrator.ts` -> memoria, identidade e contexto.
- `core/controller/pending/`
  - `PendingActionCoordinator.ts` -> regras de pending action/topic shift.

### 5. Integridade arquitetural dos modulos
- Tomam decisao final cognitiva? NAO.
- Dependem do Orchestrator? SIM (controller delega e nao decide estrategia final).
- Risco de mini-brain? MEDIO no coordinator de skill se embutir politicas de decisao.

### 6. Preservacao do Single Brain
- Controller deve ser gateway/orquestracao tecnica.
- Toda decisao de estrategia deve continuar no Orchestrator.
- Evitar heuristica de negocio no adapter de canal.

### 7. Risco da refatoracao
- Classificacao: MEDIO-ALTO.
- Pode quebrar: continuidade de conversa, pending actions e fluxo de skill.
- Cuidado principal: manter side effects de sessao e logging.

### 8. Plano incremental
1. Extrair handlers de canal sem alterar assinaturas publicas.
2. Extrair `ContextHydrator`.
3. Extrair `PendingActionCoordinator`.
4. Extrair `SkillConversationCoordinator`.
5. Reduzir `runConversation` para pipeline linear.

---

## 5) src/engine/SkillRegistry.ts

### 1. Analise estrutural
- Tamanho: ~994 linhas.
- Blocos principais: definicao de ferramentas, seguranca basica de comandos, IO de arquivos, auditoria de skills, comandos de sistema, conversao de arquivos e utilitarios.
- Metodos longos (estimativa): `registerDefaultSkills` (principal concentrador).

### 2. Responsabilidades identificadas
1. Registro de metadados das tools.
2. Implementacao de cada tool.
3. Validacoes de seguranca por tool.
4. Automacoes de ciclo de vida de skills.
5. Utilitarios de filesystem/execucao local.

### 3. Problemas
- Forte concentracao de tudo em `registerDefaultSkills`.
- Acoplamento de concerns diferentes (filesystem, audit, shell, web, conversao).
- Duplicacao de logica de validacao de caminho em varias tools.
- Risco de regressao por efeito colateral entre tools no mesmo arquivo.

### 4. Sugestao de modulos
- `engine/skills/registry/`
  - `ToolRegistry.ts` -> container e lookup.
- `engine/skills/tools/filesystem/`
  - `readLocalFileTool.ts`, `writeFileTool.ts`, `moveFileTool.ts`, etc.
- `engine/skills/tools/system/`
  - `execCommandTool.ts`, `runPythonTool.ts`.
- `engine/skills/tools/skills_lifecycle/`
  - `writeSkillFileTool.ts`, `promoteSkillTool.ts`, `runSkillAuditorTool.ts`.
- `engine/skills/security/`
  - `PathPolicy.ts`, `CommandSafetyPolicy.ts`.

### 5. Integridade arquitetural dos modulos
- Tomam decisao cognitiva? NAO (apenas executam comando/ferramenta).
- Dependem do Orchestrator? SIM por contrato de chamada (tool executa, nao decide quando).
- Risco de mini-brain? BAIXO-MEDIO se politicas de fallback estrategico forem inseridas nas tools.

### 6. Preservacao do Single Brain
- Tools continuam cegas para estrategia cognitiva.
- Sem heuristica de negocio para decidir fluxo conversacional.
- Orchestrator permanece dono de quando/como chamar tool.

### 7. Risco da refatoracao
- Classificacao: MEDIO.
- Pode quebrar: assinatura de tools, validacao de seguranca, comandos de sistema.
- Cuidado principal: manter contratos JSON e mensagens de erro.

### 8. Plano incremental
1. Extrair `ToolRegistry` sem alterar API externa.
2. Migrar tools de filesystem para pasta dedicada.
3. Migrar tools de system exec com `CommandSafetyPolicy`.
4. Migrar tools de skill lifecycle.
5. Adicionar teste de regressao por tool.

---

## 6) src/core/agent/TaskClassifier.ts

### 1. Analise estrutural
- Tamanho: ~889 linhas.
- Blocos principais: tipos/capabilities, regras heuristicas, classificacao em camadas (heuristica/memoria/llm/fallback), detectores especializados, builders de plano deterministico.
- Metodos longos (estimativa): `classify`, `heuristicClassify`, `isContentGeneration`, `buildExecutionPlan`.

### 2. Responsabilidades identificadas
1. Classificacao semantica de tarefa.
2. Politica de confianca e fallback.
3. Regras regex de dominio.
4. Regras de capabilities por tipo.
5. Geracao de plano deterministico por task type.

### 3. Problemas
- Mistura de classificacao + planejamento deterministico no mesmo arquivo.
- Crescimento de regras regex tende a duplicacao e conflitos.
- Regras de alto risco e excecoes espalhadas dificultam manutencao.

### 4. Sugestao de modulos
- `core/agent/classification/`
  - `TaskTypeClassifier.ts` -> pipeline de classificacao.
  - `HeuristicRules.ts` -> catalogo de regras.
  - `ClassificationGuards.ts` -> regras de alto risco/consistencia.
- `core/agent/planning/`
  - `DeterministicPlanBuilder.ts` -> buildExecutionPlan e forced plans.
  - `TaskCapabilityMap.ts` -> capabilities por task type.

### 5. Integridade arquitetural dos modulos
- Tomam decisao final do agente? NAO (classificador emite sinal).
- Dependem do Orchestrator? SIM (saida vira entrada de decisao central).
- Risco de mini-brain? MEDIO se builder de plano passar a escolher estrategia de execucao.

### 6. Preservacao do Single Brain
- Classificador deve seguir como fornecedor de sinais.
- Decisao final de estrategia fica no Orchestrator.
- Planejamento deterministico nao pode virar politica autonoma paralela.

### 7. Risco da refatoracao
- Classificacao: MEDIO.
- Pode quebrar: precision/recall de classificacao e regressao de task type critico.
- Cuidado principal: manter ordem das regras prioritarias.

### 8. Plano incremental
1. Extrair mapa de capabilities e tipos.
2. Extrair catalogo heuristico puro.
3. Extrair pipeline de classificacao (sem mudar thresholds).
4. Extrair deterministic plan builder.
5. Validar com suite de casos reais historicos.

---

## Priorizacao de modularizacao (recomendacao)
1. AgentLoop.ts (maior risco + maior acoplamento decisorio residual)
2. AgentExecutor.ts (risco alto em healing/recovery)
3. AgentController.ts (alto acoplamento de integracao)
4. SkillRegistry.ts (concentracao operacional)
5. TaskClassifier.ts (regras + planner juntos)
6. CognitiveOrchestrator.ts (modularizacao interna do cerebro central)

## Risco geral do programa de refatoracao
- Classificacao global: ALTO.
- Motivo: arquivos centrais com muito estado, muitos side effects e governanca em transicao.
- Mitigacao: extracao por contrato, sem mover autoridade, com validacao por comportamento.

## Conclusao
- Modularizar e recomendado, mas por responsabilidade e em passos pequenos.
- O ponto critico e separar execucao de decisao, mantendo o Orchestrator como autoridade unica.
- O mapeamento acima define pontos de quebra seguros sem reescrita total.
