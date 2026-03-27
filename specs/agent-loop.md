[🇧🇷 Ver versão em Português](#-versão-em-português)

# 🧠 Spec: Agent Loop (Cognitive ReAct Engine)

**Version:** 3.1  
**Status:** Enhanced with Adaptive Intelligence  
**Author:** Luciano + IA  
**Date:** March 27, 2026  

---

## 1. Summary

The **Agent Loop** is IalClaw's reasoning engine, based on the ReAct (Reasoning and Acting) pattern.

In version 3.1, the Agent Loop evolves into an **adaptive cognitive system** with:

* **Task Classification** - understands task type before execution
* **Contextual Confidence** - calculates confidence based on step+tool history
* **Adaptive Exploration** - balances exploitation vs exploration dynamically
* **Task Reclassification** - autocorrects when execution fails
* **Smart Stop** - knows when to stop execution

---

## 2. Architecture Overview

```
User Input
    ↓
Intent Detection (IntentDetector)
    ↓
Task Classification (TaskClassifier)
    ↓
Decision Gate (Policy Engine)
    ↓
AgentLoop (Cognitive Core)
    ↓
 ┌─────────────────────────────────────────────┐
 │  PLAN → EXECUTE → VALIDATE → LEARN          │
 │         ↓              ↑                    │
 │    EXPLORE (adaptive)                       │
 │    RECLASSIFY (if needed)                   │
 │    ADAPT (plan adjustment)                   │
 └─────────────────────────────────────────────┘
    ↓
Hybrid Retrieval (Graph + Search + Tools)
    ↓
Response / Action
```

---

## 3. Task Classification System

### 3.1 Task Types

| Type | Keywords |
|------|----------|
| `file_conversion` | converter, transformar, md, html, pptx |
| `file_search` | procurar, buscar, encontrar arquivo |
| `content_generation` | criar, gerar, escrever |
| `system_operation` | executar, rodar, instalar |

### 3.2 Classification Output

```ts
interface TaskClassification {
  type: "file_conversion" | "file_search" | "content_generation" | "system_operation" | "unknown";
  confidence: number;
}
```

### 3.3 Forced Plans

When task type is detected, the system generates a forced plan:

```
file_conversion:
  1. Locate source file
  2. Read file content
  3. Convert content
  4. Save result

file_search:
  1. Determine search location
  2. Search file
  3. Return result
```

---

## 4. Contextual Confidence System

### 4.1 Calculation

Confidence is calculated based on **stepType + tool** combination:

```ts
// Filter execution memory by stepType AND tool
const contextualHistory = executionMemory.filter(
  e => e.stepType === stepType && e.tool === tool
);

// If sufficient samples (>= 2), use contextual confidence
// Otherwise, fallback to global tool average
```

### 4.2 Confidence Thresholds

| Confidence Level | Exploration Rate |
|------------------|-----------------|
| >= 0.8 (high)   | 0.05 (5%)       |
| 0.5 - 0.8       | 0.20 (20%)      |
| < 0.5 (low)     | 0.40 (40%)      |

---

## 5. Adaptive Exploration

### 5.1 Strategy

The agent balances:
- **Exploitation**: Use best-known tool (based on memory)
- **Exploration**: Try alternative tools to discover better paths

### 5.2 Implementation

```ts
const decisionConfidence = getContextualConfidence(stepType, bestTool);
const explorationRate = getAdaptiveExplorationRate(decisionConfidence);

const shouldExplore = candidateTools.length > 1 && Math.random() < explorationRate;
```

### 5.3 Constraints

- Only explores if >1 tool available
- Avoids tools with score < -3
- Logs exploration decisions: `[EXPLORATION] confidence=0.6 rate=0.2 choosing_alternative=search_file`

---

## 6. Task Reclassification

### 6.1 Trigger Conditions

- 2+ consecutive tool failures
- OR average step confidence < 0.5

### 6.2 Process

```ts
// 1. Re-classify original input
const newClassification = classifyTask(originalInput);

// 2. If different from current and confidence >= 0.85
if (newClassification.type !== currentType && newClassification.confidence >= 0.85) {
  // 3. Adjust plan using forced plan template
  const newSteps = getForcedPlanForTaskType(newClassification.type);
  currentPlan.steps = newSteps;
}
```

### 6.3 Logs

```
[RECLASSIFY] old=file_search new=file_conversion confidence=0.80
[PLAN] Plano ajustado para: file_conversion
```

---

## 7. Smart Stop Conditions

### 7.1 Global Confidence

```ts
const globalConfidence = stepValidations.reduce((a, b) => a + b, 0) / stepValidations.length;

if (globalConfidence >= 0.8 && lastStepSuccessful) {
  STOP; // Task completed successfully
}
```

### 7.2 Over-Execution Detection

```ts
if (stepCount >= 4) {
  const recentAvg = stepValidations.slice(-3).reduce((a, b) => a + b, 0) / 3;
  if (recentAvg < 0.4) {
    STOP; // No significant progress
  }
}
```

### 7.3 Logs

```
[STOP] global_confidence=0.87_threshold=0.8
```

---

## 8. Execution Memory

### 8.1 Structure

```ts
interface ExecutionMemoryEntry {
  stepType: string;    // e.g., "ler arquivo", "localizar"
  tool: string;        // e.g., "read_local_file"
  success: boolean;
  context: string;
  timestamp: number;
}
```

### 8.2 Usage

- Tracks success/failure per step+tool combination
- Used for contextual confidence calculation
- Influences adaptive exploration rate

---

## 9. Anti-Hallucination Strategies

* Task classification before execution
* Forced plans for known task types
* **ExecutionPlan** validation
* Contextual confidence monitoring
* Smart stop conditions
* Execution memory learning

---

## 10. Key Differentiators (v3.1)

| Feature | Benefit |
|---------|---------|
| Task Classification | Understands task type before acting |
| Contextual Confidence | Decisions based on real execution history |
| Adaptive Exploration | Balances learning vs discovery |
| Task Reclassification | Auto-corrects misinterpretation |
| Smart Stop | Avoids unnecessary execution |

---

<br><br>

# 🇧🇷 Versão em Português

# 🧠 Spec: Agent Loop (Cognitive ReAct Engine)

**Versão:** 3.1  
**Status:** Aprimorado com Inteligência Adaptativa  
**Autor:** Luciano + IA  
**Data:** 27 de março de 2026  

---

## 1. Resumo

O **Agent Loop** é o motor de raciocínio do IalClaw, baseado no padrão ReAct (Reasoning and Acting).

Na versão 3.1, o Agent Loop evolui para um **sistema cognitivo adaptativo** com:

* **Classificação de Tarefas** - entende o tipo de tarefa antes da execução
* **Confiança Contextual** - calcula confiança baseada em histórico step+tool
* **Exploração Adaptativa** - equilibra exploração vs exploitação dinamicamente
* **Reclassificação de Tarefas** - autocorrige quando a execução falha
* **Parada Inteligente** - sabe quando parar a execução

---

## 2. Visão Geral da Arquitetura

```
Entrada do Usuário
    ↓
Detecção de Intenção (IntentDetector)
    ↓
Classificação de Tarefa (TaskClassifier)
    ↓
Decision Gate (Policy Engine)
    ↓
AgentLoop (Núcleo Cognitivo)
    ↓
 ┌─────────────────────────────────────────────┐
 │  PLANEJAR → EXECUTAR → VALIDAR → APRENDER   │
 │            ↓              ↑                  │
 │    EXPLORAR (adaptativo)                    │
 │    RECLASSIFICAR (se necessário)            │
 │    ADAPTAR (ajuste de plano)                │
 └─────────────────────────────────────────────┘
    ↓
Busca Híbrida (Grafo + Busca + Ferramentas)
    ↓
Resposta / Ação
```

---

## 3. Sistema de Classificação de Tarefas

### 3.1 Tipos de Tarefa

| Tipo | Palavras-chave |
|------|----------------|
| `file_conversion` | converter, transformar, md, html, pptx |
| `file_search` | procurar, buscar, encontrar arquivo |
| `content_generation` | criar, gerar, escrever |
| `system_operation` | executar, rodar, instalar |

### 3.2 Saída da Classificação

```ts
interface TaskClassification {
  type: "file_conversion" | "file_search" | "content_generation" | "system_operation" | "unknown";
  confidence: number;
}
```

### 3.3 Planos Forçados

Quando o tipo de tarefa é detectado, o sistema gera um plano forçado:

```
file_conversion:
  1. Localizar arquivo de origem
  2. Ler conteúdo do arquivo
  3. Converter conteúdo
  4. Salvar resultado

file_search:
  1. Determinar local de busca
  2. Buscar arquivo
  3. Retornar resultado
```

---

## 4. Sistema de Confiança Contextual

### 4.1 Cálculo

A confiança é calculada baseada na combinação **stepType + ferramenta**:

```ts
// Filtrar memória de execução por stepType E ferramenta
const historicoContextual = executionMemory.filter(
  e => e.stepType === stepType && e.tool === ferramenta
);

// Se houver amostras suficientes (>= 2), usar confiança contextual
// Caso contrário, usar média global da ferramenta
```

### 4.2 Limiares de Confiança

| Nível de Confiança | Taxa de Exploração |
|--------------------|---------------------|
| >= 0.8 (alto)     | 0.05 (5%)           |
| 0.5 - 0.8         | 0.20 (20%)          |
| < 0.5 (baixo)     | 0.40 (40%)          |

---

## 5. Exploração Adaptativa

### 5.1 Estratégia

O agente equilibra:
- **Exploitação**: Usar melhor ferramenta conhecida (baseado na memória)
- **Exploração**: Tentar ferramentas alternativas para descobrir melhores caminhos

### 5.2 Implementação

```ts
const confiancaDecisao = getConfiancaContextual(stepType, melhorFerramenta);
const taxaExploracao = getTaxaExploracaoAdaptativa(confiancaDecisao);

const deveExplorar = ferramentasCandiatas.length > 1 && Math.random() < taxaExploracao;
```

### 5.3 Restrições

- Explora apenas se >1 ferramenta disponível
- Evita ferramentas com score < -3
- Log de decisões: `[EXPLORATION] confidence=0.6 rate=0.2 choosing_alternative=search_file`

---

## 6. Reclassificação de Tarefas

### 6.1 Condições de Gatilho

- 2+ falhas consecutivas de ferramentas
- OU confiança média dos steps < 0.5

### 6.2 Processo

```ts
// 1. Reclassificar entrada original
const novaClassificacao = classifyTask(entradaOriginal);

// 2. Se diferente da atual e confiança >= 0.85
if (novaClassificacao.type !== tipoAtual && novaClassificacao.confidence >= 0.85) {
  // 3. Ajustar plano usando template de plano forçado
  const novosSteps = getForcedPlanForTaskType(novaClassificacao.type);
  planoAtual.steps = novosSteps;
}
```

### 6.3 Logs

```
[RECLASSIFY] old=file_search new=file_conversion confidence=0.80
[PLAN] Plano ajustado para: file_conversion
```

---

## 7. Condições de Parada Inteligente

### 7.1 Confiança Global

```ts
const confiancaGlobal = stepValidations.reduce((a, b) => a + b, 0) / stepValidations.length;

if (confiancaGlobal >= 0.8 && ultimoStepBemSucedido) {
  PARAR; // Tarefa concluída com sucesso
}
```

### 7.2 Detecção de Over-Execution

```ts
if (contagemSteps >= 4) {
  const mediaRecente = stepValidations.slice(-3).reduce((a, b) => a + b, 0) / 3;
  if (mediaRecente < 0.4) {
    PARAR; // Sem progresso significativo
  }
}
```

### 7.3 Logs

```
[STOP] global_confidence=0.87_threshold=0.8
```

---

## 8. Memória de Execução

### 8.1 Estrutura

```ts
interface ExecutionMemoryEntry {
  stepType: string;    // ex: "ler arquivo", "localizar"
  tool: string;         // ex: "read_local_file"
  success: boolean;
  context: string;
  timestamp: number;
}
```

### 8.2 Uso

- Rastreia sucesso/falha por combinação step+ferramenta
- Usado para cálculo de confiança contextual
- Influencia taxa de exploração adaptativa

---

## 9. Estratégias Anti-Alucinação

* Classificação de tarefa antes da execução
* Planos forçados para tipos de tarefa conhecidos
* Validação do **ExecutionPlan**
* Monitoramento de confiança contextual
* Condições de parada inteligente
* Aprendizado via memória de execução

---

## 10. Diferenciais Principais (v3.1)

| Funcionalidade | Benefício |
|----------------|-----------|
| Classificação de Tarefas | Entende o tipo de tarefa antes de agir |
| Confiança Contextual | Decisões baseadas em histórico real de execução |
| Exploração Adaptativa | Equilibra aprendizado vs descoberta |
| Reclassificação de Tarefas | Autocorrige misinterpretação |
| Parada Inteligente | Evita execução desnecessária |
