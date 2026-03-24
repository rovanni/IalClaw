[🇧🇷 Ver versão em Português](#-versão-em-português)

# 🧠 Spec: Agent Loop (Cognitive ReAct Engine)

**Version:** 3.0  
**Status:** Updated with Cognition and Planning  
**Author:** Luciano + IA  
**Date:** March 24, 2026  

---

## 1. Summary

The **Agent Loop** is IalClaw's reasoning engine, based on the ReAct (Reasoning and Acting) pattern.

In version 3.0, the Agent Loop evolves into a **cognitive and planning** model, where it:

* Does not rely solely on history
* Receives context from cognitive memory and the Semantic Gateway
* Follows a structured Execution Plan to prevent hallucinations
* Learns from each execution via the MemoryDreamer

---

## 2. Context and Motivation

**Problem:** A traditional Agent Loop relies exclusively on message history, limiting its reasoning capacity and knowledge reuse, often leading to tool hallucination.

**Solution:** Integrate a cognitive memory layer before and after the loop, and enforce an Execution Planner, allowing:

* Retrieval of relevant knowledge (Graph-RAG)
* Reduction of tool hallucination via a structured PlanValidator
* Continuous learning

---

## 3. Goals

* **G-01:** Execute ReAct cycle (Thought → Action → Observation)
* **G-02:** Integrate cognitive context before inference
* **G-03:** Update memory after execution (Learning)
* **G-04:** Ensure strict iteration limits
* **G-05:** Support safe Tool execution via Registry and Traces
* **G-06:** Prevent infinite loops and operational hallucinations via Planning

---

## 4. Main Flow (Cognitive)

### Step 1 — Cognitive Retrieval (by Gateway)

Before starting the loop, the Semantic Gateway uses embeddings to route the intent and fetch the context:

```ts
const context = await cognitiveMemory.search(userInput);
// Injects pre-processed context and selected agent persona
```

### Step 2 — ReAct Loop Execution

```ts
// 1. Plan Phase
const plan = await planner.createPlan(userInput, context);
validatePlan(plan);

// 2. Execution Phase
for (const step of plan.steps) {
  emitDebug('thought', `Executing Step ${step.id}: ${step.tool}`);
  const result = await executeToolCall(step.tool, step.input);
  
  if (!result.success) {
     throw new Error(`Execution interrupted on step ${step.id}: ${result.error}`);
  }
}
```

### Step 3 — Cognitive Update

After final response:

```ts
await cognitiveMemory.learn({
  query: userInput,
  nodes_used: context.nodes,
  response: finalAnswer
});
// MemoryDreamer will later decay inactive nodes
```

---

## 5. Anti-Hallucination Strategies

* Obligatory cognitive context
* **ExecutionPlan** validation before any tool is run
* Safe Workspace Tools mapped in `ToolRegistry`
* Traceability via `TraceContext`

---

<br><br>

# 🇧🇷 Versão em Português

# 🧠 Spec: Agent Loop (Cognitive ReAct Engine)

**Versão:** 3.0  
**Status:** Atualizado com Cognição e Planejamento  
**Autor:** Luciano + IA  
**Data:** 24 de março de 2026  

---

## 1. Resumo

O **Agent Loop** é o motor de raciocínio do IalClaw, baseado no padrão ReAct (Reasoning and Acting).

Na versão 3.0, o Agent Loop evolui para um modelo **cognitivo e planejador**, onde:

* Não depende apenas de histórico
* Recebe contexto da memória cognitiva e do Gateway Semântico
* Segue um Plano de Execução estruturado para evitar alucinações
* Aprende com cada execução via MemoryDreamer

---

## 2. Contexto e Motivação

**Problema:**
Um Agent Loop tradicional depende exclusivamente de histórico de mensagens, limitando raciocínio e frequentemente resultando em alucinações de ferramentas.

**Solução:**
Integrar uma camada de memória cognitiva e forçar a criação de um Plano de Execução, permitindo:

* Recuperação de conhecimento (Graph-RAG)
* Redução de alucinação via PlanValidator
* Aprendizado contínuo

---

## 3. Goals (Objetivos)

* **G-01:** Executar ciclo ReAct (Thought → Action → Observation)
* **G-02:** Integrar contexto cognitivo antes da inferência
* **G-03:** Atualizar memória após execução
* **G-04:** Garantir limite seguro de iterações
* **G-05:** Suportar execução de Tools via Registry Seguro
* **G-06:** Evitar loops infinitos ou alucinação operacional via Planning

---

## 4. Fluxo Principal (Cognitivo)

### Etapa 1 — Recuperação Cognitiva (pelo Gateway)

```ts
const context = await cognitiveMemory.search(userInput);
// Injeta contexto pré-processado e persona do agente selecionado
```

### Etapa 2 — Execução do Loop ReAct

```ts
// 1. Fase de Planejamento
const plan = await planner.createPlan(userInput, context);
validatePlan(plan);

// 2. Fase de Execução
for (const step of plan.steps) {
  emitDebug('thought', `Executando Step ${step.id}: ${step.tool}`);
  const result = await executeToolCall(step.tool, step.input);
  
  if (!result.success) {
     throw new Error(`Execução interrompida no step ${step.id}: ${result.error}`);
  }
}
```

### Etapa 3 — Atualização Cognitiva

```ts
await cognitiveMemory.learn({
  query: userInput,
  nodes_used: context.nodes,
  response: finalAnswer
});
// MemoryDreamer cuidará do decaimento depois
```

---

## 5. Estratégias Anti-Alucinação

* Contexto cognitivo obrigatório
* Validação do **ExecutionPlan** (o plano só roda se as tools existirem)
* Workspace Tools mapeadas no `ToolRegistry`
* Rastreabilidade total através de `TraceContext`
