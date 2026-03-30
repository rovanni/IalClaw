import Database from 'better-sqlite3';
import { createHash } from 'crypto';
import { createLogger } from '../shared/AppLogger';
import { EmbeddingService } from './EmbeddingService';
import {
    AgentMemoryContext,
    MemoryQueryOptions,
    MemoryQueryResult,
    StoreMemoryInput,
    UpsertMemoryResult
} from './MemoryTypes';

type MemoryRow = {
    id: string;
    subtype: string;
    content: string;
    importance: number;
    score: number;
    embedding?: string | null;
    modified?: string | null;
    edge_count?: number;
    last_accessed?: string | null;
};

export class MemoryService {
    private db: Database.Database;
    private embeddingService: EmbeddingService;
    private logger = createLogger('MemoryService');

    constructor(db: Database.Database, embeddingService: EmbeddingService) {
        this.db = db;
        this.embeddingService = embeddingService;
        this.ensureTables();
    }

    public async upsertMemory(input: StoreMemoryInput): Promise<UpsertMemoryResult> {
        const now = new Date().toISOString();
        const embedding = await this.embeddingService.generate(input.content);

        if (!embedding) {
            this.logger.warn('embedding_unavailable', 'Embedding indisponível, usando fallback heurístico', {
                content_preview: input.content.slice(0, 50)
            });
            return this.fallbackUpsert(input, now);
        }

        const existing = this.findBestExistingMemory(input, embedding);

        if (existing) {
            const mergedContent = this.mergeContent(existing.content, input.content);
            const tags = JSON.stringify(this.buildTags(input.type, input.entities));
            const updatedImportance = Math.min(1, Math.max(existing.importance || 0.5, input.importance) + 0.05);
            const updatedScore = Math.min(1, Math.max(existing.score || 0.4, input.relevance));

            // Envolve todas as operações de update em uma transação atômica
            this.db.transaction(() => {
                this.db.prepare(`
                    UPDATE nodes
                    SET content = ?, content_preview = ?, importance = ?, score = ?, freshness = ?, tags = ?, modified = ?, embedding = ?
                    WHERE id = ?
                `).run(
                    mergedContent,
                    mergedContent.slice(0, 280),
                    updatedImportance,
                    updatedScore,
                    1,
                    tags,
                    now,
                    JSON.stringify(embedding),
                    existing.id
                );
                this.upsertEmbedding(existing.id, embedding, now, now, 0);
                this.relinkEntities(existing.id, input.entities, input.context, now);
            })();
            return { memoryId: existing.id, action: 'updated' };
        }

        const memoryId = this.buildMemoryId(input.type, input.content);
        const name = this.buildMemoryName(input.type, input.entities);
        const tags = JSON.stringify(this.buildTags(input.type, input.entities));

        // Envolve o insert em uma transação atômica
        this.db.transaction(() => {
            this.db.prepare(`
                INSERT INTO nodes (id, type, subtype, name, content, content_preview, importance, score, embedding, tags, freshness, auto_indexed, created_at, modified)
                VALUES (?, 'memory', ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, ?, ?)
            `).run(
                memoryId,
                input.type,
                name,
                input.content,
                input.content.slice(0, 280),
                input.importance,
                input.relevance,
                JSON.stringify(embedding),
                tags,
                now,
                now
            );
            this.upsertEmbedding(memoryId, embedding, now, now, 0);
            this.relinkEntities(memoryId, input.entities, input.context, now);
        })();
        return { memoryId, action: 'inserted' };
    }

    public async queryMemory(query: string, options?: MemoryQueryOptions): Promise<MemoryQueryResult[]> {
        const limit = options?.limit ?? 6;
        const reinforce = options?.reinforce !== false;
        const queryEmbedding = await this.embeddingService.generate(query);

        if (!queryEmbedding) {
            this.logger.warn('embedding_unavailable', 'Embedding indisponível para query, usando fallback');
            return this.fallbackQuery(query, limit);
        }

        const rows = this.db.prepare(`
            SELECT
                n.id,
                n.subtype,
                n.content,
                n.importance,
                n.score,
                COALESCE(me.embedding, n.embedding) AS embedding,
                COALESCE(ec.edge_count, 0) AS edge_count,
                me.last_accessed
            FROM nodes n
            LEFT JOIN memory_embeddings me ON me.memory_id = n.id
            LEFT JOIN (
                SELECT source, COUNT(*) AS edge_count
                FROM edges
                GROUP BY source
            ) ec ON ec.source = n.id
            WHERE n.type = 'memory'
            ORDER BY (n.importance + n.score) DESC, n.modified DESC
            LIMIT 200
        `).all() as MemoryRow[];

        const ranked = rows
            .map((row) => {
                const memoryEmbedding = this.safeParseEmbedding(row.embedding);
                const simResult = this.cosineSimilarity(queryEmbedding, memoryEmbedding);
                const similarity = simResult !== null ? this.normalizeSimilarity(simResult) : 0;
                const relevance = Math.max(0, Math.min(1, (row.importance + row.score) / 2));
                const connectionScore = Math.min(1, (row.edge_count || 0) / 6);
                const graphScore = (connectionScore * 0.7) + (relevance * 0.3);
                const finalScore = (0.6 * similarity) + (0.4 * graphScore);

                return {
                    id: row.id,
                    type: row.subtype as MemoryQueryResult['type'],
                    content: row.content,
                    similarity,
                    graphScore,
                    finalScore,
                    importance: row.importance,
                    lastAccessed: row.last_accessed || undefined
                };
            })
            .sort((a, b) => b.finalScore - a.finalScore)
            .slice(0, limit);

        if (reinforce) {
            for (const item of ranked) {
                this.reinforceMemory(item.id, 0.03);
            }
        }

        return ranked;
    }

    public reinforceMemory(memoryId: string, delta: number = 0.05): void {
        const now = new Date().toISOString();

        this.db.prepare(`
            UPDATE nodes
            SET importance = MIN(1, importance + ?),
                score = MIN(1, score + (? / 2)),
                freshness = MIN(1, freshness + 0.02),
                modified = ?
            WHERE id = ? AND type = 'memory'
        `).run(delta, delta, now, memoryId);

        this.db.prepare(`
            UPDATE memory_embeddings
            SET last_accessed = ?, access_count = access_count + 1, updated_at = ?
            WHERE memory_id = ?
        `).run(now, now, memoryId);
    }

    public countMemoriesContaining(token: string): number {
        if (!token.trim()) return 0;
        const row = this.db.prepare(`
            SELECT COUNT(*) AS count
            FROM nodes
            WHERE type = 'memory' AND LOWER(content) LIKE ?
        `).get(`%${token.toLowerCase()}%`) as { count: number };
        return Number(row?.count || 0);
    }

    public applyDecay(decayRate: number = 0.01): number {
        const result = this.db.prepare(`
            UPDATE nodes
            SET importance = MAX(0, importance - ?),
                freshness = MAX(0, freshness - (? / 2))
            WHERE type = 'memory'
              AND id IN (
                  SELECT memory_id
                  FROM memory_embeddings
                  WHERE last_accessed IS NULL OR last_accessed < datetime('now', '-30 days')
              )
        `).run(decayRate, decayRate);

        return Number(result.changes || 0);
    }

    private ensureTables(): void {
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS memory_embeddings (
                memory_id TEXT PRIMARY KEY,
                embedding TEXT NOT NULL,
                model TEXT,
                last_accessed TEXT,
                access_count INTEGER DEFAULT 0,
                created_at TEXT NOT NULL,
                updated_at TEXT NOT NULL
            );

            CREATE INDEX IF NOT EXISTS idx_memory_embeddings_accessed ON memory_embeddings(last_accessed);
        `);
    }

    private findBestExistingMemory(input: StoreMemoryInput, embedding: number[]): MemoryRow | null {
        const candidates = this.db.prepare(`
            SELECT n.id, n.subtype, n.content, n.importance, n.score, COALESCE(me.embedding, n.embedding) AS embedding
            FROM nodes n
            LEFT JOIN memory_embeddings me ON me.memory_id = n.id
            WHERE n.type = 'memory' AND n.subtype = ?
            ORDER BY n.modified DESC
            LIMIT 120
        `).all(input.type) as MemoryRow[];

        let best: { row: MemoryRow; score: number } | null = null;
        for (const row of candidates) {
            const currentEmbedding = this.safeParseEmbedding(row.embedding);
            const simResult = this.cosineSimilarity(embedding, currentEmbedding);
            const similarity = simResult !== null ? this.normalizeSimilarity(simResult) : 0;
            const overlap = this.entityOverlapScore(row.content, input.entities);
            const contradiction = this.looksContradictory(row.content, input.content) ? 0.3 : 0;
            const candidateScore = similarity + overlap + contradiction;

            if (!best || candidateScore > best.score) {
                best = { row, score: candidateScore };
            }
        }

        if (!best) return null;
        // AJUSTE: flexibilizar threshold com entity overlap para melhor merge semântico
        const entityOverlap = this.entityOverlapScore(best.row.content, input.entities);
        const shouldUpdate = best.score >= 0.85 + entityOverlap
            || (best.score >= 0.78 && entityOverlap >= 0.2)
            || this.looksContradictory(best.row.content, input.content);

        return shouldUpdate ? best.row : null;
    }

    private mergeContent(existingContent: string, newContent: string): string {
        const normalizedExisting = existingContent.trim().toLowerCase();
        const normalizedIncoming = newContent.trim().toLowerCase();
        if (normalizedExisting === normalizedIncoming) {
            return existingContent;
        }
        if (normalizedExisting.includes(normalizedIncoming)) {
            return existingContent;
        }
        if (this.looksContradictory(existingContent, newContent)) {
            return newContent;
        }
        return `${existingContent}\nAtualizacao: ${newContent}`;
    }

    private relinkEntities(memoryId: string, entities: string[], context: AgentMemoryContext, now: string): void {
        this.db.prepare(`
            DELETE FROM edges
            WHERE source = ? AND relation IN ('mentions', 'about', 'applies_to_project')
        `).run(memoryId);

        const uniqueEntities = Array.from(new Set(entities.map((entity) => entity.trim()).filter(Boolean)));
        for (const entity of uniqueEntities) {
            const entityNodeId = this.ensureEntityNode(entity, now);
            this.db.prepare(`
                INSERT INTO edges
                (source, target, relation, weight, semantic_strength, traversal_count, context, created_at)
                VALUES (?, ?, 'mentions', ?, ?, 0, ?, ?)
            `).run(memoryId, entityNodeId, 0.75, 0.7, context.sessionId, now);
        }

        if (context.projectId) {
            const projectNodeId = this.ensureProjectNode(context.projectId, now);
            this.db.prepare(`
                INSERT INTO edges
                (source, target, relation, weight, semantic_strength, traversal_count, context, created_at)
                VALUES (?, ?, 'applies_to_project', ?, ?, 0, ?, ?)
            `).run(memoryId, projectNodeId, 0.82, 0.78, context.sessionId, now);
        }
    }

    private ensureEntityNode(entity: string, now: string): string {
        const cleanEntity = entity.trim();
        const entityNodeId = `entity:${this.hash(cleanEntity.toLowerCase())}`;
        this.db.prepare(`
            INSERT OR IGNORE INTO nodes
            (id, type, subtype, name, content, content_preview, importance, score, freshness, category, tags, auto_indexed, created_at, modified)
            VALUES (?, 'concept', 'entity', ?, ?, ?, 0.45, 0.3, 1.0, 'entity', ?, 1, ?, ?)
        `).run(
            entityNodeId,
            cleanEntity,
            `Entidade: ${cleanEntity}`,
            `Entidade: ${cleanEntity}`,
            JSON.stringify(['entity', cleanEntity.toLowerCase()]),
            now,
            now
        );
        return entityNodeId;
    }

    private ensureProjectNode(projectId: string, now: string): string {
        const projectNodeId = `project:${projectId}`;
        this.db.prepare(`
            INSERT OR IGNORE INTO nodes
            (id, type, subtype, name, content, content_preview, importance, score, freshness, category, tags, auto_indexed, created_at, modified)
            VALUES (?, 'concept', 'project', ?, ?, ?, 0.72, 0.55, 1.0, 'project', ?, 1, ?, ?)
        `).run(
            projectNodeId,
            projectId,
            `Projeto ${projectId}`,
            `Projeto ${projectId}`,
            JSON.stringify(['project', projectId]),
            now,
            now
        );
        return projectNodeId;
    }

    private upsertEmbedding(memoryId: string, embedding: number[], now: string, lastAccessed?: string, accessCount?: number): void {
        this.db.prepare(`
            INSERT INTO memory_embeddings
            (memory_id, embedding, model, last_accessed, access_count, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(memory_id) DO UPDATE SET
                embedding = excluded.embedding,
                model = excluded.model,
                updated_at = excluded.updated_at,
                last_accessed = COALESCE(excluded.last_accessed, memory_embeddings.last_accessed),
                access_count = COALESCE(excluded.access_count, memory_embeddings.access_count)
        `).run(
            memoryId,
            JSON.stringify(embedding),
            process.env.OLLAMA_MODEL || process.env.MODEL || 'unknown',
            lastAccessed || null,
            accessCount ?? 0,
            now,
            now
        );
    }

    private entityOverlapScore(content: string, entities: string[]): number {
        if (!entities.length) return 0;
        const normalized = content.toLowerCase();
        let matches = 0;
        for (const entity of entities) {
            if (normalized.includes(entity.toLowerCase())) {
                matches++;
            }
        }
        return Math.min(0.4, (matches / entities.length) * 0.4);
    }

    private looksContradictory(previous: string, incoming: string): boolean {
        const prev = previous.toLowerCase();
        const next = incoming.toLowerCase();
        const negPattern = /\b(nao|não|nunca|jamais)\b/;
        const hasNegPrev = negPattern.test(prev);
        const hasNegNext = negPattern.test(next);
        if (hasNegPrev !== hasNegNext) {
            const sharedWords = this.sharedTokenCount(prev, next);
            return sharedWords >= 3;
        }
        return false;
    }

    private sharedTokenCount(a: string, b: string): number {
        const tokensA = new Set(this.tokenize(a));
        const tokensB = new Set(this.tokenize(b));
        let count = 0;
        for (const token of tokensA) {
            if (tokensB.has(token)) count++;
        }
        return count;
    }

    private tokenize(value: string): string[] {
        return value
            .toLowerCase()
            .split(/[^a-z0-9à-ÿ_]+/i)
            .map((token) => token.trim())
            .filter((token) => token.length >= 3);
    }

    private safeParseEmbedding(embedding?: string | null): number[] {
        if (!embedding) return [];
        try {
            const parsed = JSON.parse(embedding);
            return Array.isArray(parsed) ? parsed : [];
        } catch (error: any) {
            this.logger.debug('invalid_embedding', 'Falha ao parsear embedding armazenado.', {
                reason: String(error?.message || error)
            });
            return [];
        }
    }

    private buildMemoryId(type: string, content: string): string {
        return `memory:${type}:${this.hash(`${type}:${content}:${Date.now()}`)}`;
    }

    private buildMemoryName(type: string, entities: string[]): string {
        if (!entities.length) {
            return `memory:${type}`;
        }
        const entitySuffix = entities.slice(0, 2).join('/');
        return `memory:${type}:${entitySuffix}`;
    }

    private buildTags(type: string, entities: string[]): string[] {
        const base = ['memory_lifecycle', type];
        for (const entity of entities) {
            base.push(`entity:${entity.toLowerCase()}`);
        }
        return Array.from(new Set(base));
    }

    private hash(text: string): string {
        return createHash('sha1').update(text).digest('hex').slice(0, 16);
    }

    private cosineSimilarity(a: number[], b: number[]): number | null {
        if (!a.length || !b.length) return null;
        const len = Math.min(a.length, b.length);
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < len; i++) {
            dot += a[i] * b[i];
            normA += a[i] * a[i];
            normB += b[i] * b[i];
        }
        if (!normA || !normB) return null;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    private normalizeSimilarity(value: number): number {
        return Math.max(0, Math.min(1, (value + 1) / 2));
    }

    private fallbackUpsert(input: StoreMemoryInput, now: string): UpsertMemoryResult {
        const memoryId = this.buildMemoryId(input.type, input.content);
        const name = this.buildMemoryName(input.type, input.entities);
        const tags = JSON.stringify(this.buildTags(input.type, input.entities));

        this.db.prepare(`
            INSERT INTO nodes
            (id, type, subtype, name, content, content_preview, importance, score, freshness, category, tags, auto_indexed, created_at, modified)
            VALUES (?, 'memory', ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
        `).run(
            memoryId,
            input.type,
            name,
            input.content,
            input.content.slice(0, 280),
            input.importance,
            input.relevance,
            1,
            'memory_lifecycle',
            tags,
            now,
            now
        );

        this.relinkEntities(memoryId, input.entities, input.context, now);
        return { memoryId, action: 'inserted' };
    }

    private fallbackQuery(query: string, limit: number): MemoryQueryResult[] {
        const normalizedQuery = query.toLowerCase();
        const rows = this.db.prepare(`
            SELECT id, subtype, content, importance, score
            FROM nodes
            WHERE type = 'memory' AND LOWER(content) LIKE ?
            ORDER BY importance DESC, score DESC
            LIMIT ?
        `).all(`%${normalizedQuery}%`, limit) as Array<{ id: string; subtype: string; content: string; importance: number; score: number }>;

        return rows.map(row => ({
            id: row.id,
            type: row.subtype as MemoryQueryResult['type'],
            content: row.content,
            similarity: 0,
            graphScore: (row.importance + row.score) / 2,
            finalScore: (row.importance + row.score) / 2,
            importance: row.importance
        }));
    }
}
