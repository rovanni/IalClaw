import { GraphAdapter, getGraphAdapter, GraphNode } from './graphAdapter';
import { createLogger } from '../../shared/AppLogger';

export interface ExpansionOptions {
    maxDepth?: number;
    maxTerms?: number;
    includeTypes?: string[];
    excludeTerms?: string[];
}

export interface ExpansionResult {
    originalTerms: string[];
    expandedTerms: string[];
    graphTerms: string[];
    graphNodes: GraphNode[];
}

export interface GraphEnrichmentResult {
    docId: string;
    connectedNodes: GraphNode[];
    relationScore: number;
    semanticBoost: number;
}

export interface DebugInfo {
    expandedTerms: string[];
    graphTerms: string[];
    scoreBreakdown: Record<string, number>;
    graphNodes: GraphNode[];
}

export class SemanticGraphBridge {
    private graphAdapter: GraphAdapter;
    private expansionCache: Map<string, string[]> = new Map();
    private enrichmentCache: Map<string, GraphEnrichmentResult> = new Map();
    private logger = createLogger('SemanticGraphBridge');
    private enabled: boolean = true;
    private static readonly MAX_CACHE_SIZE = 1000;

    constructor(graphAdapter?: GraphAdapter) {
        this.graphAdapter = graphAdapter || getGraphAdapter();
    }

    private cleanupCache<K, V>(cache: Map<K, V>): void {
        if (cache.size > SemanticGraphBridge.MAX_CACHE_SIZE) {
            const entries = Array.from(cache.entries()).slice(-500);
            cache.clear();
            for (const [k, v] of entries) {
                cache.set(k, v);
            }
        }
    }

    isEnabled(): boolean {
        return this.enabled && this.graphAdapter.isAvailable();
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    async expandWithGraph(
        terms: string[],
        options: ExpansionOptions = {}
    ): Promise<ExpansionResult> {
        const {
            maxDepth = 1,
            maxTerms = 20,
            excludeTerms = []
        } = options;

        if (!this.isEnabled()) {
            return {
                originalTerms: terms,
                expandedTerms: terms,
                graphTerms: [],
                graphNodes: []
            };
        }

        const originalTerms = [...terms];
        const allExpanded = new Set<string>(terms);
        const allGraphTerms: string[] = [];
        const allGraphNodes: GraphNode[] = [];
        const processedTerms = new Set<string>();

        for (const term of terms) {
            if (processedTerms.has(term.toLowerCase())) continue;
            processedTerms.add(term.toLowerCase());

            const cacheKey = `${term}:${maxDepth}`;
            if (this.expansionCache.has(cacheKey)) {
                const cached = this.expansionCache.get(cacheKey)!;
                for (const t of cached) {
                    if (!excludeTerms.includes(t)) {
                        allExpanded.add(t);
                        if (!allGraphTerms.includes(t)) {
                            allGraphTerms.push(t);
                        }
                    }
                }
                continue;
            }

            try {
                const relatedTerms = await this.graphAdapter.getRelatedTerms(term);
                const relatedNodes = await this.graphAdapter.getRelatedNodes(term);

                const validTerms = relatedTerms
                    .filter(t => t.length > 2 && !excludeTerms.includes(t))
                    .slice(0, maxTerms);

                this.expansionCache.set(cacheKey, validTerms);
                this.cleanupCache(this.expansionCache);

                for (const t of validTerms) {
                    allExpanded.add(t);
                    if (!allGraphTerms.includes(t)) {
                        allGraphTerms.push(t);
                    }
                }

                for (const node of relatedNodes) {
                    const existingIndex = allGraphNodes.findIndex(n => n.id === node.id);
                    if (existingIndex === -1) {
                        allGraphNodes.push(node);
                    }
                }
            } catch (error) {
                this.logger.warn('expansion_failed', `Falha ao expandir termo: ${term}`, {
                    error: error instanceof Error ? error.message : String(error)
                });
            }

            if (allExpanded.size >= maxTerms * 2) break;
        }

        const expandedTerms = Array.from(allExpanded).slice(0, maxTerms);

        return {
            originalTerms,
            expandedTerms,
            graphTerms: allGraphTerms,
            graphNodes: allGraphNodes
        };
    }

    async enrichDocument(
        docId: string,
        docTags: string[],
        docKeywords: string[],
        docRelations: string[] = []
    ): Promise<GraphEnrichmentResult> {
        if (!this.isEnabled()) {
            return {
                docId,
                connectedNodes: [],
                relationScore: 0,
                semanticBoost: 0
            };
        }

        const cacheKey = docId;
        if (this.enrichmentCache.has(cacheKey)) {
            return this.enrichmentCache.get(cacheKey)!;
        }

        const connectedNodes: GraphNode[] = [];
        let totalRelationScore = 0;
        const allDocTerms = [...docTags, ...docKeywords, ...docRelations];

        for (const term of allDocTerms) {
            try {
                const relatedNodes = await this.graphAdapter.getRelatedNodes(term);
                
                for (const node of relatedNodes) {
                    const existingIndex = connectedNodes.findIndex(n => n.id === node.id);
                    if (existingIndex === -1) {
                        connectedNodes.push(node);
                        totalRelationScore += node.score;
                    } else {
                        connectedNodes[existingIndex].score += node.score * 0.5;
                        totalRelationScore += node.score * 0.5;
                    }
                }
            } catch (error) {
                this.logger.warn('enrichment_failed', `Falha ao enriquecer documento: ${docId}`, {
                    term,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        const semanticBoost = Math.min(totalRelationScore * 0.1, 2.0);

        const result: GraphEnrichmentResult = {
            docId,
            connectedNodes,
            relationScore: totalRelationScore,
            semanticBoost
        };

        this.enrichmentCache.set(cacheKey, result);
        this.cleanupCache(this.enrichmentCache);
        return result;
    }

    calculateGraphScore(
        docTags: string[],
        graphTerms: string[],
        graphNodes: GraphNode[]
    ): number {
        if (!this.isEnabled() || graphNodes.length === 0) {
            return 0;
        }

        let matchCount = 0;
        const normalizedDocTags = docTags.map(t => t.toLowerCase());

        for (const node of graphNodes) {
            const nodeNameLower = node.name.toLowerCase();
            
            if (normalizedDocTags.some(tag => 
                tag.includes(nodeNameLower) || nodeNameLower.includes(tag)
            )) {
                matchCount++;
            }

            if (graphTerms.some(term => 
                term.toLowerCase().includes(nodeNameLower) || 
                nodeNameLower.includes(term.toLowerCase())
            )) {
                matchCount += 0.5;
            }
        }

        return Math.min(matchCount * 2, 10);
    }

    async syncDocumentRelations(
        docId: string,
        tags: string[],
        relations: string[]
    ): Promise<void> {
        if (!this.isEnabled()) {
            return;
        }

        try {
            await this.graphAdapter.syncTagsToGraph(tags, docId);
            await this.graphAdapter.syncRelationsToGraph(relations, docId);
            
            this.enrichmentCache.delete(docId);
            
            this.logger.info('relations_synced', `Relações sincronizadas para documento: ${docId}`, {
                tagsCount: tags.length,
                relationsCount: relations.length
            });
        } catch (error) {
            this.logger.warn('sync_failed', `Falha ao sincronizar relações: ${docId}`, {
                error: error instanceof Error ? error.message : String(error)
            });
        }
    }

    clearCaches(): void {
        this.expansionCache.clear();
        this.enrichmentCache.clear();
    }

    reset(): void {
        this.expansionCache.clear();
        this.enrichmentCache.clear();
        this.enabled = true;
    }

    getCacheStats(): {
        expansionCacheSize: number;
        enrichmentCacheSize: number;
    } {
        return {
            expansionCacheSize: this.expansionCache.size,
            enrichmentCacheSize: this.enrichmentCache.size
        };
    }
}

let globalBridge: SemanticGraphBridge | null = null;

export function createSemanticGraphBridge(graphAdapter?: GraphAdapter): SemanticGraphBridge {
    return new SemanticGraphBridge(graphAdapter);
}

export function getSemanticGraphBridge(): SemanticGraphBridge {
    if (!globalBridge) {
        globalBridge = new SemanticGraphBridge();
    }
    return globalBridge;
}

export function resetSemanticGraphBridge(): void {
    if (globalBridge) {
        globalBridge.reset();
    }
    globalBridge = null;
}
