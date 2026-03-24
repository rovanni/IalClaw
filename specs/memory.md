# 🧠 Memory System — IalClaw

**Versão:** 3.0
**Status:** Definição Cognitiva
**Autor:** Luciano + IA
**Data:** 2026-03-23

---

# 1. Visão Geral

O sistema de memória do IalClaw não é apenas um mecanismo de persistência, mas um **sistema cognitivo ativo**, responsável por armazenar, recuperar, relacionar e evoluir conhecimento ao longo do tempo.

A memória é estruturada em três camadas complementares:

* Memória Episódica
* Memória Semântica
* Memória Relacional (Grafo)

---

# 2. Princípios Fundamentais

* Memória é ativa, não passiva
* Conhecimento é reutilizável
* Relações são tão importantes quanto dados
* O sistema deve aprender com uso
* Contexto deve ser construído antes da inferência

---

# 3. Tipos de Memória

---

## 3.1 Memória Episódica

Representa o histórico de interações com o usuário.

### Características:

* Sequencial
* Temporal
* Contextual

### Estrutura:

* conversations
* messages

### Função:

* Manter continuidade de diálogo
* Fornecer contexto recente ao AgentLoop

---

## 3.2 Memória Semântica

Representa conhecimento persistente do sistema.

### Origem:

* Arquivos `.md`
* Documentação do sistema
* Skills
* Configurações

### Estrutura:

* documents

### Função:

* Base de conhecimento reutilizável
* Fonte primária de contexto
* Redução de dependência do LLM

---

## 3.3 Memória Relacional (Grafo)

Representa conexões entre conhecimentos.

### Estrutura:

* nodes
* edges

### Função:

* Navegação semântica
* Inferência indireta
* Associação de conceitos

---

# 4. Pipeline Cognitivo

Todo input do usuário segue o seguinte fluxo:

User Input
→ Normalização
→ Cache
→ Grafo
→ Documentos
→ Ranking
→ Construção de Contexto
→ AgentLoop
→ Resposta
→ Aprendizado

---

# 5. Recuperação de Memória (Search)

A recuperação de contexto segue estratégia **GRAPH_FIRST**.

## Ordem de execução:

1. Query Cache
2. Graph Traversal
3. Document Retrieval
4. Ranking
5. Context Builder

---

## Pseudocódigo:

```ts id="memcode1"
search(query):
  normalized = normalize(query)

  if cache.hit(normalized):
    return cache.result

  nodes = graph.traverse(query)
  docs = documents.fetch(nodes)

  ranked = rank(docs)

  return buildContext(ranked)
```

---

# 6. Construção de Contexto

O contexto enviado ao LLM deve:

* Ser relevante
* Ser limitado em tokens
* Evitar redundância
* Priorizar maior score

---

## Estrutura:

```text id="memcode2"
CONTEXTO COGNITIVO:

- conceito A
- conceito B
- documento relevante X
```

---

# 7. Sistema de Score

Cada elemento possui um score dinâmico:

```text id="memcode3"
final_score =
  relevance *
  importance *
  freshness *
  usage_frequency *
  graph_weight
```

---

# 8. Aprendizado Contínuo

Após cada interação, o sistema deve:

* Atualizar score dos nodes utilizados
* Incrementar peso das edges percorridas
* Registrar evento em learning_events
* Atualizar cache de consulta

---

## Pseudocódigo:

```ts id="memcode4"
learn(query, nodes):
  for node in nodes:
    node.score += 0.1

  for edge in used_edges:
    edge.weight += 0.05
```

---

# 9. Cache Cognitivo

Antes de qualquer processamento:

```text id="memcode5"
if cache_hit:
  return resultado direto
```

---

## Benefícios:

* Redução de latência
* Redução de tokens
* Respostas mais consistentes

---

# 10. Decaimento de Memória

Para evitar obsolescência:

```text id="memcode6"
score = score * 0.98 por dia
```

---

# 11. Ingestão de Conhecimento

Processo de indexação de `.md`:

1. Leitura do arquivo
2. Extração de título e conteúdo
3. Criação em documents
4. Criação de node
5. Detecção de relações → edges

---

# 12. Tipos de Nós

* document
* concept
* skill
* memory
* rule

---

# 13. Tipos de Relações

* references
* depends_on
* uses
* extends
* related_to

---

# 14. Atualização de Memória

A memória é atualizada em dois momentos:

### Durante ingestão

* criação de nodes e edges

### Durante uso

* ajuste de scores
* reforço de conexões

---

# 15. Integração com AgentLoop

---

## Antes da execução

```ts id="memcode7"
context = cognitiveMemory.search(input)
inject(context)
```

---

## Após execução

```ts id="memcode8"
cognitiveMemory.learn(input, context)
```

---

# 16. Limitações Atuais

* Sem embeddings vetoriais
* Busca baseada em heurística textual
* Grafo ainda dependente de regras

---

# 17. Evolução Futura

* Vector embeddings
* Similaridade semântica real
* Auto-descoberta de relações
* Clustering de conhecimento
* Memória hierárquica

---

# 18. Conclusão

O sistema de memória do IalClaw transforma o agente de:

"executor de prompts"

para:

"sistema cognitivo com aprendizado, contexto e estrutura de conhecimento"
