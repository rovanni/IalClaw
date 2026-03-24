import Database from 'better-sqlite3';

type NodeResult = {
  id: string;
  name: string;
  score: number;
  content_preview: string;
};

type SearchResult = {
  nodes: NodeResult[];
  context: string;
};

export class CognitiveMemory {
  private db: Database.Database;

  constructor(dbPath: string) {
    this.db = new Database(dbPath);
  }

  // ================================
  // 🔎 SEARCH (GRAPH-FIRST)
  // ================================
  public search(query: string, limit: number = 5): SearchResult {
    const normalized = this.normalize(query);

    // 1. CACHE
    const cacheHit = this.db
      .prepare(`SELECT result_ids FROM query_cache WHERE query_normalized = ?`)
      .get(normalized);

    if (cacheHit) {
      const ids = JSON.parse(cacheHit.result_ids);
      return this.buildFromIds(ids);
    }

    // 2. GRAPH SEARCH (simplificado por score)
    const nodes = this.db
      .prepare(`
        SELECT id, name, score, content_preview
        FROM nodes
        ORDER BY score DESC
        LIMIT ?
      `)
      .all(limit) as NodeResult[];

    // 3. BUILD CONTEXT
    const context = this.buildContext(nodes);

    // 4. CACHE STORE
    this.db.prepare(`
      INSERT OR REPLACE INTO query_cache
      (query_hash, query_text, query_normalized, result_ids, hit_count, created)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
    `).run(
      this.hash(normalized),
      query,
      normalized,
      JSON.stringify(nodes.map(n => n.id))
    );

    return { nodes, context };
  }

  // ================================
  // 🧠 LEARNING
  // ================================
  public learn(input: {
    query: string;
    nodes_used: NodeResult[];
    success?: boolean;
  }) {
    const { nodes_used } = input;

    const updateNode = this.db.prepare(`
      UPDATE nodes
      SET score = score + 0.1
      WHERE id = ?
    `);

    const updateEdges = this.db.prepare(`
      UPDATE edges
      SET weight = weight + 0.05,
          traversal_count = traversal_count + 1
      WHERE source = ? OR target = ?
    `);

    const insertLearning = this.db.prepare(`
      INSERT INTO learning_events (query, selected_nodes, success, created_at)
      VALUES (?, ?, ?, datetime('now'))
    `);

    const tx = this.db.transaction(() => {
      for (const node of nodes_used) {
        updateNode.run(node.id);
        updateEdges.run(node.id, node.id);
      }

      insertLearning.run(
        input.query,
        JSON.stringify(nodes_used.map(n => n.id)),
        input.success ? 1 : 0
      );
    });

    tx();
  }

  // ================================
  // 🏗️ BUILD CONTEXT
  // ================================
  private buildContext(nodes: NodeResult[]): string {
    const lines = nodes.map(n => `- ${n.name}: ${n.content_preview}`);
    return `CONTEXTO COGNITIVO:\n\n${lines.join('\n')}`;
  }

  private buildFromIds(ids: string[]): SearchResult {
    const placeholders = ids.map(() => '?').join(',');

    const nodes = this.db
      .prepare(`
        SELECT id, name, score, content_preview
        FROM nodes
        WHERE id IN (${placeholders})
      `)
      .all(...ids) as NodeResult[];

    return {
      nodes,
      context: this.buildContext(nodes)
    };
  }

  // ================================
  // 🧰 UTIL
  // ================================
  private normalize(text: string): string {
    return text.toLowerCase().trim();
  }

  private hash(text: string): string {
    let hash = 0;
    for (let i = 0; i < text.length; i++) {
      hash = (hash << 5) - hash + text.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString();
  }
}
