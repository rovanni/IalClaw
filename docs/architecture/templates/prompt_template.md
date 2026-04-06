# 🧠 TEMPLATE PADRÃO DEFINITIVO — SINGLE BRAIN (VERSÃO 2.0)

---

## 🧠 CONTEXTO

Estamos evoluindo o projeto **IalClaw** para o modelo **Single Brain**, onde:

* O **CognitiveOrchestrator** é o único decisor
* O **AgentLoop** apenas executa
* Todas as decisões são representadas como **signals explícitos**
* O sistema deve ser **auditável, previsível e sem decisões distribuídas**

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
## ⚙️ PLANO ESTRATÉGICO DE REFATORAÇÃO (OBRIGATÓRIO)

Crie um plano em arquivo do que precisa ser feito com Checklist a ser validado e salve em:
D:\IA\IalClaw\docs\architecture\plans
Exemplo: D:\IA\IalClaw\docs\architecture\plans\KB-027-PLANO.md
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
4. Converter lógica cognitiva em signal apropriado (criando ou reutilizando)
5. Manter a execução local por enquanto
6. Adicionar TODO explícito para migração futura ao Orchestrator

### 🚫 Restrições desta etapa

* NÃO alterar comportamento atual
* NÃO ativar decisão nova no Orchestrator nesta fase
* NÃO remover lógica existente durante a extração para signal

---

### 📋 CHECKLIST KANBAN V2.0 (OBRIGATÓRIO)

Após qualquer alteração, os ficheiros nas pastas físicas devem ser atualizados:

1. Pendente: Remover o card de docs/architecture/kanban/Pendente/problemas_*.md.
2. Andamento: Manter o rastro em docs/architecture/kanban/Em_Andamento/em_andamento.md.
3. Testes: Registar evidências em docs/architecture/kanban/Testes/testes.md.
4. Concluído: Registrar o card em docs/architecture/kanban/Concluido/concluido.md quando o gate final for aprovado.
5. Mapa: Atualizar o status em docs/architecture/kanban/mapa_problemas_sistema.md.

---

## 🧠 REGRAS ARQUITETURAIS

* Orchestrator é o único decisor
* Signals representam intenção (não lógica nova)
* AgentLoop NÃO decide (estado alvo)
* NÃO alterar heurísticas existentes
* NÃO remover branches existentes

---

## 🌐 INTERNACIONALIZAÇÃO (i18n) — OBRIGATÓRIO

Mantenha sempre o padrão do sistema com foco em internacionalização (i18n).
Certifique-se de aplicar as diretrizes de internacionalização (i18n) do sistema em todas as etapas.

### 📌 Regras obrigatórias

* Todo string visível ao usuário deve usar `t('chave')` do módulo `src/i18n`
* Nunca usar strings hardcoded em mensagens de erro, logs externos ou respostas ao usuário
* Adicionar sempre as chaves em **ambos** os catálogos: `src/i18n/pt-BR.json` **e** `src/i18n/en-US.json`
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

# ⚙️ REGRA DE IMPLEMENTAÇÃO (CRÍTICA)

Implementar SEMPRE de forma incremental:

1. Criar estrutura mínima (método vazio)
2. Compilar
3. Adicionar lógica mínima
4. Compilar
5. Integrar no fluxo
6. Compilar

🚫 PROIBIDO:

* Implementar tudo de uma vez
* Criar métodos grandes inicialmente

---

## 📏 REGRA DE TAMANHO

* Evitar métodos grandes (>50 linhas) na primeira versão
* Começar simples e evoluir

👉 Primeiro estrutura
👉 Depois comportamento

---

## 🔒 PROTEÇÃO DE INSERÇÃO

Antes de inserir código:

* Identificar:

  * início do método
  * fim do método
  * escopo da classe

👉 Inserir apenas em pontos seguros já existentes

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

**[DESCREVER A ETAPA AQUI]**

---

# 🧪 VALIDAÇÃO OBRIGATÓRIA (VERSÃO AVANÇADA)

Após implementar, você DEVE verificar:

---

### 1. inconsistências

* Existem decisões contraditórias?

---

### 2. duplicações

* Existe lógica duplicada ou paralela?
* Existe código equivalente com outro nome?

---

### 3. melhorias seguras

* Algo pode ser centralizado depois?

---

### 4. riscos arquiteturais

* Existe bypass do Orchestrator?
* Existe mini-brain ativo?

---

### 5. coerência de autoridade

* Quem decide de fato?
* Existe mais de um decisor?

---

## 🔥 6. VERIFICAÇÃO DE CONFLITOS REAIS (OBRIGATÓRIO)

### a. conflitos entre signals

* Route vs FailSafe
* Validation vs StopContinue
* Fallback vs Route

---

### b. divergência loop vs orchestrator

* decisões diferentes?
* qual foi aplicada?

---

### c. conflitos silenciosos

* conflitos não registrados?

---

### d. inconsistência de comportamento

* execução indevida?
* confirmação indevida?

---

### e. conflito de autoridade

* signals competindo?
* ausência de hierarquia?

---

## 🏗️ 7. VALIDAÇÃO ESTRUTURAL (CRÍTICA)

### a. escopo correto

* código dentro da classe correta?
* dentro do método correto?

---

### b. integridade sintática

* chaves `{}` corretas?
* código não inserido entre métodos?

---

### c. integração válida

* variáveis existem?
* métodos acessíveis?

---

### d. impacto controlado

* poucas alterações?
* sem efeito colateral?

---

### e. compilação incremental ⚠️

* compilou após cada etapa?

---

## ❗ REGRA DE SEGURANÇA

Se ocorrer:

* muitos erros (>5)
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

* Zero duplicação
* Zero regressão
* Decisões auditáveis
* Conflitos visíveis
* Arquitetura preservada

---

# 🧠 COMO USAR

Basta adicionar:

```text
## 🧩 ESCOPO DA IMPLEMENTAÇÃO

👉 Implementar:

[EX: FASE 2 — Auditoria cruzada dos signals]
```

---

# 🔥 MELHORIA MAIS IMPORTANTE QUE VOCÊ GANHOU

Esse novo template resolve exatamente o que aconteceu com você:

* ❌ patch quebrando arquivo
* ❌ código fora da classe
* ❌ erro em cascata

Agora você passa a ter:

✔ controle estrutural
✔ controle incremental
✔ controle de risco

---

Se quiser, posso agora:

👉 refazer o prompt da FASE 2 usando esse template já otimizado (versão segura pra não quebrar nada)
