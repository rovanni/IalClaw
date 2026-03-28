[🇧🇷 Ver versão em Português](#-versão-em-português)

# 🧠 Memory System — IalClaw

**Version:** 3.0  
**Status:** Cognitive Definition  
**Author:** Luciano + IA  
**Date:** March 24, 2026  

---

## 1. Overview

IalClaw's memory system is not merely a persistence engine, but an **active cognitive system** responsible for storing, retrieving, relating, and evolving knowledge over time.

Memory is structured into four complementary layers:

* Episodic Memory
* Semantic Memory (with Embeddings)
* Relational Memory (Graph)
* Execution Memory (Tool Decisions + Reliability)

---

## 2. Fundamental Principles

* Memory is active, not passive
* Knowledge is reusable
* Relationships are as important as data
* The system must learn through usage
* Context must be built and injected before inference

---

## 3. Memory Types

### 3.1 Episodic Memory
Represents the history of interactions with the user.

**Characteristics:** Sequential, Temporal, Contextual  
**Structure:** `conversations`, `messages`  
**Function:** Maintain dialogue continuity and provide recent context.

### 3.2 Semantic Memory
Represents the system's persistent knowledge.

**Origin:** `.md` files, system docs, configuration  
**Structure:** `documents` (with vector embeddings)  
**Function:** Reusable knowledge base, primary source of context.

### 3.3 Relational Memory (Graph)
Represents connections between knowledge.

**Structure:** `nodes` (with embeddings), `edges`  
**Function:** Semantic navigation, indirect inference, concept association.

### 3.4 Execution Memory (Tool Decisions)
Represents learned tool execution patterns.

**Structure:** `nodes` (type: tool_decision) with taskType, step, tool, success  
**Function:** Persist historical tool performance to improve future decision-making.
**Integration:** DecisionMemory queries past successes/failures before ranking tools.

---

## 4. Cognitive Pipeline (v3.0)

All user input follows this flow:

User Input → Semantic Gateway (Intent Embedding) → Cache Check → Graph Traversal (Cosine Sim) → Document Retrieval → Context Ranking → Agent Planner (ReAct) → Action Execution → Response → Learning / Dreamer Decay

---

## 5. Memory Retrieval (Search)

Context retrieval follows a **GRAPH_FIRST Hybrid** strategy.

**Execution Order:**
1. Query Cache
2. Graph Traversal (Vector Embeddings + Cosine Similarity)
3. Document Retrieval
4. Context Ranking
5. Context Builder

---

## 6. Context Building
The context sent to the LLM must be: Relevant, Token-limited, Non-redundant, and Prioritize higher scores.

---

## 7. Scoring System

Each element possesses a dynamic score updated frequently:
`final_score = (cosine_similarity * relevance) * freshness * graph_weight`

---

## 8. Continuous Learning & Decay (MemoryDreamer)

### Learning
After each interaction:
* Update score of used nodes
* Increase weight of traversed edges
* Register event in `learning_events`

### Decay
To avoid obsolescence, the `MemoryDreamer` gradually prunes the graph:
* Edges decay slightly every cycle
* Unused episodic nodes are archived

---

## 9. Integration with AgentLoop

**Before execution:** `context = cognitiveMemory.search(input)`  
**After execution:** `cognitiveMemory.learn(input, context)`

---

## 10. Conclusion

IalClaw's memory system transforms the agent from a pure "prompt executor" into a **"cognitive system with learning, context, and structural knowledge navigation"**.

---
---

<br><br>

# 🇧🇷 Versão em Português

# 🧠 Memory System — IalClaw

**Versão:** 3.0  
**Status:** Definição Cognitiva  
**Autor:** Luciano + IA  
**Data:** 24 de março de 2026  

---

## 1. Visão Geral

O sistema de memória do IalClaw não é apenas um mecanismo de persistência, mas um **sistema cognitivo ativo**, responsável por armazenar, recuperar, relacionar e evoluir conhecimento ao longo do tempo.

A memória é estruturada em quatro camadas complementares:

* Memória Episódica
* Memória Semântica (com Embeddings)
* Memória Relacional (Grafo)
* Memória de Execução (Decisões de Tools + Confiabilidade)

---

## 2. Princípios Fundamentais

* Memória é ativa, não passiva
* Conhecimento é reutilizável
* Relações são tão importantes quanto dados
* O sistema deve aprender com uso
* Contexto deve ser construído antes da inferência

---

## 3. Tipos de Memória

### 3.1 Memória Episódica
Representa o histórico de interações.

**Características:** Sequencial, Temporal, Contextual  
**Estrutura:** `conversations`, `messages`  
**Função:** Continuidade de diálogo.

### 3.2 Memória Semântica
Representa conhecimento persistente.

**Origem:** Arquivos `.md`, configurações  
**Estrutura:** `documents` (agora com vector embeddings)  
**Função:** Base de conhecimento reutilizável.

### 3.3 Memória Relacional (Grafo)
Representa conexões entre conhecimentos.

**Estrutura:** `nodes` (com embeddings), `edges`  
**Função:** Navegação semântica e associação de conceitos.

### 3.4 Memória de Execução (Decisões de Tools)
Representa padrões aprendidos de execução de tools.

**Estrutura:** `nodes` (tipo: tool_decision) com taskType, step, tool, success  
**Função:** Persistir histórico de performance de tools para melhorar decisões futuras.
**Integração:** DecisionMemory consulta sucessos/falhas passadas antes de ranquear tools.

---

## 4. Pipeline Cognitivo (v3.0)

Todo input do usuário segue o fluxo:

User Input → Gateway Semântico (Embeddings) → Cache → Grafo (Cosine Sim) → Documentos → Ranking → Agent Planner (ReAct) → Execução → Resposta → Aprendizado / Decaimento (Dreamer)

---

## 5. Recuperação de Memória (Search)

A recuperação de contexto segue estratégia **Híbrida GRAPH_FIRST**.

**Ordem:**
1. Query Cache
2. Graph Traversal (Similaridade Cosseno)
3. Document Retrieval
4. Context Ranking
5. Context Builder

---

## 6. Construção de Contexto
O contexto enviado ao LLM deve: Ser relevante, Limitado em tokens, Evitar redundância e Priorizar maior score.

---

## 7. Sistema de Score

Cada elemento possui um score dinâmico:
`final_score = (similaridade_cosseno * relevancia) * frescor * peso_do_grafo`

---

## 8. Aprendizado Contínuo & Decaimento (MemoryDreamer)

### Aprendizado
Após cada interação:
* Atualizar score dos nodes utilizados
* Incrementar peso das edges percorridas

### Decaimento
O `MemoryDreamer` limpa o grafo de tempos em tempos:
* Pesos de arestas decaem lentamente
* Memórias não utilizadas são oxidadas e podadas

---

## 9. Conclusão

O sistema de memória evoluiu e transforma o agente em um **sistema cognitivo com estrutura de conhecimento vetorial e base em grafo realista**.
