# Plano de Correcao - KB-003 (AgentLoop Linear)

Status: Concluido (nucleo tecnico fechado)
Data: 2026-04-04
Card alvo: KB-003
Dependencias diretas: KB-001, KB-023, KB-024
Template base: docs/architecture/templates/prompt_template.md

## Progresso atual (2026-04-04)
- Etapas 1 e 2 aplicadas nos pontos de reclassificacao, retry LLM e ajuste de plano com SAFE MODE.
- Stop/continue e delta agora sao avaliados no Orchestrator por contexto (StopContinueModule), com AgentLoop atuando como executor tecnico da decisao retornada.
- Reality-check de claim de execucao migrado para signal explicito (`RealityCheckSignal`) com decisao final no Orchestrator em safe mode.
- Pendencia encerrada: heuristicas residuais de stop/delta removidas do loop e centralizadas no Orchestrator.

## Objetivo
Transformar o AgentLoop em executor linear, removendo decisoes taticas locais de reclassificacao, ajuste de plano e retry, sem alterar comportamento funcional durante a migracao incremental.

## Escopo
- Incluir apenas src/engine/AgentLoop.ts e pontos minimos de integracao com src/core/orchestrator/CognitiveOrchestrator.ts.
- Nao reescrever o arquivo inteiro.
- Refatorar funcao por funcao.
- Preservar SAFE MODE em todos os gates:
  - finalDecision = orchestratorDecision ?? loopDecision

## Definicao de pronto
- AgentLoop nao toma decisao cognitiva final para:
  - reclassificacao
  - ajuste de plano
  - retry com LLM
  - stop/continue por delta
  - reality-check de confianca
- AgentLoop apenas:
  - coleta sinais
  - consulta Orchestrator
  - aplica fallback SAFE MODE
  - executa o fluxo tecnico
- npx tsc --noEmit sem erros.
- Testes relevantes verdes.

## Nao objetivos nesta fase
- Nao mudar heuristicas de negocio.
- Nao alterar politicas de risco/confiança.
- Nao remover branches legados sem cobertura.

## Plano por etapas (incremental)

### Etapa 0 - Baseline e inventario
Objetivo:
- Mapear todas as decisoes locais restantes no AgentLoop.

Acoes:
1. Catalogar metodos decisorios e call sites.
2. Confirmar equivalentes existentes no Orchestrator.
3. Evitar duplicacao (reuso obrigatorio).

Entrega:
- Lista de funcoes e sinais por prioridade.

Validacao:
- Build limpa sem alteracao funcional.

---

### Etapa 1 - Extracao sem mudanca funcional
Objetivo:
- Isolar logica cognitiva em sinais, mantendo aplicacao local.

Acoes:
1. Em cada funcao-alvo, separar bloco tecnico e bloco cognitivo.
2. Converter bloco cognitivo em signal explicito (ou reutilizar signal existente).
3. Adicionar TODO de migracao para decisao do Orchestrator.

Funcoes foco inicial:
- shouldReclassify
- adjustPlanAfterFailure
- shouldRetryWithLlm
- checkDeltaAndStop
- injectRealityCheck (parte decisoria)

Validacao:
- npx tsc --noEmit
- Sem regressao de fluxo.

---

### Etapa 2 - Consulta ao Orchestrator com SAFE MODE
Objetivo:
- Trocar decisao local por consulta central, mantendo fallback.

Acoes:
1. Para cada signal, chamar metodo correspondente no Orchestrator.
2. Aplicar:
   - finalDecision = orchestratorDecision ?? loopDecision
3. Registrar divergencias em debug/evento.

Validacao:
- Build limpa.
- Logs mostram autoridade aplicada por ponto de decisao.

---

### Etapa 3 - Auditoria de conflitos reais
Objetivo:
- Tornar conflitos visiveis e auditaveis.

Acoes:
1. Verificar conflitos:
   - Route vs FailSafe
   - Validation vs StopContinue
   - Fallback vs Route
2. Verificar divergencia loop vs orchestrator.
3. Garantir evento de conflito rastreavel.

Validacao:
- Conflitos mapeados sem comportamento oculto.

---

### Etapa 4 - Reducao controlada de fallback local
Objetivo:
- Diminuir dependencia de loopDecision quando o Orchestrator estiver estavel.

Acoes:
1. Manter SAFE MODE por default.
2. Em pontos com estabilidade comprovada, marcar pronto para remocao de fallback local.
3. Nao remover fallback sem evidencias de runtime/teste.

Validacao:
- Sem regressao.
- Evidencias de estabilidade por caso critico.

---

### Etapa 5 - Fechamento do KB-003
Objetivo:
- Consolidar AgentLoop como executor linear.

Acoes:
1. Revisao final de pontos decisorios remanescentes.
2. Atualizar kanban e checklist vivo.
3. Registrar riscos residuais e proxima onda (KB-001, KB-023, KB-024).

Validacao:
- Criterio de pronto do KB-003 atendido.
- Estado documentado no kanban.

## Matriz de risco
- Alto: alterar sem SAFE MODE ativo em call sites criticos.
- Medio: duplicar signal em vez de reutilizar.
- Medio: quebrar escopo da classe com insercao em ponto inseguro.
- Baixo: ruido de log sem impacto funcional.

## Gate de qualidade por PR
- [ ] Sem duplicacao de logica cognitiva
- [ ] SAFE MODE aplicado
- [ ] TODO de migracao presente quando necessario
- [ ] i18n aplicado para strings visiveis
- [ ] npx tsc --noEmit
- [ ] Checklist vivo atualizado

## Prompt operacional (template preenchido para Etapa 1)
Use este prompt para executar a Etapa 1 exatamente no formato do template padrao:

### Prompt
Estamos evoluindo o IalClaw para Single Brain. Aplique o template em docs/architecture/templates/prompt_template.md e implemente APENAS a etapa abaixo.

## ESCOPO DA IMPLEMENTACAO
Implementar APENAS ETAPA 1 (Extracao sem mudanca funcional) do plano em docs/architecture/plans/KB-003_Correcao_AgentLoop_SingleBrain.md.

Regras obrigatorias:
1. Refatorar funcao por funcao em src/engine/AgentLoop.ts.
2. Nao alterar comportamento funcional.
3. Nao remover branches existentes.
4. Reutilizar sinais/metodos existentes antes de criar novos.
5. Manter execucao local por enquanto e adicionar TODO de migracao para o Orchestrator.
6. Aplicar i18n para qualquer string visivel adicionada.
7. Compilar incrementalmente com npx tsc --noEmit.
8. Se houver >5 erros, parar e reportar.

Funcoes alvo nesta etapa:
- shouldReclassify
- adjustPlanAfterFailure
- shouldRetryWithLlm
- checkDeltaAndStop
- injectRealityCheck (somente parte decisoria)

Saida esperada:
- Lista objetiva das funcoes tocadas
- Quais sinais foram reutilizados/criados
- Confirmacao de ausencia de mudanca funcional
- Resultado do npx tsc --noEmit

## Atualizacao operacional obrigatoria
Ao finalizar, atualizar:
- docs/architecture/kanban/historico/checklist_vivo.md
- docs/architecture/kanban/Pendente/problemas_criticos.md
