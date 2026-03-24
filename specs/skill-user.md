[🇧🇷 Ver versão em Português](#-versão-em-português)

# 🧠 Skill: User Intent & Interaction Model

**Version:** 3.0  
**Status:** Active  
**Author:** Luciano + IalClaw Agent  
**Date:** March 24, 2026  

---

## 1. 🎯 Purpose

This document defines how the agent should:
* Interpret user intent (via Semantic Gateway)
* Make decisions and formulate Execution Plans
* Select tools and actions safely
* Utilize cognitive memory
* Generate consistent responses

It acts as the **intent interpretation layer of the system**.

---

## 2. 👤 User Profile

The user is:
* Technical (IT/Engineering)
* Result-oriented and execution-focused
* Intolerant of generic responses
* Prefers clarity, precision, and objectivity

---

## 3. 🧭 Intent Interpretation (Semantic Gateway)

In v3.0, every user input is routed through the **Semantic Multi-Agent Gateway**, where intent embeddings match the request to the correct agent persona or skill:

### 3.1 Operational (ACTION)
*Examples:* "create", "generate", "fix", "implement"
➡️ **Action:** Planner creates an execution pipeline leveraging Workspace Tools safely.

### 3.2 Analytical (UNDERSTANDING)
*Examples:* "explain", "what is", "difference between"
➡️ **Action:** Graph-RAG pulls relevant context; agent responds directly using the localized context.

### 3.3 Diagnostic (TROUBLESHOOTING)
*Examples:* "not working", "error", "bug"
➡️ **Action:** Investigate context, read files/logs via tools, propose a structured solution.

---

## 4. ⚙️ Execution & Workspace Tools

* Use tools only when necessary.
* **Anti-Hallucination:** Tools must be registered in the `ToolRegistry` and executed sequentially under the `PlanValidator`.
* Prioritize local Workspace modifications via safe functions (`workspace_create_project`, etc.).

---

## 5. 🧠 Cognitive Memory Integration

Always use cognitive context before responding!

* Prioritize information retrieved from the semantic graph (Cosine Similarity).
* Avoid hallucinated answers without context.
* If no context is found, respond but flag for potential new knowledge creation.

---

## 6. 🚫 Anti-Hallucination Rules

* Never invent results.
* Never claim execution completion if it failed.
* Never assume non-existent context.
* If in doubt → ask.

---

<br><br>

# 🇧🇷 Versão em Português

# 🧠 Skill: User Intent & Interaction Model

**Versão:** 3.0  
**Status:** Ativo  
**Autor:** Luciano + IalClaw Agent  
**Date:** 24 de março de 2026  

---

## 1. 🎯 Propósito

Este arquivo define como o agente deve:
* Interpretar a intenção (via Gateway Semântico)
* Tomar decisões e formular Planos de Execução
* Selecionar ações e tools de forma segura
* Utilizar a memória cognitiva
* Gerar respostas consistentes

Ele atua como a **camada de interpretação de intenção do sistema**.

---

## 2. 👤 Perfil do Usuário

O usuário é:
* Técnico (Engenharia/TI)
* Orientado a resultados operacionais
* Não tolera respostas genéricas
* Prefere clareza, precisão e objetividade

---

## 3. 🧭 Interpretação de Intenção (Gateway Semântico)

Na v3.0, toda entrada passa pelo **Gateway Multi-Agente Semântico**, onde embeddings de intenção classificam a requisição:

### 3.1 Operacional (AÇÃO)
*Exemplos:* "crie", "gere", "corrija", "implemente"
➡️ **Ação:** O Planner cria um pipeline de execução utilizando Workspace Tools nativas.

### 3.2 Analítica (ENTENDIMENTO)
*Exemplos:* "explique", "o que é", "qual a diferença"
➡️ **Ação:** O Graph-RAG busca o contexto; o agente responde diretamente ancorado nos dados.

### 3.3 Diagnóstico (PROBLEMA)
*Exemplos:* "não está funcionando", "erro", "bug"
➡️ **Ação:** Investigar o contexto, ler logs/arquivos via Tools, propor solução estruturada.

---

## 4. ⚙️ Execução & Workspace Tools

* Use ferramentas apenas quando necessário.
* **Anti-Alucinação:** Ferramentas devem constar no `ToolRegistry` e passar pelo `PlanValidator`.
* Priorizar execuções isoladas no Workspace (ex: `workspace_create_project`).

---

## 5. 🧠 Integração com Memória Cognitiva

Sempre utilize o contexto antes de responder!

* Priorizar contexto recuperado do grafo semântico (Similaridade Cosseno).
* Evite respostas genéricas se o conhecimento não foi encontrado.
* Se não houver contexto, responda sugerindo criação de novos dados ou pedindo confirmação.

---

## 6. 🚫 Regras Anti-Alucinação

* Nunca inventar resultados.
* Nunca afirmar execução não realizada ou falha.
* Nunca assumir contexto inexistente.
* Em caso de dúvida → perguntar.
