# Plano de Simplificação do Sistema de Decisão do IalClaw

## Problema Atual

4 camadas de decisão se conflitam e bloqueiam a execução:
- TaskClassifier → ActionRouter → DecisionEngine → CognitiveOrchestrator
- 9.120 linhas de código só nos arquivos de decisão
- 8+ fixes pontuais que não resolveram o problema fundamental

## Princípio

**O LLM decide. O sistema executa. Apenas protege contra destruição.**

## Arquitetura Simplificada

### Antes (Complexo)
```
Input → TaskClassifier → ActionRouter → DecisionEngine → CognitiveOrchestrator → AgentLoop
         (1049 linhas)    (266 linhas)    (290 linhas)      (2256 linhas)        (3628 linhas)
```

### Depois (Simples)
```
Input → SimpleClassifier → AgentLoop
         (decide: EXECUTE ou DIRECT_REPLY)
         (+ SafetyGuard: bloquear ações destrutivas)
```

## Regras do SimpleClassifier

1. **Pedido claro → EXECUTE** (usa tools)
   - Instalar, criar, gerar, enviar, converter, buscar, executar
   - Áudio, voz, TTS, arquivo, pesquisa

2. **Pergunta → DIRECT_REPLY** (LLM responde)
   - O que é, como funciona, qual o preço, etc.
   - Continuação de conversa (se tem contexto)

3. **Ação destrutiva → CONFIRM** (pede confirmação)
   - rm -rf, sudo, delete, drop, format
   - Apenas essas pedem confirmação

4. **Contexto sempre disponível**
   - lastResult da conversa anterior
   - Se o usuário continua o assunto, mantém o contexto

## Mudanças

### Remover (simplificar)
- CognitiveOrchestrator (2256 linhas) → SimpleOrchestrator (~200 linhas)
- DecisionEngine (290 linhas) → integrado no SimpleClassifier
- ActionRouter (266 linhas) → integrado no SimpleClassifier
- TaskClassifier (1049 linhas) → SimpleClassifier (~300 linhas)

### Manter
- AgentLoop (3628 linhas) → simplificado
- AgentController (1631 linhas) → simplificado
- IntentionResolver → simplificado (apenas SMALL_TALK e CONFIRM)

### Novo Fluxo
```
Input
  ↓
SimpleClassifier.classify(input, context)
  ↓
  ├─ EXECUTE → AgentLoop (com tools)
  ├─ DIRECT_REPLY → LLM direto
  └─ CONFIRM → pede confirmação (só para ações destrutivas)
```

## Implementação

### Fase 1: Criar SimpleClassifier
- Classificação em 3 categorias: EXECUTE, DIRECT_REPLY, CONFIRM
- Keywords + heurística simples
- Sem confidence score complexo

### Fase 2: Simplificar AgentLoop
- Remover short-circuit de content_generation
- Remover governance complexo
- Manter apenas safety guard

### Fase 3: Remover camadas antigas
- CognitiveOrchestrator → SimpleOrchestrator
- DecisionEngine → integrado no SimpleClassifier
- ActionRouter → integrado no SimpleClassifier
- TaskClassifier → SimpleClassifier

### Fase 4: Manter contexto
- lastResult sempre disponível
- Se input é continuação, usar contexto anterior
- Se input é novo assunto, classificar normalmente

## Resultado Esperado

- ~90% menos código de decisão
- LLM decide o que fazer
- Sistema apenas protege contra destruição
- Contexto mantido entre mensagens
- Respostas em vez de "Não tenho certeza"