import { tokenize } from '../core/tokenizer';
import { normalize, normalize as normalizeTerm } from '../core/normalizer';
import { InvertedIndex, IndexedDocument } from '../index/invertedIndex';
import { Scorer, ScoredDocument } from '../ranking/scorer';
import { AutoTagger, SemanticStructure } from '../llm/autoTagger';
import { LlmReranker } from '../llm/llmReranker';
import { createLogger } from '../../shared/AppLogger';

export interface SearchDocument {
    id: string;
    title: string;
    content: string;
    metadata?: Record<string, any>;
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
    };
}

export interface SearchOptions {
    limit?: number;
    offset?: number;
    useLLM?: boolean;
    useRerank?: boolean;
    expandSynonyms?: boolean;
    minScore?: number;
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
    private logger = createLogger('SearchEngine');
    private synonyms: SynonymMap;
    private useCache: boolean;
    private documentCache: Map<string, SearchDocument>;

    constructor(options: {
        useLLM?: boolean;
        useRerank?: boolean;
        synonyms?: SynonymMap;
    } = {}) {
        this.index = new InvertedIndex();
        this.scorer = new Scorer();
        this.autoTagger = new AutoTagger();
        this.llmReranker = new LlmReranker(options.useRerank ?? false);
        this.synonyms = { ...DEFAULT_SYNONYMS, ...options.synonyms };
        this.useCache = true;
        this.documentCache = new Map();
    }

    async indexDocument(doc: SearchDocument): Promise<void> {
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
            minScore = 0
        } = options;

        this.logger.info('search_started', 'Iniciando busca', { query: query.slice(0, 50), limit });

        const normalizedQuery = normalize(query, { removeAccents: true });
        let queryTokens = tokenize(normalizedQuery);

        if (expandSynonyms) {
            queryTokens = this.expandWithSynonyms(queryTokens);
            queryTokens = Array.from(new Set(queryTokens));
        }

        this.logger.debug('query_tokens', 'Tokens da query processados', { tokens: queryTokens });

        const searchResults = this.index.search(queryTokens);
        
        if (searchResults.size === 0) {
            this.logger.info('no_results', 'Nenhum resultado encontrado', { query: query.slice(0, 50) });
            return [];
        }

        const scoredDocs = this.scorer.scoreDocuments(query, searchResults, this.index['documents']);

        const searchResultsFinal: SearchResult[] = scoredDocs
            .filter(scored => scored.score >= minScore)
            .slice(offset, offset + limit)
            .map(scored => ({
                doc: this.getSearchDocument(scored.doc),
                score: scored.score,
                matchDetails: scored.matchDetails
            }));

        if (useRerank && searchResultsFinal.length > 1) {
            const reranked = await this.llmReranker.rerank(query, scoredDocs.map(s => s.doc));
            const rerankMap = new Map(reranked.map(r => [r.docId, r.relevanceScore]));
            
            searchResultsFinal.sort((a, b) => {
                const scoreA = rerankMap.get(a.doc.id) ?? a.score;
                const scoreB = rerankMap.get(b.doc.id) ?? b.score;
                return scoreB - scoreA;
            });
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

    getStats(): {
        documentCount: number;
        uniqueTerms: number;
        avgTokensPerDoc: number;
    } {
        return this.index.getIndexStats();
    }

    clearIndex(): void {
        this.index.clear();
        this.documentCache.clear();
        this.autoTagger.clearCache();
    }

    setSynonyms(synonyms: SynonymMap): void {
        this.synonyms = { ...DEFAULT_SYNONYMS, ...synonyms };
    }

    setWeights(weights: Partial<{
        titleMatch: number;
        contentMatch: number;
        tagMatch: number;
        categoryMatch: number;
        keywordMatch: number;
    }>): void {
        this.scorer.setWeights(weights);
    }

    setRerankEnabled(enabled: boolean): void {
        this.llmReranker.setEnabled(enabled);
    }
}

export function createSearchEngine(options?: {
    useLLM?: boolean;
    useRerank?: boolean;
    synonyms?: SynonymMap;
}): SearchEngine {
    return new SearchEngine(options);
}
