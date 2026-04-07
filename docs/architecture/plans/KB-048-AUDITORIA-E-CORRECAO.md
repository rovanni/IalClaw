# KB-048 — Auditoria de Aderência ao Template e Plano de Correção

Data: 2026-04-06
Status: auditoria concluída, correção pendente
Escopo: verificar se o KB-048 seguiu os critérios de docs/architecture/templates/prompt_template.md e consolidar um plano de ajuste

---

## Resumo Executivo

Conclusão geral: o KB-048 ficou parcialmente alinhado ao template, mas não atende integralmente aos critérios obrigatórios.

Principais desvios:

- houve mudança funcional no Orchestrator, enquanto o template-base desta etapa exige refatoração estrutural sem ativar nova decisão
- a governança de `input_gap` não está coerente entre o gate final do Orchestrator e o fluxo real do `AgentController`
- a cobertura de validação não se sustenta integralmente em runtime: o teste dedicado do KB-048 falha hoje
- o plano não trouxe checklist Kanban V2.0
- o i18n não foi especificado nem evidenciado nos dois catálogos exigidos

Principais acertos:

- a decisão de introspecção passa pelo gate final `consolidateAndReturn(...)`
- existe validação de invariantes no gate final
- existe ponto único de log final para a decisão consolidada
- a implementação reutiliza serviços de memória existentes, em vez de recriar infraestrutura paralela

---

## Matriz de Aderência ao Template

### 1. Verificar antes de implementar

Status: parcial

Evidência positiva:

- o KB-048 reutiliza `searchByContent(...)` e `saveUserMemory(...)`
- a decisão específica foi extraída para `decideMemoryQuery(...)`

Lacuna:

- não há evidência no plano de revisão explícita de lógica equivalente já existente antes da introdução do novo caminho de precedência

Arquivos observados:

- src/core/orchestrator/decisions/memory/decideMemoryQuery.ts
- src/memory/CognitiveMemory.ts

### 2. Plano estratégico em arquivo

Status: conforme

Evidência:

- existe o plano em `docs/architecture/plans/KB-048-PLANO.md`

### 3. Estratégia de refatoração estrutural, não funcional

Status: não conforme

Critério do template:

- não alterar comportamento atual
- não ativar decisão nova no Orchestrator nesta fase

Evidência:

- o plano declara explicitamente um novo caminho de alta precedência no Orchestrator
- a implementação intercepta `MEMORY_QUERY`, `MEMORY_CHECK` e `MEMORY_STORE` antes do fluxo normal
- isso altera comportamento observável do sistema e ativa decisão nova

Arquivos observados:

- docs/architecture/templates/prompt_template.md
- docs/architecture/plans/KB-048-PLANO.md
- src/core/orchestrator/CognitiveOrchestrator.ts

### 4. Granularidade por função

Status: parcial

Evidência positiva:

- a extração para `decideMemoryQuery(...)` respeita recorte funcional pequeno

Lacuna:

- a entrega não foi apresentada como extração passiva de signal com TODO de migração futura; ela já entra ativa na decisão

### 5. Regras arquiteturais Single Brain

Status: parcial

Evidência positiva:

- o Orchestrator continua decidindo e centralizando a consolidação final

Lacuna:

- embora não haja bypass direto do Orchestrator nesse trecho, a etapa feriu a regra do template que proibia ativar decisão nova nesta rodada

### 6. i18n obrigatório

Status: não conforme

Evidência:

- o plano cita apenas `pt-BR.json`
- não há evidência correspondente de `en-US.json`
- há strings hardcoded em logs externos do fluxo implementado

Exemplos observados:

- `reason: 'memory_store_executed'`
- `reason: 'memory_introspection_hit'`
- `reason: 'memory_introspection_miss'`
- log textual de precedência de introspecção no Orchestrator

Observação:

- nomes de reason internos podem ser aceitáveis como códigos técnicos, mas o template foi explícito ao exigir rigor de i18n para mensagens externas, logs externos e respostas ao usuário

### 7. Safe mode obrigatório

Status: não aplicável ou parcial

Justificativa:

- o template exige `finalDecision = orchestratorDecision ?? loopDecision` para cenários de dupla autoridade
- no KB-048, a decisão é tomada diretamente no Orchestrator antes do fluxo normal; não há evidência de conflito loop versus orchestrator especificamente nesse trecho
- portanto, a regra não foi violada de forma explícita aqui, mas também não é o eixo principal da implementação do KB-048

### 8. Governança de invariantes (KB-048)

Status: parcial

#### 8.1 Gate final `consolidateAndReturn`

Status: conforme

Evidência:

- o método `decide(...)` retorna via `this.consolidateAndReturn(...)`
- o gate final valida convergência mínima da decisão

#### 8.2 `input_gap` consumido ou preservado corretamente

Status: não conforme no fluxo real

Evidência:

- no `CognitiveOrchestrator`, o consumo do gap está centralizado e condicionado por `decision.usedInputGap`
- porém, no `AgentController`, o `session.last_input_gap` é limpo antes da orquestração
- isso enfraquece a garantia de que o gate final seja o único responsável pelo consumo efetivo

Conclusão:

- a intenção da governança está correta no Orchestrator
- a implementação do fluxo completo ainda não preserva a invariância prometida

#### 8.3 Ponto único de log da decisão final

Status: parcial

Evidência positiva:

- existe um log final consolidado em `final_cognitive_decision`

Lacuna:

- além dele, o fluxo também emite logs intermediários de precedência e consumo, o que é aceitável
- o ponto crítico é que o log final existe e está centralizado, então este item está substancialmente atendido

### 9. Validação obrigatória avançada

Status: parcial

Evidência positiva:

- existe teste dedicado em `tests/KB048_memory_introspection.test.ts`

Lacuna crítica:

- o teste falha atualmente em runtime para uma das frases esperadas como `MEMORY_QUERY`

Falha observada:

- entrada: `quais informacoes voce tem sobre o paxg?`
- esperado: `MEMORY_QUERY`
- obtido: `QUESTION`

Conclusão:

- a cobertura existe, mas o KB-048 não está estabilizado o suficiente para ser tratado como aderente sem ressalvas

### 10. Checklist Kanban V2.0

Status: não conforme

Evidência:

- o plano do KB-048 não apresenta checklist Kanban V2.0
- não foi encontrado rastro explícito do KB-048 nos arquivos de kanban consultados durante a auditoria

---

## Evidências Técnicas Consolidadas

### Evidência A: ativação funcional no Orchestrator

- `src/core/orchestrator/CognitiveOrchestrator.ts`
- o trecho de precedência de memória executa antes do bloco normal e já retorna decisão ativa

### Evidência B: gate final centralizado

- `src/core/orchestrator/CognitiveOrchestrator.ts`
- `consolidateAndReturn(...)` valida invariantes, consome gap quando aplicável e registra a decisão final

### Evidência C: conflito de governança do input gap

- `src/core/AgentController.ts`
- o `last_input_gap` é limpo antes da orquestração

### Evidência D: falha de validação real do KB-048

Comando executado:

`npx.cmd ts-node tests/KB048_memory_introspection.test.ts`

Resultado:

- falha no cenário `quais informacoes voce tem sobre o paxg?`
- o classificador retornou `QUESTION` em vez de `MEMORY_QUERY`

---

## Plano de Correção Recomendado

### Objetivo

Levar o KB-048 para aderência prática ao template atual, minimizando regressão e evitando expansão escalar do escopo.

### Etapa 1. Corrigir a classificação de intenção

Objetivo:

- fazer o teste do KB-048 passar de forma consistente

Ações:

- revisar `isMemoryIntrospection(...)` para cobrir frases abertas do tipo `quais informacoes voce tem sobre ...`
- garantir que o gating de memória aconteça antes do fallback genérico de `QUESTION`
- incluir casos adicionais no teste dedicado para plural, variações sem acento e frases abertas com `tem sobre`

Critério de aceite:

- `tests/KB048_memory_introspection.test.ts` passando

### Etapa 2. Fechar a governança real do input gap

Objetivo:

- alinhar o fluxo real ao contrato do gate final do Orchestrator

Ações:

- revisar a limpeza antecipada de `session.last_input_gap` no `AgentController`
- decidir uma única autoridade de consumo do gap
- manter preservação explícita para rotas metacognitivas, como introspecção de memória

Critério de aceite:

- o gap só é consumido pelo ponto definido como autoridade final
- testes de preservação e consumo passam no fluxo real, não apenas no teste isolado do Orchestrator

### Etapa 3. Fechar checklist Kanban V2.0

Objetivo:

- alinhar o KB-048 ao processo operacional do repositório

Ações:

- registrar rastreio em `docs/architecture/kanban/Em_Andamento/em_andamento.md`
- registrar evidências em `docs/architecture/kanban/Testes/testes.md`
- atualizar `docs/architecture/kanban/mapa_problemas_sistema.md`
- registrar conclusão em `docs/architecture/kanban/Concluido/concluido.md` quando os gates finais forem aprovados

### Etapa 4. Fechar o i18n onde for aplicável

Objetivo:

- remover ambiguidade sobre aderência ao template

Ações:

- revisar se há mensagens visíveis ao usuário ou logs externos que precisam de `t(...)`
- se houver novas mensagens, adicionar chaves em `src/i18n/pt-BR.json` e `src/i18n/en-US.json`

### Etapa 5. Revisar alinhamento de etapa arquitetural

Objetivo:

- decidir se o KB-048 será mantido como exceção funcional aprovada ou reclassificado como etapa fora do template-base de refatoração estrutural

Justificativa:

- o principal desvio não é só técnico; é de enquadramento da etapa frente ao template

---

## Checklist de Fechamento Proposto

- [ ] teste dedicado do KB-048 passando
- [ ] governança de `input_gap` validada no fluxo real
- [ ] checklist Kanban V2.0 refletido nos arquivos físicos
- [ ] i18n revisado e ajustado quando aplicável
- [ ] decisão arquitetural documentada sobre a natureza funcional do KB-048

---

## Veredito Final

O KB-048 não pode ser considerado totalmente aderente ao template atual.

Classificação final:

- aderência arquitetural: parcial
- aderência processual: baixa
- aderência de validação: parcial, com falha real em teste dedicado
- aderência à governança de invariantes: parcial, com conflito relevante no `input_gap`

Recomendação:

- corrigir primeiro a classificação de intenção e a autoridade de consumo do `input_gap`
- só então registrar o KB-048 como concluído no kanban