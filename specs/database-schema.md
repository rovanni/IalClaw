# 🗄️ Database Schema — IalClaw (Cognitive System)

**Versão:** 2.0
**Status:** Definição Oficial
**Autor:** Luciano + IA
**Data:** 2026-03-23

---

# 1. Visão Geral

O banco de dados do IalClaw utiliza **SQLite** como mecanismo de persistência local e é responsável por armazenar:

* Histórico de conversas (memória episódica)
* Conhecimento estruturado (memória semântica)
* Relações entre conhecimentos (grafo)
* Cache de consultas
* Eventos de aprendizado

---

# 2. Configuração Inicial

```sql id="db-init"
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA foreign_keys=OFF;
```

---

# 3. Memória Episódica

---

## 3.1 conversations

```sql id="db-conversations"
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  provider TEXT,
  started_at TEXT,
  last_message_at TEXT,
  message_count INTEGER DEFAULT 0,
  metadata TEXT
);
```

---

## 3.2 messages

```sql id="db-messages"
CREATE TABLE IF NOT EXISTS messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  conversation_id TEXT,
  role TEXT,
  content TEXT,
  tool_name TEXT,
  tool_args TEXT,
  tool_result TEXT,
  created_at TEXT
);
```

---

# 4. Memória Semântica

---

## 4.1 documents

```sql id="db-documents"
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT UNIQUE,

  filename TEXT,
  path TEXT,

  title TEXT,
  content TEXT,
  summary TEXT,

  category TEXT,
  tags TEXT,

  importance REAL DEFAULT 0.5,
  freshness REAL DEFAULT 1.0,
  score REAL DEFAULT 0.0,

  access_count INTEGER DEFAULT 0,
  last_accessed TEXT,

  content_hash TEXT,

  created_at TEXT,
  updated_at TEXT
);
```

---

# 5. Grafo Cognitivo

---

## 5.1 nodes

```sql id="db-nodes"
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  doc_id TEXT,

  type TEXT,
  name TEXT,

  category TEXT,
  score REAL DEFAULT 0.0,

  tags TEXT,
  content_preview TEXT,

  auto_indexed INTEGER DEFAULT 1,

  created_at TEXT,
  modified TEXT
);
```

---

## 5.2 edges

```sql id="db-edges"
CREATE TABLE IF NOT EXISTS edges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  source TEXT,
  target TEXT,

  relation TEXT,
  weight REAL DEFAULT 0.5,

  semantic_strength REAL DEFAULT 0.5,
  traversal_count INTEGER DEFAULT 0,

  context TEXT,
  source_line INTEGER,

  created_at TEXT
);
```

---

# 6. Cache Cognitivo

---

## 6.1 query_cache

```sql id="db-cache"
CREATE TABLE IF NOT EXISTS query_cache (
  query_hash TEXT PRIMARY KEY,

  query_text TEXT,
  query_normalized TEXT,

  result_ids TEXT,
  result_count INTEGER,

  confidence REAL DEFAULT 1.0,
  source TEXT,

  hit_count INTEGER DEFAULT 0,
  last_access TEXT,

  created TEXT,
  expires_at TEXT
);
```

---

# 7. Aprendizado

---

## 7.1 learning_events

```sql id="db-learning"
CREATE TABLE IF NOT EXISTS learning_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,

  query TEXT,
  selected_nodes TEXT,

  success INTEGER,
  feedback_score REAL,

  created_at TEXT
);
```

---

# 8. Endereços Cognitivos (Opcional)

---

## 8.1 cognitive_addresses

```sql id="db-addresses"
CREATE TABLE IF NOT EXISTS cognitive_addresses (
  address TEXT PRIMARY KEY,
  target_path TEXT,
  target_type TEXT,
  description TEXT,
  created TEXT
);
```

---

# 9. Estatísticas

---

## 9.1 stats

```sql id="db-stats"
CREATE TABLE IF NOT EXISTS stats (
  key TEXT PRIMARY KEY,
  value TEXT,
  updated_at TEXT
);
```

---

# 10. Índices (Performance)

---

```sql id="db-indexes"
CREATE INDEX IF NOT EXISTS idx_messages_conversation 
ON messages(conversation_id);

CREATE INDEX IF NOT EXISTS idx_documents_category 
ON documents(category);

CREATE INDEX IF NOT EXISTS idx_documents_score 
ON documents(score);

CREATE INDEX IF NOT EXISTS idx_nodes_type 
ON nodes(type);

CREATE INDEX IF NOT EXISTS idx_edges_source 
ON edges(source);

CREATE INDEX IF NOT EXISTS idx_edges_target 
ON edges(target);

CREATE INDEX IF NOT EXISTS idx_cache_hash 
ON query_cache(query_hash);
```

---

# 11. Full-Text Search (Opcional, recomendado)

---

```sql id="db-fts"
CREATE VIRTUAL TABLE IF NOT EXISTS documents_fts USING fts5(
  title,
  content,
  content='documents',
  content_rowid='id'
);
```

---

# 12. Triggers para FTS

---

```sql id="db-triggers"
CREATE TRIGGER IF NOT EXISTS documents_ai AFTER INSERT ON documents BEGIN
  INSERT INTO documents_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;

CREATE TRIGGER IF NOT EXISTS documents_ad AFTER DELETE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, content)
  VALUES('delete', old.id, old.title, old.content);
END;

CREATE TRIGGER IF NOT EXISTS documents_au AFTER UPDATE ON documents BEGIN
  INSERT INTO documents_fts(documents_fts, rowid, title, content)
  VALUES('delete', old.id, old.title, old.content);

  INSERT INTO documents_fts(rowid, title, content)
  VALUES (new.id, new.title, new.content);
END;
```

---

# 13. Observações Importantes

* Banco local (`.db`) não deve ir para Git
* WAL deve estar sempre ativo
* Vacuum periódico recomendado
* JSON armazenado como TEXT

---

# 14. Conclusão

Este schema suporta:

* Memória episódica (chat)
* Memória semântica (documentos)
* Grafo cognitivo (relações)
* Cache inteligente
* Aprendizado contínuo

Representando a base estrutural do agente cognitivo IalClaw
