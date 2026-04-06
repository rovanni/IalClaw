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

Anti-patterns observados anteriormente:

- contratos duplicados inline entre Orchestrator e modulos auxiliares
- contextos definidos localmente dentro de modulos de decisao
- acoplamento implicito entre contrato local e decisao estrutural

Risco:

- codigo correto com arquitetura invisivel
- perda de rastreabilidade sobre a modularizacao do cerebro central
- reintroducao futura de contratos paralelos por falta de fonte unica

Observacao de rastreabilidade:

- `KB-028` ja esta ocupado no kanban para `src/services`
- esta modularizacao recebe o identificador `KB-046` para evitar colisao documental

Meta indireta desta etapa:

- reduzir complexidade estrutural percebida do `CognitiveOrchestrator`
- melhorar auditabilidade sem perseguir reducao agressiva de LOC nesta rodada

---

## REGRA CRITICA - VERIFICAR ANTES DE IMPLEMENTAR

Antes de alterar codigo:

- verificar se contratos equivalentes ja existem no Orchestrator
- reutilizar tipos compartilhados em vez de recriar aliases locais
- preservar Safe Mode e semantica atual das decisoes
- manter a autoridade final no `CognitiveOrchestrator`

Abortar a microetapa se:

- surgir conflito de autoridade entre modulo e Orchestrator
- surgir divergencia de comportamento em testes existentes
- a compatibilidade passar a exigir mudanca de heuristica

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

## PLANO ESTRATEGICO DE MODULARIZACAO

Arquivo oficial:

- `D:/IA/IalClaw/docs/architecture/plans/KB-046-PLANO.md`

Objetivo operacional:

- modularizar o `CognitiveOrchestrator` por contratos pequenos e auditaveis
- reduzir complexidade sem deslocar autoridade para modulos auxiliares
- manter o arquivo principal como hub de governanca, nao como concentrador de heuristicas duplicadas

Sequencia obrigatoria:

1. fechar governanca formal e contratos compartilhados
2. mapear blocos com fronteira clara e baixo risco
3. extrair apenas funcoes puras ou helpers sem autoridade propria
4. validar compilacao e rastreabilidade a cada microetapa
5. sincronizar kanban antes de expandir o escopo

---

## REGRA GERAL DE MODULARIZACAO

Diretriz obrigatoria desta etapa:

- nao priorizar funcoes grandes inteiras apenas por parecerem ter maior impacto
- priorizar blocos coesos e contratos pequenos, inclusive quando estiverem dentro de funcoes grandes
- tratar funcoes grandes apenas como contenedores de fronteiras internas extraiveis

Riscos de comecar por funcoes grandes inteiras:

- mistura de multiplos dominios na mesma extracao
- aumento do risco de quebrar authority
- diff grande e dificil de auditar
- regressao silenciosa
- perda de rastreabilidade

Abordagem correta nesta fase:

- comecar por funcoes pequenas isoladas quando existirem
- quando a fronteira estiver dentro de uma funcao grande, extrair apenas o bloco coeso
- evitar mover a funcao grande inteira no KB-046

Heuristica operacional:

- perguntar primeiro qual pedaco dessa funcao nao deveria continuar inline no Orchestrator
- so depois decidir se esse pedaco vira `types/`, `decisions/` ou helper puro

---

## ESTRATEGIA DE REFATORACAO

A refatoracao deve permanecer estrutural, nao funcional.

Granularidade obrigatoria:

- refatorar um dominio por vez
- preferir blocos coesos dentro de funcoes grandes em vez de mover a funcao inteira
- nao reescrever o `CognitiveOrchestrator.ts` inteiro
- nao combinar extracao estrutural com tuning de heuristica

Ordem obrigatoria por microetapa:

1. identificar o contrato reutilizavel
2. confirmar que o contrato nao decide sozinho
3. extrair implementacao para modulo ou arquivo de tipos
4. manter a chamada final no `CognitiveOrchestrator`
5. compilar
6. atualizar plano/kanban se a etapa mudar de estado

Restricoes desta etapa:

- nao mover `decide()` inteiro
- nao mover `resolveSignalAuthority`
- nao alterar `auditSignalConsistency`
- nao alterar Safe Mode
- nao usar tamanho da funcao como criterio principal de prioridade

Prioridade correta dos alvos:

- alta: bloco coeso dentro de funcao grande
- alta: funcao pequena isolada e puramente estrutural
- baixa nesta fase: funcao grande inteira

Checklist rapido para aprovar candidato:

- nao decide nada sozinho
- nao altera o fluxo principal
- nao depende de estado complexo
- pode virar funcao pura ou contrato compartilhado
- ja existe duplicacao, derivacao repetida ou fronteira semelhante em outro modulo

Se qualquer item acima falhar, abortar a extracao ou reduzir ainda mais o escopo.

---

## DOMINIOS MAPEADOS PARA EXTRAÇÃO

Base de mapeamento:

- `docs/architecture/plans/OrchestratorModularizationMapPhase1.md`

Blocos ja iniciados nesta etapa:

- planning decision
- capability fallback decision
- contratos compartilhados de planning

Blocos candidatos para etapas seguintes:

- helpers de decisao puros com fronteira clara e sem estado proprio
- tipos compartilhados adicionais hoje repetidos no arquivo principal
- modulos de decisao que ja existem mas ainda dependem de contratos inline
- blocos coesos de derivacao hoje embutidos em funcoes maiores do Orchestrator

Blocos que NAO entram agora:

- `decide()`
- `resolveSignalAuthority`
- `auditSignalConsistency`
- blocos de conciliacao entre signals com risco de conflito cruzado
- funcoes grandes inteiras apenas por concentraram muitas linhas

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

### FASE 4 - Consolidacao de fronteiras modulares

Acoes:

- revisar se os modulos extraidos continuam facts-first
- revisar se ainda existe contrato duplicado no `CognitiveOrchestrator`
- registrar proxima fronteira segura antes de nova extracao

Checklist:

- [x] nenhum novo contrato duplicado introduzido
- [x] fronteira seguinte definida sem conflito de autoridade
- [x] diff continua pequeno e auditavel

### FASE 5 - Preparacao para proxima rodada

Acoes:

- documentar proxima extracao segura no proprio plano
- manter o card em andamento enquanto houver modularizacao aberta
- mover para concluido apenas quando a rodada atual estiver fechada documentalmente

Checklist:

- [x] proxima rodada definida
- [x] nenhum gap documental restante
- [x] pronto para fechamento ou continuidade controlada

---

## STATUS OPERACIONAL DESTA SESSAO

- governanca formal aberta com o KB-046
- tipos de planning centralizados em `src/core/orchestrator/types/PlanningTypes.ts`
- contrato de `decideCapabilityFallback(...)` centralizado em `src/core/orchestrator/types/CapabilityFallbackTypes.ts`
- contrato de `decideRetryAfterFailure(...)` centralizado em `src/core/orchestrator/types/RetryAfterFailureTypes.ts`
- contrato de `ActiveDecisionsResult` centralizado em `src/core/orchestrator/types/ActiveDecisionsTypes.ts`
- contrato de `IngestedSignalSummary` centralizado em `src/core/orchestrator/types/IngestSignalsTypes.ts`
- `decidePlanningStrategy.ts` agora reutiliza contrato compartilhado
- `CapabilityAwarePlan` passou a carregar `hasGap` como estado derivado canonical do modulo de planning
- `CognitiveOrchestrator.ts` deixou de recalcular `hasGap` no path de planning e agora apenas consome a derivacao do modulo
- `decideCapabilityFallback.ts` agora reutiliza contrato compartilhado em vez de contexto inline
- `decideRetryAfterFailure.ts` agora concentra a derivacao estrutural de retry apos falha, mantendo authority resolution, safe mode e telemetria finais no `CognitiveOrchestrator`
- `buildActiveDecisionsResult.ts` agora concentra a montagem estrutural de `loop`, `applied` e `safeModeFallbackApplied`, mantendo as chamadas `decide*` no `CognitiveOrchestrator`
- `buildIngestedSignalSummary.ts` agora concentra o resumo factual inicial de `ingestSignalsFromLoop(...)`, mantendo no `CognitiveOrchestrator` a mutacao de estado e o logging por tipo de signal
- `CognitiveOrchestrator.ts` mantem a autoridade final e apenas delega computacao estrutural
- compilacao validada com `npx.cmd tsc --noEmit`

---

## CHECKLIST KANBAN V2.0

Ao concluir a rodada atual:

- [x] registrar rastreio em `docs/architecture/kanban/Em_Andamento/em_andamento.md`
- [x] registrar evidencias em `docs/architecture/kanban/Testes/testes.md`
- [x] atualizar status em `docs/architecture/kanban/mapa_problemas_sistema.md`
- [ ] registrar conclusao em `docs/architecture/kanban/Concluido/concluido.md`
- [ ] remover o card de `Em_Andamento` quando a rodada estiver fechada

---

## REGRAS ARQUITETURAIS

- o `CognitiveOrchestrator` continua como unico decisor
- modulos auxiliares nao podem introduzir estrategia propria
- contratos compartilhados devem ter fonte unica
- extracao modular nao pode reduzir auditabilidade
- nenhuma etapa pode reabrir split-brain no cerebro central

---

## I18N - OBRIGATORIO

Se uma rodada futura da modularizacao introduzir novas mensagens visiveis, logs externos ou erros:

- [ ] adicionar chaves em `src/i18n/pt-BR.json`
- [ ] adicionar chaves em `src/i18n/en-US.json`
- [ ] substituir strings hardcoded por `t()`
- [ ] validar `npx tsc --noEmit` apos a alteracao

Se nao houver novas mensagens:

- [x] registrar que a etapa foi estrutural e nao exigiu novas chaves

---

## REGRA DE IMPLEMENTACAO

Implementar incrementalmente:

1. escolher um bloco pequeno e isolado
2. extrair sem mudar heuristica
3. compilar
4. revisar rastreabilidade
5. atualizar plano/kanban
6. so entao iniciar a proxima extracao

Fluxo corrigido de microetapa:

1. identificar o contrato reutilizavel
2. confirmar que o contrato nao decide sozinho
3. extrair para o destino correto
4. atualizar imports consumidores
5. remover da origem imediatamente
6. compilar com `npx.cmd tsc --noEmit`
7. validar ausencia de duplicacao residual
8. atualizar plano e kanban

Proibido:

- modularizar varios dominios de alto risco no mesmo diff
- mover autoridade decisoria para fora do `CognitiveOrchestrator`
- misturar refactor estrutural com correcao funcional nao planejada

---

## REGRA CRITICA - POS-EXTRACAO (OBRIGATORIA)

Apos qualquer extracao de tipo, funcao ou contrato:

1. mover para o destino definido (`types/`, `decisions/` ou `modules/`)
2. atualizar todos os imports consumidores
3. validar compilacao com `npx.cmd tsc --noEmit`
4. remover completamente a implementacao original da origem
5. garantir que nao existe duplicacao residual
6. atualizar plano e kanban se a extracao alterar o estado da rodada

Proibido:

- manter copia temporaria na origem
- deixar alias equivalente coexistindo como fonte paralela
- manter codigo comentado como backup estrutural

Regra de ouro:

- deve existir exatamente uma fonte de verdade para cada contrato

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
- o contexto de capability fallback tambem deixou de existir como contrato inline no modulo auxiliar

### Conflitos

- nenhum conflito novo de autoridade foi introduzido
- nenhum conflito entre strategy module e Orchestrator foi identificado nesta etapa

### Autoridade

- o `CognitiveOrchestrator` continua como unico decisor
- os modulos extraidos permanecem como funcoes auxiliares sem autoridade propria

### Melhoria segura aplicada

- modularizacao com reutilizacao de tipos, sem mudanca funcional
- eliminacao de duplicacao de derivacao no fluxo de planning, mantendo o modulo como fonte unica de verdade
- extracao da derivacao pura de retry apos falha para modulo auxiliar sem deslocar a resolucao final de autoridade do Orchestrator
- extracao da montagem pura de `ActiveDecisionsResult` para helper auxiliar sem deslocar o disparo das decisoes ativas
- extracao do resumo factual de ingestao de signals para helper auxiliar sem deslocar a observacao passiva nem os logs por signal

### Verificacao estrutural

- contratos compartilhados foram centralizados sem criar fonte paralela
- a delegacao atual permanece sob chamada explicita do `CognitiveOrchestrator`
- nenhuma heuristica nova foi adicionada nesta rodada
- o Orchestrator nao recompõe mais `hasGap` no path de planning; apenas audita o valor derivado pelo modulo

---

## PROXIMA FRONTEIRA SEGURA

Fronteira definida para a rodada seguinte:

- revisar contratos inline restantes e blocos coesos de derivacao ainda embutidos em funcoes maiores do `CognitiveOrchestrator`
- priorizar apenas contextos puros e pequenos, sem estado e sem authority propria
- candidata anterior concluida: `RetryAfterFailureContext` agora possui fonte unica compartilhada com `decideRetryAfterFailure.ts`
- candidata atual concluida: `applyActiveDecisions(...)` agora delega a montagem estrutural para `buildActiveDecisionsResult.ts`
- candidata atual complementar concluida: `ingestSignalsFromLoop(...)` agora delega o resumo factual inicial para `buildIngestedSignalSummary.ts`
- proxima candidata segura: identificar um bloco pequeno que hoje apenas deriva dados ou monta contexto dentro de uma funcao maior, sem tocar em `resolveSignalAuthority`
- proibido nesta rodada: escolher uma funcao grande inteira como alvo apenas por volume ou impacto percebido

Condicoes obrigatorias antes da proxima extracao:

- diff pequeno e reversivel
- sem mover `decide()` nem funcoes de conciliacao de authority
- validacao com `npx.cmd tsc --noEmit`
- sincronizacao imediata do plano e do kanban

Criterios obrigatorios da candidata:

- nao possuir estado proprio
- nao influenciar authority
- nao exigir nova heuristica
- permitir limpeza imediata da origem apos a extracao
- representar um bloco coeso claramente separavel do restante da funcao hospedeira

---

## CRITERIO DE ACEITE

KB-046 sera considerado fechado quando:

- existir plano formal para a modularizacao
- a duplicacao de tipos tiver sido removida
- `npx tsc --noEmit` passar sem erro atribuivel a esta etapa
- kanban e mapa de problemas estiverem sincronizados

Critero de fechamento desta rodada:

- nenhum gap documental restante
- nenhuma duplicacao conhecida aberta no escopo imediato desta extracao
- proxima fronteira de modularizacao definida com risco controlado
