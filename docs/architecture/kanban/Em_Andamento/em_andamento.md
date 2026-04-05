# Em andamento

- [ ] 
 - Neutralizar Search como subsistema decisório isolado (Fases 1-6)
  - Origem: problemas_criticos (Single Brain)
  - Risco: Crítico
  - Status: 85% concluído
  - Progresso por fase: F1/F2 concluídas; F3 concluída com T3.2-T3.5 aplicadas (SearchEngine session-aware, InvertedIndex session-scoped, SemanticGraphBridge sem singleton no caminho principal e AutoTagger com cache por sessão); F4 avançada com src/tests/KB027SearchSignals.test.ts cobrindo Safe Mode nas 5 decisões de busca, restando T4.3 e validação final; F5/F6 concluídas com logica real nos decide* e safe mode preservado
  - Evidência atual: integração do CognitiveOrchestrator nas decisões de busca, SearchCache já existe em src/shared/SessionManager.ts, compilação limpa e testes gerais passando na última validação completa
  - Planejamento vigente: docs/architecture/plans/KB-027-PLANO.md replanejado em 5 de abril de 2026 para fechar apenas F3/F4 remanescentes
  - O que falta: fechar T4.3, executar a validação final de conflitos/autoridade e registrar as evidências finais no kanban para mover o card quando pronto
  - O que NÃO deve ser tocado agora: heurísticas de busca, tuning de scoring/boost, redesign do GraphAdapter e outras KBs críticas fora do escopo do Search

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
- KB-027
  - FASE 3: concluir T3.2-T3.5 (refactor de injecao de SessionManager no SearchEngine).
  - FASE 4: consolidar e ampliar cobertura de integracao (`src/tests/KB027SearchSignals.test.ts`).
