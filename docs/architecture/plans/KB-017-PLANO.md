# PLANO DE CORRECAO - KB-017

Data: 5 de abril de 2026
Status: Planejado para execucao incremental no modelo Single Brain 2.0
Risco: Critico
Escopo: externalizar decisao de capability fallback para o Orchestrator

---

## CONTEXTO

Estado atual validado:

- O fallback de capability esta centralizado, mas ainda retorna `mode`/`strategy`.
- Isso embute decisao no modulo de capabilities.
- O consumo principal esta em `AgentExecutor`, que propaga esse payload como resultado de erro.
- Nao existe decisao explicita de fallback de capability no Orchestrator para este fluxo.

Definicao de pronto do KB-017:

- fallback retorna apenas fatos/metadados (sem `strategy` decisoria)
- decisao final de fallback fica no Orchestrator
- executor aplica decisao em safe mode durante a transicao

---

## DIAGNOSTICO ARQUITETURAL

Problema nuclear:

- `handleCapabilityFallback(...)` retorna campos decisorios (`mode`, `strategy`).
- No estado alvo Single Brain, capabilities devem apenas sinalizar fatos.

Risco:

- mini-brain residual no dominio de capabilities
- possibilidade de divergencia de decisao entre pontos de execucao
- trilha de debug menos deterministica por decisao implita no payload

Paralelo com KB-024:

- mesmo padrao de migracao: sair de decisao local para facts-first + safe mode

---

## REGRA CRITICA - VERIFICAR ANTES DE IMPLEMENTAR

Antes de alterar codigo:

- Verificar tipos existentes de sinal/decisao no Orchestrator que podem ser reutilizados.
- Verificar funcoes existentes de governanca no executor para manter padrao de safe mode.
- Verificar cobertura atual em testes para fluxos com capability ausente.

Se existir estrutura equivalente:

- Reutilizar.
- Nao recriar contrato redundante.

Proibido:

- adicionar novo decisor fora do Orchestrator
- mudar heuristicas de instalacao/erro nesta fase
- alterar semantica de mensagens ao usuario sem necessidade

---

## SAFE MODE (OBRIGATORIO)

Padrao obrigatorio durante migracao:

`finalDecision = orchestratorDecision ?? localDecision`

Neste KB, `localDecision` deve ser temporaria e removivel na fase final.

---

## FASES TECNICAS E CHECKLIST

### FASE 1 - Facts-first no fallback (sem quebrar comportamento)

Acoes:

- substituir contrato de retorno de `capabilityFallback` para fatos puros
- remover `strategy` do payload
- incluir metadados minimos:
  - `failureType`
  - `capability`
  - `retryPossible`
  - `severity`
  - `context`

Checklist:

- [ ] `capabilityFallback` nao retorna estrategia
- [ ] payload expressa somente fatos observaveis
- [ ] compilacao sem erros

### FASE 2 - Integrar decisao no Orchestrator em safe mode

Acoes:

- criar sinal de fallback de capability para ingestao/decisao no Orchestrator
- introduzir `decideCapabilityFallback(signal)` no Orchestrator
- no executor, manter fallback local temporario: `orchestratorDecision ?? localDecision`

Checklist:

- [ ] decisao central existe no Orchestrator
- [ ] executor aplica safe mode explicitamente
- [ ] telemetria registra decisao orquestrada e local

### FASE 3 - Remover decisao local residual

Acoes:

- retirar branch decisoria local no dominio de fallback de capability
- manter apenas aplicacao tecnica da decisao retornada pelo Orchestrator
- preservar mensagens e erros existentes, sem regressao funcional

Checklist:

- [ ] sem mini-brain residual no fallback
- [ ] sem `strategy` local como fonte primaria
- [ ] fluxo continua funcional com capacidades ausentes

### FASE 4 - Testes e rastreabilidade

Acoes:

- adicionar/atualizar testes para:
  - capability ausente com decisao do Orchestrator
  - safe mode quando Orchestrator nao decidir
  - payload factual completo
- validar logs/traces de fallback

Checklist:

- [ ] testes cobrindo caminho governado e safe mode
- [ ] rastreabilidade de decisao adequada
- [ ] sem regressao em fluxos de erro

---

## REGRAS DE IMPLEMENTACAO

- Refatoracao estrutural, nao funcional
- Mudancas pequenas por funcao/modulo
- Compilar e validar a cada etapa
- Evitar mudanca de UX/texto fora do necessario

---

## CHECKLIST KANBAN V2.0

Ao concluir implementacao:

- [ ] remover card KB-017 de `docs/architecture/kanban/Pendente/problemas_criticos.md`
- [ ] registrar rastreio em `docs/architecture/kanban/Em_Andamento/em_andamento.md`
- [ ] registrar evidencias em `docs/architecture/kanban/Testes/testes.md`
- [ ] registrar conclusao em `docs/architecture/kanban/Concluido/concluido.md`
- [ ] atualizar status em `docs/architecture/kanban/mapa_problemas_sistema.md`

---

## CRITERIO DE ACEITE

KB-017 sera considerado fechado quando:

- fallback de capability produzir somente fatos
- Orchestrator for o decisor final deste dominio
- safe mode estiver explicito e coberto por teste
- nao houver regressao nos fluxos de capability ausente
