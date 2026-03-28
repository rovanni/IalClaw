# Autonomy Module

Motor de decisão de autonomia: decide quando o agente deve EXECUTAR, PERGUNTAR ou CONFIRMAR.

## Filosofia

> "Não basta saber o que fazer — precisa saber quando fazer sem pedir permissão."

Sem isso:
- Agente vira passivo ❌
- Ou vira perigoso ❌

Com isso:
- Agente vira confiável ✅

## Uso

### Decisão Básica

```typescript
import { decideAutonomy, createAutonomyContext, AutonomyDecision } from './autonomy';

// Caso: git push (seguro, continuação, parâmetros completos)
const ctx = createAutonomyContext('git_push', {
    isContinuation: true,
    hasAllParams: true
});

const decision = decideAutonomy(ctx);
// → AutonomyDecision.EXECUTE

if (decision === AutonomyDecision.EXECUTE) {
    await exec('git push origin main');
}
```

### Caso: content_generation sem contexto

```typescript
const ctx = createAutonomyContext('content_generation', {
    hasAllParams: hasContentSource(input)  // false se não tem fonte
});

const decision = decideAutonomy(ctx);
// → AutonomyDecision.ASK

if (decision === AutonomyDecision.ASK) {
    return t('content.ask_for_source');
}
```

### Caso: comando destrutivo

```typescript
const ctx = createAutonomyContext('delete_database', {
    isDestructive: true
});

const decision = decideAutonomy(ctx);
// → AutonomyDecision.CONFIRM
```

## Regras de Decisão

| Condição | Decisão |
|----------|---------|
| Destrutivo OU risco alto | **CONFIRM** |
| Falta informação | **ASK** |
| Continuação + risco baixo | **EXECUTE** |
| Risco baixo | **EXECUTE** |
| Risco médio | **ASK** |
| Fallback | **ASK** |

## Helpers

```typescript
// Detectar risco
AutonomyHelpers.detectRisk('delete database'); // 'high'
AutonomyHelpers.detectRisk('git push');        // 'medium'
AutonomyHelpers.detectRisk('content_generation'); // 'low'

// Detectar destrutivo
AutonomyHelpers.isDestructiveCommand('rm -rf /'); // true
AutonomyHelpers.isDestructiveCommand('git push');  // false

// Detectar continuação
AutonomyHelpers.isContinuation('e para utilizar o arquivo X'); // true
AutonomyHelpers.isContinuation('criar slides'); // false
```

## Casos Cobertos

| Cenário | Decisão |
|---------|---------|
| "criar slides" (sem conteúdo) | ASK |
| "usar arquivo X" (continuação) | EXECUTE |
| "git push" | EXECUTE |
| "delete database" | CONFIRM |
| "instalar pacote" | EXECUTE (se params completos) |

## Extensão Futura

- DecisionMemory → ajustar decisões automaticamente
- Histórico de erro → reduzir autonomia
- Confiança → modular EXECUTE vs ASK