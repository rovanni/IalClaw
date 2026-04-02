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

## 📋 CHECKLIST VIVO (OBRIGATÓRIO)

Arquivo:

```
D:\IA\IalClaw\docs\architecture\checklist.md
```

Após qualquer alteração, atualizar:

a. O que já foi corrigido
b. O que está em andamento
c. O que ainda falta
d. O que NÃO deve ser tocado agora

---

## 🧠 REGRAS ARQUITETURAIS

* Orchestrator é o único decisor
* Signals representam intenção (não lógica nova)
* AgentLoop NÃO decide (estado alvo)
* NÃO alterar heurísticas existentes
* NÃO remover branches existentes

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
