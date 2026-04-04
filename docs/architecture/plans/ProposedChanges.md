# Proposed Changes: Capabilities Refactoring

Acompanhamento de execucao em Kanban:
- docs/architecture/kanban/README.md

Este plano visa unificar a lógica de capacidades ao modelo **Single Brain**, eliminando mini-cérebros e centralizando o estado.

## 🎯 Objetivos
1.  Eliminar decisões em em `SkillManager` e `stepCapabilities`.
2.  Centralizar o estado de capacidades no `SessionManager` (`CognitiveState`).
3.  Converter componentes lógicos em **Pure Signals**.

---

## 🛠️ Mudanças Propostas

### 1. Centralização de Estado (`CapabilityRegistry` -> `SessionManager`)
*   **Remover**: O `Map` interno de `CapabilityRegistry`.
*   **Mover**: Injetar `capabilities` como parte do `CognitiveState` no `SessionManager`.
*   **Ação**: `CapabilityRegistry` torna-se apenas um helper/type-def ou é absorvido pelo `SessionManager`.

### 2. Transformação em Signals (Stateless)
*   **`stepCapabilities.ts`**:
    *   Renomear `resolveRuntimeModeForPlan` para `getPlanSignals`.
    *   Deve retornar apenas fatos (ex: `hasHtmlEntry: boolean`) em vez de decisões (ex: `skipRuntimeExecution: boolean`).
*   **`capabilityFallback.ts`**:
    *   Deve retornar apenas metadados sobre a capacidade e não o `mode` (`blocked`/`degraded`). A decisão de degradar é do Orquestrador.
*   **`languageConfig.ts`**:
    *   Remover `resolveAppLanguage` do helper.
    *   Tornar o arquivo um **Pure Signal** que apenas expõe o que está no Ambiente e o que está no arquivo.
    *   O `CognitiveOrchestrator` ou um `SettingsManager` centralizado deve fazer a resolução final.


### 3. SkillManager como Puro Executor
*   **Remover**: `SkillPolicy` e lógica de `ensure`.
*   **Substituir**: O Orquestrador decide se deve instalar. O `SkillManager` fornece métodos atômicos: `check(cap)` e `install(cap)`.
*   **Fluxo**:
    1.  Orchestrator vê `capability_gap`.
    2.  Orchestrator decide `strategy: INSTALL_PENDING`.
    3.  `CognitiveActionExecutor` chama `skillManager.install(cap)`.

### 4. Unificação de Decisão no Orchestrator
*   Mover a lógica de `requiresDOM` e skipping de runtime para o pipeline de decision do `CognitiveOrchestrator`.

---

## 🗓️ Fases de Migração

| Fase | Descrição | Risco |
| :--- | :--- | :--- |
| **1. Estado** | Mover Map para CognitiveState no SessionManager. | ⚠️ Médio (Regressão em testes) |
| **2. Signals** | Refatorar `stepCapabilities` para remover decisões. | 🔥 Crítico (Impacta AgentExecutor) |
| **3. Policy** | Remover SkillPolicy do SkillManager; mover para Orchestrator. | ⚠️ Médio |
| **4. Executor** | Simplificar `AgentExecutor` e mover loop de healing para o Orquestrador. | 🔥 Crítico |
| **5. Flow** | Sincronizar `FlowState` com `SessionManager`. | ⚠️ Médio |

---

## 📂 src/core/agent

### Problema
Presença de lógica de decisão descentralizada em `decisionGate` e `TaskClassifier`, além de duplicação de detecção de intenção.

### Evidência
- `decisionGate.ts`: Implementa lógica de threshold e roteamento (`confirm` vs `execute`).
- `TaskClassifier.ts`: Decide quando pedir mais contexto ao usuário.
- `PendingActionTracker.ts`: Duplica heurísticas de `IntentionResolver`.

### Correção proposta
- **Eliminar `decisionGate.ts`**: Mover a lógica de thresholds e decisão de confirmação para o `CognitiveOrchestrator`.
- **Refatorar `TaskClassifier`**: Transformar em **Pure Signal**. Em vez de retornar `needsContext` e `contextQuestion`, deve retornar apenas `missing_metadata: ['source']`. O Orquestrador decide se deve perguntar.
- **Centralizar Memória**: Mover o armazenamento de `ClassificationMemory` para dentro do `CognitiveState` no `SessionManager`.

---

## 📂 src/core/executor

### Problema
O executor atua como um cérebro secundário (split-brain) ao gerenciar loops de auto-correção (`runWithHealing`) e replanejamento direto via LLM.

### Evidência
- `AgentExecutor.ts`: Implementa `MAX_RETRIES` e chama `this.replan()` recursivamente.
- `repairPipeline.ts`: Contém lógica heurística de "conserto" de planos que deveria ser estratégica.

### Correção proposta
- **Externalizar o Loop de Healing**: O `AgentExecutor` deve executar apenas UM passo de cada vez (ou um plano atômico) e retornar o erro ao Orquestrador. O Orquestrador decide se deve tentar o `replan` ou pedir ajuda ao usuário.
- **Remover Chamadas Diretas ao LLM**: O Executor não deve ter acesso ao `llmProvider`. Toda geração de texto ou plano deve passar pelos Signals consumidos pelo Orquestrador.
- **Fundir `repairPipeline` no Planejador/Orquestrador**: As correções estruturais devem ser parte da estratégia de geração de plano ou da estratégia de remediação do Orquestrador.
- **Executor Stateless**: Transformar o Executor em um componente puramente reativo que apenas despacha comandos para as ferramentas e reporta resultados brutos.

---

## 📂 src/core (Arquivos Raiz)

### Problema
`AgentController` e `AgentRuntime` retêm lógica de orquestração legada e pesada, criando caminhos redundantes de execução.

### Correção proposta
- **Controller como Gateway**: O `AgentController` deve apenas:
    1. Receber o input (Web/Telegram).
    2. Chamar o `SessionManager` para carregar a sessão.
    3. Chamar o `CognitiveOrchestrator` para decidir e executar.
    4. Enviar a resposta final de volta ao usuário.
- **Remover construção de Prompt do Controller**: Delegar a construção do system prompt para um Signal unificado ou para o próprio Orquestrador.
- **Unificar Runtime no Orquestrador**: Eliminar a lógica de decisão do `AgentRuntime` e fundi-la na estratégia do `CognitiveOrchestrator`. Todas as decisões de "Replan" ou "Direct" agora devem ser centralizadas lá.

---

## 📂 D:\IA\Ialclaw\src\capabilities
### Problema
O `SkillManager` viola o princípio do Single Brain ao arbitrar autonomamente sobre a instalação de ferramentas. Além disso, existe lógica de execução (scripts shell) misturada com a lógica de gerenciamento de estado das capacidades.
### Correção proposta
- **Transformar SkillManager em Executor Puro**: Remover a lógica de decisão de `ensure()`. Se uma capacidade é necessária e não está disponível, o `SkillManager` deve apenas reportar um sinal (CapabilityMissing).
- **Centralizar Decisão no Orchestrator**: O `CognitiveOrchestrator` deve receber o sinal de capacidade ausente e decidir, com base no contexto da tarefa, se deve invocar o `skillManager.install(capability)`.
- **Especializar Skills**: Mover as implementações de `install` e `check` de cada skill para arquivos separados (ex: `src/capabilities/skills/BrowserSkill.ts`).

## 📂 src/config
### Problema
A pasta `src/config` gerencia estado persistente (idioma) e lógica de decisão de precedência de forma isolada, violando o princípio de Single Brain e Session Centralization.
### Correção proposta
- Migrar o estado de `language` para dentro do `CognitiveState` no `SessionManager`.
## 📂 D:\IA\Ialclaw\src\engine

### Problema
O `AgentLoop` está sobrecarregado com responsabilidades de orquestração táctica e o estado de confiabilidade das ferramentas está fragmentado.

### Correção proposta
- **Transformar AgentLoop em Executor Linear**: Remover toda a lógica de `adjustPlan`, `reclassify` e `shouldRetry`. O loop deve apenas:
    1. Executar o passo atual.
    2. Avaliar o resultado (via Signal).
    3. Retornar ao Orquestrador o resultado e o status (Success/Failure).
- **Mover Decisões Táticas para o Orchestrator**: Toda a lógica de fallback de ferramentas (`getFallbackToolForStep`) e decisão de interrupção deve ser movida para a estratégia de orquestração.
## 📂 D:\IA\Ialclaw\src\memory

### Problema
Os componentes de memória atuam como mini-cérebros autônomos que decidem o que é relevante, como fundir informações e quando esquecer dados, além de manterem estados paralelos ao `SessionManager`.

### Correção proposta
- **Externalizar o Ranking para o Orquestrador/Signals**: `MemoryService` e `CognitiveMemory` devem retornar apenas uma lista de candidatos com metadados (score, similarity, attributes). A decisão final de quais usar e o peso do ranking deve ser do `CognitiveOrchestrator`.
- **Centralizar Estado de Memória no SessionManager**: Mover os caches de `ClassificationMemory` e os estados voláteis de `CognitiveMemory` (`recentlyUsedNodes`, etc) para o `CognitiveState`.
- **Padrão de "Proposed Update"**: Em vez de `mergeContent` automático, o `MemoryService` deve sinalizar uma contradição ou nova informação ao Orquestrador, que então decide se deve atualizar a memória.
## 📂 D:\IA\Ialclaw\src\schemas

### Problema
Uso de lógica de validação manual extensiva, o que dificulta a manutenção e a garantia de consistência em esquemas complexos (ex: `workspace_apply_diff`).

### Correção proposta
- **Migrar para Zod**: Substituir os validadores manuais em `toolSchemas.ts` por esquemas Zod (ou similar) para maior robustez e tipagem automática.

---

## 📂 src/scripts
### Problema
Os scripts de bootstrap e testes reforçam a dispersão da lógica de decisão de roteamento e identidades.
### Correção proposta
- **Centralizar Definições de Identidade**: Mover as definições do `bootstrap-identities.ts` para um Signal centralizado ou para o `CognitiveOrchestrator`.

---

## 📂 src/search
### Problema
O módulo funciona como um "segundo cérebro" com estado próprio e decisões de relevância embutidas, quebrando a centralização do modelo Single Brain.
### Correção proposta
- **Centralizar Índices e Caches**: Migrar o `InvertedIndex` e todos os caches de busca para o `SessionManager` (via `CognitiveState`) ou para um Manager de Conhecimento persistente sincronizado.
- **Transformar em Pure Signals**: Refatorar `AutoTagger`, `Scorer` e `GraphAdapter` para serem puramente reativos, retornando apenas metadados e scores brutos sem tomar decisões de "boost" ou "fallback".

---

## 📂 src/services
### Problema
O module de serviços abriga lógica de decisão de diálogo (Onboarding) e gestão de estado de sessão isolada.
### Correção proposta
- **Unificar Onboarding no FlowManager**: Migrar o fluxo de onboarding para o sistema unificado de `Flows` do `src/core/flow`, permitindo que o `CognitiveOrchestrator` governe a conversação.
- **Persistir Estado no SessionManager**: Remover o `Map` de estados local e integrar o progresso do onboarding ao `CognitiveState` persistente.
- Neutralizar WorkspaceService: Remover as decisões de "reutilização" de projeto do serviço. Ele deve apenas executar a ordem de "criar" ou "abrir" enviada pelo orquestrador.

---

## 📂 src/shared
### Problema
O `SessionManager` contém pequenos fragmentos de lógica de decisão e possui dependências cíclicas com o `core`. O `TraceRecorder` é rígido em sua configuração de eventos.

### Correção proposta
- **Externalizar Decisões de Task**: Remover a lógica de ativação automática de `updateTaskContext`. O Orquestrador deve enviar explicitamente o estado `active: true/false`.
- **Inverter Dependências**: Refatorar os tipos de `PendingAction` e `FlowState` para uma pasta de tipos comum (`src/types` or similar) or para o próprio `SessionManager`, eliminando o import de `core` em `shared`.
- **TraceRecorder Reativo**: Alterar o `TraceRecorder` para aceitar uma configuração de eventos via sinais de inicialização, ou simplesmente gravar todos os eventos que chegam ao `DebugBus` sem filtragem hardcoded (delegando a inteligência de filtro para a query de análise).
- **Consolidar getCognitiveState**: Mover a lógica de projeção semântica de `getCognitiveState` para um **Signal** no core, mantendo o `SessionManager` puramente como um repositório de dados brutos.

---

## 📂 D:\IA\Ialclaw\src\skills

### Problema
A pasta `src/skills` abriga mini-brains de decisão (`SkillResolver`) e estado paralelo (`SkillResolutionManager.pendingSkillList`), além de duplicar lógica de detecção de intenção.

### Correção proposta
- **Transformar SkillResolver em Signal**: O resolver deve apenas fornecer uma lista de candidatos ("Signals") baseados no input. A decisão de qual skill ativar deve ser do `CognitiveOrchestrator`.
- **Mover Estado para o SessionManager**: A lista de skills pendentes de instalação (`pendingSkillList`) deve ser armazenada no `CognitiveState` para garantir persistência e visibilidade.
- **Remover Mini-Brains de Intenção**: Eliminar a detecção de verbos "instalar/usar" via regex dentro de `SkillResolutionManager`. Essa tarefa deve ser centralizada no `IntentionResolver` do core.
- **Neutralizar SkillLoader**: Mantê-lo como um Helper puramente técnico para leitura de arquivos, sem lógica de política.

---

## 📂 D:\IA\Ialclaw\src\telegram

### Problema
O módulo de Telegram acumula responsabilidades decisórias sobre onboarding, permissões de usuário e estratégia de anexação de arquivos, além de realizar transformações de texto (sanitização) que deveriam ser centralizadas.

### Correção proposta
- **TelegramInputHandler como Pure Signal**:
    - Remover chamadas ao `OnboardingService`. O handler deve apenas emitir o payload de texto.
    - O Orquestrador detecta via Signals (`OnboardingSignals`) se o usuário precisa de onboarding e desvia o fluxo.
    - Transformar `isUserAllowed` em um Signal de segurança.
- **TelegramOutputHandler como Pure Executor**:
    - Remover `sanitizeOutput`. O Orquestrador deve enviar o texto já final e localizado.
    - Remover `resolveArtifactAttachment`. O Orquestrador deve enviar explicitamente no comando de saída qual arquivo deve ser anexado (ex: `send(text, attachmentPath)`).
    - Reportar falhas de entrega de forma estruturada para o Orquestrador decidir sobre o retry estratégico (ex: "usuário bloqueou o bot").

---

## 📂 src/tools

### Problema
As ferramentas do workspace acumulam pequenas lógicas de decisão (mini-brains) sobre ranking de âncoras, validação de integridade e detecção de anomalias em diffs.

### Correção proposta
- **Externalizar Pesos de Diff**: Mover os pesos de `strategyWeight`, `uniquenessBoost` e `specificityBoost` para uma configuração de Signal ou permitir que o Orquestrador os envie como parâmetros.
- **Parametrizar Validação de Projeto**: O `workspace_validate_project` deve receber as regras ou o "rigor" (ex: `strict: true`) do Orquestrador, em vez de ter limites fixos.
- **Reportar Facts em vez de Suspicion**: O `workspace_apply_diff` deve reportar a mudança percentual de tamanho para o Orquestrador, e o Orquestrador decide se o `DIFF_RESULT_SUSPICIOUS` é um erro real ou uma deleção intencional.
- **Neutralizar workspaceRunProject**: O Orquestrador deve especificar o runtime (ex: `runtime: 'node'`) no comando de execução, ou a tool deve retornar múltiplos sinais de runtime possíveis para decisão superior.


---

## 📂 src/utils

### Problema
Presença de estado volátil isolado (`messageDedup`) e pequenas decisões táticas de correção de input e infraestrutura.

### Correção proposta
- **Centralizar Cache de Mensagens**: Mover o `processedMessages` de `messageDedup.ts` para o `CognitiveState` no `SessionManager`. O utilitário deve tornar-se um **Pure Signal** que recebe o estado atual do cache para validar.
- **Externalizar Decisão de Infra**: O `ollamaCheck.ts` deve apenas reportar sinais (`OLLAMA_NOT_RUNNING`). A decisão de tentar iniciar o serviço (`startOllama`) deve ser comandada pelo Orquestrador como uma `SystemAction`.
- **Mover Normalização de Aliases**: Remover heurísticas de `validateToolInput.ts`. Se o LLM errar o nome do campo, o erro deve subir como um sinal de `tool_input_error` e o Orquestrador deve decidir se aplica uma correção automática (via um Signal de `InputRepair`) ou se pede novo plano.
- **Injeção de Configuração**: Substituir acessos diretos a `process.env` por uma configuração injetada (proveniente do `SessionManager` ou `CognitiveOrchestrator`) para manter o determinismo.

---

## 📂 src/dashboard

### Problema
O Dashboard atua como um orquestrador secundário para o canal web, acumulando estado de controle local e decisões de fluxo de onboarding/configuração.

### Correção proposta
- **Neutralizar Chat Web**: Remover a lógica de onboarding do `DashboardServer`. O chat deve apenas encaminhar o payload para o `AgentController`, que delegará ao Orquestrador a decisão de disparar o onboarding (via Signals).
- **Centralizar Controle de Cancelamento**: Mover a flag `cancelRequested` para o `SessionManager` (`CognitiveState`). O Orquestrador deve consultar este sinal centralizado para decidir a interrupção.
- **Consumir Sinais de Confiança Reais**: Substituir o cálculo hardcoded de confiança pelo valor retornado pelo `CognitiveOrchestrator` no payload de resposta.
- **Delegar Persistência de Configuração**: O dashboard deve apenas emitir um comando de alteração de configuração para o Orquestrador. A persistência e aplicação do novo estado devem ser responsabilidade do `SessionManager`.
- **Abstração de Dados de Grafo**: Em vez de consultar o SQLite diretamente, o dashboard deve consumir um **Signal** (`MemorySignals`) que provê a visualização do grafo de forma agnóstica ao armazenamento.

---

## 📂 src/db e src/i18n

### Problema
Cálculo de idioma e estado de localização fragmentados; inicialização de sistema centralizada em script procedural.

### Correção proposta
- **Transformar i18n em Pure Signal**: `detectLanguage` deve retornar um `LanguageSignal` (ex: `{ detected: 'pt-BR', confidence: 0.8 }`) que o Orquestrador consome para setar o idioma na sessão.
- **Centralizar Idioma no SessionManager**: Mover a preferência de idioma para o `CognitiveState`. O `shared/i18n` deve apenas prover as strings com base no idioma passado pelo cérebro.
- **Injetar Banco de Dados**: DatabaseManager deve ser injetado nos Managers que dele necessitam, reduzindo o uso de `getInstance()` global.
- **Refatorar index.ts**: Criar um `SystemOrchestrator` ou similar para gerenciar o ciclo de vida da aplicação (setup, healthchecks, startup de serviços), deixando o `index.ts` apenas como o ponto de entrada que invoca este orquestrador de sistema.
- **Mover Tools Nativas do Startup**: O registro de tools como `memory.store` e `list_available_tools` deve ser movido para uma classe de `SystemCapabilities` ou similar, limpando a inicialização.
