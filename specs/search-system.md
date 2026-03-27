# Sistema de Busca Semântica - Especificação Técnica

## Visão Geral

Sistema de busca semântica baseado em **indexação inteligente** sem uso de embeddings ou vector databases. Implementa busca por índice invertido com re-ranking opcional via LLM.

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

## Fluxo de Busca

```
1. Normalizar query
   ↓
2. Expandir sinônimos (local)
   ↓
3. Buscar no índice invertido
   ↓
4. Calcular scores (title > tag > keyword > content)
   ↓
5. Opcional: Re-ranking com LLM
   ↓
6. Retornar top resultados
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
