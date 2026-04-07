# KB-050 - Plano de Governanca Semantica de Capabilities

## 1) Contexto

Este plano define a evolucao do fluxo de capacidades para um modelo de governanca semantica compativel com Single Brain, sem criar mini-brain local no loader/manager.

Pipeline alvo:

```txt
RAW (frontmatter livre)
  -> Normalizacao (string -> formato padrao)
  -> Canonicalizacao (alias -> capability oficial)
  -> Validacao (known vs unknown)
  -> Indexacao (SkillManager)
```

Objetivo principal: remover ambiguidade semantica de capabilities sem quebrar plugabilidade de skills.

## 2) Regra Critica Antes da Implementacao (Reuso Obrigatorio)

Antes de codar, executar levantamento para evitar duplicacao:

- [ ] Verificar normalizacao ja existente em [src/utils](src/utils)
- [ ] Verificar mapeamentos de capability ja existentes em [src/capabilities](src/capabilities)
- [ ] Verificar validacao/indexacao atual no loader/manager de skills em [src/skills](src/skills)
- [ ] Verificar se ja existe diagnostico de unknown capabilities em [src/skills](src/skills)
- [ ] Registrar decisoes de reuso (o que foi reaproveitado e o que foi criado)

Regra de ouro:

- Se existir equivalente, reutilizar.
- Nao recriar fluxo paralelo com outro nome.

## 3) Escopo Desta Etapa (Obrigatorio)

Implementar apenas a etapa KB-050:

- Introduzir contrato canonico de capabilities (registry + alias map)
- Integrar canonicalizacao no ponto de carga de skills
- Preservar valores raw para auditoria
- Emitir diagnostico de unknown sem bloquear runtime

Fora de escopo nesta etapa:

- Bloqueio hard-fail para capability unknown
- Refatoracao ampla de todo o subsistema de skills
- Mudanca de heuristicas de decisao do Orchestrator

## 4) Estrategia de Refatoracao (Estrutural, sem mudar comportamento)

Regra: refatorar por funcao, incrementalmente.

Ordem obrigatoria em cada funcao alterada:

1. Identificar trechos cognitivos versus tecnicos
2. Separar transformacao semantica em helper dedicado
3. Manter execucao tecnica local (loader/manager)
4. Substituir string livre por resultado canonicalizado
5. Adicionar TODO explicito para governanca futura no Orchestrator
6. Compilar apos cada micro-etapa

Restricoes:

- Nao alterar comportamento funcional esperado
- Nao remover branches existentes de fallback
- Nao criar decisor paralelo ao Orchestrator

## 5) Desenho da Solucao em 3 Camadas

### Camada 1 - Padronizacao (Vocabulario Canonico)

Criar um registry estruturado, nao apenas lista de strings.

Arquivo alvo sugerido: [src/capabilities/capabilityRegistry.ts](src/capabilities/capabilityRegistry.ts)

Contrato:

- `CANONICAL_CAPABILITIES` como fonte unica de verdade
- `CanonicalCapability = keyof typeof CANONICAL_CAPABILITIES`
- Metadata inicial: `description`, `category`
- Extensivel para `risk`, `priority`, `installPolicy`

### Camada 2 - Normalizacao + Canonicalizacao

Criar um mapa de aliases e um canonicalizador deterministico.

Arquivos alvo sugeridos:

- [src/capabilities/capabilityAliasMap.ts](src/capabilities/capabilityAliasMap.ts)
- [src/capabilities/canonicalizeCapability.ts](src/capabilities/canonicalizeCapability.ts)

Contrato minimo:

- `normalize(raw)` aplica lowercase, trim e normalizacao de separadores
- `canonicalizeCapability(raw)` retorna:
  - `canonical`
  - `isCanonical`
  - `isKnown`
  - `isUnknown`

Tipo recomendado:

```ts
type CapabilityResult = {
  canonical: string;
  isCanonical: boolean;
  isKnown: boolean;
  isUnknown: boolean;
};
```

### Camada 3 - Validacao com Governanca (no ponto certo)

Integrar no loader de skills (ponto de entrada das capabilities do frontmatter).

Comportamento esperado:

- Capability conhecida: indexa canonical
- Capability alias conhecida: indexa canonical + registra raw para auditoria
- Capability desconhecida: NAO indexa no capability index, registra em auditoria com warning estruturado, sem quebrar sistema

Regra de seguranca semantica:

- Unknown nao pode virar "quase-canonico" no index.
- Unknown fica somente em trilha de auditoria/diagnostico.

Representacao recomendada para auditoria:

```ts
{
  raw: "browser nav",
  normalized: "browser_nav",
  canonical: "browser_execution",
  isKnown: true,
  isUnknown: false,
  timestamp: "2026-04-07T00:00:00.000Z",
  source: "skill_frontmatter",
  skillId: "..."
}
```

Fluxo recomendado no loader para unknown:

```ts
if (!result.isKnown) {
  capabilityAuditLog.push({
    raw,
    normalized,
    canonical: result.canonical,
    isKnown: false,
    isUnknown: true,
    source: "skill_frontmatter",
    skillId,
    timestamp: new Date().toISOString()
  });
  continue; // Nao indexa unknown
}
```

## 6) Camada Extra Recomendada - Diagnostics

Adicionar observabilidade no manager:

- `getUnknownCapabilities(): string[]`
- `getCapabilityAuditLog()`
- `getUnusedCapabilities(): string[]`

Separacao obrigatoria de responsabilidades:

- `capabilityIndex`: somente capacidades canonical conhecidas
- `capabilityAuditLog`: trilha completa de entrada semantica (canonical, alias, unknown)

Formato minimo do `capabilityAuditLog`:

```ts
{
  skillId: string;
  raw: string;
  normalized: string;
  canonical: string;
  isKnown: boolean;
  isUnknown: boolean;
  source: "skill_frontmatter";
  timestamp: string;
}
```

Protecao contra conflito de alias (critico):

- Adicionar `validateAliasMap()` no startup de skills e no CI.
- Falhar build quando o mesmo alias apontar para canonicos diferentes.

Exemplo:

```ts
function validateAliasMap() {
  const seen: Record<string, string> = {};
  for (const [alias, canonical] of Object.entries(CAPABILITY_ALIASES)) {
    if (seen[alias] && seen[alias] !== canonical) {
      throw new Error(`Alias conflitante: ${alias}`);
    }
    seen[alias] = canonical;
  }
}
```

Objetivo:

- Identificar drift semantico
- Dar base para politica futura de endurecimento em CI

## 7) Plano de Implementacao Incremental

Fase 0 - Levantamento e Reuso

- [ ] Mapear pontos de normalizacao ja existentes
- [ ] Mapear ponto exato de ingestao no skill loader
- [ ] Mapear consumidores do indice de capabilities

Fase 1 - Estrutura Minima

- [ ] Criar `capabilityRegistry.ts` com capacidades canonicas iniciais
- [ ] Criar `capabilityAliasMap.ts` com aliases baseline
- [ ] Criar `canonicalizeCapability.ts` com assinatura e retorno minimo
- [ ] Criar `validateAliasMap()` e executar em bootstrap de skills
- [ ] `npx tsc --noEmit`

Fase 2 - Integracao no Loader

- [ ] Substituir push de string bruta por canonicalizacao
- [ ] Preservar raw para auditoria
- [ ] Garantir que unknown NAO entra no `capabilityIndex`
- [ ] Logar `unknown_capability_detected` (warning)
- [ ] `npx tsc --noEmit`

Fase 3 - Diagnostics

- [ ] Expor `getUnknownCapabilities()` no manager
- [ ] Expor `getCapabilityAuditLog()` no manager
- [ ] Expor `getUnusedCapabilities()` no manager
- [ ] Adicionar cobertura de testes para canonical/alias/unknown/mixed
- [ ] `npx tsc --noEmit`

Fase 4 - Gate de Qualidade

- [ ] Criar script `scripts/validateCapabilities.ts` (ou .js)
- [ ] Incluir validacao de conflito de alias no script
- [ ] Regra DEV: warning
- [ ] Regra CI: fail com unknown nao aprovado

## 8) Checklist de Validacao Avancada (Obrigatorio)

1. Inconsistencias

- [ ] Nao ha contradicao entre registry, aliases e index

2. Duplicacoes

- [ ] Nao ha normalizador paralelo em outro modulo

3. Melhorias seguras

- [ ] Pontos de consolidacao futura no Orchestrator documentados

4. Riscos arquiteturais

- [ ] Nenhum bypass de autoridade cognitiva foi criado

5. Coerencia de autoridade

- [ ] Loader/Manager executam; nao decidem politica global

6. Governanca de invariantes (KB-048)

- [ ] Mudanca nao interfere no Gate Final (`consolidateAndReturn`)
- [ ] Mudanca nao cria caminho paralelo de decisao

7. Conflitos reais

- [ ] Alias ambiguo mapeado para mais de uma canonical capability bloqueia startup/CI
- [ ] Divergencia entre capability inferida e capability indexada
- [ ] Conflitos silenciosos registrados em diagnostico

8. Fronteira de autoridade (Single Brain)

- [ ] Orchestrator NAO interpreta normalizacao/canonicalizacao
- [ ] Loader/Manager apenas transformam/indexam/auditam

## 9) i18n (Obrigatorio)

Regras para esta etapa:

- Nao introduzir string hardcoded em mensagens ao usuario
- Logs/eventos externos relevantes devem usar chaves i18n quando aplicavel
- Se houver novas mensagens de erro/diagnostico expostas: adicionar em
  - [src/i18n/pt-BR.json](src/i18n/pt-BR.json)
  - [src/i18n/en-US.json](src/i18n/en-US.json)

Checklist i18n:

- [ ] Chaves adicionadas em pt-BR
- [ ] Chaves adicionadas em en-US
- [ ] Hardcoded substituido por `t()` quando mensagem for user-facing
- [ ] `npx tsc --noEmit` sem erros

## 10) Safe Mode (Obrigatorio)

Manter o padrao de fallback existente em pontos de decisao conectados ao Orchestrator:

```ts
finalDecision = orchestratorDecision ?? localDecision
```

Observacao: KB-050 nao deve ativar nova autoridade cognitiva nesta etapa; apenas preparar governanca semantica de capacidades.

Regra adicional:

- Proibido mover decisao de unknown/alias para o Orchestrator nesta etapa.

## 11) Checklist Kanban V2.0 (Obrigatorio)

- [ ] Pendente: remover card correspondente em docs/architecture/kanban/Pendente
- [ ] Andamento: registrar trilha em docs/architecture/kanban/Em_Andamento/em_andamento.md
- [ ] Testes: registrar evidencias em docs/architecture/kanban/Testes/testes.md
- [ ] Concluido: registrar em docs/architecture/kanban/Concluido/concluido.md apos gate final
- [ ] Mapa: atualizar docs/architecture/kanban/mapa_problemas_sistema.md

## 12) Criterio de Pronto (Definition of Done)

- [ ] Pipeline RAW -> normalize -> canonicalize -> validate -> index ativo no loader
- [ ] Auditoria preserva `raw` e `canonical`
- [ ] Unknown capability gera warning observavel, sem hard fail e sem poluir `capabilityIndex`
- [ ] `capabilityIndex` e `capabilityAuditLog` estao separados
- [ ] Testes cobrindo canonical direto, alias, unknown e mixed
- [ ] Tipagem canonica eliminando string solta em pontos centrais
- [ ] Build TypeScript limpo
