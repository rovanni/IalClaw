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

## Separacao de foco

### 1) Em andamento e pendente de validacao de testes
- KB-001
- KB-011
- KB-012
- Fonte unica de validacao: `docs/architecture/kanban/Em_Andamento/validacao.md`

### 2) Em andamento e pendente de correcao/implementacao

