import { tokenize } from '../core/tokenizer';
import { normalize } from '../core/normalizer';

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

export class InvertedIndex {
    private termIndex: Map<string, Set<string>>;
    private documents: Map<string, IndexedDocument>;
    private termFrequency: Map<string, Map<string, number>>;
    private titleIndex: Map<string, Set<string>>;
    private tagIndex: Map<string, Set<string>>;
    private categoryIndex: Map<string, Set<string>>;

    constructor() {
        this.termIndex = new Map();
        this.documents = new Map();
        this.termFrequency = new Map();
        this.titleIndex = new Map();
        this.tagIndex = new Map();
        this.categoryIndex = new Map();
    }

    addDocument(doc: IndexedDocument): void {
        if (this.documents.has(doc.id)) {
            this.removeDocument(doc.id);
        }

        this.documents.set(doc.id, doc);

        const tokens = doc.tokens || tokenize(doc.content);
        
        for (const token of tokens) {
            this.addTermToIndex(token, doc.id, 'term');
        }

        const titleTokens = tokenize(doc.title);
        for (const token of titleTokens) {
            this.addTermToIndex(token, doc.id, 'title');
        }

        if (doc.tags) {
            for (const tag of doc.tags) {
                const normalizedTag = normalize(tag);
                this.addTermToIndex(normalizedTag, doc.id, 'tag');
            }
        }

        if (doc.categoria) {
            const normalizedCat = normalize(doc.categoria);
            this.addTermToIndex(normalizedCat, doc.id, 'category');
        }
    }

    private addTermToIndex(term: string, docId: string, indexType: 'term' | 'title' | 'tag' | 'category'): void {
        const normalizedTerm = normalize(term);
        
        let index: Map<string, Set<string>>;
        switch (indexType) {
            case 'title':
                index = this.titleIndex;
                break;
            case 'tag':
                index = this.tagIndex;
                break;
            case 'category':
                index = this.categoryIndex;
                break;
            default:
                index = this.termIndex;
        }

        if (!index.has(normalizedTerm)) {
            index.set(normalizedTerm, new Set());
        }
        index.get(normalizedTerm)!.add(docId);

        if (!this.termFrequency.has(normalizedTerm)) {
            this.termFrequency.set(normalizedTerm, new Map());
        }
        const tf = this.termFrequency.get(normalizedTerm)!;
        tf.set(docId, (tf.get(docId) || 0) + 1);
    }

    removeDocument(docId: string): void {
        const doc = this.documents.get(docId);
        if (!doc) return;

        const tokens = doc.tokens || tokenize(doc.content);
        
        for (const token of tokens) {
            this.removeTermFromIndex(token, docId, 'term');
        }

        const titleTokens = tokenize(doc.title);
        for (const token of titleTokens) {
            this.removeTermFromIndex(token, docId, 'title');
        }

        if (doc.tags) {
            for (const tag of doc.tags) {
                this.removeTermFromIndex(normalize(tag), docId, 'tag');
            }
        }

        if (doc.categoria) {
            this.removeTermFromIndex(normalize(doc.categoria), docId, 'category');
        }

        this.documents.delete(docId);
    }

    private removeTermFromIndex(term: string, docId: string, indexType: 'term' | 'title' | 'tag' | 'category'): void {
        const normalizedTerm = normalize(term);
        
        let index: Map<string, Set<string>>;
        switch (indexType) {
            case 'title':
                index = this.titleIndex;
                break;
            case 'tag':
                index = this.tagIndex;
                break;
            case 'category':
                index = this.categoryIndex;
                break;
            default:
                index = this.termIndex;
        }

        const docSet = index.get(normalizedTerm);
        if (docSet) {
            docSet.delete(docId);
            if (docSet.size === 0) {
                index.delete(normalizedTerm);
            }
        }

        const tf = this.termFrequency.get(normalizedTerm);
        if (tf) {
            tf.delete(docId);
            if (tf.size === 0) {
                this.termFrequency.delete(normalizedTerm);
            }
        }
    }

    search(queryTerms: string[]): Map<string, {
        docIds: Set<string>;
        type: 'term' | 'title' | 'tag' | 'category';
    }> {
        const results = new Map<string, {
            docIds: Set<string>;
            type: 'term' | 'title' | 'tag' | 'category';
        }>();

        for (const term of queryTerms) {
            const normalizedTerm = normalize(term);

            const termDocs = this.termIndex.get(normalizedTerm);
            if (termDocs && termDocs.size > 0) {
                results.set(normalizedTerm, { docIds: termDocs, type: 'term' });
            }

            const titleDocs = this.titleIndex.get(normalizedTerm);
            if (titleDocs && titleDocs.size > 0) {
                const key = `title:${normalizedTerm}`;
                results.set(key, { docIds: titleDocs, type: 'title' });
            }

            const tagDocs = this.tagIndex.get(normalizedTerm);
            if (tagDocs && tagDocs.size > 0) {
                const key = `tag:${normalizedTerm}`;
                results.set(key, { docIds: tagDocs, type: 'tag' });
            }

            const catDocs = this.categoryIndex.get(normalizedTerm);
            if (catDocs && catDocs.size > 0) {
                const key = `cat:${normalizedTerm}`;
                results.set(key, { docIds: catDocs, type: 'category' });
            }
        }

        return results;
    }

    getDocument(docId: string): IndexedDocument | undefined {
        return this.documents.get(docId);
    }

    getAllDocuments(): IndexedDocument[] {
        return Array.from(this.documents.values());
    }

    getDocumentCount(): number {
        return this.documents.size;
    }

    getTermFrequency(term: string, docId: string): number {
        const normalizedTerm = normalize(term);
        return this.termFrequency.get(normalizedTerm)?.get(docId) || 0;
    }

    getIndexStats(): {
        uniqueTerms: number;
        documentCount: number;
        avgTokensPerDoc: number;
    } {
        const allTokens = Array.from(this.documents.values())
            .reduce((acc, doc) => acc + (doc.tokens?.length || 0), 0);
        
        return {
            uniqueTerms: this.termIndex.size,
            documentCount: this.documents.size,
            avgTokensPerDoc: this.documents.size > 0 ? allTokens / this.documents.size : 0
        };
    }

    clear(): void {
        this.termIndex.clear();
        this.documents.clear();
        this.termFrequency.clear();
        this.titleIndex.clear();
        this.tagIndex.clear();
        this.categoryIndex.clear();
    }
}

export function createInvertedIndex(): InvertedIndex {
    return new InvertedIndex();
}
