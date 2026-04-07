# Em andamento

- [ ] KB-001 - Externalizar healing loop do executor para governanca do Orchestrator (Fase 1+2)
  - Origem: problemas_criticos (Single Brain)
  - Risco: Alto
  - Status: Fase 1+2 aplicadas; consultas a decideRetryAfterFailure reduzidas de 8 para 4; stepCapabilities.test.ts migrado; compilacao global limpa; aguardando validacao em runtime para concluir.
  - Validacao detalhada: ver `docs/architecture/kanban/Testes/testes.md`.

- [ ] KB-011 - Monitorar logs de short-circuit em produção
  - Origem: checklist (o que esta em andamento)
  - Risco: Médio
  - Status: coletando evidencias de reducao de promessa sem execucao.
  - Validacao detalhada: ver `docs/architecture/kanban/Testes/testes.md`.

- [ ] KB-012 - Validar runtime de filesystem com meta.source
  - Origem: checklist (o que esta em andamento)
  - Risco: Médio
  - Status: aguardando rodada adicional em ambiente real.
  - Validacao detalhada: ver `docs/architecture/kanban/Testes/testes.md`.

- [ ] KB-024 - Centralizar ranking e estado de memoria no SessionManager (parcialmente mitigado, em migracao de autoridade)
  - Origem: problemas_criticos (Single Brain)
  - Risco: Critico
  - Status (ETAPA KB-024.1): concluida. execution memory migrada para estado session-scoped no SessionManager; ranking factual por sessao exposto pelo SessionManager e consumido pelo AgentLoop.
  - Status (ETAPA KB-024.2): adiada nesta fase para manter aderencia ao template. Orchestrator permanece passivo na selecao de tool e o loop permanece decisor em safe mode.
  - Proximo gate: concluir extracao facts-first e remocao de decisao local residual antes da validacao final de fechamento.
  - Validacao detalhada: ver `docs/architecture/kanban/Testes/testes.md`.

## Separacao de foco

### 1) Em andamento e pendente de validacao de testes
- KB-001
- KB-011
- KB-012
- KB-024
- Fonte unica de validacao: `docs/architecture/kanban/Testes/testes.md`

### 2) Em andamento e pendente de correcao/implementacao
- Nenhum card nesta faixa no momento.
- Regra de entrada: mover para esta faixa apenas quando houver implementacao aberta sem evidencia minima em runtime.

## Criterios operacionais (alinhados ao template)

- Reutilizar comportamento existente antes de criar novo fluxo local.
- Manter safe mode explicito nas decisoes (`orchestratorDecision ?? decisaoLocal`).
- Registrar evidencia objetiva em `docs/architecture/kanban/Testes/testes.md` antes de marcar concluido.
- Sincronizar status em `docs/architecture/kanban/mapa_problemas_sistema.md` e `docs/architecture/kanban/Concluido/concluido.md` ao fechar card.

## Rastreio de movimentacao

- [x] KB-017 - Externalizar capabilityFallback para signal puro
  - Data de fechamento: 2026-04-05
  - Movimentacao: removido de `Pendente/problemas_criticos.md` e encaminhado para `Concluido/concluido.md`.
  - Evidencias: registro tecnico consolidado em `Testes/testes.md` (governanca no Orchestrator, fallback factual, regressao sem falhas).

- [x] KB-048 - Memory Introspection + Final Gate (estabilizacao)
  - Data de fechamento: 2026-04-06
  - Movimentacao: consolidado como concluido com excecao arquitetural controlada documentada em `docs/architecture/decisions/KB-048-exception.md`.
  - Evidencias: classificacao de `MEMORY_QUERY` estabilizada para linguagem natural PT-BR; consumo de `last_input_gap` mantido exclusivamente no Final Gate; validacao registrada em `Testes/testes.md`.

- [x] KB-049 - Small Talk Governance (fast-path + anti-overreach)
  - Data de fechamento: 2026-04-06
  - Movimentacao: consolidado como concluido com validacao unitaria e de integracao; sem pendencias abertas no escopo.
  - Evidencias: precedencia `MEMORY -> SMALL_TALK` no `IntentionResolver`; `skipPlanning/skipToolLoop` no `CognitiveOrchestrator`; `AgentLoop` respeitando flags e bypass de bloqueio indevido em `REAL_TOOLS_ONLY`; validacao registrada em `Testes/testes.md`.

