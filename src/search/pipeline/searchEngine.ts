import { tokenize } from '../core/tokenizer';
import { normalize, normalize as normalizeTerm } from '../core/normalizer';
import { InvertedIndex, IndexedDocument } from '../index/invertedIndex';
import { Scorer, ScoredDocument, ScoringWeights } from '../ranking/scorer';
import { AutoTagger, SemanticStructure } from '../llm/autoTagger';
import { LlmReranker } from '../llm/llmReranker';
import { createLogger } from '../../shared/AppLogger';
import { SemanticGraphBridge, getSemanticGraphBridge, ExpansionResult } from '../graph/semanticGraphBridge';
import { GraphNode } from '../graph/graphAdapter';
import { CognitiveOrchestrator } from '../../core/orchestrator/CognitiveOrchestrator';

export interface SearchDocument {
    id: string;
    title: string;
    content: string;
    metadata?: Record<string, any>;
}

export interface SearchOptions {
    limit?: number;
    offset?: number;
    useLLM?: boolean;
    useRerank?: boolean;
    expandSynonyms?: boolean;
    minScore?: number;
    expandWithGraph?: boolean;
    graphMaxTerms?: number;
    debug?: boolean;
    sessionId?: string;
}

export interface SearchResult {
    doc: SearchDocument;
    score: number;
    matchDetails: {
        titleMatches: number;
        contentMatches: number;
        tagMatches: number;
        categoryMatch: boolean;
        keywordMatches: number;
        graphRelationMatches?: number;
    };
    debugInfo?: SearchDebugInfo;
}

export interface SearchDebugInfo {
    expandedTerms: string[];
    graphTerms: string[];
    graphNodes: GraphNode[];
    scoreBreakdown: {
        tokenMatch: number;
        tagMatch: number;
        graphRelationMatch: number;
        semanticBoost: number;
    };
}

interface SynonymMap {
    [term: string]: string[];
}

const DEFAULT_SYNONYMS: SynonymMap = {
    ' IA ': ['inteligência artificial', 'machine learning', 'ml', 'deep learning'],
    'ai': ['inteligência artificial', 'machine learning'],
    'computador': ['computadora', 'pc', 'notebook', 'laptop'],
    'software': ['programa', 'aplicativo', 'app', 'sistema'],
    'internet': ['web', 'online', 'rede'],
    'dados': ['informação', 'informações', 'data'],
    'erro': ['bug', 'falha', 'problema', 'defeito'],
    'usuário': ['utilizador', 'user', 'cliente'],
    'busca': ['pesquisa', 'procura', 'consulta'],
    'documento': ['doc', 'arquivo', 'file']
};

export class SearchEngine {
    private index: InvertedIndex;
    private scorer: Scorer;
    private autoTagger: AutoTagger;
    private llmReranker: LlmReranker;
    private graphBridge: SemanticGraphBridge;
    private logger = createLogger('SearchEngine');
    private synonyms: SynonymMap;
    private useCache: boolean;
    private documentCache: Map<string, SearchDocument>;
    private enableGraphExpansion: boolean = true;
    private orchestrator?: CognitiveOrchestrator;

    constructor(options: {
        useLLM?: boolean;
        useRerank?: boolean;
        synonyms?: SynonymMap;
        useGraphExpansion?: boolean;
    } = {}) {
        this.index = new InvertedIndex();
        this.scorer = new Scorer();
        this.autoTagger = new AutoTagger();
        this.llmReranker = new LlmReranker(options.useRerank ?? false);
        this.graphBridge = getSemanticGraphBridge();
        this.synonyms = { ...DEFAULT_SYNONYMS, ...options.synonyms };
        this.useCache = true;
        this.documentCache = new Map();
        this.enableGraphExpansion = options.useGraphExpansion ?? true;
    }

    async indexDocument(doc: SearchDocument, syncToGraph: boolean = true): Promise<void> {
        this.logger.info('indexing_document', 'Indexando documento', { docId: doc.id, title: doc.title });

        let semanticStructure: SemanticStructure;

        try {
            semanticStructure = await this.autoTagger.generateSemanticStructure(doc);
        } catch (error) {
            this.logger.warn('auto_tag_failed', 'Falha no auto-tagging, usando fallback', {
                docId: doc.id,
                error: error instanceof Error ? error.message : String(error)
            });
            semanticStructure = await this.autoTagger.generateSemanticStructure(doc, { useLLM: false });
        }

        const indexedDoc: IndexedDocument = {
            id: doc.id,
            title: doc.title,
            content: doc.content,
            tokens: semanticStructure.tokens,
            keywords: semanticStructure.keywords,
            tags: semanticStructure.tags,
            categoria: semanticStructure.categoria,
            subcategoria: semanticStructure.subcategoria,
            relacoes: semanticStructure.relacoes,
            metadata: doc.metadata
        };

        this.index.addDocument(indexedDoc);

        if (this.useCache) {
            this.documentCache.set(doc.id, doc);
        }

        if (syncToGraph && this.graphBridge.isEnabled()) {
            try {
                await this.graphBridge.syncDocumentRelations(
                    doc.id,
                    semanticStructure.tags,
                    semanticStructure.relacoes
                );
            } catch (error) {
                this.logger.warn('graph_sync_failed', 'Falha ao sincronizar com grafo', {
                    docId: doc.id,
                    error: error instanceof Error ? error.message : String(error)
                });
            }
        }

        this.logger.info('document_indexed', 'Documento indexado com sucesso', {
            docId: doc.id,
            tokensCount: semanticStructure.tokens.length,
            keywordsCount: semanticStructure.keywords.length,
            tagsCount: semanticStructure.tags.length
        });
    }

    async indexDocuments(docs: SearchDocument[]): Promise<void> {
        for (const doc of docs) {
            await this.indexDocument(doc);
        }
    }

    async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
        const {
            limit = 10,
            offset = 0,
            useLLM = false,
            useRerank = false,
            expandSynonyms = true,
            minScore = 0,
            expandWithGraph = this.enableGraphExpansion,
            graphMaxTerms = 20,
            debug = false,
            sessionId
        } = options;

        this.logger.info('search_started', 'Iniciando busca', { query: query.slice(0, 50), limit, expandWithGraph });

        const normalizedQuery = normalize(query, { removeAccents: true });
        let queryTokens = tokenize(normalizedQuery);

        // T2.1 — SAFE MODE: Decisão de expansão com sinônimos
        const orchestratorQueryExpansionDecision = this.orchestrator?.decideQueryExpansion(sessionId);
        const shouldExpandSynonyms = orchestratorQueryExpansionDecision ?? expandSynonyms;

        if (shouldExpandSynonyms) {
            queryTokens = this.expandWithSynonyms(queryTokens);
            queryTokens = Array.from(new Set(queryTokens));
        }

        // T2.1 — SEARCH_QUERY signal: registrar expansão por sinônimos
        if (shouldExpandSynonyms && this.orchestrator && sessionId) {
            this.orchestrator.ingestSearchSignal(sessionId, {
                type: 'SEARCH_QUERY',
                originalQuery: query,
                expandedTerms: queryTokens,
                graphExpansion: false,
                reasoningContext: `Synonym expansion applied: ${queryTokens.length} terms`
            });
        }

        let expansionResult: ExpansionResult | null = null;
        
        // T2.3 — SAFE MODE: Decisão de expansão com grafo semântico
        const orchestratorGraphDecision = this.orchestrator?.decideGraphExpansion(sessionId);
        const graphConfig = orchestratorGraphDecision ?? {
            enabled: expandWithGraph && this.graphBridge.isEnabled(),
            maxTerms: graphMaxTerms,
            boost: 0.1
        };

        if (graphConfig.enabled && this.graphBridge.isEnabled()) {
            try {
                expansionResult = await this.graphBridge.expandWithGraph(queryTokens, {
                    maxTerms: graphConfig.maxTerms
                });
                
                if (expansionResult.graphTerms.length > 0) {
                    queryTokens = [...new Set([...queryTokens, ...expansionResult.graphTerms])];
                    this.logger.debug('graph_expansion', 'Termos expandidos via grafo', {
                        original: queryTokens.length,
                        expanded: expansionResult.expandedTerms.length,
                        graphTerms: expansionResult.graphTerms.length
                    });

                    // T2.3 — SEARCH_QUERY signal: registrar expansão via grafo semântico
                    if (this.orchestrator && sessionId) {
                        this.orchestrator.ingestSearchSignal(sessionId, {
                            type: 'SEARCH_QUERY',
                            originalQuery: query,
                            expandedTerms: expansionResult.graphTerms,
                            graphExpansion: true,
                            reasoningContext: `Graph expansion applied: +${expansionResult.graphTerms.length} terms`
                        });
                    }
                }
            } catch (error) {
                this.logger.warn('graph_expansion_failed', 'Falha na expansão via grafo, continuando sem ela', {
                    error: error instanceof Error ? error.message : String(error)
                });

                // T2.3 — SAFE MODE: Decisão de fallback para expansão com grafo
                const fallbackStrategy = this.orchestrator?.decideSearchFallbackStrategy(sessionId, 'expansion') ?? 'warn_and_continue';

                // T2.3 — SEARCH_FALLBACK signal: registrar falha na expansão via grafo
                if (this.orchestrator && sessionId) {
                    this.orchestrator.ingestSearchSignal(sessionId, {
                        type: 'SEARCH_FALLBACK',
                        offendingComponent: 'expansion',
                        errorSummary: error instanceof Error ? error.message : String(error),
                        fallbackStrategy: fallbackStrategy,
                        reasoningContext: 'Graph expansion failed, continuing without graph terms'
                    });
                }

                if (fallbackStrategy === 'abort') {
                    throw error;
                }
            }
        }

        this.logger.debug('query_tokens', 'Tokens da query processados', { tokens: queryTokens });

        const searchResults = this.index.search(queryTokens);
        
        if (searchResults.size === 0) {
            this.logger.info('no_results', 'Nenhum resultado encontrado', { query: query.slice(0, 50) });
            return [];
        }

        // T2.2 — SAFE MODE: Decisão de pesos de scoring
        // T2.2 — SAFE MODE: Decisão de pesos de scoring
        // Usa scorer local para não mutar this.scorer (estado compartilhado entre buscas)
        const orchestratorWeights = this.orchestrator?.decideSearchWeights(sessionId);
        const activeScorer = orchestratorWeights ? new Scorer(orchestratorWeights) : this.scorer;

        const scoredDocs = activeScorer.scoreDocuments(query, searchResults, this.index.getDocuments());

        // T2.2 — SEARCH_SCORING signal: registrar pesos de scoring aplicados
        if (this.orchestrator && sessionId) {
            this.orchestrator.ingestSearchSignal(sessionId, {
                type: 'SEARCH_SCORING',
                weights: { ...activeScorer.getWeights() } as unknown as Record<string, number>,
                semanticBoost: 1.0,
                reasoningContext: `Scoring applied to ${scoredDocs.length} documents`
            });
        }

        const searchResultsFinal: SearchResult[] = scoredDocs
            .filter(scored => scored.score >= minScore)
            .slice(offset, offset + limit)
            .map(scored => {
                const baseResult: SearchResult = {
                    doc: this.getSearchDocument(scored.doc),
                    score: scored.score,
                    matchDetails: scored.matchDetails
                };

                if (debug) {
                    let graphRelationScore = 0;
                    let semanticBoost = 0;
                    let connectedNodes: GraphNode[] = [];

                    if (expandWithGraph && expansionResult && this.graphBridge.isEnabled()) {
                        const docTags = scored.doc.tags || [];
                        const docKeywords = scored.doc.keywords || [];
                        const docRelations = scored.doc.relacoes || [];

                        graphRelationScore = this.graphBridge.calculateGraphScore(
                            docTags,
                            expansionResult.graphTerms,
                            expansionResult.graphNodes
                        );

                        baseResult.matchDetails.graphRelationMatches = Math.floor(graphRelationScore);
                        baseResult.score += graphRelationScore;

                        semanticBoost = graphRelationScore * 0.1;
                        baseResult.score += semanticBoost;

                        connectedNodes = expansionResult.graphNodes;
                    }

                    return {
                        ...baseResult,
                        debugInfo: {
                            expandedTerms: expansionResult?.expandedTerms || queryTokens,
                            graphTerms: expansionResult?.graphTerms || [],
                            graphNodes: connectedNodes,
                            scoreBreakdown: {
                                tokenMatch: scored.matchDetails.contentMatches,
                                tagMatch: scored.matchDetails.tagMatches * 5,
                                graphRelationMatch: graphRelationScore,
                                semanticBoost
                            }
                        }
                    } as SearchResult;
                }

                return baseResult as SearchResult;
            });

        if (useRerank && searchResultsFinal.length > 1) {
            // T2.4 — SAFE MODE: Decisão de reranking com LLM
            const orchestratorRerankerDecision = this.orchestrator?.decideReranking(sessionId);
            const shouldRerank = orchestratorRerankerDecision ?? useRerank;

            if (shouldRerank) {
                const reranked = await this.llmReranker.rerank(query, scoredDocs.map(s => s.doc));
                const rerankMap = new Map(reranked.map(r => [r.docId, r.relevanceScore]));
                
                searchResultsFinal.sort((a, b) => {
                    const scoreA = rerankMap.get(a.doc.id) ?? a.score;
                    const scoreB = rerankMap.get(b.doc.id) ?? b.score;
                    return scoreB - scoreA;
                });

                // T2.4 — SEARCH_RERANKER signal: registrar decisão de reranking com LLM
                if (this.orchestrator && sessionId) {
                    this.orchestrator.ingestSearchSignal(sessionId, {
                        type: 'SEARCH_RERANKER',
                        shouldRerank: true,
                        confidence: 0.8,
                        reasoningContext: `LLM reranking applied to ${searchResultsFinal.length} results`
                    });
                }
            }
        }

        this.logger.info('search_completed', 'Busca concluída', {
            query: query.slice(0, 50),
            resultsCount: searchResultsFinal.length
        });

        return searchResultsFinal;
    }

    private expandWithSynonyms(tokens: string[]): string[] {
        const expanded = [...tokens];

        for (const token of tokens) {
            const normalizedToken = ` ${normalize(token)} `;
            
            for (const [synonymKey, synonymValues] of Object.entries(this.synonyms)) {
                const normalizedKey = ` ${synonymKey} `;
                
                if (normalizedToken.includes(normalizedKey) || normalizedKey.includes(normalizedToken)) {
                    for (const synonym of synonymValues) {
                        const synonymTokens = tokenize(synonym);
                        expanded.push(...synonymTokens);
                    }
                }
            }
        }

        return expanded;
    }

    private getSearchDocument(indexedDoc: IndexedDocument): SearchDocument {
        const cached = this.documentCache.get(indexedDoc.id);
        if (cached) {
            return cached;
        }

        return {
            id: indexedDoc.id,
            title: indexedDoc.title,
            content: indexedDoc.content,
            metadata: indexedDoc.metadata
        };
    }

    removeDocument(docId: string): void {
        this.index.removeDocument(docId);
        this.documentCache.delete(docId);
    }

    clearIndex(): void {
        this.index.clear();
        this.documentCache.clear();
        this.autoTagger.clearCache();
    }

    setSynonyms(synonyms: SynonymMap): void {
        this.synonyms = { ...DEFAULT_SYNONYMS, ...synonyms };
    }

    setWeights(weights: Partial<ScoringWeights>): void {
        this.scorer.setWeights(weights);
    }

    setRerankEnabled(enabled: boolean): void {
        this.llmReranker.setEnabled(enabled);
    }

    setOrchestrator(orchestrator: CognitiveOrchestrator): void {
        this.orchestrator = orchestrator;
    }

    setGraphExpansionEnabled(enabled: boolean): void {
        this.enableGraphExpansion = enabled;
        this.graphBridge.setEnabled(enabled);
    }

    isGraphExpansionEnabled(): boolean {
        return this.enableGraphExpansion && this.graphBridge.isEnabled();
    }

    getGraphBridge(): SemanticGraphBridge {
        return this.graphBridge;
    }

    getStats(): {
        documentCount: number;
        uniqueTerms: number;
        avgTokensPerDoc: number;
        graphEnabled: boolean;
        graphCacheStats: {
            expansionCacheSize: number;
            enrichmentCacheSize: number;
        };
    } {
        return {
            ...this.index.getIndexStats(),
            graphEnabled: this.isGraphExpansionEnabled(),
            graphCacheStats: this.graphBridge.getCacheStats()
        };
    }
}

export function createSearchEngine(options?: {
    useLLM?: boolean;
    useRerank?: boolean;
    synonyms?: SynonymMap;
    useGraphExpansion?: boolean;
}): SearchEngine {
    return new SearchEngine(options);
}
