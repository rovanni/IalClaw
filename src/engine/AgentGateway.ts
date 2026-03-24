import { CognitiveMemory, NodeResult } from '../memory/CognitiveMemory';
import { LLMProvider } from '../engine/ProviderFactory';

export type AgentMatch = {
    agentId: string;
    score: number;
};

export class AgentGateway {
    private memory: CognitiveMemory;
    private provider: LLMProvider;
    private agentEmbeddingCache = new Map<string, number[]>();

    constructor(memory: CognitiveMemory, provider: LLMProvider) {
        this.memory = memory;
        this.provider = provider;
    }

    private async preloadAgentEmbeddings(agents: NodeResult[]) {
        let didLog = false;

        for (const agent of agents) {
            if (this.agentEmbeddingCache.has(agent.id)) continue;

            if (!didLog) {
                console.time("gateway-warmup");
                didLog = true;
            }

            const parsed = this.safeParse(agent.content || '');
            const hint = parsed?.routing?.embedding_hint;

            if (hint) {
                const embedding = await this.provider.embed(hint);
                this.agentEmbeddingCache.set(agent.id, embedding);
            }
        }

        if (didLog) {
            console.timeEnd("gateway-warmup");
        }
    }

    public async selectAgent(query: string, queryEmbedding: number[]): Promise<string> {
        // Fetch all agents globally to analyze routing properties
        const allIdentities = await this.memory.getIdentityNodes();
        const agents = allIdentities.filter(n => n.subtype === 'agent');

        if (agents.length === 0) {
            return "identity:agent:general"; // Ultimate fallback if db has no agents
        }

        // Cache evaluation once per reboot/new agent
        await this.preloadAgentEmbeddings(agents);

        const scores: AgentMatch[] = agents.map(agent => {
            const parsed = this.safeParse(agent.content || '');
            const routing = parsed?.routing;

            let score = 0;

            if (routing?.keywords && Array.isArray(routing.keywords)) {
                const queryLower = query.toLowerCase();
                for (const k of routing.keywords) {
                    if (queryLower.includes(k.toLowerCase())) {
                        score += 0.4;
                    }
                }
            }

            // SEMANTIC
            const agentEmbedding = this.agentEmbeddingCache.get(agent.id);
            if (agentEmbedding) {
                const similarity = this.cosineSimilarity(agentEmbedding, queryEmbedding);
                const normalizedSim = (similarity + 1) / 2; // -1..1 to 0..1
                score += normalizedSim * 0.5;
            }

            score += routing?.priority || 0;

            return {
                agentId: agent.id,
                score
            };
        });

        // Sort descending by score
        scores.sort((a, b) => b.score - a.score);

        const topMatch = scores[0];

        if (topMatch.score < 0.4) {
            return "identity:agent:general";
        }

        return topMatch.agentId;
    }

    private safeParse(content: string): any {
        try {
            const match = content.match(/\{[\s\S]*\}/);
            if (match) {
                return JSON.parse(match[0]);
            }
            return null;
        } catch (e) {
            return null;
        }
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
