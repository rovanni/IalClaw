import Database from 'better-sqlite3';
import path from 'path';
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
    private recentlyUsedCodeNeighbors = new Set<string>();
    private recentlyUsedCodeNeighborStrength = new Map<string, number>();
    private recentNodeLastAccessedAt = new Map<string, number>();
    private recentNodeAccessCount = new Map<string, number>();
    private activeCodeFiles = new Set<string>();

    private readonly RECENCY_HALF_LIFE_MS = 1000 * 60 * 60;
    private readonly RECENCY_WEIGHT = 0.16;
    private readonly ACTIVE_FILE_BONUS = 0.3;
    private readonly NEIGHBOR_BASE_WEIGHT = 0.08;

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

    public async indexCodeNode(input: {
        project_id: string;
        relative_path: string;
        raw_content: string;
    }): Promise<void> {
        const projectId = String(input.project_id || '').trim();
        const relativePath = this.normalizeRelativePath(input.relative_path);
        const rawContent = String(input.raw_content || '');

        if (!projectId || !relativePath || !rawContent || !this.isCodePath(relativePath)) {
            return;
        }

        const now = new Date().toISOString();
        const codeNodeId = this.buildCodeNodeId(projectId, relativePath);
        const preview = rawContent.slice(0, 280);
        const subtype = path.posix.extname(relativePath).replace('.', '') || 'text';
        const tags = JSON.stringify(['code', projectId, relativePath]);
        const embeddingSource = rawContent.slice(0, 6000);
        const embedding = await this.provider.embed(embeddingSource);

        this.db.prepare(`
            INSERT OR REPLACE INTO nodes
            (id, type, subtype, name, content, content_preview, embedding, category, tags, importance, score, freshness, auto_indexed, created_at, modified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            codeNodeId,
            'code',
            subtype,
            relativePath,
            rawContent,
            preview,
            JSON.stringify(embedding),
            'code',
            tags,
            0.75,
            0.6,
            1.0,
            1,
            now,
            now
        );

        const projectNodeId = this.ensureProjectNode(projectId, now);

        this.db.prepare(`
            DELETE FROM edges
            WHERE source = ? AND relation = 'part_of'
        `).run(codeNodeId);

        this.db.prepare(`
            INSERT INTO edges
            (source, target, relation, weight, semantic_strength, traversal_count, context, created_at)
            VALUES (?, ?, 'part_of', ?, ?, 0, ?, ?)
        `).run(codeNodeId, projectNodeId, 0.95, 0.9, projectId, now);

        const importedPaths = this.extractRelativeImports(relativePath, rawContent);

        this.db.prepare(`
            DELETE FROM edges
            WHERE source = ? AND relation = 'imports'
        `).run(codeNodeId);

        const insertImportEdge = this.db.prepare(`
            INSERT INTO edges
            (source, target, relation, weight, semantic_strength, traversal_count, context, created_at)
            VALUES (?, ?, 'imports', ?, ?, 0, ?, ?)
        `);

        const insertPlaceholder = this.db.prepare(`
            INSERT OR IGNORE INTO nodes
            (id, type, subtype, name, content, content_preview, category, tags, importance, score, freshness, auto_indexed, created_at, modified)
            VALUES (?, 'code', ?, ?, ?, ?, 'code', ?, ?, ?, ?, 1, ?, ?)
        `);

        for (const targetPath of importedPaths) {
            const targetNodeId = this.buildCodeNodeId(projectId, targetPath);
            const targetSubtype = path.posix.extname(targetPath).replace('.', '') || 'text';
            const placeholderContent = `Placeholder para ${targetPath}`;
            const placeholderTags = JSON.stringify(['code', projectId, targetPath, 'placeholder']);

            insertPlaceholder.run(
                targetNodeId,
                targetSubtype,
                targetPath,
                placeholderContent,
                placeholderContent,
                placeholderTags,
                0.4,
                0.2,
                1.0,
                now,
                now
            );

            insertImportEdge.run(codeNodeId, targetNodeId, 0.7, 0.7, relativePath, now);
        }
    }

    public setActiveCodeFiles(projectId: string, relativePaths: string[]): void {
        if (!projectId || !Array.isArray(relativePaths)) {
            return;
        }

        for (const p of relativePaths) {
            const normalized = this.normalizeRelativePath(p);
            if (!normalized || !this.isCodePath(normalized)) {
                continue;
            }
            this.activeCodeFiles.add(this.buildCodeNodeId(projectId, normalized));
        }

        if (this.activeCodeFiles.size > 80) {
            const first = this.activeCodeFiles.values().next().value;
            if (first) {
                this.activeCodeFiles.delete(first);
            }
        }
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

        // 4. Context Bonus/Penalty
        if (node.type === 'code') {
            const decay = this.computeRecencyDecay(node.id);
            score += decay * this.RECENCY_WEIGHT;

            if (this.activeCodeFiles.has(node.id)) {
                score += this.ACTIVE_FILE_BONUS;
            }

            const neighborStrength = this.recentlyUsedCodeNeighborStrength.get(node.id) || 0;
            if (neighborStrength > 0 && this.recentlyUsedCodeNeighbors.has(node.id)) {
                score += this.NEIGHBOR_BASE_WEIGHT * neighborStrength;
            }

            if ((this.recentNodeAccessCount.get(node.id) || 0) > 5) {
                score *= 0.9;
            }
        } else if (this.recentlyUsedNodes.has(node.id)) {
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

        try {
            const tx = this.db.transaction(() => {
                for (const node of nodes_used) {
                    updateNode.run(node.id);
                    updateEdges.run(node.id, node.id);
                    this.recentlyUsedNodes.add(node.id);
                    this.markNodeUsage(node.id);
                }
                insertLearning.run(input.query, JSON.stringify(nodes_used.map(n => n.id)), input.success ? 1 : 0);
            });
            tx();
        } catch (err) {
            this.db.exec('ROLLBACK');
            throw err;
        }

        this.refreshRecentlyUsedCodeNeighbors();

        // Evict oldest entries to prevent unbounded growth
        this.enforceMemoryBounds();
    }

    private enforceMemoryBounds(): void {
        const MAX_RECENT_NODES = 200;
        const MAX_ACCESS_MAP = 500;

        if (this.recentlyUsedNodes.size > MAX_RECENT_NODES) {
            const entries = Array.from(this.recentlyUsedNodes);
            const toRemove = entries.slice(0, Math.floor(MAX_RECENT_NODES * 0.3));
            toRemove.forEach(id => this.recentlyUsedNodes.delete(id));
        }

        if (this.recentNodeLastAccessedAt.size > MAX_ACCESS_MAP) {
            const entries = Array.from(this.recentNodeLastAccessedAt.entries())
                .sort((a, b) => a[1] - b[1])
                .slice(0, Math.floor(MAX_ACCESS_MAP * 0.3));
            entries.forEach(([key]) => {
                this.recentNodeLastAccessedAt.delete(key);
                this.recentNodeAccessCount.delete(key);
            });
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

    public async saveProjectNode(project: {
        id: string;
        name: string;
        description?: string;
        files_count?: number;
    }): Promise<void> {
        const content = `Projeto: ${project.name}${project.description ? ` — ${project.description}` : ''}`;
        const nodeId = `project:${project.id}`;
        const embedding = await this.provider.embed(content);
        const now = new Date().toISOString();
        const tags = JSON.stringify(['project', project.id]);

        this.db.prepare(`
            INSERT OR REPLACE INTO nodes
            (id, type, subtype, name, content, content_preview, embedding, category, tags, importance, score, freshness, auto_indexed, created_at, modified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            nodeId,
            'memory',
            'project',
            project.name,
            content,
            content.slice(0, 280),
            JSON.stringify(embedding),
            'project',
            tags,
            0.8,
            0.7,
            1.0,
            1,
            now,
            now
        );
    }

    public async upsertSkillGraph(input: {
        skill_name: string;
        description?: string;
        capabilities?: string[];
        tools?: string[];
        source?: string;
    }): Promise<void> {
        const safeName = String(input.skill_name || '').trim().toLowerCase().replace(/[^a-z0-9\-_]/g, '');
        if (!safeName) return;

        const skillId = `skill:${safeName}`;
        const now = new Date().toISOString();
        const description = String(input.description || `Skill publica instalada: ${safeName}`).trim();
        const content = `Skill: ${safeName} | origem: ${input.source || 'unknown'} | descricao: ${description}`;
        const embedding = await this.provider.embed(content.slice(0, 6000));

        this.db.prepare(`
            INSERT OR REPLACE INTO nodes
            (id, type, subtype, name, content, content_preview, embedding, category, tags, importance, score, freshness, auto_indexed, created_at, modified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `).run(
            skillId,
            'memory',
            'skill',
            safeName,
            content,
            content.slice(0, 280),
            JSON.stringify(embedding),
            'skill',
            JSON.stringify(['skill', safeName, 'public']),
            0.8,
            0.65,
            1.0,
            1,
            now,
            now
        );

        this.db.prepare(`DELETE FROM edges WHERE source = ?`).run(skillId);

        const upsertConcept = this.db.prepare(`
            INSERT OR IGNORE INTO nodes
            (id, type, subtype, name, content, content_preview, category, tags, importance, score, freshness, auto_indexed, created_at, modified)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `);

        const createEdge = this.db.prepare(`
            INSERT INTO edges
            (source, target, relation, weight, semantic_strength, traversal_count, context, created_at)
            VALUES (?, ?, ?, ?, ?, 0, ?, ?)
        `);

        const caps = Array.from(new Set((input.capabilities || []).map(c => String(c || '').trim()).filter(Boolean)));
        for (const capability of caps) {
            const nodeId = `capability:${this.hash(capability.toLowerCase())}`;
            upsertConcept.run(
                nodeId,
                'concept',
                'skill_capability',
                capability,
                `Capability ${capability}`,
                `Capability ${capability}`,
                'skill_capability',
                JSON.stringify(['skill_capability']),
                0.5,
                0.35,
                1.0,
                now,
                now
            );
            createEdge.run(skillId, nodeId, 'provides', 0.8, 0.75, safeName, now);
        }

        const tools = Array.from(new Set((input.tools || []).map(t => String(t || '').trim()).filter(Boolean)));
        for (const tool of tools) {
            const nodeId = `tool:${this.hash(tool.toLowerCase())}`;
            upsertConcept.run(
                nodeId,
                'concept',
                'skill_tool',
                tool,
                `Tool ${tool}`,
                `Tool ${tool}`,
                'skill_tool',
                JSON.stringify(['skill_tool']),
                0.5,
                0.35,
                1.0,
                now,
                now
            );
            createEdge.run(skillId, nodeId, 'uses', 0.8, 0.75, safeName, now);
        }

        if (input.source) {
            const source = String(input.source).trim();
            const nodeId = `source:${this.hash(source.toLowerCase())}`;
            upsertConcept.run(
                nodeId,
                'concept',
                'skill_source',
                source,
                `Source ${source}`,
                `Source ${source}`,
                'skill_source',
                JSON.stringify(['skill_source']),
                0.45,
                0.3,
                1.0,
                now,
                now
            );
            createEdge.run(skillId, nodeId, 'installed_from', 0.7, 0.7, safeName, now);
        }
    }

    public removeSkillGraph(skillName: string): void {
        const safeName = String(skillName || '').trim().toLowerCase().replace(/[^a-z0-9\-_]/g, '');
        if (!safeName) return;
        const skillId = `skill:${safeName}`;

        this.db.prepare(`DELETE FROM edges WHERE source = ? OR target = ?`).run(skillId, skillId);
        this.db.prepare(`DELETE FROM nodes WHERE id = ?`).run(skillId);
    }

    public cleanupOrphanSkillNodes(): number {
        const result = this.db.prepare(`
            DELETE FROM nodes
            WHERE subtype IN ('skill_capability', 'skill_tool', 'skill_source')
              AND id NOT IN (SELECT source FROM edges)
              AND id NOT IN (SELECT target FROM edges)
        `).run();
        return Number(result.changes || 0);
    }

    public getProjectNodes(limit: number = 10): NodeResult[] {
        return this.db.prepare(`
            SELECT id, type, subtype, name, score, importance, freshness, content, content_preview
            FROM nodes
            WHERE subtype = 'project'
            ORDER BY importance DESC, score DESC
            LIMIT ?
        `).all(limit) as NodeResult[];
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

    private normalizeRelativePath(relativePath: string): string {
        return String(relativePath || '').replace(/\\/g, '/').replace(/^\.\//, '').trim();
    }

    private isCodePath(relativePath: string): boolean {
        const ext = path.posix.extname(relativePath).toLowerCase();
        return [
            '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
            '.py', '.go', '.rs', '.java', '.cs', '.cpp',
            '.c', '.h', '.hpp', '.kt', '.kts', '.swift', '.php', '.rb'
        ].includes(ext);
    }

    private buildCodeNodeId(projectId: string, relativePath: string): string {
        const normalizedPath = this.normalizeRelativePath(relativePath);
        return `code:${projectId}:${normalizedPath}`;
    }

    private ensureProjectNode(projectId: string, now: string): string {
        const projectNodeId = `project:${projectId}`;
        const content = `Projeto ${projectId}`;

        this.db.prepare(`
      INSERT OR IGNORE INTO nodes
      (id, type, subtype, name, content, content_preview, category, tags, importance, score, freshness, auto_indexed, created_at, modified)
      VALUES (?, 'concept', 'project', ?, ?, ?, 'project', ?, ?, ?, ?, 1, ?, ?)
    `).run(
            projectNodeId,
            projectId,
            content,
            content,
            JSON.stringify(['project', projectId]),
            0.7,
            0.5,
            1.0,
            now,
            now
        );

        return projectNodeId;
    }

    private extractRelativeImports(sourcePath: string, rawContent: string): string[] {
        const patterns = [
            /(?:import|export)\s+[\s\S]*?from\s*['\"]([^'\"]+)['\"]/g,
            /import\s*['\"]([^'\"]+)['\"]/g,
            /require\s*\(\s*['\"]([^'\"]+)['\"]\s*\)/g,
            /import\s*\(\s*['\"]([^'\"]+)['\"]\s*\)/g
        ];

        const resolved = new Set<string>();
        for (const pattern of patterns) {
            let match: RegExpExecArray | null;
            while ((match = pattern.exec(rawContent)) !== null) {
                const specifier = match[1];
                if (!specifier || !specifier.startsWith('.')) {
                    continue;
                }

                const target = this.resolveImportPath(sourcePath, specifier);
                if (!target || target === sourcePath) {
                    continue;
                }

                resolved.add(target);
            }
        }

        return Array.from(resolved);
    }

    private resolveImportPath(sourcePath: string, specifier: string): string {
        const normalizedSource = this.normalizeRelativePath(sourcePath);
        const sourceDir = path.posix.dirname(normalizedSource);
        let target = path.posix.normalize(path.posix.join(sourceDir, specifier));

        if (!path.posix.extname(target)) {
            const sourceExt = path.posix.extname(normalizedSource) || '.ts';
            if (target.endsWith('/')) {
                target = `${target}index${sourceExt}`;
            } else {
                target = `${target}${sourceExt}`;
            }
        }

        return this.normalizeRelativePath(target);
    }

    private refreshRecentlyUsedCodeNeighbors(): void {
        this.recentlyUsedCodeNeighbors.clear();
        this.recentlyUsedCodeNeighborStrength.clear();
        const ids = Array.from(this.recentlyUsedNodes);
        if (ids.length === 0) {
            return;
        }

        const placeholders = ids.map(() => '?').join(',');

        const neighbors = this.db.prepare(`
      SELECT DISTINCT target AS id
      FROM edges
      WHERE relation = 'imports' AND source IN (${placeholders})
      UNION
      SELECT DISTINCT source AS id
      FROM edges
      WHERE relation = 'imports' AND target IN (${placeholders})
    `).all(...ids, ...ids) as Array<{ id: string }>;

        for (const row of neighbors) {
            if (!this.recentlyUsedNodes.has(row.id)) {
                this.recentlyUsedCodeNeighbors.add(row.id);
                const strength = this.maxSourceDecayForNeighbor(row.id, ids) * 0.5;
                this.recentlyUsedCodeNeighborStrength.set(row.id, strength);
            }
        }
    }

    private markNodeUsage(nodeId: string): void {
        const now = Date.now();
        this.recentNodeLastAccessedAt.set(nodeId, now);
        this.recentNodeAccessCount.set(nodeId, (this.recentNodeAccessCount.get(nodeId) || 0) + 1);
        if (nodeId.startsWith('code:')) {
            this.activeCodeFiles.add(nodeId);
        }
    }

    private computeRecencyDecay(nodeId: string): number {
        const lastAccessedAt = this.recentNodeLastAccessedAt.get(nodeId);
        if (!lastAccessedAt) {
            return 0;
        }

        const age = Date.now() - lastAccessedAt;
        if (age <= 0) {
            return 1;
        }

        return Math.exp(-age / this.RECENCY_HALF_LIFE_MS);
    }

    private maxSourceDecayForNeighbor(neighborId: string, sourceIds: string[]): number {
        const linkedSources = this.db.prepare(`
      SELECT DISTINCT source AS id
      FROM edges
      WHERE relation = 'imports' AND target = ? AND source IN (${sourceIds.map(() => '?').join(',')})
      UNION
      SELECT DISTINCT target AS id
      FROM edges
      WHERE relation = 'imports' AND source = ? AND target IN (${sourceIds.map(() => '?').join(',')})
    `).all(neighborId, ...sourceIds, neighborId, ...sourceIds) as Array<{ id: string }>;

        let maxDecay = 0;
        for (const source of linkedSources) {
            const sourceDecay = this.computeRecencyDecay(source.id);
            if (sourceDecay > maxDecay) {
                maxDecay = sourceDecay;
            }
        }

        return maxDecay;
    }
}
