# KB-045 - Governança de iniciação de flow pelo Orchestrator

Data: 2026-04-04
Escopo: conectar o início de flows guiados ao runtime principal sob autoridade explícita do CognitiveOrchestrator.
Regra central: o Orchestrator decide quando iniciar flow; o executor apenas instancia e persiste o estado.

## Problema original

`FlowManager.startFlow()` existia, mas permanecia isolado em `AgentRouterExample.ts`, fora do runtime real.
Com isso, o sistema principal não possuía caminho para:

- decidir o início de um flow no Orchestrator
- executar esse início no executor
- persistir `session.flow_state` já no primeiro passo

Isso mantinha uma lacuna arquitetural pós KB-021: havia governança para continuidade de flow ativo, mas não para o evento de início.

## Critério de pronto

- Orchestrator decide início de flow via decisão explícita
- executor chama `startFlow()` sem heurística local
- `session.flow_state` é atualizado no início

## Implementação

### Fase 1 — contrato mínimo

- `CognitiveStrategy.START_FLOW` adicionado em `CognitiveOrchestrator`
- `flowId?: string` adicionado em `CognitiveDecision`
- `decideFlowStart(sessionId, text)` criado inicialmente em safe mode (`undefined`)

### Fase 2 — decisão no Orchestrator

- `CognitiveOrchestrator.decide()` passou a avaliar `decideFlowStart()` logo após a governança de flow ativo
- `decideFlowStart()` reutiliza `FlowRegistry.list()` e detecta o caso atualmente suportado (`html_slides`) sem criar router paralelo
- quando elegível, o Orchestrator retorna `{ strategy: START_FLOW, flowId }`

### Fase 3 — execução no executor

- `CognitiveActionExecutor` ganhou `case CognitiveStrategy.START_FLOW`
- `executeStartFlow()` resolve o flow com `FlowRegistry.get(decision.flowId)`
- o executor chama `flowManager.startFlow(flow, {}, flow.id)` sem heurística local
- `session.flow_state` é sincronizado imediatamente após o start
- histórico e memória recebem o prompt inicial do flow

### Fase 4 — consistência e i18n

- `HtmlSlidesFlow.id` foi alinhado para `html_slides`, igual ao ID do registry
- isso evita estado órfão na retomada via `FlowRegistry.get(session.flow_state.flowId)`
- chaves i18n adicionadas:
  - `flow.start.initiated`
  - `flow.start.not_found`

## Arquivos alterados

- src/core/orchestrator/CognitiveOrchestrator.ts
- src/core/orchestrator/CognitiveActionExecutor.ts
- src/core/flow/flows/HtmlSlidesFlow.ts
- src/i18n/pt-BR.json
- src/i18n/en-US.json
- src/tests/run.ts
- docs/architecture/kanban/Pendente/problemas_criticos.md
- docs/architecture/kanban/concluido.md
- docs/architecture/kanban/mapa_problemas_sistema.md
- docs/architecture/kanban/historico/checklist_vivo.md

## Invariantes preservados

- nenhuma heurística de início de flow foi adicionada ao executor
- não foi criado router paralelo fora do Orchestrator
- continuidade de flow ativo continuou na seção de governança já existente
- fallback de fluxos não encontrados continua explícito e auditável

## Validação

- `npx.cmd tsc --noEmit` -> sucesso
- `npm.cmd test` -> sucesso
- regressão adicionada em `src/tests/run.ts` cobrindo:
  - decisão `START_FLOW`
  - `flowId = html_slides`
  - prompt inicial do flow
  - persistência de `session.flow_state`
  - reidratação possível via `FlowRegistry.get(session.flow_state.flowId)`

## Riscos residuais

- a detecção de início de flow ainda cobre explicitamente o caso de `html_slides`; novos flows devem ser adicionados pelo mesmo caminho governado no Orchestrator
- o encerramento do flow continua dependente do contrato atual de `FlowManager.handleInput()` e do ciclo já existente no executor