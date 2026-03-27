# Sistema de Busca Semântica - Especificação Técnica

## Visão Geral

Sistema de busca semântica híbrido que combina **indexação inteligente** com **expansão semântica via grafo cognitivo**. Implementa busca por índice invertido com re-ranking opcional via LLM e integração com o Graph-RAG.

## Arquitetura

```
src/search/
├── core/
│   ├── tokenizer.ts         # Tokenização de texto
│   └── normalizer.ts       # Normalização com stopwords
├── index/
│   └── invertedIndex.ts    # Índice invertido
├── ranking/
│   └── scorer.ts           # Sistema de pontuação
├── pipeline/
│   └── searchEngine.ts     # Motor de busca
├── llm/
│   ├── promptBuilder.ts    # Templates seguros
│   ├── autoTagger.ts       # Geração de estrutura semântica
│   └── llmReranker.ts      # Re-ranking com LLM
├── graph/
│   ├── graphAdapter.ts     # Adapter para CognitiveMemory
│   └── semanticGraphBridge.ts # Ponte semântica search↔graph
└── index.ts                # Exports
```

## Componentes

### 1. Tokenizer (`core/tokenizer.ts`)

Funções principais:
- `tokenize(text, options)` - Tokeniza texto com opções de mínimo/máximo comprimento
- `tokenizeWithPositions(text)` - Retorna tokens com posições
- `extractPhrases(text, minWords, maxWords)` - Extrai frases de N palavras

### 2. Normalizer (`core/normalizer.ts`)

Funções principais:
- `normalize(text, options)` - Normaliza com opções de:
  - `removeAccents` - Remove acentos
  - `removeStopwords` - Remove stopwords
  - `stem` - Aplica stemização simples
- `removeAccentsFromText(text)` - Remove acentos
- `isStopword(word)` - Verifica se é stopword

### 3. Índice Invertido (`index/invertedIndex.ts`)

Estrutura de dados que mapeia termos → documentos:

```typescript
interface InvertedIndexData {
  termIndex: Map<string, Set<string>>;      // termo → [docIds]
  documents: Map<string, IndexedDocument>;   // docId → documento
  termFrequency: Map<string, Map<string, number>>; // termo → {docId → frequência}
}
```

Métodos:
- `addDocument(doc)` - Adiciona documento ao índice
- `removeDocument(docId)` - Remove documento
- `search(queryTerms)` - Busca termos no índice
- `getIndexStats()` - Retorna estatísticas

### 4. Scorer (`ranking/scorer.ts`)

Sistema de pontuação com pesos configuráveis:

```typescript
interface ScoringWeights {
  titleMatch: number;      // default: 10
  contentMatch: number;     // default: 1
  tagMatch: number;         // default: 5
  categoryMatch: number;    // default: 3
  keywordMatch: number;    // default: 2
  positionBonus: number;    // default: 0.1
}
```

### 5. Prompt Builder (`llm/promptBuilder.ts`)

Sistema de template seguro com validação:

```typescript
// Uso básico
const prompt = buildPrompt(
  'Olá {{nome}}, você tem {{quantidade}} mensagens',
  { nome: 'Usuário', quantidade: 5 }
);
// Resultado: "Olá Usuário, você tem 5 mensagens"

// Validação de segurança
checkPromptSafety('Prompt com {{variavel}}'); 
// Lança erro se houver placeholder não substituído
```

### 6. Auto Tagger (`llm/autoTagger.ts`)

Gera estrutura semântica usando LLM:

```typescript
interface SemanticStructure {
  tokens: string[];        // Tokens importantes
  keywords: string[];      // 5-10 palavras-chave
  tags: string[];          // 3-7 tags
  categoria: string;       // Categoria principal
  subcategoria: string;    // Subcategoria
  relacoes: string[];     // Entidades relacionadas
}
```

Fluxo:
1. Envia prompt para LLM com contexto completo
2. LLM retorna JSON com estrutura semântica
3. Fallback para tokenização se LLM falhar

### 7. LLM Re-ranker (`llm/llmReranker.ts`)

Re-ordena resultados usando LLM:
- Envia top 5-10 documentos para o LLM
- LLM atribui scores de 0-10
- Retorna documentos re-ordenados

### 8. Search Engine (`pipeline/searchEngine.ts`)

Motor de busca principal que orquestra todos os componentes:

```typescript
const engine = createSearchEngine({
  useLLM: false,           // Usar LLM para auto-tagging
  useRerank: false,        // Usar re-ranking
  synonyms: {}              // Sinônimos customizados
});

// Indexar documentos
await engine.indexDocument({
  id: '1',
  title: 'Machine Learning Basics',
  content: 'Machine learning is...'
});

// Buscar
const results = await engine.search('machine learning', {
  limit: 10,
  offset: 0,
  expandSynonyms: true,
  minScore: 0
});
```

## Sistema Híbrido Search + Graph-RAG

O sistema agora integra busca semântica com o grafo cognitivo para fornecer resultados mais rico semanticamente.

### Componentes de Integração

#### 1. Graph Adapter (`graph/graphAdapter.ts`)

Adapter que expõe interface simples para o CognitiveMemory:

```typescript
interface GraphAdapterInterface {
  getNodeByTerm(term: string): Promise<GraphNode | null>;
  getRelatedNodes(term: string): Promise<GraphNode[]>;
  getNodeEmbedding(term: string): Promise<number[] | null>;
  getRelatedTerms(term: string): Promise<string[]>;
  syncTagsToGraph(tags: string[], docId: string): Promise<void>;
  syncRelationsToGraph(relations: string[], docId: string): Promise<void>;
}
```

#### 2. Semantic Graph Bridge (`graph/semanticGraphBridge.ts`)

Ponte entre busca e grafo cognitivo:

```typescript
class SemanticGraphBridge {
  // Expande termos via relações do grafo
  expandWithGraph(terms: string[], options): Promise<ExpansionResult>;
  
  // Enriquece documento com dados do grafo
  enrichDocument(docId, docTags, docKeywords): Promise<GraphEnrichmentResult>;
  
  // Calcula score baseado em conexões
  calculateGraphScore(docTags, graphTerms, graphNodes): number;
  
  // Sincroniza tags/relações do autoTagger para o grafo
  syncDocumentRelations(docId, tags, relations): Promise<void>;
}
```

### Fluxo de Busca Híbrido

```
1. Normalizar query
   ↓
2. Expandir sinônimos (local)
   ↓
3. EXPANSÃO VIA GRAFO (NOVO)
   - Para cada termo, buscar nós relacionados no grafo
   - Adicionar termos relacionados à query
   - Evitar duplicação com cache
   ↓
4. Buscar no índice invertido
   ↓
5. Calcular scores híbridos:
   - titleMatch * 1
   - tagMatch * 3
   - graphRelationMatch * 2
   - semanticBoost (baseado em conexões)
   ↓
6. Opcional: Re-ranking com LLM
   ↓
7. Retornar top resultados
```

### Configuração de Pesos

```typescript
interface ScoringWeights {
  titleMatch: number;        // default: 10
  contentMatch: number;      // default: 1
  tagMatch: number;          // default: 5
  categoryMatch: number;    // default: 3
  keywordMatch: number;     // default: 2
  positionBonus: number;    // default: 0.1
  graphRelationMatch: number; // default: 2 (NOVO)
}
```

### Modo Debug

Para debugging, adicione `debug: true` na busca:

```typescript
const results = await engine.search('machine learning', { debug: true });

results.forEach(r => {
  console.log(r.debugInfo.expandedTerms);   // Termos expandidos
  console.log(r.debugInfo.graphTerms);       // Termos do grafo
  console.log(r.debugInfo.scoreBreakdown);   // Detalhamento de scores
  // {
  //   tokenMatch: 5,
  //   tagMatch: 15,
  //   graphRelationMatch: 4,
  //   semanticBoost: 0.4
  // }
});
```

## Sinônimos Padrão

```typescript
const DEFAULT_SYNONYMS = {
  ' IA ': ['inteligência artificial', 'machine learning', 'ml', 'deep learning'],
  'ai': ['inteligência artificial', 'machine learning'],
  'computador': ['computadora', 'pc', 'notebook'],
  'software': ['programa', 'aplicativo', 'app'],
  // ... mais sinônimos
};
```

## Uso

```typescript
import { 
  createSearchEngine,
  buildPrompt,
  checkPromptSafety,
  tokenize,
  normalize
} from './search';

// 1. Criar motor de busca
const engine = createSearchEngine();

// 2. Indexar documentos
await engine.indexDocument({
  id: 'doc1',
  title: 'Introdução ao Machine Learning',
  content: 'Machine learning é um ramo da inteligência artificial...'
});

// 3. Buscar
const results = await engine.search('inteligência artificial');

// 4. Ver resultados
results.forEach(r => {
  console.log(r.doc.title, r.score);
});

// 5. Estatísticas
console.log(engine.getStats());
```

## Extensões Futuras

- Integração com vector embeddings para RAG híbrido
- Cache de embeddings para performance
- Indexação incremental
- Suporte a múltiplos idiomas
