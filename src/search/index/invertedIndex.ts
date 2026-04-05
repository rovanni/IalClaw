import { tokenize } from '../core/tokenizer';
import { normalize } from '../core/normalizer';
import { SearchCache, SessionManager } from '../../shared/SessionManager';

export interface IndexedDocument {
    id: string;
    title: string;
    content: string;
    tokens: string[];
    keywords?: string[];
    tags?: string[];
    categoria?: string;
    subcategoria?: string;
    relacoes?: string[];
    metadata?: Record<string, any>;
}

export interface InvertedIndexData {
    termIndex: Map<string, Set<string>>;
    documents: Map<string, IndexedDocument>;
    termFrequency: Map<string, Map<string, number>>;
}

interface InvertedIndexState {
    termIndex: Map<string, Set<string>>;
    documents: Map<string, IndexedDocument>;
    termFrequency: Map<string, Map<string, number>>;
    titleIndex: Map<string, Set<string>>;
    tagIndex: Map<string, Set<string>>;
    categoryIndex: Map<string, Set<string>>;
}

export class InvertedIndex {
    private termIndex: Map<string, Set<string>>;
    private documents: Map<string, IndexedDocument>;
    private termFrequency: Map<string, Map<string, number>>;
    private titleIndex: Map<string, Set<string>>;
    private tagIndex: Map<string, Set<string>>;
    private categoryIndex: Map<string, Set<string>>;
    private sessionManager: Pick<typeof SessionManager, 'getSession'>;

    constructor(options: {
        sessionManager?: Pick<typeof SessionManager, 'getSession'>;
    } = {}) {
        this.termIndex = new Map();
        this.documents = new Map();
        this.termFrequency = new Map();
        this.titleIndex = new Map();
        this.tagIndex = new Map();
        this.categoryIndex = new Map();
        this.sessionManager = options.sessionManager ?? SessionManager;
    }

    private createInvertedState(cache: SearchCache): InvertedIndexState {
        if (!cache.invertedIndexes.termIndex) {
            cache.invertedIndexes.termIndex = new Map<string, Set<string>>();
        }
        if (!cache.invertedIndexes.titleIndex) {
            cache.invertedIndexes.titleIndex = new Map<string, Set<string>>();
        }
        if (!cache.invertedIndexes.tagIndex) {
            cache.invertedIndexes.tagIndex = new Map<string, Set<string>>();
        }
        if (!cache.invertedIndexes.categoryIndex) {
            cache.invertedIndexes.categoryIndex = new Map<string, Set<string>>();
        }
        if (!cache.invertedIndexes.termFrequency) {
            cache.invertedIndexes.termFrequency = new Map<string, Map<string, number>>();
        }
        if (!cache.invertedIndexes.documents) {
            cache.invertedIndexes.documents = new Map<string, IndexedDocument>();
        }

        return {
            termIndex: cache.invertedIndexes.termIndex as Map<string, Set<string>>,
            documents: cache.invertedIndexes.documents as Map<string, IndexedDocument>,
            termFrequency: cache.invertedIndexes.termFrequency as Map<string, Map<string, number>>,
            titleIndex: cache.invertedIndexes.titleIndex as Map<string, Set<string>>,
            tagIndex: cache.invertedIndexes.tagIndex as Map<string, Set<string>>,
            categoryIndex: cache.invertedIndexes.categoryIndex as Map<string, Set<string>>
        };
    }

    private getState(sessionId?: string): InvertedIndexState {
        if (!sessionId) {
            return {
                termIndex: this.termIndex,
                documents: this.documents,
                termFrequency: this.termFrequency,
                titleIndex: this.titleIndex,
                tagIndex: this.tagIndex,
                categoryIndex: this.categoryIndex
            };
        }

        const session = this.sessionManager.getSession(sessionId);
        if (!session.search_cache) {
            session.search_cache = {
                documentCache: new Map<string, any>(),
                invertedIndexes: {
                    termIndex: new Map<string, Set<string>>(),
                    titleIndex: new Map<string, Set<string>>(),
                    tagIndex: new Map<string, Set<string>>(),
                    categoryIndex: new Map<string, Set<string>>(),
                    termFrequency: new Map<string, Map<string, number>>(),
                    documents: new Map<string, IndexedDocument>()
                },
                semanticCache: {
                    expansionCache: new Map<string, string[]>(),
                    enrichmentCache: new Map<string, any>()
                },
                autoTaggerCache: new Map<string, string[]>()
            };
        }

        return this.createInvertedState(session.search_cache);
    }

    addDocument(doc: IndexedDocument, sessionId?: string): void {
        const state = this.getState(sessionId);

        if (state.documents.has(doc.id)) {
            this.removeDocument(doc.id, sessionId);
        }

        state.documents.set(doc.id, doc);

        const tokens = doc.tokens || tokenize(doc.content);

        for (const token of tokens) {
            this.addTermToIndex(token, doc.id, 'term', sessionId);
        }

        const titleTokens = tokenize(doc.title);
        for (const token of titleTokens) {
            this.addTermToIndex(token, doc.id, 'title', sessionId);
        }

        if (doc.tags) {
            for (const tag of doc.tags) {
                const normalizedTag = normalize(tag);
                this.addTermToIndex(normalizedTag, doc.id, 'tag', sessionId);
            }
        }

        if (doc.categoria) {
            const normalizedCat = normalize(doc.categoria);
            this.addTermToIndex(normalizedCat, doc.id, 'category', sessionId);
        }
    }

    private addTermToIndex(term: string, docId: string, indexType: 'term' | 'title' | 'tag' | 'category', sessionId?: string): void {
        const state = this.getState(sessionId);
        const normalizedTerm = normalize(term);

        let index: Map<string, Set<string>>;
        switch (indexType) {
            case 'title':
                index = state.titleIndex;
                break;
            case 'tag':
                index = state.tagIndex;
                break;
            case 'category':
                index = state.categoryIndex;
                break;
            default:
                index = state.termIndex;
        }

        if (!index.has(normalizedTerm)) {
            index.set(normalizedTerm, new Set());
        }
        index.get(normalizedTerm)!.add(docId);

        if (!state.termFrequency.has(normalizedTerm)) {
            state.termFrequency.set(normalizedTerm, new Map());
        }
        const tf = state.termFrequency.get(normalizedTerm)!;
        tf.set(docId, (tf.get(docId) || 0) + 1);
    }

    removeDocument(docId: string, sessionId?: string): void {
        const state = this.getState(sessionId);
        const doc = state.documents.get(docId);
        if (!doc) return;

        const tokens = doc.tokens || tokenize(doc.content);

        for (const token of tokens) {
            this.removeTermFromIndex(token, docId, 'term', sessionId);
        }

        const titleTokens = tokenize(doc.title);
        for (const token of titleTokens) {
            this.removeTermFromIndex(token, docId, 'title', sessionId);
        }

        if (doc.tags) {
            for (const tag of doc.tags) {
                this.removeTermFromIndex(normalize(tag), docId, 'tag', sessionId);
            }
        }

        if (doc.categoria) {
            this.removeTermFromIndex(normalize(doc.categoria), docId, 'category', sessionId);
        }

        state.documents.delete(docId);
    }

    private removeTermFromIndex(term: string, docId: string, indexType: 'term' | 'title' | 'tag' | 'category', sessionId?: string): void {
        const state = this.getState(sessionId);
        const normalizedTerm = normalize(term);

        let index: Map<string, Set<string>>;
        switch (indexType) {
            case 'title':
                index = state.titleIndex;
                break;
            case 'tag':
                index = state.tagIndex;
                break;
            case 'category':
                index = state.categoryIndex;
                break;
            default:
                index = state.termIndex;
        }

        const docSet = index.get(normalizedTerm);
        if (docSet) {
            docSet.delete(docId);
            if (docSet.size === 0) {
                index.delete(normalizedTerm);
            }
        }

        const tf = state.termFrequency.get(normalizedTerm);
        if (tf) {
            tf.delete(docId);
            if (tf.size === 0) {
                state.termFrequency.delete(normalizedTerm);
            }
        }
    }

    search(queryTerms: string[], sessionId?: string): Map<string, {
        docIds: Set<string>;
        type: 'term' | 'title' | 'tag' | 'category';
    }> {
        const state = this.getState(sessionId);
        const results = new Map<string, {
            docIds: Set<string>;
            type: 'term' | 'title' | 'tag' | 'category';
        }>();

        for (const term of queryTerms) {
            const normalizedTerm = normalize(term);

            const termDocs = state.termIndex.get(normalizedTerm);
            if (termDocs && termDocs.size > 0) {
                results.set(normalizedTerm, { docIds: termDocs, type: 'term' });
            }

            const titleDocs = state.titleIndex.get(normalizedTerm);
            if (titleDocs && titleDocs.size > 0) {
                const key = `title:${normalizedTerm}`;
                results.set(key, { docIds: titleDocs, type: 'title' });
            }

            const tagDocs = state.tagIndex.get(normalizedTerm);
            if (tagDocs && tagDocs.size > 0) {
                const key = `tag:${normalizedTerm}`;
                results.set(key, { docIds: tagDocs, type: 'tag' });
            }

            const catDocs = state.categoryIndex.get(normalizedTerm);
            if (catDocs && catDocs.size > 0) {
                const key = `cat:${normalizedTerm}`;
                results.set(key, { docIds: catDocs, type: 'category' });
            }
        }

        return results;
    }

    getDocument(docId: string, sessionId?: string): IndexedDocument | undefined {
        const state = this.getState(sessionId);
        return state.documents.get(docId);
    }

    getDocuments(sessionId?: string): Map<string, IndexedDocument> {
        const state = this.getState(sessionId);
        return state.documents;
    }

    getAllDocuments(sessionId?: string): IndexedDocument[] {
        return Array.from(this.getDocuments(sessionId).values());
    }

    getDocumentCount(sessionId?: string): number {
        return this.getDocuments(sessionId).size;
    }

    getTermFrequency(term: string, docId: string, sessionId?: string): number {
        const state = this.getState(sessionId);
        const normalizedTerm = normalize(term);
        return state.termFrequency.get(normalizedTerm)?.get(docId) || 0;
    }

    getIndexStats(sessionId?: string): {
        uniqueTerms: number;
        documentCount: number;
        avgTokensPerDoc: number;
    } {
        const state = this.getState(sessionId);
        const allTokens = Array.from(state.documents.values())
            .reduce((acc, doc) => acc + (doc.tokens?.length || 0), 0);

        return {
            uniqueTerms: state.termIndex.size,
            documentCount: state.documents.size,
            avgTokensPerDoc: state.documents.size > 0 ? allTokens / state.documents.size : 0
        };
    }

    clear(sessionId?: string): void {
        const state = this.getState(sessionId);
        state.termIndex.clear();
        state.documents.clear();
        state.termFrequency.clear();
        state.titleIndex.clear();
        state.tagIndex.clear();
        state.categoryIndex.clear();
    }
}

export function createInvertedIndex(options?: {
    sessionManager?: Pick<typeof SessionManager, 'getSession'>;
}): InvertedIndex {
    return new InvertedIndex(options);
}
