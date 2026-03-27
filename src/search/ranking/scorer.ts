import { IndexedDocument } from '../index/invertedIndex';
import { normalize } from '../core/normalizer';
import { tokenize } from '../core/tokenizer';

export interface ScoredDocument {
    doc: IndexedDocument;
    score: number;
    matchDetails: {
        titleMatches: number;
        contentMatches: number;
        tagMatches: number;
        categoryMatch: boolean;
        keywordMatches: number;
        graphRelationMatches?: number;
    };
}

export interface ScoringWeights {
    titleMatch: number;
    contentMatch: number;
    tagMatch: number;
    categoryMatch: number;
    keywordMatch: number;
    positionBonus: number;
    graphRelationMatch: number;
}

export const DEFAULT_WEIGHTS: ScoringWeights = {
    titleMatch: 10,
    contentMatch: 1,
    tagMatch: 5,
    categoryMatch: 3,
    keywordMatch: 2,
    positionBonus: 0.1,
    graphRelationMatch: 2
};

export class Scorer {
    private weights: ScoringWeights;

    constructor(weights: Partial<ScoringWeights> = {}) {
        this.weights = { ...DEFAULT_WEIGHTS, ...weights };
    }

    scoreDocuments(
        query: string,
        results: Map<string, { docIds: Set<string>; type: 'term' | 'title' | 'tag' | 'category' }>,
        documents: Map<string, IndexedDocument>
    ): ScoredDocument[] {
        const scoredDocs = new Map<string, ScoredDocument>();

        const queryTokens = tokenize(query).map(t => normalize(t));

        for (const [term, result] of Array.from(results.entries())) {
            for (const docId of Array.from(result.docIds)) {
                const doc = documents.get(docId);
                if (!doc) continue;

                if (!scoredDocs.has(docId)) {
                    scoredDocs.set(docId, {
                        doc,
                        score: 0,
                        matchDetails: {
                            titleMatches: 0,
                            contentMatches: 0,
                            tagMatches: 0,
                            categoryMatch: false,
                            keywordMatches: 0
                        }
                    });
                }

                const scored = scoredDocs.get(docId)!;

                switch (result.type) {
                    case 'title':
                        scored.score += this.weights.titleMatch * this.calculateTermWeight(term.replace('title:', ''), queryTokens);
                        scored.matchDetails.titleMatches++;
                        break;
                    case 'tag':
                        scored.score += this.weights.tagMatch * this.calculateTermWeight(term.replace('tag:', ''), queryTokens);
                        scored.matchDetails.tagMatches++;
                        break;
                    case 'category':
                        scored.score += this.weights.categoryMatch;
                        scored.matchDetails.categoryMatch = true;
                        break;
                    case 'term':
                    default:
                        const contentMatches = this.countTermMatches(term, doc);
                        scored.score += this.weights.contentMatch * contentMatches;
                        scored.matchDetails.contentMatches += contentMatches;
                        break;
                }
            }
        }

        for (const [docId, scored] of Array.from(scoredDocs.entries())) {
            if (scored.doc.keywords) {
                const keywordMatches = this.countKeywordMatches(queryTokens, scored.doc.keywords);
                scored.score += this.weights.keywordMatch * keywordMatches;
                scored.matchDetails.keywordMatches = keywordMatches;
            }

            scored.score = Math.round(scored.score * 100) / 100;
        }

        return Array.from(scoredDocs.values())
            .sort((a, b) => b.score - a.score);
    }

    private calculateTermWeight(term: string, queryTokens: string[]): number {
        const queryIndex = queryTokens.indexOf(term);
        if (queryIndex === -1) return 1;
        
        const positionFactor = 1 + (queryTokens.length - queryIndex) * this.weights.positionBonus;
        return positionFactor;
    }

    private countTermMatches(term: string, doc: IndexedDocument): number {
        const normalizedTerm = normalize(term);
        
        const contentTokens = doc.tokens || tokenize(doc.content);
        let count = 0;
        
        for (const token of contentTokens) {
            if (normalize(token) === normalizedTerm) {
                count++;
            }
        }
        
        return Math.min(count, 10);
    }

    private countKeywordMatches(queryTokens: string[], keywords: string[]): number {
        let matches = 0;
        
        for (const keyword of keywords) {
            const normalizedKeyword = normalize(keyword);
            for (const queryToken of queryTokens) {
                if (normalizedKeyword.includes(queryToken) || queryToken.includes(normalizedKeyword)) {
                    matches++;
                    break;
                }
            }
        }
        
        return matches;
    }

    setWeights(weights: Partial<ScoringWeights>): void {
        this.weights = { ...this.weights, ...weights };
    }

    getWeights(): ScoringWeights {
        return { ...this.weights };
    }
}

export function createScorer(weights?: Partial<ScoringWeights>): Scorer {
    return new Scorer(weights);
}
