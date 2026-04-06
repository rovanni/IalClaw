# PLANO DE CORRECAO - KB-046

Data: 6 de abril de 2026
Status: Em andamento
Risco: Medio
Escopo: modularizacao governada do CognitiveOrchestrator sem alterar comportamento

---

## CONTEXTO

Esta etapa fecha o gap entre a refatoracao tecnica ja iniciada no `CognitiveOrchestrator` e o sistema formal de governanca arquitetural.

Estado atual validado antes deste plano:

- a extracao de `decidePlanningStrategy(...)` e `decideCapabilityFallback(...)` ja foi iniciada de forma incremental
- a mudanca e estrutural, nao funcional
- foi detectada duplicacao de contratos entre `CognitiveOrchestrator.ts` e `src/core/orchestrator/decisions/planning/decidePlanningStrategy.ts`
- nao existia ainda plano formal, sincronizacao de kanban nem validacao arquitetural documentada para esta etapa

Definicao de pronto do KB-046:

- modularizacao rastreada por plano formal em `docs/architecture/plans/`
- tipos compartilhados reutilizados, sem duplicacao entre modulos
- kanban sincronizado com status, evidencias e impacto arquitetural
- validacao formal registrada com inconsistencias, conflitos e autoridade

---

## DIAGNOSTICO ARQUITETURAL

Problema nuclear:

- a refatoracao estava tecnicamente segura, mas sem fechar o gate documental exigido pelo template

Gaps reais identificados:

- ausencia de plano formal para a mudanca
- ausencia de sincronizacao do kanban operacional
- duplicacao de `CapabilityAwarePlan` e `PlanningStrategyContext`
- validacao arquitetural nao registrada como artefato auditavel

Risco:

- codigo correto com arquitetura invisivel
- perda de rastreabilidade sobre a modularizacao do cerebro central
- reintroducao futura de contratos paralelos por falta de fonte unica

Observacao de rastreabilidade:

- `KB-028` ja esta ocupado no kanban para `src/services`
- esta modularizacao recebe o identificador `KB-046` para evitar colisao documental

---

## REGRA CRITICA - VERIFICAR ANTES DE IMPLEMENTAR

Antes de alterar codigo:

- verificar se contratos equivalentes ja existem no Orchestrator
- reutilizar tipos compartilhados em vez de recriar aliases locais
- preservar Safe Mode e semantica atual das decisoes
- manter a autoridade final no `CognitiveOrchestrator`

Proibido:

- criar novo mini-brain em modulos auxiliares
- alterar heuristicas ou comportamento funcional junto com a modularizacao
- reusar identificador de KB ja ocupado no kanban

---

## OBJETIVO

Reduzir complexidade estrutural do `CognitiveOrchestrator` sem alterar comportamento, fechando o gate de governanca exigido pelo template.

---

## ESCOPO

Incluido nesta etapa:

- extracao e centralizacao dos tipos de planejamento compartilhados
- alinhamento de imports entre Orchestrator e modulo de decisao
- criacao do plano formal desta mudanca
- sincronizacao de `em_andamento.md`, `testes.md` e `mapa_problemas_sistema.md`

Fora de escopo:

- alterar heuristicas de planejamento
- ativar novas decisoes fora das ja existentes
- reorganizar todo o arquivo `CognitiveOrchestrator.ts`

---

## FASES TECNICAS E CHECKLIST

### FASE 1 - Governanca formal

Acoes:

- criar plano oficial do KB-046
- registrar status em `Em_Andamento`
- registrar evidencias e criterio de validacao em `Testes`
- refletir impacto no mapa de problemas

Checklist:

- [x] plano formal criado
- [x] kanban sincronizado
- [x] validacao documentada

### FASE 2 - Reutilizacao de contratos

Acoes:

- criar `src/core/orchestrator/types/PlanningTypes.ts`
- mover `CapabilityAwarePlan`
- mover `PlanningStrategyContext`
- importar contratos compartilhados nos pontos consumidores

Checklist:

- [x] tipos compartilhados centralizados
- [x] duplicacao removida
- [x] comportamento preservado

### FASE 3 - Validacao

Acoes:

- validar compilacao TypeScript
- garantir ausencia de regressao estrutural imediata
- registrar resultado documental

Checklist:

- [x] `npx tsc --noEmit` sem erros
- [x] evidencias sincronizadas no kanban

---

## RISCOS

- quebrar imports durante a centralizacao de tipos
- perder contexto de autoridade ao extrair contratos
- colidir com KB ja existente no kanban

## MITIGACOES

- extracao minima apenas de contratos compartilhados
- nenhuma mudanca de heuristica ou branch decisoria
- uso de novo identificador documental (`KB-046`)

---

## SAFE MODE

Padrao obrigatorio mantido:

`finalDecision = orchestratorDecision ?? localDecision`

Nesta etapa, a modularizacao nao altera esse comportamento.

---

## VALIDACAO FORMAL

### Inconsistencias

- antes da correcao existia duplicacao de contratos de planejamento
- apos a centralizacao, a fonte de verdade passa a ser `src/core/orchestrator/types/PlanningTypes.ts`

### Conflitos

- nenhum conflito novo de autoridade foi introduzido
- nenhum conflito entre strategy module e Orchestrator foi identificado nesta etapa

### Autoridade

- o `CognitiveOrchestrator` continua como unico decisor
- os modulos extraidos permanecem como funcoes auxiliares sem autoridade propria

### Melhoria segura aplicada

- modularizacao com reutilizacao de tipos, sem mudanca funcional

---

## CRITERIO DE ACEITE

KB-046 sera considerado fechado quando:

- existir plano formal para a modularizacao
- a duplicacao de tipos tiver sido removida
- `npx tsc --noEmit` passar sem erro atribuivel a esta etapa
- kanban e mapa de problemas estiverem sincronizados
