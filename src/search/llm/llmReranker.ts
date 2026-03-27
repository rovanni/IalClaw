import { ProviderFactory, LLMProvider, MessagePayload } from '../../engine/ProviderFactory';
import { buildPrompt, checkPromptSafety } from './promptBuilder';
import { createLogger } from '../../shared/AppLogger';
import { parseLlmJson } from '../../utils/parseLlmJson';
import { IndexedDocument } from '../index/invertedIndex';

export interface RerankResult {
    docId: string;
    relevanceScore: number;
    reason?: string;
}

export interface RerankOptions {
    maxDocs?: number;
    minScore?: number;
}

const RERANK_SYSTEM = `Você é um especialista em relevância de busca. 
Sua tarefa é reordenar documentos conforme sua relevância para a consulta do usuário.

IMPORTANTE:
- Analise cada documento individualmente
- Considere o título, conteúdo e tags
- Atribua scores de 0-10 baseados na relevância
- Retorne APENAS JSON válido`;

const RERANK_USER = `Considere a seguinte consulta: "{{query}}"

Liste os documentos a seguir em ordem de relevância para esta consulta.

DOCUMENTOS:
{{documents}}

Retorne JSON no formato:
{
  "results": [
    {"docId": "id1", "relevanceScore": 9.5, "reason": "motivo breve"},
    {"docId": "id2", "relevanceScore": 7.2, "reason": "motivo breve"},
    ...
  ]
}

Cada documento deve ter:
- docId: o ID do documento
- relevanceScore: score de 0-10
- reason: explicação breve do score`;

export class LlmReranker {
    private provider: LLMProvider;
    private logger = createLogger('LlmReranker');
    private enabled: boolean;

    constructor(enabled: boolean = true) {
        this.provider = ProviderFactory.getProvider();
        this.enabled = enabled;
    }

    async rerank(
        query: string,
        documents: IndexedDocument[],
        options: RerankOptions = {}
    ): Promise<RerankResult[]> {
        const {
            maxDocs = 10,
            minScore = 0
        } = options;

        if (!this.enabled) {
            return documents.map(doc => ({
                docId: doc.id,
                relevanceScore: 5.0,
                reason: 'Reranking desabilitado'
            }));
        }

        if (documents.length === 0) {
            return [];
        }

        if (documents.length === 1) {
            return [{
                docId: documents[0].id,
                relevanceScore: 10,
                reason: 'Único documento'
            }];
        }

        const docsToRerank = documents.slice(0, maxDocs);

        const documentsText = docsToRerank.map((doc, index) => {
            return `${index + 1}. ID: ${doc.id}
   Título: ${doc.title}
   Tags: ${doc.tags?.join(', ') || 'N/A'}
   Categoria: ${doc.categoria || 'N/A'}
   Conteúdo: ${doc.content.slice(0, 300)}...`;
        }).join('\n\n');

        const userPrompt = buildPrompt(
            RERANK_USER,
            {
                query,
                documents: documentsText
            },
            { throwOnMissing: true }
        );

        checkPromptSafety(userPrompt);

        const messages: MessagePayload[] = [
            { role: 'system', content: RERANK_SYSTEM },
            { role: 'user', content: userPrompt }
        ];

        this.logger.info('reranking_started', 'Iniciando reranking com LLM', {
            query: query.slice(0, 50),
            docCount: docsToRerank.length
        });

        try {
            const response = await this.provider.generate(messages);

            if (!response.final_answer) {
                throw new Error('LLM não retornou resposta');
            }

            const parsed = parseLlmJson(response.final_answer);

            if (!Array.isArray(parsed.results)) {
                throw new Error('Formato de resposta inválido');
            }

            const results: RerankResult[] = parsed.results
                .filter((r: any) => r.docId && typeof r.relevanceScore === 'number')
                .map((r: any) => ({
                    docId: String(r.docId),
                    relevanceScore: Math.min(10, Math.max(0, Number(r.relevanceScore))),
                    reason: String(r.reason || '')
                }))
                .filter((r: RerankResult) => r.relevanceScore >= minScore);

            this.logger.info('reranking_completed', 'Reranking concluído', {
                resultsCount: results.length
            });

            return results.sort((a, b) => b.relevanceScore - a.relevanceScore);

        } catch (error) {
            this.logger.error('reranking_failed', error, 'Falha no reranking');

            return docsToRerank.map(doc => ({
                docId: doc.id,
                relevanceScore: 5.0,
                reason: 'Reranking falhou, usando score padrão'
            }));
        }
    }

    setEnabled(enabled: boolean): void {
        this.enabled = enabled;
    }

    isEnabled(): boolean {
        return this.enabled;
    }
}

export function createLlmReranker(enabled?: boolean): LlmReranker {
    return new LlmReranker(enabled);
}
