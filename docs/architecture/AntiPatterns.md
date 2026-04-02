# Anti-Patterns: src/capabilities

Este documento lista as violações arquiteturais identificadas na pasta `src/capabilities` com base no modelo **Single Brain**.

## 🔴 Decisão Indevida (Mini-Brains)

### 1. Decisão de Fluxo de Runtime
*   **Onde**: `stepCapabilities.ts` -> `resolveRuntimeModeForPlan`
*   **Evidência**: O arquivo decide sozinho se deve pular a execução ou se browser é obrigatório baseando-se no contexto de arquivos, sem passar pelo Orquestrador.
*   **Impacto**: 🔥 **Crítico** - Cria fluxos paralelos que o Orquestrador não controla.

### 2. Decisão de Instalação Automática
*   **Onde**: `SkillManager.ts` -> `ensure`
*   **Evidência**: O método avalia o `activePolicy` e decide se deve emitir um status de erro, pedir ao usuário ou rodar `skill.install()` diretamente.
*   **Impacto**: ⚠️ **Médio** - O Executor está "pensando" sobre a estratégia de remediação.

### 3. Resolução de Idioma Global
*   **Onde**: `languageConfig.ts` -> `resolveAppLanguage`
*   **Evidência**: Decide a precedência entre variáveis de ambiente e arquivo de configuração local de forma estática.
*   **Violação**: Decisões de "qual idioma usar" devem ser sinais consumidos pelo Orquestrador, não lógicas embutidas em helpers.
*   **Impacto**: ⚠️ **Médio** - Dificulta a sobreposição dinâmica de comportamento pelo cérebro.

---

## 🟠 Estado Duplicado ou Paralelo

### 1. Estado de Capacidades Isolado
*   **Onde**: `CapabilityRegistry.ts` -> `private capabilities = new Map()`
*   **Evidência**: O registro mantém um cache interno de quais ferramentas estão instaladas.
*   **Violação**: Nenhuma decisão deve ocorrer baseada em estado fora do `SessionManager`.
*   **Impacto**: 🔥 **Crítico** - Risco de dessincronização e opacidade para o Orquestrador.

### 2. Configuração em Disco (config.json)
*   **Onde**: `languageConfig.ts` -> `writeAppConfig`
*   **Evidência**: Persistência síncrona de estado global em arquivo JSON.
*   **Violação**: Configurações mutáveis devem ser tratadas como estado da aplicação ou sinais, idealmente centralizados ou sincronizados com o `SessionManager`.
*   **Impacto**: ⚠️ **Médio** - Cria um canal de persistência lateral.

### 2. Ongoing Checks Cache
*   **Onde**: `SkillManager.ts` -> `private ongoingChecks = new Map()`
*   **Evidência**: Mantém controle de promessas de verificação em andamento.
*   **Impacto**: 🟢 **Baixo** - Pode ser movido para um contexto de execução transiente, mas idealmente não deve ser estado de classe persistente.

### 4. Loop de Self-Healing em AgentExecutor
*   **Onde**: `AgentExecutor.ts` -> `runWithHealing`
*   **Evidência**: O executor tenta replanejar e corrigir erros de input chamando o LLM diretamente 5 vezes antes de reportar falha.
*   **Impacto**: 🔥 **Crítico** - Cria um loop de decisão opaco ao Orquestrador.

### 5. Estado de Flow Isolado
*   **Onde**: `FlowManager.ts` -> `private state: FlowState`
*   **Evidência**: O progresso de fluxos guiados vive na memória da classe, sumindo em restarts e ficando fora do snapshot cognitivo.
*   **Impacto**: 🔥 **Crítico** - Quebra a continuidade da consciência entre sessões.

---

## 🔵 Fluxo Paralelo

### 1. Fallback Hardcoded
*   **Onde**: `capabilityFallback.ts`
*   **Evidência**: `if (capability === 'browser_execution') return { mode: 'degraded' ... }`
*   **Violação**: Implementa controle de fluxo e estratégia de fallback fora do Orquestrador.
*   **Impacto**: ⚠️ **Médio** - Rigidez na resposta a falhas.

---

## ⚫ Vazamento de Abstração

### 1. Dependência de Binários em Managers
*   **Onde**: `index.ts` e `SkillManager.ts` definem lógica de `child_process`.
*   **Evidência**: O registro de skills no `index.ts` contém detalhes de implementação de sistema (`process.platform === 'win32'`).
*   **Impacto**: ⚠️ **Médio** - Dificulta testes e portabilidade.

---

## 🔴 Decisão fora do Orchestrator (Split-Brain)

### 3. Gateway de Decisão Paralelo
- **Arquivo: função**: `src/core/agent/decisionGate.ts` -> `decisionGate`
- **Evidência**: Define thresholds (`THRESHOLD_EXECUTE`, `THRESHOLD_CONFIRM`) e decide o tipo de resposta (`execute`, `confirm`, `pass`) antes de chegar ao `CognitiveOrchestrator`.
- **Risco**: 🔥 **Crítico**

### 4. Decisão de Necessidade de Contexto
- **Arquivo: função**: `src/core/agent/TaskClassifier.ts` -> `classifyWithContext`
- **Evidência**: Decide que o usuário *precisa* ser perguntado sobre a fonte (`needsContext: true`) e já emite a pergunta, bypassando a avaliação de autonomia do Orquestrador.
- **Risco**: ⚠️ **Médio**

---

## 🟡 Lógica Duplicada

### 1. Detecção de Intenções de Fluxo
- **Arquivos**: `src/core/agent/IntentionResolver.ts` e `src/core/agent/PendingActionTracker.ts`
- **Evidência**: Ambos implementam regex para `isConfirmation`, `isDecline` e `RETRY`.
- **Risco**: 🟢 **Baixo**

---

## 🔵 Fluxo Paralelo

### 2. Loop de Self-Healing Interno
- **Arquivo: função**: `src/core/executor/AgentExecutor.ts` -> `runWithHealing`
- **Evidência**: O executor tenta replanejar e corrigir erros (incluindo erros de input de ferramentas) chamando o LLM diretamente em um loop de até 5 tentativas, sem reportar o estado intermediário ao Orquestrador.
- **Risco**: 🔥 **Crítico**

### 3. Decisão de Reparo Estrutural
- **Arquivo: função**: `src/core/executor/repairPipeline.ts` -> `repairPlanStructure`
- **Evidência**: O pipeline decide heuristicamente como injetar ou remover passos de criação de projeto, agindo como um "mini-brain" de remediação local.
- **Risco**: ⚠️ **Médio**

---

## 🟠 Acoplamento de Orquestração

### 1. Controller Inteligente (Heavy Middleman)
- **Arquivo**: `src/core/AgentController.ts`
- **Evidência**: O controller decide sobre comandos, skills e construção de prompts complexos antes de repassar para o Orquestrador ou Loop. Ele contém fluxos de execução paralelos (`runWithSkill`) que ignoram a governança cognitiva.
- **Risco**: 🔥 **Crítico**

### 2. Runtime de Decisão Paralela
- **Arquivo**: `src/core/AgentRuntime.ts`
- **Evidência**: Implementa lógica própria de `RuntimeDecision` (Replan, Repair, Direct) baseada em thresholds locais, competindo com a estratégia do `CognitiveOrchestrator`.
- **Risco**: 🔥 **Crítico**

## "Mini-Brain" em Gerenciadores de Capacidade
### Descrição
O `SkillManager` toma decisões autônomas sobre a instalação de dependências sistêmicas (auto-install) com base em políticas internas, ignorando o controle de fluxo centralizado do `CognitiveOrchestrator`. Isso quebra o modelo Single Brain, onde apenas o Orchestrator deve decidir sobre ações que alteram o ambiente ou consumem tempo/recursos significativos.
### Evidências
- `src/capabilities/SkillManager.ts`: Método `ensure` decide e executa `skill.install()` diretamente se a política for `auto-install`.
### Risco

## Persistência de Configuração Lateral (config.json)
### Descrição
O sistema utiliza um arquivo `config.json` para persistir o idioma global, criando um estado que não é gerenciado pelo `SessionManager`. Isso impede que o `CognitiveOrchestrator` tenha uma visão holística e única do estado do sistema durante a sessão.
### Evidências
- `src/config/languageConfig.ts`: funções `readAppConfig`, `writeAppConfig` e `setConfiguredLanguage`.
### Risco
- ⚠️ Médio

## Lógica de Decisão de Configuração (Mini-Brain)
### Descrição
A função `resolveAppLanguage` decide a precedência entre variáveis de ambiente, configurações em disco e valores de fallback. Essa política de resolução é uma decisão cognitiva sobre o comportamento do sistema e deveria estar sob controle do Orquestrador.
### Evidências
- `src/config/languageConfig.ts`: função `resolveAppLanguage`.
### Risco
- ⚠️ Médio

## 🔴 Decisão fora do Orchestrator (Engine Loop)

### 1. Loop de Decisão em AgentLoop
- **Arquivo: função**: `src/engine/AgentLoop.ts` -> `runInternal`, `adjustPlanAfterFailure`, `shouldRetryWithLlm`
- **Evidência**: O loop decide autonomamente se deve reclassificar a tarefa, trocar a ferramenta por um fallback ou solicitar intervenção do LLM para "verificar se o resultado está correto".
- **Risco**: 🔥 **Crítico** - O `AgentLoop` atua como um orquestrador tático paralelo, impedindo que o `CognitiveOrchestrator` tenha visão total das falhas e estratégias de recuperação.

### 2. Heurística de Explicabilidade (Reality Check)
- **Arquivo: função**: `src/engine/AgentLoop.ts` -> `applyExecutionClaimGuard`
- **Evidência**: Decide se a resposta do LLM é "mentirosa" (sem evidência de execução) e injeta um aviso de segurança.
- **Risco**: ⚠️ **Médio** - Embora útil, a decisão de "confiar ou não" na resposta final é uma função cognitiva do Orquestrador.

## 🟠 Estado Paralelo (Performance Metrics)

## 🔴 Decisão fora do Orchestrator (Memory Logic)

### 1. Algoritmo de Ranking e Exploração
- **Arquivo: função**: `src/memory/CognitiveMemory.ts` -> `rankWithHybridScoring`
- **Evidência**: Implementa uma lógica de "exploração controlada" (20% de resultados aleatórios) e pesos de ranking hardcoded.
- **Risco**: 🔥 **Crítico** - A estratégia de "o que eu devo lembrar agora" é uma decisão cognitiva central que deve ser controlada pelo Orquestrador, não embutida no Manager de dados.

### 2. Heurística de Consolidação (Merge)
- **Arquivo: função**: `src/memory/MemoryService.ts` -> `mergeContent`, `looksContradictory`
- **Evidência**: Decide automaticamente descartar informações antigas se a nova "parecer contraditória" via heurística de regex.
- **Risco**: ⚠️ **Médio** - Perda de informação e decisões de "verdade" tomadas sem o contexto total da tarefa.

## 🟠 Estado Paralelo (Memory Caches)

### 1. Memória de Classificação Local
- **Arquivo**: `src/memory/ClassificationMemory.ts`
- **Evidência**: `private memory: MemoryEntry[] = []`
- **Violação**: Mantém um histórico de inputs e classificações em um array privado na classe (singleton), tornando-o invisível ao `SessionManager`.
- **Risco**: 🔥 **Crítico** - Impede a serialização completa do estado do cérebro.

### 2. Caches de Arquivos Ativos e Nós Recentes
- **Arquivo**: `src/memory/CognitiveMemory.ts`
- **Evidência**: `private recentlyUsedNodes`, `private activeCodeFiles`
- **Risco**: ⚠️ **Médio**

---

## Decisão de Roteamento Hardcoded
### Descrição
Regras de roteamento (keywords, prioridade de agentes) estão fixas em scripts de bootstrap, em vez de serem sinais dinâmicos ou configurações gerenciadas pelo Orquestrador.
### Evidências
- `src/scripts/bootstrap-identities.ts`: Array `DEFAULT_GATEWAY_IDENTITIES` define prioridades e keywords de roteamento.
### Risco
- ⚠️ Médio

## Mini-Brain de Roteamento (AgentGateway)
### Descrição
O `AgentGateway` decide por conta própria qual identidade de agente deve processar uma consulta (`selectAgent`), em vez de apenas fornecer o sinal de similaridade semântica para que o Orquestrador decida.
### Evidências
- `src/scripts/test-routing.ts`: Testa a função `gateway.selectAgent(q, emb)`.
### Risco

---

## Subsistema de Decisão Isolado (Search Engine)
### Descrição
O `SearchEngine` gerencia um pipeline complexo de busca (expansão, scoring, rerank) e toma decisões táticas de fallback e estratégia de recuperação que deveriam estar sob controle do Orquestrador Central.
### Evidências
- `src/search/pipeline/searchEngine.ts`: Gerencia o fluxo completo e aplica pesos de boost internamente.
### Risco
- 🔥 Crítico

## Fragmentação de Estado em Caches Voláteis
### Descrição
O módulo de busca mantém pelo menos 5 caches diferentes e o próprio índice invertido em memória volátil (`Maps` privados), tornando o estado do sistema opaco e impossibilitando a serialização completa via `SessionManager`.
### Evidências
- `src/search/pipeline/searchEngine.ts`: `documentCache`
- `src/search/llm/autoTagger.ts`: `cache`
- `src/search/index/invertedIndex.ts`: `termIndex`, `documents`, etc.
- `src/search/graph/semanticGraphBridge.ts`: `expansionCache`, `enrichmentCache`
### Risco
- 🔥 Crítico

## Heurísticas de Relevância Hardcoded
### Descrição
Pesos de importância (título vs conteúdo), bônus de posição e thresholds de boost semântico estão fixos no código, impedindo o Orquestrador de ajustar a estratégia de busca dinamicamente.
### Evidências
- `src/search/ranking/scorer.ts`: `DEFAULT_WEIGHTS`
- `src/search/graph/semanticGraphBridge.ts`: `semanticBoost` fixo em 0.1.
### Risco
- ⚠️ Médio

---

## Mini-Brain de Diálogo e Classificação de Intenção
### Descrição
O `OnboardingService` decide por conta própria o que o usuário disse e qual a próxima pergunta do fluxo usando um motor de regras interno (regex), bypassando o `CognitiveOrchestrator` e o `IntentionResolver`.
### Evidências
- `src/services/OnboardingService.ts`: Funções `classificarEntrada` e `processOnboardingAnswer`.
### Risco
- 🔥 Crítico

## Estado de Sessão Isolado (Onboarding States)
### Descrição
O progresso da conversa de onboarding é mantido em um `Map` privado em memória, tornando-o volátil e invisível para o mecanismo de snapshot do `SessionManager`.
### Evidências
- `src/services/OnboardingService.ts`: Propriedade `private states: Map<string, OnboardingState>`.
### Risco
- 🔥 Crítico

## Decisão Tática de Reutilização de Projeto
### Descrição
O `WorkspaceService` decide autonomamente se deve reutilizar um projeto existente ou criar um novo com base no estado da sessão, em vez de apenas fornecer a capacidade técnica de fazê-lo quando solicitado pelo Orquestrador.
### Evidências
- `src/services/WorkspaceService.ts`: Lógica de reaproveitamento no método `createProject`.
### Risco
- ⚠️ Médio

---

## Decisão em State Manager (SessionManager)
### Descrição
O `SessionManager` decide autonomamente se uma tarefa está ativa baseando-se na presença de ações pendentes, em vez de apenas armazenar essa flag conforme determinado pelo Orquestrador.
### Evidências
- `src/shared/SessionManager.ts`: Método `updateTaskContext` define `session.task_context.active = session.task_context.active || hasPending;`.
### Risco
- ⚠️ Médio

## Acoplamento Circular / Vazamento de Abstração
### Descrição
O `SessionManager` (camada Shared/State) depende de componentes do `core` (`PendingActionTracker`, `FlowState`), o que inverte a hierarquia de dependências e dificulta a evolução isolada da camada de estado.
### Evidências
- `src/shared/SessionManager.ts`: Imports de `../core/agent/PendingActionTracker` e `../core/flow/types`.
### Risco
- ⚠️ Médio

## Conhecimento Global de Eventos (TraceRecorder)
### Descrição
O `TraceRecorder` mantém uma lista exaustiva e hardcoded de todos os eventos significativos do sistema para fins de filtragem/gravação.
### Evidências
- `src/shared/TraceRecorder.ts`: Array `tracedEvents` contendo mais de 40 strings fixas.
### Risco
- 🟢 Baixo

---

## 🟠 Estado Paralelo (Pending Skills)

### 3. Estado de Resolução Pendente
- **Onde**: `SkillResolutionManager.ts` -> `private pendingSkillList`
- **Evidência**: Mantém a lista de skills encontradas em busca para confirmação do usuário (`instale o número 1`).
- **Violação**: Esse estado é volátil e invisível ao `SessionManager`. Se o sistema reiniciar ou limpar o cache, a referência ao "número 1" é perdida.
- **Risco**: ⚠️ **Médio**

## 🔴 Decisão fora do Orchestrator (Mini-Brains de Skill)

### 5. Decisão de Resolução de Skill
- **Arquivo: função**: `SkillResolver.ts` -> `resolve`
- **Evidência**: Decide qual skill deve ser ativada e executa roteamento direto para o `skill-installer` em cases específicos.
- **Risco**: 🔥 **Crítico** - A decisão de "qual ferramenta usar" deve ser um sinal processado pelo `CognitiveOrchestrator`, não uma lógica local.

### 6. Detecção de Intenção Local
- **Arquivo: função**: `SkillResolutionManager.ts` -> `resolveFromContext`, `resolveFromText`
- **Evidência**: Implementa regex próprio para detectar ações de "instalar" ou "usar" (ex: lines 72, 133). Isso duplica a função do `IntentionResolver`.
- **Risco**: ⚠️ **Médio**

---

## 🔴 Decisão fora do Orchestrator (Telegram Module)

### 1. Gestão de Onboarding no Input
- **Arquivo: função**: `TelegramInputHandler.ts` -> `checkOnboarding`, `processOnboardingAnswer`
- **Evidência**: O handler decide se deve iniciar o onboarding ou processar uma resposta, interagindo diretamente com o `OnboardingService`.
- **Risco**: 🔥 **Crítico** - Cria um fluxo de diálogo paralelo que ignora a orquestração central.

### 2. Seleção de Anexo no Output
- **Arquivo: função**: `TelegramOutputHandler.ts` -> `resolveArtifactAttachment`
- **Evidência**: O executor decide qual arquivo enviar para o usuário com base em extensões e metadados da sessão.
- **Risco**: ⚠️ **Médio** - A decisão de "o que enviar" é uma escolha de comunicação estratégica do cérebro.

### 3. Sanitização de Output Fixa
- **Arquivo: função**: `TelegramOutputHandler.ts` -> `sanitizeOutput`
- **Evidência**: Aplica substituições de strings (como traduzir `capabilitygapdetected`) de forma hardcoded no executor.
- **Risco**: ⚠️ **Médio** - Abstração de mensagens de erro deve ser parte da camada de explicabilidade/cognição.

## 🟠 Estado paralelo (Telegram)

### 1. Cache de Usuários Permitidos
- **Arquivo**: `TelegramInputHandler.ts` -> `allowedUsers`
- **Evidência**: Mantém um `Set` derivado de variáveis de ambiente em memória local.
- **Risco**: 🟢 **Baixo** - Idealmente deveria ser um sinal consultado pelo Orquestrador.

## 🔵 Fluxo paralelo (Telegram)

### 1. Loop de Retry de Mensagens
- **Arquivo: função**: `TelegramOutputHandler.ts` -> `sendTextChunks`
- **Evidência**: Implementa lógica de retry exponencial e fallbacks para texto plano em caso de erro de Markdown internamente.
- **Risco**: ⚠️ **Médio** - Embora prático, oculta falhas de entrega do Orquestrador.

---

## 🔴 Decisão fora do Orchestrator (Tools Logic)

### 1. Pesos e Heurísticas de Ranking de Âncoras
- **Arquivo: função**: `src/tools/workspaceDiff.ts` -> `rankResolvedAnchor`, `rankAnchors`
- **Evidência**: Define bônus de unicidade (`uniquenessBoost`) e especificidade (`specificityBoost`) de forma fixa, além de pesos para estratégias de busca (`strategyWeight`).
- **Risco**: ⚠️ **Médio** - A estratégia de "quão confiável é este ponto de inserção" é uma decisão cognitiva que deve ser parametrizada ou decidida pelo Orquestrador.

### 2. Regras de Validação Estrutural Hardcoded
- **Arquivo: função**: `src/tools/workspaceValidateProject.ts` -> `runValidationRules`
- **Evidência**: Define limites arbitrários (tamanho < 20 caracteres) e obrigatoriedade de tags (ex: `<html`) para considerar um projeto válido.
- **Risco**: ⚠️ **Médio** - Impede que o Orquestrador ajuste o rigor da validação conforme o tipo de tarefa.

### 3. Heurística de Resultado de Diff Suspeito
- **Arquivo: função**: `src/tools/WorkspaceTools.ts` -> `workspaceApplyDiffTool.execute`
- **Evidência**: `updatedContent.length < currentContent.length * 0.3` gera erro `DIFF_RESULT_SUSPICIOUS`.
- **Risco**: ⚠️ **Médio** - O Executor está decidindo se o trabalho do "cérebro" faz sentido com base em uma métrica de tamanho.

### 4. Decisão de Runtime Automática (Router Implícito)
- **Arquivo: função**: `src/tools/workspaceRunProject.ts` -> `runProject`
- **Evidência**: Decide entre `runNodeProject` e `runHtmlProject` verificando a existência de `index.js` ou `index.html`.
- **Risco**: 🟢 **Baixo** - Embora prático, oculta a intenção de execução do Orquestrador.


---

## Estado Paralelo em Utilitários (Dedup Cache)
### Descrição
O utilitário `messageDedup.ts` mantém um cache de IDs de mensagens processadas em um `Map` estático na memória. Isso cria um estado invisível ao `SessionManager`, impedindo a recuperação total da consciência após um restart e permitindo reprocessamento indevido de mensagens antigas.
### Evidências
- `src/utils/messageDedup.ts`: `const processedMessages = new Map<number, number>();`
### Risco
- ⚠️ Médio

## Decisão de Infraestrutura Autônoma (Ollama)
### Descrição
O utilitário `ollamaCheck.ts` decide autonomamente a estratégia de inicialização do serviço Ollama (uso de systemctl em Linux vs execução direta do binário), bypassando a orquestração central.
### Evidências
- `src/utils/ollamaCheck.ts`: método `startOllama`.
### Risco
- 🟢 Baixo

## Mini-Brain de Normalização de Aliases
### Descrição
A função `validateToolInput.ts` contém lógica de "remendo" (patching) para corrigir inconsistências comuns do LLM (ex: trocar `project_name` por `name`). Decisões sobre como interpretar ou corrigir inputs de ferramentas devem ser centralizadas no Orquestrador ou em um Signal de reparo agnóstico.
### Evidências
- `src/utils/validateToolInput.ts`: função `normalizeAliases`.
### Risco
- ⚠️ Médio

---

## Decisão de Onboarding no Dashboard (Router-Brain)
### Descrição
O `DashboardServer` intercepta mensagens de chat e decide autonomamente se deve iniciar ou processar o onboarding, duplicando a lógica presente no `TelegramInputHandler` e ignorando a orquestração central.
### Evidências
- `src/dashboard/DashboardServer.ts`: Lógica de onboarding dentro do endpoint `/api/chat` (linhas 93-128).
### Risco
- 🔥 Crítico

## Estado de Controle de Execução Isolado
### Descrição
O cancelamento de tarefas via web é gerenciado por um `Map` privado (`webExecutionControl`), tornando o estado de interrupção invisível para o Orquestrador Cognitivo e para outros canais (como Telegram).
### Evidências
- `src/dashboard/DashboardServer.ts`: `private webExecutionControl = new Map<string, { cancelRequested: boolean }>();`
### Risco
- ⚠️ Médio

## Cálculo de Confiança Hardcoded
### Descrição
O servidor de dashboard atribui valores fixos de confiança às respostas do agente baseando-se apenas no modo de execução, em vez de consumir o sinal real de confiança (`ConfidenceScore`) gerado pelo cérebro.
### Evidências
- `src/dashboard/DashboardServer.ts`: Objeto `confidenceByMode` (linhas 142-146).
### Risco
- ⚠️ Médio

## Persistência de Configuração Direta
### Descrição
O dashboard lê e escreve configurações globais (`execution_mode`) diretamente no banco de dados SQLite, ignorando a governança do `SessionManager` ou do Orquestrador.
### Evidências
- `src/dashboard/DashboardServer.ts`: Métodos `initializeAgentConfig` e `persistAgentConfig`.
### Risco
- ⚠️ Médio

---

## Decisão de Idioma no Signal (Mini-Brain)
### Descrição
O utilitário de internacionalização (`src/i18n/index.ts`) decide por conta própria qual é o idioma da mensagem do usuário usando scoring heurístico. Essa decisão deveria ser um sinal bruto para o Orquestrador, permitindo que o cérebro use o contexto da sessão para resolver ambiguidades.
### Evidências
- `src/i18n/index.ts`: método `detectLanguage`.
### Risco
- ⚠️ Médio

## Estado de Idioma Paralelo
### Descrição
O idioma "corrente" da thread ou do sistema é mantido fora do `SessionManager`, dificultando a serialização completa e o controle do Orquestrador sobre como o agente deve responder em sessões multi-idioma.
### Evidências
- `src/i18n/index.ts`: `globalLanguage` e `languageScope`.
### Risco
- ⚠️ Médio

## Orquestração de Startup Pesada (Heavy Bootstrap)
### Descrição
O `index.ts` realiza decisões críticas sobre reparo de banco de dados, execução de setup e inicialização de serviços de IA (`startOllama`) de forma procedural e síncrona, em vez de sinalizar essas necessidades de infraestrutura para um Orquestrador de Sistema.
### Evidências
- `src/index.ts`: métodos `checkAndRunSetup`, `checkAndPromptDatabase` e bloco de inicialização do Ollama.
### Risco
- 🟢 Baixo
