import * as dotenv from 'dotenv';
import { DatabaseManager } from '../db/DatabaseManager';
import { ProviderFactory } from '../engine/ProviderFactory';

dotenv.config();

type GatewayIdentitySeed = {
    id: string;
    subtype: 'agent';
    name: string;
    category: string;
    tags: string[];
    importance: number;
    score: number;
    freshness: number;
    routing: {
        priority: number;
        keywords: string[];
        embedding_hint: string;
    };
};

const DEFAULT_GATEWAY_IDENTITIES: GatewayIdentitySeed[] = [
    {
        id: 'identity:agent:general',
        subtype: 'agent',
        name: 'Generalist Agent',
        category: 'gateway_identity',
        tags: ['identity', 'agent', 'general', 'gateway'],
        importance: 1,
        score: 0.9,
        freshness: 1,
        routing: {
            priority: 0.35,
            keywords: ['geral', 'ajuda', 'explicar', 'resumo', 'duvida'],
            embedding_hint: 'agente geral para perguntas abertas, orientacao, explicacoes e fallback seguro'
        }
    },
    {
        id: 'identity:agent:performance',
        subtype: 'agent',
        name: 'Performance Agent',
        category: 'gateway_identity',
        tags: ['identity', 'agent', 'performance', 'latency', 'optimization'],
        importance: 0.95,
        score: 0.85,
        freshness: 1,
        routing: {
            priority: 0.05,
            keywords: ['lento', 'devagar', 'latencia', 'performance', 'otimizar', 'cpu', 'memoria'],
            embedding_hint: 'agente especialista em performance, lentidao, profiling, gargalos e otimizacao de codigo'
        }
    },
    {
        id: 'identity:agent:database',
        subtype: 'agent',
        name: 'Database Agent',
        category: 'gateway_identity',
        tags: ['identity', 'agent', 'database', 'sqlite', 'storage'],
        importance: 0.95,
        score: 0.85,
        freshness: 1,
        routing: {
            priority: 0.05,
            keywords: ['banco', 'database', 'sqlite', 'query', 'schema', 'corrompido', 'migracao'],
            embedding_hint: 'agente especialista em banco de dados, sqlite, schema, corrupcao, consultas e persistencia'
        }
    }
];

export async function bootstrapGatewayIdentities() {
    const dbManager = new DatabaseManager('db.sqlite');
    const db = dbManager.getDb();
    const provider = ProviderFactory.getProvider();
    const timestamp = new Date().toISOString();

    let inserted = 0;
    let updated = 0;

    try {
        for (const seed of DEFAULT_GATEWAY_IDENTITIES) {
            const existing = db.prepare('SELECT id FROM nodes WHERE id = ?').get(seed.id) as { id: string } | undefined;
            const content = JSON.stringify({
                identity: {
                    id: seed.id,
                    subtype: seed.subtype,
                    name: seed.name,
                    category: seed.category
                },
                routing: seed.routing
            }, null, 2);
            const preview = `${seed.name} :: ${seed.routing.embedding_hint}`.slice(0, 280);
            const embedding = await provider.embed(seed.routing.embedding_hint);

            db.prepare(`
                INSERT OR REPLACE INTO nodes
                (id, type, subtype, name, content, content_preview, embedding, category, tags, importance, score, freshness, auto_indexed, created_at, modified)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, COALESCE((SELECT created_at FROM nodes WHERE id = ?), ?), ?)
            `).run(
                seed.id,
                'identity',
                seed.subtype,
                seed.name,
                content,
                preview,
                JSON.stringify(embedding),
                seed.category,
                JSON.stringify(seed.tags),
                seed.importance,
                seed.score,
                seed.freshness,
                1,
                seed.id,
                timestamp,
                timestamp
            );

            if (existing) {
                updated++;
            } else {
                inserted++;
            }
        }

        const totalAgents = db.prepare(`
            SELECT COUNT(*) as total
            FROM nodes
            WHERE type = 'identity' AND subtype = 'agent'
        `).get() as { total: number };

        console.log(`[Bootstrap] Identidades do gateway prontas. Inseridas: ${inserted}, atualizadas: ${updated}, total de agentes: ${totalAgents.total}.`);
        return { inserted, updated, totalAgents: totalAgents.total };
    } finally {
        dbManager.close();
    }
}

bootstrapGatewayIdentities().catch((error) => {
    console.error('[Bootstrap] Falha ao semear identidades do gateway:', error);
    process.exit(1);
});