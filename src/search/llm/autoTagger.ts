import { ProviderFactory, LLMProvider, MessagePayload } from '../../engine/ProviderFactory';
import { buildPrompt, checkPromptSafety } from './promptBuilder';
import { createLogger } from '../../shared/AppLogger';
import { parseLlmJson } from '../../utils/parseLlmJson';

export interface SemanticStructure {
    tokens: string[];
    keywords: string[];
    tags: string[];
    categoria: string;
    subcategoria: string;
    relacoes: string[];
}

export interface GenerateSemanticOptions {
    useLLM?: boolean;
    fallbackToTokenize?: boolean;
    maxKeywords?: number;
    maxTags?: number;
}

const SEMANTIC_ANALYSIS_SYSTEM = `Você é um sistema de análise semântica para indexação de documentos.
Seu objetivo é analisar documentos e extrair estrutura semântica EXPLÍCITA.

IMPORTANTE:
- NÃO use embeddings ou vetores
- Use apenas análise linguística e semântica EXPLÍCITA
- Identifique padrões linguísticos claros
- Categorize por conteúdo semântico manifesto

Retorne APENAS JSON válido, sem textos adicionais.`;

const SEMANTIC_ANALYSIS_USER = `Analise o documento abaixo e extraia sua estrutura semântica.

DOCUMENTO:
---
Título: {{title}}

Conteúdo: {{content}}
---

Analise e retorne:

1. **tokens**: Lista de tokens importantes (palavras-chave do conteúdo, ignore stopwords)
2. **keywords**: 5-10 palavras-chave principais que representam o tema
3. **tags**: 3-7 tags que categorizam o conteúdo
4. **categoria**: Categoria principal (ex: "tecnologia", "saúde", "finanças", "educação", "esportes", etc)
5. **subcategoria**: Subcategoria mais específica
6. **relacoes**: Entidades ou conceitos relacionados mencionados

Retorne JSON no formato:
{
  "tokens": ["token1", "token2", ...],
  "keywords": ["palavra1", "palavra2", ...],
  "tags": ["tag1", "tag2", ...],
  "categoria": "categoria principal",
  "subcategoria": "subcategoria",
  "relacoes": ["entidade1", "entidade2", ...]
}

Analise apenas o conteúdo fornecido. Não invente informações.`;

export class AutoTagger {
    private provider: LLMProvider;
    private logger = createLogger('AutoTagger');
    private useCache: boolean;
    private cache: Map<string, SemanticStructure>;

    constructor(useCache: boolean = true) {
        this.provider = ProviderFactory.getProvider();
        this.useCache = useCache;
        this.cache = new Map();
    }

    async generateSemanticStructure(
        doc: { id: string; title: string; content: string },
        options: GenerateSemanticOptions = {}
    ): Promise<SemanticStructure> {
        const {
            useLLM = true,
            fallbackToTokenize = true,
            maxKeywords = 10,
            maxTags = 7
        } = options;

        const cacheKey = `${doc.id}:${doc.content.slice(0, 100)}`;
        if (this.useCache && this.cache.has(cacheKey)) {
            this.logger.debug('cache_hit', 'Usando cache para documento', { docId: doc.id });
            return this.cache.get(cacheKey)!;
        }

        let semanticStructure: SemanticStructure;

        if (useLLM) {
            try {
                semanticStructure = await this.generateWithLLM(doc);
            } catch (error) {
                this.logger.warn('llm_generation_failed', 'Falha ao gerar estrutura semântica com LLM', {
                    docId: doc.id,
                    error: error instanceof Error ? error.message : String(error)
                });

                if (fallbackToTokenize) {
                    semanticStructure = this.generateFallback(doc);
                } else {
                    throw error;
                }
            }
        } else {
            semanticStructure = this.generateFallback(doc);
        }

        if (semanticStructure.keywords.length > maxKeywords) {
            semanticStructure.keywords = semanticStructure.keywords.slice(0, maxKeywords);
        }

        if (semanticStructure.tags.length > maxTags) {
            semanticStructure.tags = semanticStructure.tags.slice(0, maxTags);
        }

        if (this.useCache) {
            this.cache.set(cacheKey, semanticStructure);
        }

        return semanticStructure;
    }

    private async generateWithLLM(doc: { id: string; title: string; content: string }): Promise<SemanticStructure> {
        const userPrompt = buildPrompt(
            SEMANTIC_ANALYSIS_USER,
            {
                title: doc.title,
                content: doc.content.slice(0, 4000)
            },
            { throwOnMissing: true }
        );

        checkPromptSafety(userPrompt);

        const messages: MessagePayload[] = [
            { role: 'system', content: SEMANTIC_ANALYSIS_SYSTEM },
            { role: 'user', content: userPrompt }
        ];

        this.logger.info('generating_semantic_structure', 'Gerando estrutura semântica com LLM', {
            docId: doc.id,
            title: doc.title.slice(0, 50)
        });

        const response = await this.provider.generate(messages);

        if (!response.final_answer) {
            throw new Error('LLM não retornou resposta');
        }

        const parsed = parseLlmJson(response.final_answer);

        const semanticStructure: SemanticStructure = {
            tokens: Array.isArray(parsed.tokens) ? parsed.tokens : [],
            keywords: Array.isArray(parsed.keywords) ? parsed.keywords : [],
            tags: Array.isArray(parsed.tags) ? parsed.tags : [],
            categoria: String(parsed.categoria || ''),
            subcategoria: String(parsed.subcategoria || ''),
            relacoes: Array.isArray(parsed.relacoes) ? parsed.relacoes : []
        };

        this.logger.info('semantic_structure_generated', 'Estrutura semântica gerada', {
            docId: doc.id,
            keywordsCount: semanticStructure.keywords.length,
            tagsCount: semanticStructure.tags.length
        });

        return semanticStructure;
    }

    private generateFallback(doc: { id: string; title: string; content: string }): SemanticStructure {
        const { tokenize } = require('../core/tokenizer');
        const { normalize } = require('../core/normalizer');

        const allText = `${doc.title} ${doc.content}`;
        const tokens = tokenize(allText);
        const uniqueTokens = Array.from(new Set(tokens));

        const words = allText.toLowerCase().split(/\s+/);
        const wordFreq = new Map<string, number>();
        for (const word of words) {
            const normalized = normalize(word);
            if (normalized.length > 3) {
                wordFreq.set(normalized, (wordFreq.get(normalized) || 0) + 1);
            }
        }

        const sortedWords = Array.from(wordFreq.entries())
            .sort((a, b) => b[1] - a[1])
            .slice(0, 10)
            .map(([word]) => word);

        const semanticStructure: SemanticStructure = {
            tokens: uniqueTokens.slice(0, 50) as string[],
            keywords: sortedWords.slice(0, 5) as string[],
            tags: [],
            categoria: this.guessCategory(doc.content),
            subcategoria: '',
            relacoes: []
        };

        return semanticStructure;
    }

    private guessCategory(content: string): string {
        const contentLower = content.toLowerCase();
        
        const categoryPatterns: Record<string, string[]> = {
            'tecnologia': ['software', 'programa', 'código', 'api', 'desenvolvedor', 'sistema', 'computador', 'digital'],
            'finanças': ['dinheiro', 'investimento', 'finança', 'banco', 'renda', 'cust', 'preço', 'valor'],
            'saúde': ['saúde', 'médico', 'hospital', 'paciente', 'tratamento', 'doença', 'remédio'],
            'educação': ['escola', 'universidade', 'aluno', 'professor', 'curso', 'aula', 'estudo'],
            'direito': ['lei', 'jurídico', 'advogado', 'tribunal', 'processo', 'direito', 'sentença'],
            'marketing': ['marketing', 'cliente', 'venda', 'marca', 'publicidade', 'promoção'],
            'recursos humanos': ['funcionário', 'contratação', 'RH', 'colaborador', 'cargo', 'salário']
        };

        for (const [category, keywords] of Object.entries(categoryPatterns)) {
            const matches = keywords.filter(kw => contentLower.includes(kw)).length;
            if (matches >= 2) {
                return category;
            }
        }

        return 'geral';
    }

    clearCache(): void {
        this.cache.clear();
    }

    getCacheSize(): number {
        return this.cache.size;
    }
}

export function createAutoTagger(useCache?: boolean): AutoTagger {
    return new AutoTagger(useCache);
}
