[🇧🇷 Ver versão em Português](#-versão-em-português)

# Spec: PRD — IalClaw Core (Cognitive Version)

**Version:** 3.0  
**Status:** Approved  
**Author:** Luciano + IalClaw Agent  
**Date:** March 24, 2026  
**Reviewers:** Luciano  

## 1. Summary

IalClaw is a personal Artificial Intelligence agent operating 100% locally. It transcends the role of a simple chatbot by implementing a Cognitive Memory (Episodic, Semantic, and Relational via Graphs) integrated into an execution pipeline via Telegram. The goal is to allow the agent to learn from past interactions, relate concepts in local files, and reduce token consumption through caching and intelligent context retrieval.

## 2. Context and Motivation

**Problem:** Traditional agents are stateless or only have memory limited to the immediate chat history. This prevents long-term learning, the relationship between different conversation sessions, and the reuse of knowledge extracted from local documents without costly reprocessing.

**Solution:** Implement an active memory infrastructure that stores not only what was said, but the connections between facts (graphs) and reference documents (semantics), operating on a local SQLite database.

## 3. Goals

- **G-01:** Operate primarily via Telegram using the `grammy` library.
- **G-02:** Swap "brains" (LLMs) via `ProviderFactory` (Gemini, DeepSeek, etc.).
- **G-03:** Maintain persistent episodic memory (chat history).
- **G-04:** Execute complex reasoning via `AgentLoop` (ReAct pattern).
- **G-05:** Build and maintain a real-time knowledge graph.
- **G-06:** Implement active cognitive memory for context injection.
- **G-07:** Learn automatically through interactions and feedback.
- **G-08:** Reduce latency and token costs via intelligent query caching.

## 4. Non-Goals (Out of Scope)

- **NG-01:** Native Mobile or Web Chat Interface (Exclusive Telegram interface for interaction, Web is only for visualization).
- **NG-02:** Multi-user support outside the strict Whitelist.
- **NG-03:** Use of distributed databases (focus on local SQLite).

## 5. System Architecture

The data flow follows a circular structure where the output feeds back into the memory:

1. **Input:** Message received via Telegram.
2. **Cognitive Pipeline:** Normalization -> Cache -> Graph Search -> Doc Retrieval -> Context Ranking.
3. **Context Injection:** Retrieved context is injected as a system message.
4. **AgentLoop:** LLM processing loop (Thought -> Action -> Observation).
5. **Output:** Response sent to the user.
6. **Learning Update:** The response and query are processed to update weights in the graph and documents.

## 6. Cognitive Model

The system is supported by three memory pillars:

### 6.1 Episodic Memory
Stores the chronological history of interactions. Essential for maintaining the continuity of the immediate dialogue.

### 6.2 Semantic Memory
Based on local documents (Markdown). The agent reads, summarizes, and categorizes files for future queries.

### 6.3 Relational Memory (Graph)
Connects entities and concepts. If the user talks about "Project X" and "SQLite", the system creates an edge linking these nodes, allowing associative navigation.

---

<br><br>

# 🇧🇷 Versão em Português

# Spec: PRD — IalClaw Core (Versão Cognitiva)

**Versão:** 3.0  
**Status:** Aprovada  
**Autor:** Luciano + IalClaw Agent  
**Data:** 24 de março de 2026  
**Reviewers:** Luciano  

## 1. Resumo

O IalClaw é um agente pessoal de Inteligência Artificial operando 100% localmente. Ele transcende a função de um chatbot simples ao implementar uma Memória Cognitiva (Episódica, Semântica e Relacional via Grafos) integrada a um pipeline de execução via Telegram. O objetivo é permitir que o agente aprenda com interações passadas, relacione conceitos em arquivos locais e reduza o consumo de tokens através de cache e recuperação de contexto inteligente.

## 2. Contexto e Motivação

**Problema:** Agentes tradicionais são stateless ou possuem memória limitada ao histórico imediato do chat. Isso impede o aprendizado de longo prazo, a relação entre diferentes sessões de conversa e a reutilização de conhecimentos extraídos de documentos locais sem reprocessamento custoso.

**Solução:** Implementar uma infraestrutura de memória ativa que armazena não apenas o que foi dito, mas as conexões entre fatos (grafos) e documentos de referência (semântica), operando sobre um banco SQLite local.

## 3. Goals (Objetivos)

- **G-01:** Operar primariamente via Telegram usando a biblioteca `grammy`.
- **G-02:** Intercambiar "cérebros" (LLMs) via `ProviderFactory` (Gemini, DeepSeek, etc.).
- **G-03:** Manter memória episódica persistente.
- **G-04:** Executar raciocínio complexo via `AgentLoop` (padrão ReAct).
- **G-05:** Construir e manter um grafo de conhecimento em tempo real.
- **G-06:** Implementar memória cognitiva ativa para injeção de contexto.
- **G-07:** Aprender automaticamente através das interações e feedbacks.
- **G-08:** Reduzir latência e custo (tokens) via cache inteligente de queries.

## 4. Non-Goals (Fora de Escopo)

- **NG-01:** Interface de Chat Web ou Mobile nativa exclusivas (Interface principal pelo Telegram, Web apenas para o Dashboard visual).
- **NG-02:** Suporte multiusuário fora da Whitelist estrita.
- **NG-03:** Uso de bancos de dados distribuídos (foco total em SQLite local).

## 5. Arquitetura do Sistema

O fluxo de dados segue uma estrutura circular onde a saída retroalimenta a memória:

1. **Input:** Mensagem recebida via Telegram.
2. **Cognitive Pipeline:** Normalização -> Cache -> Busca em Grafo -> Recuperação de Docs -> Ranking de Contexto.
3. **Context Injection:** O contexto recuperado é injetado como mensagem de sistema.
4. **AgentLoop:** Processamento pelo LLM (Pensa -> Age -> Observa).
5. **Output:** Resposta enviada ao usuário.
6. **Learning Update:** A resposta e a query são processadas para atualizar pesos no grafo e documentos.

## 6. Modelo Cognitivo

O sistema é sustentado por três pilares:

### 6.1 Memória Episódica
Armazena histórico cronológico. Essencial para continuidade do diálogo.

### 6.2 Memória Semântica
Baseada em documentos locais. O agente lê, resume e categoriza arquivos para consultas futuras.

### 6.3 Memória Relacional (Grafo)
Conecta entidades e conceitos. A menção de termos em conjunto cria arestas para navegação associativa.