# Cognitive Architecture Map: src/capabilities

Este documento mapeia a função e o papel arquitetural de cada arquivo na pasta `src/capabilities`, seguindo o modelo **Single Brain**.

## 🗺️ Mapeamento de Arquivos

| Arquivo | Função Real | Papel Arquitetural | Estado |
| :--- | :--- | :--- | :--- |
| `CapabilityRegistry.ts` | Armazena o estado de disponibilidade das ferramentas. | **State** | ❌ **Desalinhado** (Mantém Map interno) |
| `SkillManager.ts` | Gerencia a verificação e instalação de skills/ferramentas. | **Executor** | ❌ **Desalinhado** (Toma decisões de policy) |
| `bootstrapCapabilities.ts` | Inicializa as capacidades básicas no startup. | **Router / Initializer** | ✅ Alinhado |
| `capabilityFallback.ts` | Define estratégias de fallback para capacidades ausentes. | **Signal** | ❌ **Desalinhado** (Contém lógica de decisão) |
| `stepCapabilities.ts` | Identifica requisitos de ferramentas por passo do plano. | **Signal** | ❌ **Desalinhado** (Mini-cérebro de runtime) |
| `taskCapabilities.ts` | Mapeia tipos de tarefa para capacidades necessárias. | **Signal** | ✅ Alinhado |
| `index.ts` | Ponto de entrada e registro de instâncias globais. | **Router** | ✅ Alinhado |

### `src/config`

| Arquivo | Função Real | Papel Arquitetural | Estado |
| :--- | :--- | :--- | :--- |
| `languageConfig.ts` | Resolve e persiste o idioma global do sistema. | **Signal / Helper** | ❌ **Desalinhado** (Ficheiro `config.json` paralelo) |

### `src/core`

| Arquivo/Pasta | Função Real | Papel Arquitetural | Estado |
| :--- | :--- | :--- | :--- |
| `src/core/agent` | Analisadores de intenção e classificadores de tarefa. | **Signal** | ❌ **Mini-brains** em `decisionGate` e `TaskClassifier`. |
| `src/core/autonomy` | Motores de decisão de autonomia e roteamento. | **Brain / Signal** | ❌ **Mini-brains** em `ActionRouter` e `DecisionEngine`. |
| `src/core/executor` | Execução de planos e self-healing. | **Executor** | 🔥 **Crítico**: Loop de decisão paralelo em `AgentExecutor`. |
| `src/core/flow` | Gerenciamento de fluxos conversacionais. | **Mini-Brain** | ❌ **Split-Brain**: Estado isolado do `SessionManager`. |
| `src/core/planner` | Geração de planos de execução. | **Signal** | ⚠️ **Desalinhado**: Reparo interno de planos (self-healing). |
| `src/core/orchestrator` | Orquestração central de decisões. | **The Brain** | ⚠️ **Desalinhado**: Delegação de autoridade excessiva. |

---

## 🔄 Fluxo de Dados e Decisão

1.  **Input Phase**: O `TelegramInputHandler` ou `AgentController` pode emitir sinais de `capability_gap`.
2.  **Orchestration Phase**: O `CognitiveOrchestrator` avalia se existe um gap e decide a estratégia (`CONFIRM`, `ASK`).
3.  **Execution Phase**:
    *   O `CognitiveActionExecutor` chama `skillManager.ensure` para instalar capacidades pendentes.
    *   O `AgentExecutor` consulta `stepCapabilities` para decidir modos de runtime.

---

## 🧠 Análise de Cognição

### Mini-cérebros Detectados
*   **SkillManager**: Decide se deve falhar ou iniciar auto-instalação com base em uma `policy` interna.
*   **stepCapabilities**: Decide se o runtime deve ser pulado ou se browser é obrigatório (`resolveRuntimeModeForPlan`).
*   **capabilityFallback**: Decide o modo de degradação (`blocked` vs `degraded`).
*   **languageConfig**: Decide a precedência de idioma (`Env > Config > Fallback`) em `resolveAppLanguage`.

### Split-Brain (Estado Distribuído)
*   **Capacidades**: O estado vive no `CapabilityRegistry.capabilities` (Map privado), isolado do `SessionManager`.
---

## 📂 src/core/context

Contém sinais puros relacionados à continuidade da tarefa e extração de metadados do input. Após a remoção do `TaskContextManager`, a pasta tornou-se totalmente sem estado (stateless).

### Papel arquitetural dominante
- **Signals**

### Fluxos principais
- Fornece `TaskContextSignals.detectContinuation` para o Orquestrador/Loop decidir se o input refere-se à tarefa anterior.
- Auxilia na extração de fontes e objetivos (`extractTaskData`) do texto bruto.

---

## 📂 src/core/agent

Responsável pela classificação de intenções e roteamento preliminar de decisões.

### Papel arquitetural dominante
- **Signals** (`IntentionResolver`, `TaskClassifier`)
- **Executor** (`executeTool`)
- **Brain (Indevido)** (`decisionGate`)

### Fluxos principais
- O input passa pelo `IntentionResolver` para detectar comandos como "stop", "continue", "confirm".
- O `TaskClassifier` rotula o tipo de tarefa (code, system, content, etc.).
- O `decisionGate` tenta decidir autonomamente se deve executar, confirmar ou passar a tarefa.

### Observações
- ❌ **Mini-brain detectado** em `decisionGate.ts`: Ele toma decisões de política de confiança que pertencem ao Orquestrador.
- 🟡 **Lógica duplicada**: Detecção de confirmação/retry existe tanto no `IntentionResolver` quanto no `PendingActionTracker`.

---

## 📂 src/core/executor

Responsável pela execução física dos planos gerados, incluindo mecânicas de diff, validação e self-healing.

### Papel arquitetural dominante
- **Executor** (`AgentExecutor`, `diffStrategy`)
- **Signal / Helper** (`repairPipeline`, `operationalLearning`)
- **State** (`AgentConfig`)

### Fluxos principais
- Recebe um `ExecutionPlan` e executa passo a passo via `executeToolCall`.
- Monitora falhas de execução e inicia o pipeline de `repair` e `replan`.
- Decide modos de validação (soft, strict, minimal) e estratégias de escrita em arquivo via `diffStrategy`.

### Observações
- 🔥 **Crítico: Loop de Decisão Paralelo**: `AgentExecutor.ts` contém um loop de "Self-Healing" que realiza até 5 tentativas de replanejamento via LLM sem intervenção do Orquestrador.
- ❌ **Mini-brain detectado** em `repairPipeline.ts`: Toma decisões automáticas de correção de estrutura de plano (ex: injeção de `workspace_create_project`).

---

## 📂 src/core/flow

Gerencia fluxos de conversação multi-etapa (assistentes guiados).

### Papel arquitetural dominante
- **Mini-Brain / State (Isolado)** (`FlowManager`)
- **Router** (`FlowRegistry`)
- **Signal / Logic** (`flows/`)

### Fluxos principais
- O `FlowManager` mantém o progresso do usuário em sessões guiadas.
- O `FlowRegistry` carrega definições de fluxos como o `HtmlSlidesFlow`.

### Observações
- 🔥 **Crítico: Estado Isolado**: O progresso do flow vive na memória da classe `FlowManager`, não sendo persistido no `SessionManager`. 

## 📂 src/core (Arquivos Raiz)

- **AgentController.ts**: 🔥 **Crítico: Split-Brain**. Atua como um orquestrador secundário, gerenciando comandos, skills e construção de contexto pesado por fora do Orquestrador Cognitivo.
- **AgentRuntime.ts**: ❌ **Split-Brain Legado**. Gerencia o pipeline de decisão de "Replan vs Direct" de forma paralela ao Orquestrador.
- **AgentRuntime.ts**: Gateway para o Planner e Executor.

---

## 🧐 Conclusão da Auditoria `src/core`

A arquitetura do IalClaw encontra-se em um estado de transição. Embora o `CognitiveOrchestrator` tenha sido introduzido, ele ainda compete com "cérebros" legados e mini-brains locais:

1. **Decisões Distribuídas**: Thresholds de autonomia e confiança estão espalhados por 4-5 arquivos diferentes.
2. **Loops Opacos**: O ciclo de "Self-Healing" no Executor impede que o Orquestrador tome decisões estratégicas sobre falhas.
3. **Estado Fragmentado**: O progresso de fluxos (Flows) e memórias de classificação não estão no `SessionManager`.
4. **Decisões em Sombra**: `DecisionHandler.ts` e `decisionGate.ts` competem com o Orquestrador na resolução de erros e roteamento.

---

## 📂 src/shared
Pasta contendo utilitários transversais, gerenciamento de sessão e persistência de traces. É o alicerce de estado e observabilidade do sistema.

### Papel arquitetural dominante
- **State** (`SessionManager`)
- **Helper** (`AppLogger`, `BinaryUtils`, `DebugBus`, `TraceContext`, `sanitizePath`)
- **Executor** (`TraceRecorder`)

### Observações
- **SessionManager**: Atua corretamente como o **Single Source of Truth** para o estado da sessão, consolidando `pending_actions`, `task_context` e `reactive_state`.
- **TraceRecorder**: Garante a persistência de eventos para auditoria e depuração.
- ❌ **Mini-brain detectado** em `SessionManager.ts`: A função `updateTaskContext` decide autonomamente o estado `active` da tarefa.
- ⚫ **Vazamento de Abstração**: `SessionManager` importa tipos e helpers de `src/core`, criando uma dependência circular indesejada entre a camada de estado e a camada lógica.
- ⚫ **Vazamento de Abstração**: `TraceRecorder` possui uma lista hardcoded de eventos do sistema, exigindo manutenção manual a cada nova funcionalidade.

### 📂 src/core/autonomy (Análise Detalhada)

| Arquivo | Função Real | Papel Arquitetural | Estado |
| :--- | :--- | :--- | :--- |
| `ActionRouter.ts` | Decide a rota de execução (Tool vs Direct LLM). | **Signal** | ✅ Alinhado (Stateless) |
| `CapabilityResolver.ts` | Detecta lacunas de ferramentas (gaps). | **Signal** | ✅ Alinhado (Stateless) |
| `ConfidenceScorer.ts` | Agrega múltiplos sinais de confiança. | **Signal** | ✅ Alinhado (Stateless) |
| `DecisionEngine.ts` | Lógica pura de decisão de autonomia. | **Signal (Logic)** | ✅ Alinhado (Stateless) |

### 📂 src/core/validation e tools

| Arquivo | Função Real | Papel Arquitetural | Estado |
| :--- | :--- | :--- | :--- |
| `DecisionHandler.ts` | Decide interações de recuperação de erro. | **Mini-Brain** | 🔥 **Split-Brain**: Compete com o Orchestrator. |
| `PlanExecutionValidator.ts` | Valida o sucesso do plano executado. | **Signal** | ✅ Alinhado |
| `ToolRegistry.ts` | Catálogo de ferramentas disponíveis. | **Manager** | ✅ Alinhado |
| `TaskContextSignals.ts` | Detecta sinais de continuidade (contexto). | **Signal** | ✅ Alinhado (Stateless) |

4. **Acoplamento no Controller**: O `AgentController` conhece detalhes demais sobre a construção de prompts e execução de skills.

---

## 📂 D:\IA\Ialclaw\src\capabilities
Esta pasta gerencia as capacidades técnicas do agente (browser, fs, node, etc.) e os "Skills" que as provêm. Ela atua como a interface entre as necessidades cognitivas (o que o cérebro quer fazer) e a disponibilidade técnica (o que o corpo consegue fazer).

### Papel arquitetural dominante
- **Signal / Executor / State** (Mistura de funções que deve ser segregada).

### Observações
- A maioria dos arquivos (`stepCapabilities.ts`, `taskCapabilities.ts`, `capabilityFallback.ts`) atua corretamente como **Signals** (estáticos e sem decisão).
- `CapabilityRegistry.ts` é o **State** local de capacidades.
- `SkillManager.ts` está sobrecarregado, atuando como Brain (decidindo instalações) e Executor (rodando comandos shell).

---

## 📂 D:\IA\Ialclaw\src\schemas
Contém definições de esquemas e validadores para garantir a integridade dos dados trocados entre o LLM e as ferramentas (Skills).

### Papel arquitetural dominante
- **Signal / Helper** (`toolSchemas.ts`)

### Observações
- ✅ **Alinhado**: Os esquemas são puramente funcionais e sem estado (stateless).

---

## 📂 src/scripts
Pasta contendo scripts utilitários de setup, inicialização de dados (bootstrap) e testes de infraestrutura.

### Papel arquitetural dominante
- **Executor / Helper**

### Observações
- **bootstrap-identities.ts**: Atua como um semeador de banco de dados, mas contém lógica de roteamento (keywords, priority) hardcoded.
- **test-routing.ts**: Revela que o `AgentGateway` está atuando como um "mini-brain" de roteamento semântico.

---

## 📂 src/search
Módulo completo de busca semântica, indexação e ranking. Atua como um subsistema de recuperação de informação.

### Papel arquitetural dominante
- **Router / Executor (SearchEngine)**
- **Signal (LLM/Logic)**
- **State / Manager (InvertedIndex)**

### Observações
- **SearchEngine.ts**: Atua como um orquestrador tático, coordenando múltiplos componentes (AutoTagger, Scorer, GraphBridge).
- **AutoTagger.ts**: Signal baseado em LLM com fallback heurístico para classificação de documentos.
- **InvertedIndex.ts**: Mantém o estado do índice em memória volátil.
- **Scorer.ts**: Implementa lógica de ranking com pesos hardcoded.

---

## 📂 src/services
Contém serviços de suporte à aplicação, incluindo onboarding de usuários e gestão técnica do workspace.

### Papel arquitetural dominante
- **Executor / Manager**
- **Mini-Brain (Onboarding)**

### Observações
- **OnboardingService.ts**: 🔥 **Crítico**. Atua como um orquestrador de diálogo independente, decidindo fluxos e classificando intenções via regex.
- **WorkspaceService.ts**: Atua majoritariamente como um Executor de sistema de arquivos para projetos, mas invade decisões de sessão ao gerenciar a reutilização de projetos.

---

## 📂 D:\IA\Ialclaw\src\skills
Gerencia o carregamento, resolução e instalação de skills (ferramentas) do agente. Atua como o "corpo" de ferramentas disponíveis.

### Papel arquitetural dominante
- **Helper / Executor / Signal** (Mistura que exige segregação)

### Mapeamento de Arquivos

| Arquivo | Função Real | Papel Arquitetural | Estado |
| :--- | :--- | :--- | :--- |
| `AuditLog.ts` | Consulta status de segurança das skills. | **Helper** | ✅ Alinhado |
| `SkillInstaller.ts` | Interface para instalação de skills. | **Executor** | ✅ Alinhado |
| `SkillLoader.ts` | Carrega `SKILL.md` e parseia frontmatter. | **Helper / Signal** | ✅ Alinhado |
| `SkillResolutionManager.ts` | Busca e resolve skills a partir do input. | **Router / State** | ❌ **Desalinhado** (Estado paralelo) |
| `SkillResolver.ts` | Decide qual skill deve ser executada. | **Router / Brain** | ❌ **Desalinhado** (Mini-brain) |
| `types.ts` | Definições de tipos do domínio de skills. | **Helper** | ✅ Alinhado |
| `internal/skill-installer.ts` | Execução física (git/npm) da instalação. | **Executor** | ✅ Alinhado |

### Observações
- **SkillResolutionManager**: Mantém a lista `pendingSkillList` em memória privada, invisível ao `SessionManager`.
- **SkillResolver**: Toma decisões de roteamento e possui lógica de intenção embutida (regex para comandos).
- **AuditLog**: Fornece sinais de política (status de auditoria) essenciais para a segurança.

---

## 📂 D:\IA\Ialclaw\src\telegram
Esta pasta gerencia a comunicação de entrada e saída com a plataforma Telegram. Atua como o "periférico" de entrada/saída do sistema.

### Papel arquitetural dominante
- **Router / Signal** (`TelegramInputHandler`)
- **Executor** (`TelegramOutputHandler`)

### Observações
- **TelegramInputHandler**: Converte atualizações brutas do Telegram em `CognitiveInputPayload`. Atualmente contém lógica de onboarding e verificação de permissões que deveria ser sinalizada, não decidida.
- **TelegramOutputHandler**: Responsável pela entrega de mensagens, geração de áudio (TTS) e anexação de artefatos. Apresenta lógica de sanitização e seleção de anexo que belong ao cérebro.

---

## 📂 src/tools
Esta pasta contém as ferramentas técnicas (Tools) que o agente utiliza para manipular o workspace, incluindo criação de projetos, salvamento de arquivos, aplicação de diffs e execução/validação de código.

### Papel arquitetural dominante
- **Executor** (`workspaceCreateProjectTool`, `workspaceSaveArtifactTool`, `workspaceApplyDiffTool`, `workspaceRunProjectTool`)
- **Signal / Logic** (`workspaceValidateProjectTool`, `workspaceDiff.ts`)

### Observações
- **workspaceApplyDiffTool**: Atua como um Executor, mas depende de heurísticas de decisão para validar a "suspicion" do resultado.
- **workspaceDiff.ts**: Centraliza a lógica de resolução de âncoras, mas contém pesos e scores hardcoded que definem a estratégia de aplicação do patch.
- **workspaceRunProjectTool**: Decide o runtime (Node vs HTML) com base na presença de arquivos específicos.
- **workspaceValidateProjectTool**: Fornece sinais sobre a integridade do projeto, mas as regras de validação estão embutidas no código.


---

## 📂 src/utils
Conjunto de utilitários técnicos e auxiliares para processamento de erros, strings, caminhos e validações de infraestrutura.

### Papel arquitetural dominante
- **Helper / Signal**

### Mapeamento de Arquivos

| Arquivo | Função Real | Papel Arquitetural | Estado |
| :--- | :--- | :--- | :--- |
| `errorClassifier.ts` | Categoriza erros técnicos. | **Signal** | ✅ Alinhado |
| `errorFingerprint.ts` | Gera hashes estáveis de erros. | **Helper** | ✅ Alinhado |
| `inputOscillation.ts` | Detecta repetição tática de inputs. | **Signal** | ✅ Alinhado |
| `messageDedup.ts` | Evita reprocessamento de mensagens. | **State / Manager** | ❌ **Desalinhado** (Estado paralelo) |
| `minimalChange.ts` | Valida se correção de plano foi cirúrgica. | **Signal** | ✅ Alinhado |
| `ollamaCheck.ts` | Gestão de disponibilidade do Ollama. | **Executor / Signal** | ❌ **Desalinhado** (Decisão de infra) |
| `parseLlmJson.ts` | Parse e auto-reparo de JSON do LLM. | **Helper** | ✅ Alinhado |
| `pathResolver.ts` | Proteção de path traversal e absolute paths. | **Helper** | ✅ Alinhado |
| `validateToolInput.ts` | Validação de esquemas e normalização. | **Executor / Signal** | ❌ **Desalinhado** (Mini-brain de aliases) |

### Observações
- **messageDedup.ts**: Mantém cache volátil em memória, quebrando a persistência do Single Brain.
- **ollamaCheck.ts**: Toma decisões de inicialização de serviço (systemctl vs serve).
- **validateToolInput.ts**: Contém heurísticas de mapeamento de campos (`project_name` -> `name`) que são decisões cognitivas sobre tolerância a falhas do LLM.

---

## 📂 src/dashboard
Interface web para monitoramento, depuração e interação com o agente. Provê visualização de grafos, logs em tempo real (via SSE) e um chat web.

### Papel arquitetural dominante
- **Router / Executor**

### Mapeamento de Arquivos

| Arquivo | Função Real | Papel Arquitetural | Estado |
| :--- | :--- | :--- | :--- |
| `DashboardServer.ts` | Servidor API e Host de arquivos estáticos. | **Router / Executor** | ❌ **Desalinhado** (Estado e decisões locais) |
| `public/` | Interface do usuário (HTML/JS). | **Helper / Assets** | ✅ Alinhado |

### Observações
- **DashboardServer**: Atua como um "periférico" de entrada/saída, mas acumula lógica de onboarding e persistência de configuração que deveria ser centralizada.
- **SSE Stream**: O endpoint `/debug/stream` expõe eventos do `DebugBus` diretamente, o que é um excelente sinal de observabilidade, mas o dashboard decide como rotular esses eventos.

---

## 📂 src/db
Camada de abstração física para persistência de dados em SQLite.

### Papel arquitetural dominante
- **Manager / State (Storage)**

### Observações
- **DatabaseManager.ts**: Singleton que garante a saúde do arquivo de banco de dados e aplica o schema inicial.
- **schema.sql**: Define os contratos de dados para memórias (episódica, semântica e cognitivo-grafo).

---

## 📂 src/i18n
Gerenciamento de tradução e localização.

### Papel arquitetural dominante
- **Signal / Helper**

### Observações
- ❌ **Mini-brain detectado**: `detectLanguage` decide autonomamente o idioma do input via heurísticas.
- ❌ **Estado Paralelo**: O idioma ativo é mantido em variáveis globais/locais (`AsyncLocalStorage`).

---

## 📂 src (Arquivos Raiz)

### Papel arquitetural dominante
- **Router / Initializer**

### Observações
- **index.ts**: Centraliza o bootstrap, mas acumula decisões de infraestrutura (Ollama startup, database repair) e registro de tools nativas.
