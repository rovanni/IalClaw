# 🧠 PLANO DE CORREÇÃO — KB-022
## Remover Split-Brain de AgentController e AgentRuntime

**Data de criação:** 2026-04-04  
**Prioridade:** Crítico  
**Status:** Pendente → Em andamento  

---

## 🔍 Diagnóstico do Problema

### O que é o split-brain aqui

O **KB-022** documenta que `AgentController` e `AgentRuntime` operam com orquestração própria em paralelo ao `CognitiveOrchestrator`, criando dois problemas distintos:

#### Problema A — AgentRuntime cria seu próprio CognitiveOrchestrator
Arquivo: `src/core/AgentRuntime.ts`

```ts
constructor(memory: CognitiveMemory) {
    this.planner = new AgentPlanner(memory);
    this.orchestrator = new CognitiveOrchestrator(memory, new FlowManager()); // ← instância paralela
    this.executor = new AgentExecutor(memory, this.orchestrator);
}
```

O `AgentRuntime` instancia seu próprio `CognitiveOrchestrator`, independente do do `AgentController`.  
Qualquer chamada via `AgentRuntime.execute()` toma decisões (REPLAN, DIRECT_EXECUTION, REPAIR_AND_EXECUTE) fora da governança central.

#### Problema B — AgentController.runConversation concentra lógica cognitiva pesada
Arquivo: `src/core/AgentController.ts`, método `runConversation` (~600 linhas)

Responsabilidades atuais que não deveriam estar no controller:
1. **Context Building** — RAG retrieval (`provider.embed`, `retrieveWithTraversal`), construção de `contextStr`, injeção de projetos, skills e nome do usuário no prompt.
2. **System Prompt Assembly** — montagem de `messages[]` com system prompt de ~30 linhas hardcoded + blocos condicionais.
3. **Múltiplas ACTIVE DECISIONs semanais ao Orchestrator** — `decideStopContinue`, `decideToolFallback`, `decideStepValidation`, `decideRouteAutonomy`, `decideFailSafe` chamados diretamente no controller, fora do fluxo do Orchestrator.
4. **Gerenciamento de ciclo de vida de memória** — `captureLifecycleMemory`, `memory.learn`, `saveMessage` intercalados com a lógica principal.

### Por que isso é crítico

- Enquanto o `AgentRuntime` tiver seu próprio Orchestrator, qualquer execução via runtime bypassa completamente a governança.
- Enquanto o `AgentController` montar o prompt e ingerir signals diretamente, ele atua como orquestrador secundário — as decisões de `decideStopContinue` etc. ficam dependentes de contexto que só o Orchestrator deveria ter.
- Os KBs parcialmente mitigados (KB-001, KB-017, KB-020, KB-023, KB-024) dependem do Orchestrator ter autoridade real; isso não é possível enquanto o controller e o runtime concorrem.

---

## ⚠️ REGRA CRÍTICA — VERIFICAR ANTES DE IMPLEMENTAR

Antes de cada etapa:
- [ ] Verificar se já existe função/módulo equivalente no Orchestrator ou em helpers existentes
- [ ] NÃO recriar comportamento que já existe
- [ ] NÃO duplicar código
- [ ] Compilar com `npx tsc --noEmit` após cada passo

---

## ⚙️ ESTRATÉGIA DE REFATORAÇÃO

Conforme o template Single Brain:
- Refatorar **função por função**, não arquivo inteiro
- Manter comportamento exatamente igual durante toda a migração
- Safe mode obrigatório onde aplicável: `finalDecision = orchestratorDecision ?? localDecision`
- Adicionar TODOs explícitos para remoção futura de fallback local

---

## 📋 ETAPAS DE IMPLEMENTAÇÃO

---

### ETAPA 1 — Neutralizar instância paralela do Orchestrator no AgentRuntime

**Arquivo:** `src/core/AgentRuntime.ts`  
**Risco:** Baixo (AgentRuntime não é chamado no fluxo principal atual do controller)  
**Critério de conclusão:** `AgentRuntime` não instancia mais seu próprio `CognitiveOrchestrator`; usa apenas o `AgentExecutor` diretamente.

#### O que fazer

1. Identificar todos os pontos de uso de `this.orchestrator` dentro de `AgentRuntime.execute()`.
2. Extrair `ingestSelfHealingSignal` para ser chamado externamente (ou remover se o executor já emite signal via DebugBus).
3. Remover `this.orchestrator = new CognitiveOrchestrator(...)` do construtor.
4. Adicionar método `setOrchestrator(orchestrator: CognitiveOrchestrator)` (pattern já usado no AgentLoop).
5. Declarar `private orchestrator?: CognitiveOrchestrator` e proteger uso com guarda.

#### Restrições
- NÃO alterar a lógica de REPLAN/DIRECT_EXECUTION desta etapa (isso é KB-001/KB-020)
- NÃO remover `decideExecutionPath` ou heurísticas existentes
- Apenas remover a instanciação autônoma do Orchestrator

#### Checklist de compilação
- [ ] `npx tsc --noEmit` sem erros após remoção do `new CognitiveOrchestrator` no construtor
- [ ] `npx tsc --noEmit` após adição de `setOrchestrator`

---

### ETAPA 2 — Extrair Context Building de runConversation para ContextSignal

**Arquivo:** `src/core/AgentController.ts`, método `runConversation`  
**Risco:** Médio — afeta construção do system prompt  
**Critério de conclusão:** a montagem de `contextStr` + blocos de projetos/skills/usuário vira método isolado `buildConversationContext()`; o `runConversation` apenas consome o resultado.

#### O que fazer

1. Identificar o bloco de Context Building em `runConversation` (linhas ~570–630):
   ```
   provider.embed(effectiveUserQuery)
   memory.retrieveWithTraversal(...)
   memory.getIdentityNodes()
   contextBuilder.build(...)
   getUserName() + concatenação
   getProjectNodes() + concatenação
   resolveLanguage + buildLanguageDirective
   ```
2. Extrair para método **privado** `buildConversationContext(sessionId, effectiveUserQuery, session): Promise<ConversationContext>` retornando objeto tipado `{ contextStr, languageDirective, projectInfo, skillsBlock, history, assistantName }`.
3. O `runConversation` passa a chamar `buildConversationContext` e usa o objeto retornado.
4. Adicionar TODO: `// TODO KB-022: mover para ContextBuildingSignal no Orchestrator`

#### Restrições
- NÃO alterar strings de prompt
- NÃO alterar a ordem de resolução de idioma
- NÃO mover para o Orchestrator ainda (só isolar localmente)

#### Checklist de compilação
- [ ] `npx tsc --noEmit` após extração do método
- [ ] Comportamento idêntico verificado em execução manual

---

### ETAPA 3 — Extrair montagem do System Prompt para SystemPromptBuilder

**Arquivo:** `src/core/AgentController.ts`  
**Risco:** Baixo (extração pura, sem mudança de comportamento)  
**Critério de conclusão:** a construção do `messages[]` com o system prompt longo é delegada a um método/helper isolado; `runConversation` apenas chama e usa o resultado.

#### O que fazer

1. Verificar se já existe `SystemPromptBuilder` ou equivalente — se sim, reutilizar.
2. Se não existir: criar método privado `buildSystemPrompt(context: ConversationContext): MessagePayload[]` que monta o array de mensagens.
3. O `runConversation` passa a chamar `buildSystemPrompt(context)` e passa o resultado ao `this.loop.run(messages, policy)`.
4. Adicionar TODO: `// TODO KB-022: SystemPrompt deve vir como output de signal do Orchestrator`

#### Restrições
- NÃO alterar conteúdo das strings do prompt
- NÃO criar classe nova nesta etapa — método privado no próprio controller é suficiente

#### Checklist de compilação
- [ ] `npx tsc --noEmit` após extração

---

### ETAPA 4 — Consolidar as ACTIVE DECISIONs no Orchestrator

**Arquivo:** `src/core/AgentController.ts`  
**Risco:** Médio — afeta fluxo de signals pós-loop  
**Critério de conclusão:** as 5 chamadas de `decideXxx(sessionId)` saem do `runConversation` e passam a ser disparadas de dentro do `CognitiveOrchestrator` após `ingestSignalsFromLoop`.

#### O que fazer

1. Verificar se o método `ingestSignalsFromLoop` no `CognitiveOrchestrator` já existe (sim, confirmado na leitura).
2. Adicionar no `CognitiveOrchestrator` um método `applyActiveDecisions(sessionId: string): ActiveDecisionsResult` que interna e sequencialmente chama:
   - `this.decideStopContinue(sessionId)`
   - `this.decideToolFallback(sessionId)`
   - `this.decideStepValidation(sessionId)`
   - `this.decideRouteAutonomy(sessionId)`
   - `this.decideFailSafe(sessionId)`
   e retorna o objeto com os resultados (já consolidado).
3. No `runConversation`, substituir os 5 blocos de `ACTIVE DECISION` por uma única chamada:
   ```ts
   const activeDecisions = this.orchestrator.applyActiveDecisions(sessionId);
   ```
4. Manter o log de debug com safe-mode idêntico ao atual, mas alimentado pelo retorno de `applyActiveDecisions`.
5. Manter `auditSignalConsistency` após o bloco.
6. Safe mode preservado: cada decisão interna ao método usa `orchestratorDecision ?? loopDecision`.

#### Restrições
- NÃO remover os métodos individuais `decideXxx` do Orchestrator (eles continuam existindo)
- NÃO alterar heurísticas de cada decisão
- NÃO ativar nova lógica — apenas consolidar as chamadas que já existem

#### Checklist de compilação
- [ ] `npx tsc --noEmit` após criar `applyActiveDecisions` (vazio)
- [ ] `npx tsc --noEmit` após adicionar lógica ao método
- [ ] `npx tsc --noEmit` após substituir no `runConversation`

---

### ETAPA 5 — Validação e atualização do Kanban

**Critério de conclusão:** KB-022 movido para `concluido.md` com evidência.

#### O que fazer

1. Executar `npx tsc --noEmit` — zero erros.
2. Executar `npm.cmd test` — sem novas regressões relativamente ao estado atual.
3. Confirmar que `AgentRuntime` não instancia mais Orchestrator próprio.
4. Confirmar que `runConversation` não tem mais blocos de ACTIVE DECISION espalhados.
5. Mover KB-022 de `Pendente/problemas_criticos.md` para `concluido.md` com data e evidência.
6. Atualizar `mapa_problemas_sistema.md` (radar de críticos).
7. Atualizar `historico/checklist_vivo.md`.

---

## 🚫 O QUE NÃO TOCAR NESTE KB

| Componente | Motivo |
|---|---|
| Lógica de REPLAN/DIRECT no AgentRuntime | Escopo do KB-001 |
| repairPipeline no AgentExecutor | Escopo do KB-020 |
| FlowManager estado interno | Escopo do KB-021 |
| Heurísticas de stop/delta no StopContinueModule | Já migradas (KB-003 concluído) |
| stepCapabilities/resolveRuntimeModeForPlan | Escopo do KB-002 |
| Prompt strings e i18n keys existentes | Nunca alterar sem necessidade |

---

## 🌐 CHECKLIST i18n (por etapa)

- [ ] Nenhuma string nova visível ao usuário foi adicionada sem `t('chave')`
- [ ] Se novas chaves forem criadas: adicionadas em `src/i18n/pt-BR.json` **e** `src/i18n/en-US.json`
- [ ] `npx tsc --noEmit` sem erros após qualquer adição de string

---

## ⚠️ SAFE MODE — Lembrete

Toda decisão que envolva fallback de Orchestrator deve seguir:

```ts
finalDecision = orchestratorDecision ?? localDecision
```

Nunca remover o fallback local sem garantir que o Orchestrator sempre retorne valor definido.

---

## 📏 TAMANHO DOS MÉTODOS

- Nenhum método novo deve ultrapassar 50 linhas na primeira versão
- Se ultrapassar, quebrar em sub-métodos antes de integrar

---

## 🔗 Referências

- Kanban: [problemas_criticos.md](../kanban/Pendente/problemas_criticos.md)
- Diagnóstico: [AntiPatterns.md](../diagnostics/AntiPatterns.md)
- Mapa: [CognitiveArchitectureMap.md](../maps/CognitiveArchitectureMap.md)
- Proposta geral: [ProposedChanges.md](ProposedChanges.md)
- Template: [prompt_template.md](../templates/prompt_template.md)
- Histórico: [checklist_vivo.md](../kanban/historico/checklist_vivo.md)
