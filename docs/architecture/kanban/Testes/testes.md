# Validacao - Em andamento (teste em runtime)

Objetivo deste arquivo:
- Concentrar somente o que esta em andamento e depende de validacao em ambiente real.
- Registrar comportamento esperado, evidencias e exemplos praticos com IalClaw.

## 1) Itens em andamento que precisam de validacao de testes

- [ ] KB-001 - Externalizar healing loop do executor para governanca do Orchestrator (Fase 1+2)
  - Status: implementado parcialmente e aguardando validacao runtime.
  - Comportamento esperado:
    - Decisao final de retry/abort segue governanca do Orchestrator com safe mode (`orchestratorDecision ?? executorDecision`).
    - Sem sinais suficientes, Orchestrator pode retornar `undefined` e manter fallback controlado.
    - Com fail-safe ativo, governanca deve forcar `abort` sem loop extra.
  - Evidencias para aprovar:
    - Evento `retry_decision` com `orchestratorDecision`, `executorDecision` e `finalDecision` coerentes.
    - Sem retries extras apos `fail_safe_activated`.

- [ ] KB-011 - Monitorar logs de short-circuit em producao
  - Status: em monitoramento.
  - Comportamento esperado:
    - Em intencao operacional real, short-circuit deve ser bloqueado e fluxo deve seguir no tool loop.
    - `DIRECT_LLM` deve ser bloqueado em `REAL_TOOLS_ONLY`.
  - Evidencias para aprovar:
    - Aumento relativo de `short_circuit_blocked` / `short_circuit_blocked_real_tools_only` em casos operacionais.
    - Reducao relativa de `short_circuit_activated` em casos operacionais equivalentes.

- [ ] KB-012 - Validar runtime de filesystem com meta.source
  - Status: aguardando rodada adicional em ambiente real.
  - Comportamento esperado:
    - `taskType=filesystem` deve usar `meta.source=deterministic_builder`.
    - Tipos sem builder registrado devem cair em `meta.source=legacy_forced_plan`.
    - Steps de filesystem devem ser executaveis (`tool` definido).
  - Evidencias para aprovar:
    - `source` correto por tipo de tarefa.
    - Em filesystem, 100% dos steps com `tool` preenchido.

## 2) Roteiro pratico com IalClaw (site/jogo)

### Preparacao (Windows PowerShell)
- Rodar no diretorio do projeto:
  - `npm run dev:debug:tail`
- Opcional em outro terminal:
  - `node bin/ialclaw.js status`

### Teste A - KB-012 (filesystem)
- Prompt:
  - "crie pasta jogos e subpasta jogo-cobra"
- Esperado:
  - Plano com steps executaveis de filesystem (ex.: `create_directory`).
  - `meta.source=deterministic_builder`.

### Teste B - KB-011 (short-circuit operacional)
- Prompt:
  - "crie um site simples com html css e js no workspace e rode o projeto"
- Esperado:
  - Bloqueio de short-circuit para fluxo operacional.
  - Seguir para tool loop.

### Teste C - KB-001 (retry governado)
- Prompt principal:
  - "crie um jogo da cobrinha em html, css e js e execute"
- Prompt alternativo para provocar falha:
  - "converta o arquivo workspace/nao-existe.pdf para docx"
- Esperado:
  - `retry_decision` coerente com governanca.
  - Sem repeticao indefinida de retry apos fail-safe.

## 3) Consulta rapida de logs

- `source=deterministic_builder`
- `source=legacy_forced_plan`
- `short_circuit_blocked`
- `short_circuit_blocked_real_tools_only`
- `short_circuit_activated`
- `retry_decision`
- `fail_safe_activated`

## 4) Criterio de fechamento

- KB-001: fechar quando retries/aborts estiverem governados de forma coerente, sem loop indevido.
- KB-011: fechar quando short-circuit estiver bloqueado de forma consistente em cenarios operacionais, sem regressao conversacional.
- KB-012: fechar quando filesystem usar `deterministic_builder` e fallback sem builder usar `legacy_forced_plan` em runtime.
