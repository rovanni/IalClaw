# Auditoria Arquitetural Unificada: Modelo Single Brain

Este documento consolida os achados da auditoria realizada em todo o ecossistema do **IalClaw**, focando na transição para o modelo **Single Brain**.

## 🎯 O Objetivo: Single Brain
O sistema está sendo reestruturado para que exista apenas **uma entidade decisora** (`CognitiveOrchestrator`) e **uma fonte de verdade** para o estado (`SessionManager`). No modelo ideal:

- 🧠 **Brain (Orchestrator)**: Único que toma decisões estratégicas.
- 📡 **Signals**: Fornecem dados e fatos (stateless).
- ⚙️ **Executors**: Apenas cumprem ordens, sem "pensar" sobre o sucesso ou falha.
- 💾 **State (Managers)**: Armazenam dados exclusivamente via `SessionManager`.

---

## 🗺️ Panorama por Componente

### 1. `src/core` (O Núcleo Estratégico)
Apesar da introdução do `CognitiveOrchestrator`, o core ainda sofre com o fenômeno de **Split-Brain**.
- **Problema**: `AgentController` e `AgentRuntime` ainda detêm lógica legada de orquestração.
- **Mini-Brains**: `decisionGate.ts` e `DecisionHandler.ts` competem com o Orquestrador na resolução de erros.
- **Risco**: 🔥 **Crítico** - Conflitos de decisão e loops infinitos de replanejamento.

### 2. `src/engine` (O Sistema de Execução)
O motor de execução atual é "inteligente demais", o que quebra a hierarquia de comando.
- **Problema**: `AgentLoop.ts` decide autonomamente sobre fallbacks de ferramentas e reclassificação de tarefas.
- **Estado Paralelo**: `ToolReliability.ts` armazena métricas de sucesso em memória estática, invisíveis ao snapshot da sessão.
- **Risco**: 🔥 **Crítico** - Decisões táticas tomadas no vácuo, sem consciência do contexto global do Orquestrador.

### 3. `src/capabilities` (A Interface Técnica)
As habilidades do agente estão misturadas com lógica de política de segurança.
- **Problema**: `SkillManager.ts` decide sozinho se deve instalar uma ferramenta (auto-install).
- **Mini-Brains**: `stepCapabilities.ts` decide modos de runtime (ex: si browser é obrigatório).
- **Risco**: ⚠️ **Médio** - Execução de ações de alto custo/risco sem autorização expressa do cérebro.

### 4. `src/memory` (Gestão de Conhecimento)
O sistema de memória atua como um subsistema autônomo, tomando decisões de relevância e integridade de dados.
- **Problema**: `CognitiveMemory` e `MemoryService` decidem o ranking e a expurgação de dados via heurísticas locais.
- **Mini-Brains**: Consolidação de informações (`mergeContent`) e priorização de busca (`rankWithHybridScoring`) fora do controle do Orquestrador.
- **Estado Paralelo**: `ClassificationMemory` e caches de busca residem em Maps privados, isolados do snapshot da sessão.
- **Risco**: 🔥 **Crítico** - Alucinações de memória e perda de contexto persistente entre reinicializações.

### 5. `src/schemas` (Validação de Contratos)
Resguarda a integridade técnica das chamadas de ferramentas.
- **Papel**: **Signal / Helper**.
- **Observação**: ✅ **Totalmente Alinhado**. É um componente puramente funcional e sem estado que garante que o LLM não envie dados inválidos para o sistema.
- **Melhoria**: Oportunidade de modernizar a validação manual para esquemas tipados (Zod).

### 6. `src/scripts` (Scripts Utilitários e Infraestrutura)
Componente de suporte que revela dependências ocultas e lógicas de decisão estáticas.
- **Problema**: Lógica de roteamento (keywords/prioridades) hardcoded em scripts de bootstrap.
- **Mini-Brains**: `AgentGateway` decide o roteamento semântico de forma semiautônoma.
- **Risco**: ⚠️ **Médio** - Inconsistência entre o estado real do banco de dados e a intenção do Orquestrador.

### 7. `src/search` (Subsistema de Busca e Relevância)
Módulo pesado de recuperação de informação que opera de forma semiautônoma.
- **Problema**: Pipeline de busca complexo e scoring hardcoded fora do Orquestrador.
- **Estado Paralelo**: Mais de 5 caches em memória e índice invertido isolados do `SessionManager`.
- **Risco**: 🔥 **Crítico** - Conhecimento fragmentado e impossibilidade de snapshot completo do cérebro.

### 8. `src/services` (Serviços de Suporte e Aplicação)
Contém a lógica de onboarding e a ponte técnica com o sistema de arquivos do workspace.
- **Problema**: `OnboardingService` opera como um subsistema de decisão isolado para diálogos e classificação.
- **Decisões em Sombra**: Lógica de reutilização de projetos no `WorkspaceService` compete com a estratégia do Orquestrador.
- **Risco**: 🔥 **Crítico** - Quebra a unidade de decisão cognitiva em fluxos de boas-vindas e gestão de projetos.


### 9. `src/shared` (A Fundação de Estado e Logs)
É onde reside a memória de curto prazo e a infraestrutura de observabilidade.
- **Papel**: **State / Helper**.
- **Problema**: `SessionManager` carrega responsabilidades de interpretação de estado que pertencem ao cérebro.
- **Vazamento**: Dependência indesejada do `shared` para com o `core`.
- **Observação**: Centraliza corretamente o estado conversacional, permitindo a continuidade da tarefa.
- **Risco**: ⚠️ **Médio** - Dificulta a portabilidade e cria acoplamento entre estado e lógica.

### 10. `src/skills` (Habilidades e Ferramentas)
Responsável pelo ecossistema de habilidades dinâmicas do agente.
- **Problema**: `SkillResolver` decide qual skill ativar e `SkillResolutionManager` mantém estado de busca paralelo.
- **Mini-Brains**: Roteamento de comandos e detecção de intenção local de instalação.
- **Estado Paralelo**: Caches de resultados de busca e listas pendentes fora do `SessionManager`.
- **Risco**: 🔥 **Crítico** - Quebra a unidade de decisão do Orquestrador e causa perda de contexto em fluxos de instalação.

### 11. `src/telegram` (Interface de Mensageria)
Interface de comunicação direta com o usuário final via Telegram.
- **Problema**: O `TelegramInputHandler` atua como um gatekeeper de onboarding e permissões. O `TelegramOutputHandler` toma decisões sobre seleção de anexos e sanitização de texto.
- **Mini-Brains**: Onboarding (Input) e Seleção de Artefatos (Output).
- **Risco**: 🔥 **Crítico** - Bypass da lógica central de diálogo e opacidade na entrega de resultados.

### 12. `src/tools` (Ferramentas de Manipulação do Workspace)
Engloba as ferramentas que realizam a "escrita" e "execução" dos planos no mundo real.
- **Problema**: Lógica de "resultado suspeito" no diff e pesos de âncoras hardcoded.
- **Mini-Brains**: Regras de validação de projeto (`runValidationRules`) e decisão de runtime automática (Node vs HTML).
- **Risco**: ⚠️ **Médio** - Impedem que o Orquestrador tenha controle total sobre o rigor da execução e a estratégia de recuperação.

### 13. `src/utils` (Utilitários Técnicos e Auxiliares)
Pasta de suporte para processamento de erros, caminhos e validações de infraestrutura.
- **Problema**: Estado volátil isolado em `messageDedup.ts` para evitar duplicidade de mensagens.
- **Micro-Brains**: `ollamaCheck.ts` decide estratégias de inicialização e `validateToolInput.ts` realiza normalização de aliases do LLM.
- **Risco**: ⚠️ **Médio** - Reprocessamento de mensagens em restarts e opacidade na correção de falhas de input do LLM.

### 14. `src/dashboard` (Interface Web e Monitoramento)
Interface web para monitoramento, depuração e interação via chat.
- **Problema**: O Dashboard atua como um orquestrador secundário para o canal web.
- **Mini-Brains**: Onboarding (Web Chat), Cálculo de Confiança Hardcoded e Persistência de Configuração Direta.
- **Estado Paralelo**: Flag de cancelamento de execução (`webExecutionControl`) isolada do `SessionManager`.
- **Risco**: 🔥 **Crítico** - Quebra a unidade de decisão e o controle de estado centralizado.

### 15. `src/db` (Camada de Persistência)
Gerenciamento físico do banco SQLite e schemas.
- **Papel**: **Manager / Storage**.
- **Observação**: ✅ **Totalmente Alinhado**. Provê a infraestrutura necessária para o `SessionManager` sem exercer lógica cognitiva.

### 16. `src/i18n` (Internacionalização)
Tradução e detecção de idioma.
- **Problema**: Mini-brain de detecção de idioma e estado de localization paralelo.
- **Risco**: ⚠️ **Médio** - Conflitos de idioma e perda de controle centralizado sobre a comunicação.

### 17. `src/index.ts` (Entry Point)
Ponto de entrada do sistema.
- **Problema**: Acúmulo de decisões de infraestrutura e registro procedural de ferramentas.
- **Risco**: 🟢 **Baixo** - Dificulta a manutenção do ciclo de vida do sistema.

---

## 🔴 Principais Anti-Patterns Identificados
1.  **Decisões em Shadow (Mini-Brains)**: Lógicas de `if/else` que decidem "o que fazer a seguir" espalhadas por Executors e Signals.
2.  **Loops de Auto-Cura Opacos**: O `AgentExecutor` e o `AgentLoop` tentam se "auto-corrigir" chamando o LLM repetidamente sem reportar falhas ao Orquestrador.
3.  **Vazamento de Estado**: Uso de `static maps`, caches locais e arquivos JSON para persistir informações que deveriam estar no `CognitiveState`.
4.  **Sinais Impuros**: Componentes que deveriam apenas reportar fatos (ex: "ferramenta X não encontrada") mas acabam sugerindo ou executando a solução.
5.  **Decisões de Periféricos**: Handlers de I/O (Telegram) tomando decisões de negócio e comunicação que pertencem ao Orquestrador.

---

## 🚀 Roadmap de Transformação

### Fase 1: Unificação do Estado
- Migrar todos os caches e maps (Capacidades, Confiabilidade, Flows) para o `CognitiveState` no `SessionManager`.
- Eliminar o uso de `config.json` para estado mutável.

### Fase 2: Depuração de Mini-Brains
- Transformar `AgentLoop`, `SkillManager` e `AgentExecutor` em componentes **Stateless e Reativos**.
- Mover toda a lógica de `threshold`, `retry`, `fallback` e `replan` para o `CognitiveOrchestrator`.

### Fase 3: Purificação de Sinais
- Garantir que classificadores e validadores retornem apenas **Metadados Brutos**.
- Remover qualquer chamada direta ao LLM de dentro dos Executors.

### Fase 4: Neutralização de I/O
- Refatorar Handlers de Telegram para serem puramente reativos (Input emite sinais, Output executa comandos de envio brutos).

---

**Conclusão**: A arquitetura está evoluindo para um modelo onde o corpo (`Executors`) obedece cegamente e reporta fielmente, enquanto o cérebro (`Orchestrator`) é o único responsável pela estratégia e continuidade da consciência.
