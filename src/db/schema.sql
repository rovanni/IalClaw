-- Configuration
PRAGMA journal_mode=WAL;
PRAGMA synchronous=NORMAL;
PRAGMA temp_store=MEMORY;
PRAGMA foreign_keys=OFF;

-- Episodic Memory
CREATE TABLE IF NOT EXISTS conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT,
  provider TEXT,
  started_at TEXT,
  last_message_at TEXT,
  message_count INTEGER DEFAULT 0,
  metadata TEXT
);

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

-- Semantic Memory
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

-- Cognitive Graph
CREATE TABLE IF NOT EXISTS nodes (
  id TEXT PRIMARY KEY,
  doc_id TEXT,

  -- identidade semântica
  type TEXT,              -- memory | identity | concept | fact
  subtype TEXT,           -- soul | user | agent | heartbeat | etc

  name TEXT,
  content TEXT,           -- TEXTO COMPLETO (CRÍTICO)
  content_preview TEXT,

  -- inteligência
  importance REAL DEFAULT 0.5,
  score REAL DEFAULT 0.0,
  freshness REAL DEFAULT 1.0,

  -- embeddings
  embedding TEXT,

  -- metadados
  category TEXT,
  tags TEXT,
  auto_indexed INTEGER DEFAULT 1,

  created_at TEXT,
  modified TEXT
);

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

-- Cognitive Cache
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

-- Learning
CREATE TABLE IF NOT EXISTS learning_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  query TEXT,
  selected_nodes TEXT,
  success INTEGER,
  feedback_score REAL,
  created_at TEXT
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_messages_conversation ON messages(conversation_id);
CREATE INDEX IF NOT EXISTS idx_documents_category ON documents(category);
CREATE INDEX IF NOT EXISTS idx_documents_score ON documents(score);
CREATE INDEX IF NOT EXISTS idx_nodes_type ON nodes(type);
CREATE INDEX IF NOT EXISTS idx_edges_source ON edges(source);
CREATE INDEX IF NOT EXISTS idx_edges_target ON edges(target);
CREATE INDEX IF NOT EXISTS idx_cache_hash ON query_cache(query_hash);
