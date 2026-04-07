# KB-048 — Memory Introspection Layer

O sistema atualmente apresenta "incerteza cognitiva" ao receber perguntas simples sobre sua própria memória (ex: "isso está na sua memória?", "o que você sabe sobre mim?"). Isso ocorre porque essas perguntas são tratadas como requisições de informação genéricas, caindo em fallbacks de baixa confiança.

Este plano implementa uma **Camada de Introspecção de Memória** que detecta explicitamente essas intenções e roteia para uma resposta direta baseada no estado real da memória.

## User Review Required

> [!IMPORTANT]
> O plano introduz um novo caminho de alta precedência no `CognitiveOrchestrator`. Ele priorizará padrões de checagem de memória sobre a classificação de tarefas genérica para esses casos específicos.

> [!NOTE]
> Usaremos heurísticas simples (regex) para detecção inicial para garantir velocidade e 100% de previsibilidade para padrões comuns de introspecção.

## Proposed Changes

### Core: Intent Layer

#### [MODIFY] [IntentionResolver.ts](file:///d:/IA/IalClaw/src/core/agent/IntentionResolver.ts)
- Adicionar novos tipos de intenção: `MEMORY_QUERY`, `MEMORY_STORE`, `MEMORY_CHECK`.
- Implementar padrões regex para detectar "lembra", "sabe de mim", "armazenou", "na memória", etc.
- Padrão sugerido: `/\b(você|voce|está|tem|foi|posso)\b.*\b(lembr\w+|memória|registrado|armazenado|sabe)\b/i`.

---

### Core: Orchestrator Layer

#### [MODIFY] [CognitiveOrchestrator.ts](file:///d:/IA/IalClaw/src/core/orchestrator/CognitiveOrchestrator.ts)
- Integrar a introspecção de memória no método `decide`.
- Tratar as intenções de memória ANTES do processamento "Normal" (Passo 2.5).
- Usar a nova lógica `decideMemoryQuery` para fornecer feedback direto.

#### [NEW] [decideMemoryQuery.ts](file:///d:/IA/IalClaw/src/core/orchestrator/decisions/memory/decideMemoryQuery.ts)
- Implementar a lógica para:
  1. Identificar o objeto da consulta (palavras-chave).
  2. Realizar busca direcionada no `MemoryService`.
  3. Formular uma decisão com `CognitiveStrategy.LLM`, alta confiança e razão `memory_introspection_result`.

---

### Shared: I18n

#### [MODIFY] [pt-BR.json](file:///d:/IA/IalClaw/src/i18n/pt-BR.json)
- Adicionar chaves para feedback de introspecção de memória.

---

## Open Questions

- **Estilo de Resposta**: O sistema deve ser extremamente breve ("Sim, eu tenho isso.") ou detalhado ("Sim, lembro que você mencionou 0.38 PAXG.")? Pretendo usar "detalhado" quando um match específico for encontrado.

## Verification Plan

### Automated Tests
- Criar `tests/KB048_memory_introspection.test.ts` para verificar:
  - Detecção das intenções de introspecção.
  - Roteamento correto no Orchestrator.
  - Níveis de confiança para perguntas de memória.

### Manual Verification
- Testar com frases como:
  - "O que você sabe sobre meu saldo?"
  - "Isso está gravado na sua memória?"
  - "Você lembra do que eu te falei sobre o PAXG?"
