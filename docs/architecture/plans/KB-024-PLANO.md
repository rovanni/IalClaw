# PLANO DE CORRECAO - KB-024

Data: 5 de abril de 2026
Status: Em execucao incremental alinhada ao template Single Brain 2.0
Risco: Critico
Escopo: centralizar ranking e execution memory no SessionManager sem alterar comportamento

---

## CONTEXTO

Estamos evoluindo o IalClaw para o modelo Single Brain:

- CognitiveOrchestrator = unico decisor
- AgentLoop = executor
- Estado de sessao = SessionManager
- Sem mini-brain, sem caches paralelos invisiveis

Estado atual validado:

- KB-024 segue parcialmente mitigado.
- SessionManager ja centraliza execution memory por sessao.
- ToolSelectionSignal foi extraido no AgentLoop e integrado ao Orchestrator em modo passivo.
- A decisao final de selecao de tool permanece local em safe mode nesta etapa, conforme o template.
- Ranking cognitivo residual ainda vive no AgentLoop.
- Ha risco de divergencia entre sessoes, perda de rastreabilidade e regressao silenciosa.

Definicao de pronto do KB-024:

- sem ranking/merge decisorio local no AgentLoop
- sem caches paralelos invisiveis ao SessionManager
- leitura e escrita de memoria operacional unificadas por sessao

---

## REGRA CRITICA - VERIFICAR ANTES DE IMPLEMENTAR

Antes de alterar codigo:

- Verificar se ja existe estrutura reutilizavel em SessionManager (delta_state, search_cache, task_context).
- Verificar se ja existe tipo para memoria de execucao em AgentLoopTypes.
- Verificar se ja existe funcao equivalente para score/ranking no Orchestrator.

Se existir:

- Reutilizar.
- Nao recriar.

Proibido:

- Duplicar memoria em Map local e em sessao ao mesmo tempo como fonte primaria.
- Criar novo mini-brain no SessionManager.
- Alterar heuristicas de selecao de tool nesta fase.

---

## PLANO ESTRATEGICO DE REFATORACAO

Arquivo oficial:

- D:/IA/IalClaw/docs/architecture/plans/KB-024-PLANO.md

Objetivo:

- mover estado de ranking e execution memory do AgentLoop para SessionManager
- manter comportamento funcional equivalente
- manter Safe Mode em toda decisao cognitiva

Sequencia obrigatoria:

1. mapear estado local de memoria/ranking e call sites
2. criar estrutura minima de armazenamento no SessionManager
3. migrar escrita de executionMemory para SessionManager
4. migrar leitura de ranking/scores para SessionManager
5. manter fallback local temporario controlado por feature guard de transicao
6. remover estado local como fonte primaria
7. validar testes, traces e kanban

---

## ESTRATEGIA DE REFATORACAO (OBRIGATORIO)

A refatoracao sera estrutural, nao funcional.

Granularidade obrigatoria:

- refatorar funcao por funcao
- nao reescrever AgentLoop inteiro

Ordem obrigatoria por funcao:

1. identificar trecho cognitivo e trecho tecnico
2. manter tecnica no local
3. extrair dados/estado para SessionManager
4. preservar logica atual e Safe Mode
5. adicionar TODO curto somente quando houver bloqueio real de etapa

Restricoes desta etapa:

- nao alterar thresholds, pesos ou regras de exploration
- nao ativar decisao nova no Orchestrator
- nao remover branch existente sem cobertura de teste equivalente

---

## CHECKLIST KANBAN V2.0 (OBRIGATORIO)

Ao concluir a implementacao:

- [x] remover card KB-024 de docs/architecture/kanban/Pendente/problemas_criticos.md
- [x] registrar rastreio em docs/architecture/kanban/Em_Andamento/em_andamento.md
- [x] registrar evidencias em docs/architecture/kanban/Testes/testes.md
- [ ] registrar conclusao em docs/architecture/kanban/Concluido/concluido.md
- [x] atualizar status em docs/architecture/kanban/mapa_problemas_sistema.md

---

## REGRAS ARQUITETURAIS

- Orchestrator e o unico decisor
- signals representam intencao
- AgentLoop nao deve decidir no estado alvo
- sem heuristica nova nesta etapa
- sem bypass do Orchestrator

---

## INTERNACIONALIZACAO (i18n) - OBRIGATORIO

Checklist i18n por etapa:

- [x] chaves adicionadas em src/i18n/pt-BR.json (se houver novas mensagens)
- [x] chaves adicionadas em src/i18n/en-US.json (se houver novas mensagens)
- [ ] strings hardcoded substituidas por t()
- [x] npx tsc --noEmit sem erros

---

## SAFE MODE (OBRIGATORIO)

Padrao obrigatorio em decisoes:

finalDecision = orchestratorDecision ?? loopDecision

---

## REGRA DE IMPLEMENTACAO (CRITICA)

Implementar incrementalmente:

1. criar estrutura minima no SessionManager
2. compilar
3. migrar uma funcao de escrita
4. compilar
5. migrar uma funcao de leitura
6. compilar
7. integrar no fluxo
8. compilar e testar

---

## ESCOPO DA IMPLEMENTACAO

Implementar APENAS esta etapa:

ETAPA KB-024.1 - Centralizacao de execution memory e ranking operacional do AgentLoop no SessionManager, mantendo heuristicas atuais e Safe Mode.

Fora de escopo agora:

- redesenhar algoritmo de ranking
- modificar estrategia de selecao de tools
- alterar authority hierarchy do Orchestrator

---

## FASES TECNICAS E CHECKLIST

### FASE 1 - Mapeamento e baseline

Acoes:

- mapear os campos locais usados no ranking do AgentLoop
- mapear funcoes afetadas: registerExecutionMemory, getToolScores, getContextualConfidence, getDecisionConfidence, getBestToolForStep, logMemoryStats
- congelar baseline de comportamento com testes atuais

Checklist:

- [x] inventario de call sites concluido
- [x] baseline de testes documentada
- [ ] sem alteracao funcional nesta fase

### FASE 2 - Estrutura minima no SessionManager

Acoes:

- criar tipo session-scoped para execution memory (ex.: execution_memory_state)
- incluir getters/setters minimos no SessionManager
- limitar crescimento com mesmas regras atuais de MAX_MEMORY_ENTRIES

Checklist:

- [x] tipo adicionado sem quebrar compilacao
- [x] API minima no SessionManager pronta
- [ ] sem escrita real ainda no AgentLoop

### FASE 3 - Migrar escrita da memoria

Acoes:

- adaptar registerExecutionMemory para escrever no SessionManager
- manter formato dos registros (stepType, tool, success, context, timestamp)
- manter protecao de memoria (nao aprender step cognitivo com tool)

Checklist:

- [x] escrita ocorre por sessao
- [x] limite de tamanho preservado
- [x] logs de learning permanecem equivalentes

### FASE 4 - Migrar leitura de ranking

Acoes:

- adaptar getToolScores e getContextualConfidence para ler memoria da sessao
- preservar janelas temporais e regras de confidence/exploration
- manter retorno e ordenacao iguais

Checklist:

- [x] ranking le estado session-scoped
- [x] heuristica atual preservada
- [x] sem regressao funcional detectada

### FASE 5 - Remover fonte primaria local

Acoes:

- desativar uso de this.executionMemory como fonte primaria
- manter fallback temporario apenas para compatibilidade de teste legada, se necessario
- adicionar TODO curto para remocao final do fallback

Checklist:

- [x] estado local nao e mais autoridade para execution memory
- [x] fallback de transicao documentado
- [x] sem duplicidade ativa de fonte primaria

### FASE 6 - Validacao e observabilidade

Acoes:

- validar traces para confirmar que dados usados no ranking estao visiveis por sessao
- validar isolamento entre duas sessoes diferentes
- validar reset de estado sem vazamento entre sessoes

Checklist:

- [x] isolamento entre sessoes comprovado
- [x] reset limpa somente sessao alvo
- [x] rastreabilidade do estado aumentada

### STATUS OPERACIONAL DESTA SESSAO

- execution memory migrada para SessionManager com isolamento por sessao validado.
- ToolSelectionSignal extraido e observado pelo Orchestrator em modo passivo.
- snapshot factual de ranking por sessao agora e calculado via SessionManager e consumido pelo AgentLoop sem re-agregar entries locais.
- fallback local mantido com TODO explicito no AgentLoop para etapa futura.
- i18n adicionado para logs novos desta trilha.
- validacao executada com `node ./node_modules/typescript/bin/tsc --noEmit` e `npx.cmd ts-node src/tests/run.ts`.

### STATUS DA ETAPA KB-024.2 (ADIADA NESTA FASE)

- `decideToolSelection()` no Orchestrator permanece PASSIVO nesta fase.
- O AgentLoop continua como decisor local de selecao de tool, em safe mode.
- Fallback local permanece ativo e documentado para compatibilidade da etapa atual.
- Safe mode mantido: `finalDecision = orchestratorDecision ?? loopDecision`.
- Proximos passos: concluir extracao facts-first e migracao total de autoridade antes de ativar decisao no Orchestrator.

---

## VALIDACAO OBRIGATORIA (AVANCADA)

1. inconsistencias

- [ ] ha decisoes contraditorias entre loop e orchestrator?

2. duplicacoes

- [ ] ha logica duplicada com outro nome?
- [x] nao ha memoria paralela ativa fora da sessao

3. melhorias seguras

- [ ] ha consolidacao adicional segura para etapa futura?

4. riscos arquiteturais

- [ ] existe bypass do Orchestrator?
- [ ] existe mini-brain ativo no loop?

5. coerencia de autoridade

- [ ] quem decide de fato em cada ponto?
- [ ] existe mais de um decisor ativo?

6. verificacao de conflitos reais

- [ ] conflito entre signals (Route vs FailSafe, Validation vs StopContinue, Fallback vs Route)
- [ ] divergencia loop vs orchestrator
- [ ] conflitos silenciosos nao registrados
- [ ] inconsistencia de comportamento (execucao/confirmacao indevida)
- [ ] conflito de autoridade

7. validacao estrutural

- [x] codigo inserido em classe/metodo correto
- [x] integridade sintatica sem blocos fora de escopo
- [x] integracao valida com variaveis/metodos existentes
- [x] impacto controlado em diff pequeno e objetivo
- [x] compilacao incremental a cada microetapa

---

## VALIDACAO TECNICA FINAL

Comandos:

- npm.cmd run build (ou npx tsc --noEmit)
- npm.cmd test
- testes focados no loop e memoria por sessao

Criterio de aceite do KB-024:

- AgentLoop nao mantem ranking/execution memory local como autoridade
- SessionManager concentra estado operacional necessario
- comportamento externo permanece equivalente
- kanban atualizado com evidencias
