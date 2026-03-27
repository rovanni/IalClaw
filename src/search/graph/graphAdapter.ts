import { CognitiveMemory, NodeResult } from '../../memory/CognitiveMemory';

export interface GraphNode {
    id: string;
    name: string;
    type?: string;
    content?: string;
    score: number;
}

export interface GraphRelation {
    source: string;
    target: string;
    relation: string;
    weight: number;
}

export interface GraphAdapterInterface {
    getNodeByTerm(term: string): Promise<GraphNode | null>;
    getRelatedNodes(term: string): Promise<GraphNode[]>;
    getNodeEmbedding(term: string): Promise<number[] | null>;
    getRelatedTerms(term: string): Promise<string[]>;
    syncTagsToGraph(tags: string[], docId: string): Promise<void>;
    syncRelationsToGraph(relations: string[], docId: string): Promise<void>;
}

export class GraphAdapter implements GraphAdapterInterface {
    private memory: CognitiveMemory | null = null;
    private fallbackMode: boolean = false;
    private relationCache: Map<string, string[]> = new Map();

    constructor(memory?: CognitiveMemory) {
        this.memory = memory || null;
        this.fallbackMode = !memory;
    }

    isAvailable(): boolean {
        return !this.fallbackMode && this.memory !== null;
    }

    async getNodeByTerm(term: string): Promise<GraphNode | null> {
        if (this.fallbackMode || !this.memory) {
            return null;
        }

        try {
            const normalized = term.toLowerCase().trim();
            const results = this.memory.searchByContent(normalized, 1);
            
            if (results.length > 0) {
                const node = results[0];
                return {
                    id: node.id,
                    name: node.name,
                    type: node.type,
                    content: node.content,
                    score: node.score
                };
            }
            return null;
        } catch (error) {
            console.warn('[GraphAdapter] getNodeByTerm failed:', error);
            return null;
        }
    }

    async getRelatedNodes(term: string): Promise<GraphNode[]> {
        if (this.fallbackMode || !this.memory) {
            return [];
        }

        try {
            const normalized = term.toLowerCase().trim();
            const queryEmbedding = await this.getNodeEmbedding(normalized);
            
            if (!queryEmbedding) {
                return [];
            }

            const nodes = await this.memory.retrieveWithTraversal(normalized, queryEmbedding, 5);
            
            return nodes.slice(1).map(node => ({
                id: node.id,
                name: node.name,
                type: node.type,
                content: node.content,
                score: node.score || node.final_score || 0
            }));
        } catch (error) {
            console.warn('[GraphAdapter] getRelatedNodes failed:', error);
            return [];
        }
    }

    async getNodeEmbedding(term: string): Promise<number[] | null> {
        return null;
    }

    async getRelatedTerms(term: string): Promise<string[]> {
        const cacheKey = term.toLowerCase().trim();
        
        if (this.relationCache.has(cacheKey)) {
            return this.relationCache.get(cacheKey)!;
        }

        if (this.fallbackMode || !this.memory) {
            return [];
        }

        try {
            const relatedNodes = await this.getRelatedNodes(term);
            const terms = relatedNodes
                .map(n => n.name)
                .filter(name => name && name.length > 2)
                .slice(0, 10);

            this.relationCache.set(cacheKey, terms);
            return terms;
        } catch (error) {
            console.warn('[GraphAdapter] getRelatedTerms failed:', error);
            return [];
        }
    }

    async syncTagsToGraph(tags: string[], docId: string): Promise<void> {
        if (this.fallbackMode || !this.memory) {
            return;
        }

        try {
            const tagNodePrefix = `search:${docId}:`;
            
            for (const tag of tags) {
                const tagNormalized = tag.toLowerCase().trim();
                if (!tagNormalized) continue;
            }
        } catch (error) {
            console.warn('[GraphAdapter] syncTagsToGraph failed:', error);
        }
    }

    async syncRelationsToGraph(relations: string[], docId: string): Promise<void> {
        if (this.fallbackMode || !this.memory) {
            return;
        }
    }

    clearCache(): void {
        this.relationCache.clear();
    }
}

let globalGraphAdapter: GraphAdapter | null = null;

export function initGraphAdapter(memory?: CognitiveMemory): GraphAdapter {
    globalGraphAdapter = new GraphAdapter(memory);
    return globalGraphAdapter;
}

export function getGraphAdapter(): GraphAdapter {
    if (!globalGraphAdapter) {
        globalGraphAdapter = new GraphAdapter();
    }
    return globalGraphAdapter;
}
