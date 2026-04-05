/**
 * KB-027: Neutralizar Search como subsistema decisório isolado
 * 
 * Signals puros para representar decisões e contexto do módulo Search,
 * permitindo que o CognitiveOrchestrator governe estratégias e fallbacks.
 * 
 * Princípio: Busca emite FATOS/METADADOS; decisão fica no Orchestrator.
 */

/**
 * SearchQuerySignal: Informar estratégia de expansão de query aplicada
 * 
 * Emitido quando SearchEngine expande uma query (sinônimos, grafo semântico).
 * Permite ao Orchestrator auditar e potencialmente governar expansões futuras.
 */
export interface SearchQuerySignal {
  type: 'SEARCH_QUERY';
  originalQuery: string;
  expandedTerms?: string[];
  graphExpansion?: boolean;
  reasoningContext?: string;
}

/**
 * SearchScoringSignal: Informar estratégia de scoring aplicada
 * 
 * Emitido quando SearchEngine calcula scores de resultados.
 * Registra pesos e multiplicadores utilizados para auditoria.
 */
export interface SearchScoringSignal {
  type: 'SEARCH_SCORING';
  weights: Record<string, number>;
  semanticBoost: number;
  reasoningContext?: string;
}

/**
 * SearchRerankerSignal: Informar decisão de reranking aplicada
 * 
 * Emitido quando SearchEngine decide fazer ou não reranking com LLM.
 * Registra confiança e contexto da decisão.
 */
export interface SearchRerankerSignal {
  type: 'SEARCH_RERANKER';
  shouldRerank: boolean;
  confidence: number;
  reasoningContext?: string;
}

/**
 * SearchFallbackSignal: Informar estratégia de fallback para falha em componente
 * 
 * Emitido quando SearchEngine falha em operação (expansão, scoring, reranking, tagging)
 * e aplica fallback strategy (use_default, warn_and_continue, abort).
 */
export interface SearchFallbackSignal {
  type: 'SEARCH_FALLBACK';
  offendingComponent: 'expansion' | 'scoring' | 'reranking' | 'tagging';
  errorSummary: string;
  fallbackStrategy: 'use_default' | 'warn_and_continue' | 'abort';
  reasoningContext?: string;
}

/**
 * Tipo discriminado para todas as signals de Search
 */
export type SearchSignal = 
  | SearchQuerySignal 
  | SearchScoringSignal 
  | SearchRerankerSignal 
  | SearchFallbackSignal;
