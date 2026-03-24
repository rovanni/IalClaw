Spec: PRD — IalClaw Core (Versão Cognitiva)

Versão: 3.0

Status: Aprovada

Autor: Luciano + IalClaw Agent

Data: 23 de março de 2026

Reviewers: Luciano

1. Resumo

O IalClaw é um agente pessoal de Inteligência Artificial operando 100% localmente. Ele transcende a função de um chatbot simples ao implementar uma Memória Cognitiva (Episódica, Semântica e Relacional via Grafos) integrada a um pipeline de execução via Telegram. O objetivo é permitir que o agente aprenda com interações passadas, relacione conceitos em arquivos locais e reduza o consumo de tokens através de cache e recuperação de contexto inteligente.

2. Contexto e Motivação

Problema:
Agentes tradicionais são stateless ou possuem memória limitada ao histórico imediato do chat. Isso impede o aprendizado de longo prazo, a relação entre diferentes sessões de conversa e a reutilização de conhecimentos extraídos de documentos locais sem reprocessamento custoso.

Solução:
Implementar uma infraestrutura de memória ativa que armazena não apenas o que foi dito, mas as conexões entre os fatos (grafos) e os documentos de referência (semântica), operando sobre um banco SQLite local.

3. Goals (Objetivos)

G-01: Operar primariamente via Telegram usando a biblioteca grammy.

G-02: Intercambiar "cérebros" (LLMs) via ProviderFactory (Gemini, DeepSeek, etc.).

G-03: Manter memória episódica (histórico de conversas) persistente.

G-04: Executar raciocínio complexo via AgentLoop (padrão ReAct).

G-05: Construir e manter um grafo de conhecimento em tempo real.

G-06: Implementar memória cognitiva ativa para injeção de contexto.

G-07: Aprender automaticamente através das interações e feedbacks.

G-08: Reduzir latência e custo (tokens) via cache inteligente de queries.

4. Non-Goals (Fora de Escopo)

NG-01: Interface Web ou Mobile nativa (Interface exclusiva Telegram).

NG-02: Suporte multiusuário fora da Whitelist estrita.

NG-03: Uso de bancos de dados distribuídos (foco em SQLite local).

5. Arquitetura do Sistema

O fluxo de dados segue uma estrutura circular onde a saída retroalimenta a memória:

Input: Mensagem recebida via Telegram.

Cognitive Pipeline: Normalização -> Cache -> Busca em Grafo -> Recuperação de Docs -> Ranking de Contexto.

Context Injection: O contexto recuperado é injetado como mensagem de sistema.

AgentLoop: Processamento pelo LLM (Pensa -> Age -> Observa).

Output: Resposta enviada ao usuário.

Learning Update: A resposta e a query são processadas para atualizar pesos no grafo e documentos.

6. Modelo Cognitivo

O sistema é sustentado por três pilares de memória:

6.1 Memória Episódica

Armazena o histórico cronológico de interações. Essencial para manter a continuidade do diálogo imediato.

6.2 Memória Semântica

Baseada em documentos locais (Markdown). O agente lê, resume e categoriza arquivos para consultas futuras.

6.3 Memória Relacional (Grafo)

Conecta entidades e conceitos. Se o usuário fala sobre "Projeto X" e "SQLite", o sistema cria uma aresta ligando esses nós, permitindo navegação associativa.

7. Requisitos Funcionais

ID

Requisito

Prioridade

Critério de Aceite

RF-01

Polling via Grammy

Must

O bot deve processar mensagens em tempo real no terminal.

RF-02

Whitelist de IDs

Must

Somente IDs em TELEGRAM_ALLOWED_USER_IDS são processados.

RF-03

Injeção de Contexto

Must

O sistema deve buscar no SQLite dados relevantes antes de chamar o LLM.

RF-04

Atualização de Grafo

Should

A cada resposta, novos "Nodes" e "Edges" devem ser avaliados e salvos.

RF-05

Cache de Query

Should

Se uma query similar for detectada, retornar resultado do cache (se confiança > X).

RF-06

Ingestão de MD

Must

Monitorar pasta local para converter arquivos .md em documentos na memória semântica.

8. Modelo de Dados (SQLite)

Tabelas Principais:

conversations / messages: Logs de chat (Episódica).

documents: Conteúdo bruto, resumos e metadados de arquivos locais.

nodes: Entidades extraídas (ex: nomes, tecnologias, conceitos).

edges: Relações entre nodes (source, target, weight).

query_cache: Hashes de perguntas anteriores e seus resultados.

learning_events: Log de sucessos/falhas para ajuste de pesos.

9. Lógica de Inteligência e Score
## 9. Modelo de Dados

Além das entidades conversacionais, o sistema passa a suportar memória cognitiva estruturada.

### 9.1 Memória Episódica

conversations {
id: string
user_id: string
provider: string
}

messages {
conversation_id: string
role: string
content: string
}

### 9.2 Memória Semântica

documents {
id: integer
doc_id: string

title: string
content: string
summary: string

category: string
tags: string

importance: float
freshness: float

access_count: integer
last_accessed: string
}

### 9.3 Grafo Cognitivo

nodes {
id: string
doc_id: string

type: string
name: string

score: float
tags: string
}

edges {
source: string
target: string

relation: string
weight: float

semantic_strength: float
traversal_count: integer
}

### 9.4 Cache

query_cache {
query_hash: string

query_text: string
normalized: string

result_ids: string
confidence: float

hit_count: integer
last_used: string
}

### 9.5 Aprendizado

learning_events {
id: integer

query: string
selected_nodes: string

success: integer
feedback_score: float
}


10. Requisitos Não-Funcionais

RNF-01 (Latência): O processamento da memória cognitiva deve adicionar menos de 200ms ao tempo total de resposta.

RNF-02 (Persistência): Utilização de better-sqlite3 com modo WAL para escritas rápidas.

RNF-03 (Segurança): Dados 100% locais; nenhuma telemetria externa além da API de Chat do Telegram e Provedor LLM.

11. Riscos e Mitigações

Risco

Impacto

Mitigação

Crescimento excessivo do DB

Médio

Implementar rotina de VACUUM e deleção de mensagens antigas/irrelevantes.

Inconsistência no Grafo

Baixo

Scripts de validação de integridade referencial nas tabelas de edges.

Latência da API LLM

Alto

Sistema de fallback para modelos mais rápidos ou cache local.

12. Métricas de Sucesso

Cache Hit Rate: > 70% para comandos repetitivos.

Redução de Tokens: Redução de 60% no envio de histórico completo através da seleção de contexto.

Uptime: 99% (serviço rodando como daemon local).

13. Conclusão

O IalClaw v2.0 transforma-se de uma ferramenta de execução em um parceiro cognitivo. A implementação do grafo de conhecimento e do pipeline de aprendizado garante que, quanto mais o usuário interage, mais inteligente e eficiente o agente se torna, operando com total privacidade em ambiente local.