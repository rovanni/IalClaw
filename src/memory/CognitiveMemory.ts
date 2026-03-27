import Database from 'better-sqlite3';
import { LLMProvider } from '../engine/ProviderFactory';

export type NodeResult = {
    id: string;
    type?: string;
    subtype?: string;
    name: string;
    score: number;
    importance?: number;
    freshness?: number;
    content?: string;
    content_preview?: string;
    embedding?: string;
    depth?: number;
    final_score?: number;
    edge_weight?: number;
    semantic_strength?: number;
};

export class CognitiveMemory {
    private db: Database.Database;
    private provider: LLMProvider;
    private recentlyUsedNodes = new Set<string>();

    constructor(db: Database.Database, provider: LLMProvider) {
        this.db = db;
        this.provider = provider;
    }

    public async retrieveWithTraversal(query: string, queryEmbedding: number[], limit: number = 20): Promise<NodeResult[]> {
        // 1. Initial Hybrid Search (Seed Nodes)
        const seeds = await this.hybridSearch(query, queryEmbedding, 5);
        if (seeds.length === 0) return [];

        // 2. Traversal Expansion
        const expanded = await this.traverseGraph(seeds);

        // 3. Merge and Rank results
        return this.rankWithHybridScoring(seeds, expanded, queryEmbedding, limit);
    }

    public async getIdentityNodes(targetAgentId?: string): Promise<NodeResult[]> {
        let query = `
            SELECT id, type, subtype, name, score, importance, freshness, content, content_preview, embedding
            FROM nodes
            WHERE type = 'identity'
        `;

        if (targetAgentId) {
            query += ` AND (subtype != 'agent' OR id = ?)`;
            return this.db.prepare(query).all(targetAgentId) as NodeResult[];
        }

        return this.db.prepare(query).all() as NodeResult[];
    }

    public searchByContent(text: string, limit: number = 5): NodeResult[] {
        return this.db.prepare(`
            SELECT id, type, subtype, name, score, importance, freshness, content, content_preview
            FROM nodes
            WHERE content LIKE ?
            ORDER BY importance DESC
            LIMIT ?
        `).all(`%${text}%`, limit) as NodeResult[];
    }

    public async hybridSearch(query: string, queryEmbedding: number[], limit: number = 5): Promise<NodeResult[]> {
        const normalized = this.normalize(query);

        const cacheHit = this.db
            .prepare(`SELECT result_ids FROM query_cache WHERE query_normalized = ?`)
            .get(normalized) as { result_ids: string } | undefined;

        if (cacheHit) {
            const ids = JSON.parse(cacheHit.result_ids);
            return this.fetchNodesByIds(ids);
        }

        // Busca todos os nodes rankeados por score inicial
        const nodes = this.db
            .prepare(`
        SELECT id, type, name, score, importance, freshness, content, content_preview, embedding
        FROM nodes
      `)
            .all() as NodeResult[];

        for (const node of nodes) {
            let sim = 0;
            if (node.embedding && queryEmbedding.length > 0) {
                const nodeVec = JSON.parse(node.embedding) as number[];
                sim = this.cosineSimilarity(queryEmbedding, nodeVec);
            }
            // Hybrid Score: 30% Grafo Nativo (Score) + 70% Similaridade Semântica Verdadera
            node.score = (node.score * 0.3) + (sim * 0.7);
        }

        // Ordena de modo decrescente
        nodes.sort((a, b) => b.score - a.score);
        const topNodes = nodes.slice(0, limit);

        this.db.prepare(`
      INSERT OR REPLACE INTO query_cache
      (query_hash, query_text, query_normalized, result_ids, hit_count, created)
      VALUES (?, ?, ?, ?, 1, datetime('now'))
    `).run(
            this.hash(normalized),
            query,
            normalized,
            JSON.stringify(topNodes.map(n => n.id))
        );

        return topNodes;
    }

    private async traverseGraph(seedNodes: NodeResult[]): Promise<NodeResult[]> {
        const visited = new Set<string>();
        const results: NodeResult[] = [];
        let frontier = [...seedNodes];
        let depth = 0;

        // Limits
        const MAX_DEPTH = 2;
        const MAX_TOTAL_NODES = 30;

        while (frontier.length > 0 && depth <= MAX_DEPTH) {
            const nextFrontier: NodeResult[] = [];

            for (const node of frontier) {
                if (visited.has(node.id)) continue;
                if (results.length >= MAX_TOTAL_NODES) break;

                visited.add(node.id);
                // Assign depth for penalty calculation later (skip adding seeds to results as they are handled in mergeAndRank)
                if (depth > 0) {
                    node.depth = depth;
                    results.push(node);
                } else {
                    node.depth = 0; // seed nodes
                }

                // Fetch neighbors (limit 5 per node)
                const neighbors = await this.getNeighbors(node.id);

                for (const n of neighbors) {
                    if (!visited.has(n.id)) {
                        n.depth = depth + 1;
                        nextFrontier.push(n);
                    }
                }
            }
            if (results.length >= MAX_TOTAL_NODES) break;
            frontier = nextFrontier;
            depth++;
        }

        return results;
    }

    private async getNeighbors(nodeId: string): Promise<NodeResult[]> {
        return this.db.prepare(`
            SELECT 
                n.id, n.type, n.subtype, n.name, n.score, n.importance, n.freshness, n.content, n.content_preview, n.embedding,
                e.weight as edge_weight, e.semantic_strength
            FROM edges e
            JOIN nodes n ON n.id = e.target
            WHERE e.source = ?
            ORDER BY (e.weight + e.semantic_strength) DESC
            LIMIT 5
        `).all(nodeId) as NodeResult[];
    }

    private computeGraphScore(node: NodeResult): number {
        if (node.edge_weight === undefined || node.semantic_strength === undefined) return 0.5;

        return (node.edge_weight * 0.6) + (node.semantic_strength * 0.4);
    }

    private computeCompositeScore(node: NodeResult): number {
        const importance = node.importance || 0.5;
        const freshness = node.freshness || 1.0;
        const access = Math.min(node.score || 0, 1.0);
        return (importance * 0.4) + (freshness * 0.3) + (access * 0.3);
    }

    private computeFinalScore(node: NodeResult, queryEmbedding: number[]): number {
        // 1. Semantic Similarity
        let similarity = 0;
        if (node.embedding && queryEmbedding.length > 0) {
            const nodeVec = JSON.parse(node.embedding) as number[];
            similarity = this.cosineSimilarity(queryEmbedding, nodeVec);
            similarity = (similarity + 1) / 2;
        }

        // 2. Composite Score (importance + freshness + access)
        const composite = this.computeCompositeScore(node);

        // 3. Depth Factor
        const depthFactor = 1 / ((node.depth || 0) + 1);

        let score = (similarity * 0.4) + (composite * 0.5) + (depthFactor * 0.1);

        // 4. Repetition Penalty
        if (this.recentlyUsedNodes.has(node.id)) {
            score *= 0.8;
        }

        return score;
    }

    private rankWithHybridScoring(seeds: NodeResult[], expanded: NodeResult[], queryEmbedding: number[], limit: number = 20): NodeResult[] {
        const map = new Map<string, NodeResult>();

        for (const n of [...seeds, ...expanded]) {
            if (!map.has(n.id)) {
                map.set(n.id, n);
            }
        }

        const ranked = Array.from(map.values()).map(n => {
            const finalNode = { ...n };
            finalNode.final_score = this.computeFinalScore(finalNode, queryEmbedding);
            return finalNode;
        });

        ranked.sort((a, b) => (b.final_score || 0) - (a.final_score || 0));

        // Controlled exploration: 80% top score, 20% random from top 20
        const poolSize = Math.max(20, limit);
        const pool = ranked.slice(0, poolSize);
        const deterministicCount = Math.ceil(limit * 0.8);
        const explorationCount = limit - deterministicCount;

        const result = pool.slice(0, deterministicCount);
        const remaining = pool.slice(deterministicCount);

        for (let i = 0; i < explorationCount && remaining.length > 0; i++) {
            const idx = Math.floor(Math.random() * remaining.length);
            result.push(remaining.splice(idx, 1)[0]);
        }

        return result;
    }

    public async learn(input: {
        query: string;
        nodes_used: NodeResult[];
        success?: boolean;
        response?: string;
    }) {
        const { nodes_used } = input;

        // Gerar embedding para o nó de conhecimento novo / ou atualizar a intenção da query
        const queryEmb = await this.provider.embed(input.query);

        const updateNode = this.db.prepare(`UPDATE nodes SET score = score + 0.1 WHERE id = ?`);
        const updateEdges = this.db.prepare(`UPDATE edges SET weight = weight + 0.05, traversal_count = traversal_count + 1 WHERE source = ? OR target = ?`);
        const insertLearning = this.db.prepare(`INSERT INTO learning_events (query, selected_nodes, success, created_at) VALUES (?, ?, ?, datetime('now'))`);

        // In a full implementation we would create new Concept nodes and save their embeddings.
        // For this update, we just emulate the structural reinforcement.

        const tx = this.db.transaction(() => {
            for (const node of nodes_used) {
                updateNode.run(node.id);
                updateEdges.run(node.id, node.id);
                this.recentlyUsedNodes.add(node.id);
            }
            insertLearning.run(input.query, JSON.stringify(nodes_used.map(n => n.id)), input.success ? 1 : 0);
        });
        tx();

        // Evict oldest entries to prevent unbounded growth
        if (this.recentlyUsedNodes.size > 200) {
            const first = this.recentlyUsedNodes.values().next().value;
            if (first) this.recentlyUsedNodes.delete(first);
        }
    }

    private buildConversationTitle(content: string): string {
        const normalized = String(content || '').replace(/\s+/g, ' ').trim();
        if (!normalized) {
            return 'Nova conversa';
        }

        return normalized.slice(0, 60);
    }

    private upsertConversation(conversationId: string, role: string, content: string) {
        const existingConversation = this.db.prepare(`
      SELECT metadata, message_count
      FROM conversations
      WHERE id = ?
    `).get(conversationId) as { metadata?: string; message_count?: number } | undefined;

        const now = new Date().toISOString();
        const currentMetadata = existingConversation?.metadata
            ? JSON.parse(existingConversation.metadata)
            : {};

        if (!currentMetadata.title && role === 'user') {
            currentMetadata.title = this.buildConversationTitle(content);
        }

        if (!currentMetadata.title) {
            currentMetadata.title = 'Nova conversa';
        }

        if (!existingConversation) {
            this.db.prepare(`
        INSERT INTO conversations
        (id, user_id, provider, started_at, last_message_at, message_count, metadata)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(
                conversationId,
                conversationId,
                'ialclaw',
                now,
                now,
                0,
                JSON.stringify(currentMetadata)
            );
            return;
        }

        this.db.prepare(`
      UPDATE conversations
      SET last_message_at = ?, metadata = ?
      WHERE id = ?
    `).run(now, JSON.stringify(currentMetadata), conversationId);
    }

    public saveMessage(conversationId: string, role: string, content: string, toolName?: string, toolArgs?: string, toolResult?: string) {
        const transaction = this.db.transaction(() => {
            this.upsertConversation(conversationId, role, content);

            this.db.prepare(`
      INSERT INTO messages (conversation_id, role, content, tool_name, tool_args, tool_result, created_at)
      VALUES (?, ?, ?, ?, ?, ?, datetime('now'))
    `).run(conversationId, role, content, toolName || null, toolArgs || null, toolResult || null);

            this.db.prepare(`
      UPDATE conversations
      SET message_count = (
        SELECT COUNT(*)
        FROM messages
        WHERE conversation_id = ?
      ),
      last_message_at = datetime('now')
      WHERE id = ?
    `).run(conversationId, conversationId);
        });

        transaction();
    }

    public async saveCodeNode(input: {
        projectId: string;
        filePath: string;
        language: string;
        summary: string;
        fileType: 'controller' | 'service' | 'model' | 'config' | 'view' | 'other';
        tokensEstimate?: number;
    }): Promise<string> {
        const nodeId = `code:${this.hash(`${input.projectId}:${input.filePath}`)}`;
        const fullContent = `Arquivo ${input.filePath}: ${input.summary}`;
        const embedding = await this.provider.embed(fullContent);
        const preview = fullContent.slice(0, 280);
        const tags = JSON.stringify({
            projectId: input.projectId,
            filePath: input.filePath,
            language: input.language,
            fileType: input.fileType,
            tokensEstimate: input.tokensEstimate || 0,
            access_count: 0,
            last_accessed: null
        });
        const createdAt = new Date().toISOString();

        this.db.prepare(`
            INSERT OR REPLACE INTO nodes
            (id, type, subtype, name, content, content_preview, embedding, category, tags, importance, score, freshness, auto_indexed, created_at, modified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            nodeId,
            'code',
            input.fileType,
            input.filePath,
            fullContent,
            preview,
            JSON.stringify(embedding),
            input.language,
            tags,
            0.7,
            0.5,
            1.0,
            1,
            createdAt,
            createdAt
        );

        return nodeId;
    }

    public updateNodeMetadata(nodeId: string, update: { access_count?: number; last_accessed?: number }): void {
        const row = this.db.prepare(`SELECT tags FROM nodes WHERE id = ?`).get(nodeId) as { tags: string } | undefined;
        if (!row) return;

        let tags: any = {};
        try { tags = JSON.parse(row.tags || '{}'); } catch { tags = {}; }

        if (update.access_count !== undefined) tags.access_count = update.access_count;
        if (update.last_accessed !== undefined) tags.last_accessed = update.last_accessed;

        this.db.prepare(`UPDATE nodes SET tags = ?, modified = ? WHERE id = ?`)
            .run(JSON.stringify(tags), new Date().toISOString(), nodeId);
    }

    public getCodeNodesByProject(projectId: string): NodeResult[] {
        const nodes = this.db.prepare(`
            SELECT id, type, subtype, name, content, content_preview, tags
            FROM nodes
            WHERE type = 'code'
        `).all() as (NodeResult & { tags: string })[];

        return nodes.filter(n => {
            try {
                const tags = JSON.parse(n.tags || '{}');
                return tags.projectId === projectId;
            } catch { return false; }
        });
    }

    public async saveExecutionFix(input: {
        content: string;
        project_id?: string;
        error_type?: string;
        fingerprint?: string;
        timestamp?: number;
    }) {
        const createdAt = new Date(input.timestamp || Date.now()).toISOString();
        const nodeId = `execution-fix:${this.hash(`${input.project_id || 'global'}:${input.fingerprint || createdAt}:${createdAt}`)}`;
        const embedding = await this.provider.embed(input.content);
        const preview = input.content.slice(0, 280);
        const tags = JSON.stringify([
            'execution_fix',
            input.project_id || 'global',
            input.error_type || 'unknown'
        ]);

        this.db.prepare(`
      INSERT OR REPLACE INTO nodes
      (id, type, subtype, name, content, content_preview, embedding, category, tags, importance, score, freshness, auto_indexed, created_at, modified)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
            nodeId,
            'memory',
            'execution_fix',
            `Execution fix ${input.error_type || 'unknown'}`,
            input.content,
            preview,
            JSON.stringify(embedding),
            'execution_fix',
            tags,
            0.85,
            0.75,
            1.0,
            1,
            createdAt,
            createdAt
        );
    }

    public getConversationHistory(conversationId: string, limit: number = 20): any[] {
        return this.db.prepare(`
      SELECT * FROM messages
      WHERE conversation_id = ?
      ORDER BY id ASC
      LIMIT ?
    `).all(conversationId, limit) as any[];
    }

    private fetchNodesByIds(ids: string[]): NodeResult[] {
        if (ids.length === 0) return [];
        const placeholders = ids.map(() => '?').join(',');
        return this.db.prepare(`
      SELECT id, type, name, score, importance, freshness, content, content_preview, embedding
      FROM nodes
      WHERE id IN (${placeholders})
    `).all(...ids) as NodeResult[];
    }

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

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        let dotProduct = 0.0;
        let normA = 0.0;
        let normB = 0.0;
        const len = Math.min(vecA.length, vecB.length);
        for (let i = 0; i < len; i++) {
            dotProduct += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (normA === 0 || normB === 0) return 0;
        return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
    }
}
