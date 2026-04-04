# 🧠 PLANO DE CORREÇÃO — KB-022 (FOLLOW-UP)
## Consolidar governança do Skill Flow no AgentController

**Data de criação:** 2026-04-04  
**Prioridade:** Médio  
**Status:** Pendente

---

## 🧠 CONTEXTO

Estamos evoluindo o projeto **IalClaw** para o modelo **Single Brain**, onde:

* O **CognitiveOrchestrator** é o único decisor
* O **AgentLoop** apenas executa
* Todas as decisões são representadas como **signals explícitos**
* O sistema deve ser **auditável, previsível e sem decisões distribuídas**

---

## 🔍 Diagnóstico do Problema

O KB-022 foi aplicado com sucesso no fluxo principal de conversa, mas restou uma pendência no caminho de execução de skills em `AgentController.runWithSkill()`.

### Problema A — Skill Flow ainda faz chamadas diretas às ACTIVE DECISIONs

Arquivo: `src/core/AgentController.ts`

Trecho residual identificado no fluxo de skill:

```ts
const skillStopContinueDecision = this.orchestrator.decideStopContinue(sessionId);
const skillFallbackDecision = this.orchestrator.decideToolFallback(sessionId);
const skillValidationDecision = this.orchestrator.decideStepValidation(sessionId);
const skillRouteDecision = this.orchestrator.decideRouteAutonomy(sessionId);
const skillFailSafeDecision = this.orchestrator.decideFailSafe(sessionId);
```

Esse bloco mantém no controller a coordenação explícita das decisões ativas, em vez de delegar a consolidação ao `CognitiveOrchestrator` por meio de `applyActiveDecisions(sessionId)`.

### Problema B — Skill Flow não audita consistência após aplicar decisões

No fluxo principal, após `applyActiveDecisions(sessionId)`, o controller chama:

```ts
this.orchestrator.auditSignalConsistency(sessionId);
```

No fluxo de skill, a ingestão passiva ocorre, mas a auditoria final de consistência não é executada após aplicar as decisões observadas.

### Por que isso importa

* Ainda existe coordenação cognitiva residual no controller em um caminho de execução específico
* O fluxo principal e o fluxo de skill podem divergir em auditoria, logs e manutenção futura
* O sistema permanece funcional, mas com assimetria arquitetural e risco de regressão silenciosa

---

## ⚠️ REGRA CRÍTICA — VERIFICAR ANTES DE IMPLEMENTAR

Antes de qualquer implementação, você DEVE:

### 🔍 Verificar:

* Se já existe lógica equivalente
* Se já existe função com outro nome
* Se já existe comportamento semelhante

### ♻️ Se existir:

* REUTILIZAR
* NÃO recriar

### 🚫 PROIBIDO:

* Duplicar código
* Criar fluxos paralelos
* Reimplementar comportamento existente

👉 Isso evita:

* duplicação de código
* conflitos com arquitetura
* regressões silenciosas
* inconsistência cognitiva

---

## ⚙️ ESTRATÉGIA DE REFATORAÇÃO (OBRIGATÓRIO)

A refatoração deve ser estrutural, não funcional.
O comportamento do sistema deve permanecer exatamente igual.

### 📌 Granularidade obrigatória

* Refatorar função por função
* NÃO refatorar arquivo inteiro de uma vez

### 🧩 Ordem obrigatória por função

1. Identificar partes cognitivas dentro da função
2. Separar lógica técnica e lógica cognitiva
3. Manter lógica técnica no local atual
4. Converter lógica cognitiva em signal apropriado, criando ou reutilizando
5. Manter a execução local por enquanto
6. Adicionar TODO explícito para migração futura ao Orchestrator

### 🚫 Restrições desta etapa

* NÃO alterar comportamento atual
* NÃO ativar decisão nova no Orchestrator nesta fase
* NÃO remover lógica existente durante a extração para signal

---

## 📋 CHECKLIST VIVO (OBRIGATÓRIO)

Arquivo:

```text
D:\IA\IalClaw\docs\architecture\kanban\historico\checklist_vivo.md
```

Após qualquer alteração, atualizar:

a. O que já foi corrigido
b. O que está em andamento
c. O que ainda falta
d. O que NÃO deve ser tocado agora

---

## 🧠 REGRAS ARQUITETURAIS

* Orchestrator é o único decisor
* Signals representam intenção, não lógica nova
* AgentLoop NÃO decide, estado alvo
* NÃO alterar heurísticas existentes
* NÃO remover branches existentes

---

## 🌐 INTERNACIONALIZAÇÃO (i18n) — OBRIGATÓRIO

Mantenha sempre o padrão do sistema com foco em internacionalização.
Certifique-se de aplicar as diretrizes de i18n do sistema em todas as etapas.

### 📌 Regras obrigatórias

* Todo string visível ao usuário deve usar `t('chave')` do módulo `src/i18n`
* Nunca usar strings hardcoded em mensagens de erro, logs externos ou respostas ao usuário
* Adicionar sempre as chaves em ambos os catálogos: `src/i18n/pt-BR.json` e `src/i18n/en-US.json`
* Usar params tipados quando a mensagem contiver valores dinâmicos: `t('chave', { param: valor })`
* Seguir o namespace existente: `error.executor.*`, `runtime.*`, `agent.*`, etc.

### ✅ Checklist i18n por etapa

* [ ] Chaves adicionadas em `pt-BR.json`
* [ ] Chaves adicionadas em `en-US.json`
* [ ] Strings hardcoded substituídas por `t()`
* [ ] `npx tsc --noEmit` sem erros após as alterações

---

## ⚠️ SAFE MODE (OBRIGATÓRIO)

```ts
finalDecision = orchestratorDecision ?? loopDecision
```

---

## 📍 VALIDAÇÃO DE INSERÇÃO

Antes de aplicar qualquer patch:

* Confirmar contexto real do código
* Confirmar método atual
* Confirmar escopo da classe

🚫 NÃO inserir baseado apenas em número de linha

---

## 🧩 ESCOPO DA IMPLEMENTAÇÃO

👉 Implementar **APENAS esta etapa**:

**Substituir, em `runWithSkill()`, a coordenação manual das ACTIVE DECISIONs por `applyActiveDecisions(sessionId)` e adicionar `auditSignalConsistency(sessionId)` ao final do fluxo de skill, preservando exatamente o comportamento atual e o safe mode.**

---

## 📋 ETAPAS DE IMPLEMENTAÇÃO

---

### ETAPA 1 — Validar reutilização obrigatória no Skill Flow

**Arquivo:** `src/core/AgentController.ts`  
**Risco:** Baixo  
**Critério de conclusão:** confirmado que `applyActiveDecisions(sessionId)` já atende integralmente o fluxo necessário e que não será criado helper paralelo.

#### O que fazer

1. Confirmar que `CognitiveOrchestrator.applyActiveDecisions(sessionId)` já retorna:
   * `loop`
   * `orchestrator`
   * `applied`
   * `safeModeFallbackApplied`
2. Confirmar que os logs atuais do fluxo de skill podem ser alimentados por esse retorno sem mudar payload nem semântica.
3. Confirmar que não existe outro helper específico de skill já pronto para esse uso.

#### Restrições

* NÃO criar novo método no controller para repetir `applyActiveDecisions`
* NÃO alterar contrato de `ActiveDecisionsResult`

#### Checklist de compilação

* [ ] `npx tsc --noEmit` após validação estrutural inicial

---

### ETAPA 2 — Consolidar ACTIVE DECISIONs do Skill Flow

**Arquivo:** `src/core/AgentController.ts`, método `runWithSkill()`  
**Risco:** Médio  
**Critério de conclusão:** o fluxo de skill deixa de chamar individualmente `decideStopContinue`, `decideToolFallback`, `decideStepValidation`, `decideRouteAutonomy` e `decideFailSafe`, passando a consumir apenas `applyActiveDecisions(sessionId)`.

#### O que fazer

1. Localizar o bloco logo após `this.orchestrator.ingestSignalsFromLoop(skillSignals, sessionId)`.
2. Substituir as cinco chamadas diretas por:

```ts
const activeDecisions = this.orchestrator.applyActiveDecisions(sessionId);
```

3. Reapontar os logs do fluxo de skill para:
   * `activeDecisions.loop.*`
   * `activeDecisions.orchestrator.*`
   * `activeDecisions.applied.*`
   * `activeDecisions.safeModeFallbackApplied.*`
4. Preservar exatamente o padrão safe mode:
   * decisão final aplicada = `orchestratorDecision ?? loopDecision`
5. Manter a semântica atual dos logs de debug e do fluxo de execução.

#### Restrições

* NÃO alterar conteúdo dos logs além do estritamente necessário para consumir a estrutura consolidada
* NÃO alterar heurísticas do Orchestrator
* NÃO alterar o comportamento do AgentLoop

#### Checklist de compilação

* [ ] `npx tsc --noEmit` após a substituição inicial
* [ ] `npx tsc --noEmit` após ajustes de tipagem/log

---

### ETAPA 3 — Restaurar auditoria de consistência no Skill Flow

**Arquivo:** `src/core/AgentController.ts`, método `runWithSkill()`  
**Risco:** Baixo  
**Critério de conclusão:** o fluxo de skill passa a chamar `this.orchestrator.auditSignalConsistency(sessionId)` no mesmo estágio lógico já usado no fluxo principal.

#### O que fazer

1. Inserir `this.orchestrator.auditSignalConsistency(sessionId)` após o bloco de decisões ativas do skill flow.
2. Confirmar que a chamada ocorre antes da persistência final de resposta e memória.
3. Confirmar que a auditoria não altera o comportamento de execução, apenas observabilidade e coerência arquitetural.

#### Restrições

* NÃO mover a ordem de persistência sem necessidade
* NÃO introduzir nova decisão ou branch no controller

#### Checklist de compilação

* [ ] `npx tsc --noEmit` após inserir a auditoria

---

### ETAPA 4 — Validação e atualização do Kanban

**Critério de conclusão:** follow-up do KB-022 registrado com evidência e sem regressão funcional.

#### O que fazer

1. Executar `npx tsc --noEmit` com zero erros.
2. Executar `npm.cmd test` sem novas regressões relativamente ao estado atual.
3. Confirmar que o fluxo principal e o fluxo de skill usam o mesmo ponto de consolidação de decisões ativas.
4. Confirmar que o fluxo de skill agora também chama `auditSignalConsistency(sessionId)`.
5. Atualizar `docs/architecture/kanban/historico/checklist_vivo.md`.
6. Atualizar `docs/architecture/kanban/concluido.md` ou registrar o follow-up no histórico apropriado, com data e evidência.

---

## 🧪 VALIDAÇÃO OBRIGATÓRIA (VERSÃO AVANÇADA)

Após implementar, você DEVE verificar:

---

### 1. inconsistências

* O fluxo principal e o fluxo de skill usam a mesma fonte consolidada de decisão ativa?
* Existe divergência entre os payloads de log dos dois caminhos?

---

### 2. duplicações

* Restou lógica paralela de coordenação de decisões no controller?
* Existe código equivalente com outro nome no skill flow?

---

### 3. melhorias seguras

* O bloco de debug do skill flow pode ser centralizado depois, sem alterar comportamento?
* A auditoria pós-decisão pode virar helper comum em etapa futura?

---

### 4. riscos arquiteturais

* Existe bypass do Orchestrator no caminho de skill?
* Existe mini-brain ativo no controller após a mudança?

---

### 5. coerência de autoridade

* Quem decide de fato no fluxo de skill?
* Existe mais de um decisor competindo após a consolidação?

---

## 🔥 6. VERIFICAÇÃO DE CONFLITOS REAIS (OBRIGATÓRIO)

### a. conflitos entre signals

* Route vs FailSafe no fluxo de skill
* Validation vs StopContinue no fluxo de skill
* Fallback vs Route no fluxo de skill

---

### b. divergência loop vs orchestrator

* decisões diferentes?
* qual foi aplicada?
* `safeModeFallbackApplied` reflete corretamente os casos `undefined`?

---

### c. conflitos silenciosos

* conflitos no fluxo de skill continuam sem auditoria?
* existe signal observado e não auditado?

---

### d. inconsistência de comportamento

* execução indevida?
* confirmação indevida?
* regressão em skill install/list/ask_input?

---

### e. conflito de autoridade

* signals competindo?
* ausência de hierarquia?
* controller ainda decide algo que deveria ser apenas auditado/aplicado?

---

## 🏗️ 7. VALIDAÇÃO ESTRUTURAL (CRÍTICA)

### a. escopo correto

* código dentro da classe correta?
* dentro do método `runWithSkill()`?

---

### b. integridade sintática

* chaves `{}` corretas?
* código não inserido entre métodos?

---

### c. integração válida

* variáveis existem?
* `ActiveDecisionsResult` já está acessível no arquivo?
* métodos do Orchestrator acessíveis?

---

### d. impacto controlado

* poucas alterações?
* sem efeito colateral no fluxo principal?

---

### e. compilação incremental ⚠️

* compilou após cada etapa?

---

## ❗ REGRA DE SEGURANÇA

Se ocorrer:

* muitos erros, mais de 5
* erro estrutural
* comportamento inesperado

👉 PARAR imediatamente  
👉 reavaliar antes de continuar

---

## ❗ REGRA FINAL

Se encontrar qualquer problema:

👉 NÃO corrigir automaticamente  
👉 NÃO alterar heurísticas  
👉 NÃO tomar decisão implícita

👉 APENAS reportar

---

## 🚀 RESULTADO ESPERADO

* Zero duplicação de coordenação ativa entre fluxo principal e skill flow
* Zero regressão funcional
* Decisões auditáveis nos dois caminhos
* Conflitos visíveis
* Arquitetura preservada

---

## 🚫 O QUE NÃO TOCAR NESTE FOLLOW-UP

| Componente | Motivo |
|---|---|
| Heurísticas de decideStopContinue/decideToolFallback/decideStepValidation/decideRouteAutonomy/decideFailSafe | Já pertencem ao Orchestrator |
| Prompt de skill | Fora do escopo desta etapa |
| SkillResolver / SkillResolution | Fora do escopo desta etapa |
| Fluxo principal de runConversation | Já consolidado no KB-022 |
| AgentLoop | Não alterar comportamento técnico nesta correção |

---

## 🔗 Referências

* Plano base: `docs/architecture/plans/KB-022_Correcao_AgentController_AgentRuntime_SingleBrain.md`
* Template: `docs/architecture/templates/prompt_template.md`
* Checklist vivo: `docs/architecture/kanban/historico/checklist_vivo.md`
* Kanban concluído: `docs/architecture/kanban/concluido.md`
* Mapa de problemas: `docs/architecture/kanban/mapa_problemas_sistema.md`