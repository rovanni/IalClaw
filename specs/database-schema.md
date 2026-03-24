[🇧🇷 Ver versão em Português](#-versão-em-português)

# 🗄️ Database Schema — IalClaw (Cognitive System)

**Version:** 3.0  
**Status:** Official Definition  
**Author:** Luciano + IA  
**Date:** March 24, 2026  

---

## 1. Overview

IalClaw's database uses **SQLite** as local persistence engine and stores:

* Conversation history (episodic memory)
* Structured knowledge (semantic memory with embeddings)
* Relationships between knowledge (graph relations)
* Query cache
* Learning events

---

## 2. Initial Setup

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA foreign_keys=OFF;
```

---

## 3. Semantic Memory (v3.0 Embeddings)

### 3.1 documents
Stores raw content, summaries, and embeddings of local files.

```sql
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT UNIQUE,
  filename TEXT,
  path TEXT,
  title TEXT,
  content TEXT,
  summary TEXT,
  embedding BLOB, -- v3.0 Vector Encodings
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

## 4. Cognitive Graph

### 4.1 nodes
Stores entities extracted along with vector embeddings for cosine similarity.

```sql
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  doc_id TEXT,
  type TEXT,
  name TEXT,
  category TEXT,
  score REAL DEFAULT 0.0,
  embedding BLOB, -- v3.0 Semantic Intent Routing
  tags TEXT,
  content_preview TEXT,
  auto_indexed INTEGER DEFAULT 1,
  created_at TEXT,
  modified TEXT
);
```

### 4.2 edges
Relationships between nodes. Weight decays naturally over time via `MemoryDreamer`.

```sql
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

<br><br>

# 🇧🇷 Versão em Português

# 🗄️ Database Schema — IalClaw (Cognitive System)

**Versão:** 3.0  
**Status:** Definição Oficial  
**Autor:** Luciano + IA  
**Data:** 24 de março de 2026  

---

## 1. Visão Geral

O banco de dados do IalClaw utiliza **SQLite** como mecanismo de persistência local e armazena:

* Histórico de conversas (memória episódica)
* Conhecimento estruturado (memória semântica com embeddings)
* Relações entre conhecimentos (grafo)
* Cache de consultas
* Eventos de aprendizado

---

## 2. Configuração Inicial

```sql
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA foreign_keys=OFF;
```

---

## 3. Memória Semântica (v3.0 Embeddings)

### 3.1 documents
Armazena conteúdo bruto, resumos e embeddings de arquivos locais.

```sql
CREATE TABLE IF NOT EXISTS documents (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  doc_id TEXT UNIQUE,
  filename TEXT,
  path TEXT,
  title TEXT,
  content TEXT,
  summary TEXT,
  embedding BLOB, -- v3.0 Vector Encodings
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

## 4. Grafo Cognitivo

### 4.1 nodes
Armazena entidades e vetores para roteamento via similaridade cosseno.

```sql
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  doc_id TEXT,
  type TEXT,
  name TEXT,
  category TEXT,
  score REAL DEFAULT 0.0,
  embedding BLOB, -- v3.0 Semantic Intent Routing
  tags TEXT,
  content_preview TEXT,
  auto_indexed INTEGER DEFAULT 1,
  created_at TEXT,
  modified TEXT
);
```

### 4.2 edges
Relações entre nós. Sofrem decaimento de peso ao longo do tempo através do `MemoryDreamer`.

```sql
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
