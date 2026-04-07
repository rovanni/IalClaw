# KB-050 - Prompt de Implementacao (Single Brain)

## 🧠 CONTEXTO

Estamos evoluindo o projeto IalClaw para o modelo Single Brain, onde:

- O CognitiveOrchestrator e o unico decisor
- O AgentLoop apenas executa
- Todas as decisoes sao representadas como signals explicitos
- O sistema deve ser auditavel, previsivel e sem decisoes distribuidas

Objetivo desta etapa:

Implementar governanca semantica de capabilities com pipeline:

RAW (frontmatter livre)
-> Normalizacao (string -> formato padrao)
-> Canonicalizacao (alias -> capability oficial)
-> Validacao (known vs unknown)
-> Indexacao (SkillManager)

Com regra critica:

- Unknown NAO entra no capabilityIndex
- Unknown entra apenas em capabilityAuditLog

---

## ⚠️ REGRA CRITICA - VERIFICAR ANTES DE IMPLEMENTAR

Antes de qualquer implementacao, voce DEVE:

### 🔍 Verificar

- Se ja existe logica equivalente
- Se ja existe funcao com outro nome
- Se ja existe comportamento semelhante

### ♻️ Se existir

- REUTILIZAR
- NAO recriar

### 🚫 PROIBIDO

- Duplicar codigo
- Criar fluxos paralelos
- Reimplementar comportamento existente

---

## ⚙️ PLANO ESTRATEGICO DE REFATORACAO (OBRIGATORIO)

Use como base o plano:

- docs/architecture/plans/KB-050-PLANO.md

---

## ⚙️ ESTRATEGIA DE REFATORACAO (OBRIGATORIO)

A refatoracao deve ser estrutural, nao funcional.
O comportamento do sistema deve permanecer equivalente.

### 📌 Granularidade obrigatoria

- Refatorar funcao por funcao
- NAO refatorar arquivo inteiro de uma vez

### 🧩 Ordem obrigatoria por funcao

1. Identificar partes cognitivas dentro da funcao
2. Separar logica tecnica e logica cognitiva
3. Manter logica tecnica no local atual
4. Converter logica semantica em helper deterministico
5. Manter execucao local por enquanto
6. Adicionar TODO explicito para migracao futura ao Orchestrator

### 🚫 Restricoes desta etapa

- NAO alterar heuristicas existentes do Orchestrator
- NAO ativar nova decisao no Orchestrator nesta fase
- NAO remover branches existentes de fallback

---

### 📋 CHECKLIST KANBAN V2.0 (OBRIGATORIO)

Apos qualquer alteracao, atualizar:

1. Pendente: remover card correspondente em docs/architecture/kanban/Pendente
2. Andamento: atualizar docs/architecture/kanban/Em_Andamento/em_andamento.md
3. Testes: registrar evidencias em docs/architecture/kanban/Testes/testes.md
4. Concluido: registrar em docs/architecture/kanban/Concluido/concluido.md
5. Mapa: atualizar docs/architecture/kanban/mapa_problemas_sistema.md

---

## 🧠 REGRAS ARQUITETURAIS

- Orchestrator e o unico decisor
- Signals representam intencao, nao politica nova
- Loader e Manager apenas transformam, indexam e auditam
- NAO alterar heuristicas existentes
- NAO remover branches existentes

---

## 🌐 INTERNACIONALIZACAO (i18n) - OBRIGATORIO

### 📌 Regras obrigatorias

- Toda string visivel ao usuario deve usar t('chave')
- Nunca usar strings hardcoded em mensagens user-facing
- Adicionar chaves em ambos os catalogos:
  - src/i18n/pt-BR.json
  - src/i18n/en-US.json
- Usar params tipados quando houver valores dinamicos

### ✅ Checklist i18n por etapa

- [ ] Chaves adicionadas em pt-BR.json
- [ ] Chaves adicionadas em en-US.json
- [ ] Hardcoded substituido por t()
- [ ] npx tsc --noEmit sem erros

---

## ⚠️ SAFE MODE (OBRIGATORIO)

finalDecision = orchestratorDecision ?? localDecision

Observacao: nesta etapa KB-050, nao mover decisao de unknown/alias para o Orchestrator.

---

# ⚙️ REGRA DE IMPLEMENTACAO (CRITICA)

Implementar SEMPRE de forma incremental:

1. Criar estrutura minima (metodo/arquivo)
2. Compilar
3. Adicionar logica minima
4. Compilar
5. Integrar no fluxo
6. Compilar

🚫 PROIBIDO:

- Implementar tudo de uma vez
- Criar metodos grandes inicialmente

---

## 📏 REGRA DE TAMANHO

- Evitar metodos grandes (>50 linhas) na primeira versao
- Comecar simples e evoluir

---

## 🔒 PROTECAO DE INSERCAO

Antes de inserir codigo:

- Identificar inicio/fim do metodo
- Confirmar escopo da classe
- Inserir apenas em pontos seguros

---

## 📍 VALIDACAO DE INSERCAO

Antes de aplicar patch:

- Confirmar contexto real do codigo
- Confirmar metodo atual
- Confirmar escopo da classe

Nao inserir baseado apenas em numero de linha.

---

## 🧩 ESCOPO DA IMPLEMENTACAO

👉 Implementar APENAS a etapa KB-050, com estes entregaveis:

### Entregavel A - Camada Canonica

- Criar src/capabilities/capabilityRegistry.ts
- Definir CANONICAL_CAPABILITIES com metadata
- Definir tipo CanonicalCapability

### Entregavel B - Normalizacao e Alias

- Criar src/capabilities/capabilityAliasMap.ts
- Criar src/capabilities/canonicalizeCapability.ts
- Contrato de retorno:
  - canonical
  - isCanonical
  - isKnown
  - isUnknown

### Entregavel C - Validacao de Alias (critico)

- Implementar validateAliasMap()
- Executar no startup de skills e no script de validacao
- Em conflito de alias, falhar startup/CI

### Entregavel D - Integracao no Loader

- Integrar canonicalizeCapability no ponto de ingestao de capabilities
- Preservar raw e normalized
- Regras:
  - canonical conhecido: indexa
  - alias conhecido: indexa canonical e audita
  - unknown: NAO indexa e audita
- Logar warning unknown_capability_detected

### Entregavel E - Auditoria separada

- Separar capabilityIndex de capabilityAuditLog
- Estrutura de auditoria minima:
  - skillId
  - raw
  - normalized
  - canonical
  - isKnown
  - isUnknown
  - source
  - timestamp

### Entregavel F - Diagnostics

- Expor no SkillManager:
  - getUnknownCapabilities()
  - getCapabilityAuditLog()
  - getUnusedCapabilities()

### Entregavel G - Script de qualidade

- Criar scripts/validateCapabilities.ts (ou js)
- Regra DEV: warning
- Regra CI: fail para conflito de alias e unknown nao aprovado

### Entregavel H - Testes obrigatorios

1. canonical direto
- input: web_search
- saida: isKnown true, canonical web_search

2. alias
- input: browser nav
- saida: canonical browser_execution, isKnown true

3. unknown
- input: magic_ai_thing
- saida: isKnown false, NAO indexa, audita e loga warning

4. mixed
- input: [browser nav, unknown_x]
- index: [browser_execution]
- audit: ambos

---

# 🧪 VALIDACAO OBRIGATORIA (VERSAO AVANCADA)

Apos implementar, verificar:

### 1. Inconsistencias

- Existe contradicao entre registry, alias map e index?

### 2. Duplicacoes

- Existe logica duplicada de normalizacao/canonicalizacao?

### 3. Melhorias seguras

- Existe centralizacao futura clara no Orchestrator sem ativar nesta etapa?

### 4. Riscos arquiteturais

- Existe bypass do Orchestrator?
- Existe mini-brain ativo?

### 5. Coerencia de autoridade

- Quem decide de fato?
- Existe mais de um decisor?

### 6. GOVERNANCA DE INVARIANTES (KB-048)

- A mudanca interfere no Gate Final consolidateAndReturn?
- Existe caminho paralelo de decisao?

### 7. VERIFICACAO DE CONFLITOS REAIS (OBRIGATORIO)

a) conflitos entre signals
- Route vs FailSafe
- Validation vs StopContinue
- Fallback vs Route

b) divergencia loop vs orchestrator
- decisoes diferentes?
- qual foi aplicada?

c) conflitos silenciosos
- conflitos nao registrados?

d) inconsistencia de comportamento
- execucao indevida?
- confirmacao indevida?

e) conflito de autoridade
- signals competindo?
- ausencia de hierarquia?

---

## 🏗️ VALIDACAO ESTRUTURAL (CRITICA)

### a. escopo correto

- codigo dentro da classe correta?
- dentro do metodo correto?

### b. integridade sintatica

- chaves corretas?
- codigo inserido entre metodos?

### c. integracao valida

- variaveis existem?
- metodos acessiveis?

### d. impacto controlado

- poucas alteracoes?
- sem efeito colateral?

### e. compilacao incremental

- compilou apos cada etapa?

---

## ❗ REGRA DE SEGURANCA

Se ocorrer:

- muitos erros (>5)
- erro estrutural
- comportamento inesperado

PARAR imediatamente e reavaliar antes de continuar.

---

## ❗ REGRA FINAL

Se encontrar qualquer problema:

- NAO corrigir automaticamente heuristica cognitiva
- NAO alterar politica sem aprovacao
- APENAS reportar com evidencia

---

## 🚀 RESULTADO ESPERADO

- Zero duplicacao
- Zero regressao comportamental
- Decisoes auditaveis
- Conflitos visiveis
- Arquitetura Single Brain preservada

---

## ✅ SAIDA ESPERADA DA EXECUCAO

Ao final, apresentar:

1. Lista de arquivos criados/alterados
2. Evidencias de validacao (tsc e testes)
3. Unknowns detectados (se houver)
4. Conflitos de alias (se houver)
5. Riscos residuais e proximos passos
