import Database from 'better-sqlite3';
import { LLMProvider } from '../engine/ProviderFactory';

export const EMBEDDING_ENABLED = false;

export interface ToolDecision {
    taskType: string;
    step: string;
    tool: string;
    success: boolean;
    timestamp: number;
}

// Cache em memória para reduzir bloqueios no event loop
const decisionCache = new Map<string, ToolDecision[]>();
const CACHE_TTL_MS = 60000; // 1 minuto
let lastCacheCleanup = 0;

/**
 * Invalida cache expirado de forma não-bloqueante.
 */
function invalidateExpiredCache(): void {
    const now = Date.now();
    if (now - lastCacheCleanup < CACHE_TTL_MS) return;
    
    lastCacheCleanup = now;
    // Limpar cache antigo
    for (const [key, decisions] of decisionCache.entries()) {
        const recentDecisions = decisions.filter(d => now - d.timestamp < CACHE_TTL_MS * 10);
        if (recentDecisions.length === 0) {
            decisionCache.delete(key);
        } else {
            decisionCache.set(key, recentDecisions);
        }
    }
}

export class DecisionMemory {
    private db: Database.Database;
    private provider: LLMProvider;
    private logger = { info: (k: string, m: string) => console.log(`[DecisionMemory] ${m}`) };

    constructor(db: Database.Database, provider: LLMProvider) {
        this.db = db;
        this.provider = provider;
    }

    /**
     * Armazena decisão de forma síncrona (better-sqlite3 é síncrono por design).
     * Usa prepared statements para melhor performance.
     * Agora, toda operação de escrita é feita dentro de uma transação atômica para evitar deadlocks e garantir consistência.
     */
    async store(decision: ToolDecision): Promise<void> {
        const now = new Date().toISOString();
        const content = JSON.stringify(decision);
        
        let embedding = '[]';
        if (EMBEDDING_ENABLED) {
            try {
                const emb = await this.provider.embed(
                    `tool:${decision.tool} task:${decision.taskType} step:${decision.step} success:${decision.success}`
                );
                embedding = JSON.stringify(emb);
            } catch {
                embedding = '[]';
            }
        }

        const nodeId = `tool_decision:${this.hash(`${decision.taskType}:${decision.step}:${decision.tool}:${decision.timestamp}`)}`;
        const tags = JSON.stringify(['tool_decision', decision.taskType, decision.tool, decision.success ? 'success' : 'failure']);

        // Usar transaction para atomicidade e evitar deadlocks
        const insertStmt = this.db.prepare(`
            INSERT OR REPLACE INTO nodes
            (id, type, subtype, name, content, content_preview, embedding, category, tags, importance, score, freshness, auto_indexed, created_at, modified)
            VALUES (?, 'memory', 'tool_decision', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        `);

        this.db.transaction(() => {
            insertStmt.run(
                nodeId,
                decision.tool,
                decision.tool,
                content,
                content.slice(0, 280),
                embedding,
                'decision',
                tags,
                0.5,
                decision.success ? 1 : 0,
                1,
                0,
                now,
                now
            );
        })();

        // Atualiza cache em memória de forma segura
        invalidateExpiredCache();
        if (!decisionCache.has(nodeId)) {
            decisionCache.set(nodeId, []);
        }
        decisionCache.get(nodeId)!.push({ ...decision, timestamp: Date.now() });
    }

    /**
     * Consulta decisões usando cache em memória para reduzir latência.
     */
    async query(taskType: string, step: string, topK: number = 10): Promise<ToolDecision[]> {
        invalidateExpiredCache();
        
        const cacheKey = `${taskType}:${step}`;
        const cached = decisionCache.get(cacheKey);
        
        // Se temos cache válido, usar
        if (cached && cached.length > 0) {
            const recentDecisions = cached
                .filter(d => Date.now() - d.timestamp < CACHE_TTL_MS * 10)
                .slice(0, topK);
            if (recentDecisions.length > 0) {
                return recentDecisions;
            }
        }

        if (!EMBEDDING_ENABLED) {
            return this.queryWithoutEmbedding(taskType, step, topK);
        }

        const queryText = `${taskType} ${step}`;
        const queryEmbedding = await this.provider.embed(queryText);

        const nodes = this.db.prepare(`
            SELECT id, content, embedding, score
            FROM nodes
            WHERE type = 'memory' AND subtype = 'tool_decision'
            ORDER BY score DESC, modified DESC
            LIMIT 100
        `).all() as Array<{ id: string; content: string; embedding: string; score: number }>;

        const results = nodes
            .map(node => {
                let similarity = 0;
                try {
                    const nodeEmbedding = JSON.parse(node.embedding || '[]') as number[];
                    if (nodeEmbedding.length > 0 && queryEmbedding.length > 0) {
                        similarity = this.cosineSimilarity(queryEmbedding, nodeEmbedding);
                    }
                } catch {
                    similarity = 0;
                }

                const content = node.content;
                let parsed: ToolDecision | null = null;
                try {
                    parsed = JSON.parse(content);
                } catch {
                    parsed = null;
                }

                if (!parsed) return null;

                return { decision: parsed, similarity };
            })
            .filter((r): r is { decision: ToolDecision; similarity: number } => r !== null && r.decision !== null)
            .sort((a, b) => b.similarity - a.similarity)
            .slice(0, topK)
            .map(r => r.decision);

        // Atualizar cache
        if (results.length > 0) {
            decisionCache.set(cacheKey, results);
        }

        return results;
    }

    private async queryWithoutEmbedding(taskType: string, step: string, topK: number): Promise<ToolDecision[]> {
        const safeTaskType = String(taskType).replace(/["%_]/g, '');
        const rows = this.db.prepare(`
            SELECT content FROM nodes
            WHERE type = 'memory'
            AND subtype = 'tool_decision'
            AND content LIKE ?
            ORDER BY modified DESC
            LIMIT ?
        `).all(`%"taskType":"${safeTaskType}"%`, topK) as Array<{ content: string }>;

        const results: ToolDecision[] = [];
        for (const row of rows) {
            try {
                const parsed = JSON.parse(row.content) as ToolDecision;
                if (parsed.taskType === taskType) {
                    results.push(parsed);
                }
            } catch {
                // Skip invalid entries
            }
        }

        // Atualizar cache
        if (results.length > 0) {
            const cacheKey = `${taskType}:${step}`;
            decisionCache.set(cacheKey, results);
        }

        return results;
    }

    /**
     * Obtém histórico de ferramenta com cache.
     */
    async getToolHistory(tool: string, taskType?: string): Promise<{ success: number; failure: number; rate: number }> {
        const safeTool = String(tool).replace(/["%_]/g, '');
        const safeTaskType = taskType ? String(taskType).replace(/["%_]/g, '') : undefined;

        let query = `
            SELECT content FROM nodes
            WHERE type = 'memory' AND subtype = 'tool_decision' AND content LIKE ?
        `;
        const params: string[] = [`%"tool":"${safeTool}"%`];

        if (safeTaskType) {
            query += ` AND content LIKE ?`;
            params.push(`%"taskType":"${safeTaskType}"%`);
        }

        const rows = this.db.prepare(query).all(...params) as Array<{ content: string }>;

        let success = 0;
        let failure = 0;

        for (const row of rows) {
            try {
                const parsed = JSON.parse(row.content) as ToolDecision;
                if (parsed.success) success++;
                else failure++;
            } catch {
                // Skip invalid entries
            }
        }

        const total = success + failure;
        return {
            success,
            failure,
            rate: total > 0 ? success / total : 0
        };
    }

    private hash(text: string): string {
        let hash = 0;
        for (let i = 0; i < text.length; i++) {
            hash = (hash << 5) - hash + text.charCodeAt(i);
            hash |= 0;
        }
        return Math.abs(hash).toString(36);
    }

    private cosineSimilarity(vecA: number[], vecB: number[]): number {
        if (!vecA.length || !vecB.length) return 0;
        const len = Math.min(vecA.length, vecB.length);
        let dot = 0;
        let normA = 0;
        let normB = 0;
        for (let i = 0; i < len; i++) {
            dot += vecA[i] * vecB[i];
            normA += vecA[i] * vecA[i];
            normB += vecB[i] * vecB[i];
        }
        if (!normA || !normB) return 0;
        return dot / (Math.sqrt(normA) * Math.sqrt(normB));
    }

    /**
     * Limpa cache em memória (útil para tests ou cleanup manual).
     */
    static clearCache(): void {
        decisionCache.clear();
        lastCacheCleanup = 0;
    }
}
