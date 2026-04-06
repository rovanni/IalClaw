# PLANO DE IMPLEMENTAÇÃO - KB-047

Data: 6 de abril de 2026
Status: Aguardando Aprovação
Risco: Baixo-Médio
Escopo: Governança explícita de início de flows no `CognitiveOrchestrator`.

---

## CONTEXTO

Atualmente, o início de um fluxo guiado (Flow) no IalClaw depende de uma heurística local no `FlowRegistry` (`matchByInput`). Embora o `CognitiveOrchestrator` chame esse método, a lógica de "decidir se um flow deve começar e qual" está encapsulada fora do hub de decisões central, caracterizando um "mini-brain".

O objetivo do KB-047 é centralizar essa autoridade no Orchestrator, seguindo o padrão "Single Brain", e garantir que o `AgentExecutor` apenas execute a decisão sem possuir lógica de inicialização de contexto própria.

---

## PROPOSTA DE MUDANÇAS

### 1. Núcleo de Decisões (Decisions)

#### [NEW] [decideFlowStart.ts](file:///d:/IA/IalClaw/src/core/orchestrator/decisions/flow/decideFlowStart.ts)
- Implementará a lógica de matching baseada em triggers, tags e prioridade (atualmente no `FlowRegistry`).
- Receberá o input do usuário e a lista de definições de flows disponíveis.
- Retornará uma decisão estruturada contendo o `flowId` e, opcionalmente, parâmetros de inicialização.

#### [NEW] [FlowStartTypes.ts](file:///d:/IA/IalClaw/src/core/orchestrator/types/FlowStartTypes.ts)
- Definição dos contratos de entrada e saída para a decisão de início de flow.
- Incluirá metadados de matching (score, triggers atingidos) para auditoria.

### 2. Infraestrutura de Flow (Core Flow)

#### [MODIFY] [FlowRegistry.ts](file:///d:/IA/IalClaw/src/core/flow/FlowRegistry.ts)
- REMOVER o método `matchByInput`.
- O `FlowRegistry` passará a ser estritamente um repositório de dados (Read-Only para o Orchestrator), fornecendo as definições para que o Orchestrator decida.

### 3. Orquestração e Execução (Orchestrator & Executor)

#### [MODIFY] [CognitiveOrchestrator.ts](file:///d:/IA/IalClaw/src/core/orchestrator/CognitiveOrchestrator.ts)
- Atualizar `decideFlowStart(...)` para consumir o novo módulo `decideFlowStart.ts`.
- Adicionar emissão de debug `flow_start_decision` com detalhes do matching.
- Garantir que a precedência `Pending Action > Flow Start` seja mantida e auditada.

#### [MODIFY] [CognitiveActionExecutor.ts](file:///d:/IA/IalClaw/src/core/orchestrator/CognitiveActionExecutor.ts)
- Garantir que `executeStartFlow` seja puramente executável.
- Se necessário, aceitar parâmetros de contexto inicial vindos da decisão do Orchestrator.

---

## RISCOS E MITIGAÇÕES

- **Regressão no Matching**: A migração da lógica do `FlowRegistry` para o Orchestrator deve ser testada para garantir 100% de paridade.
- **Conflitos de Import**: Como o `FlowRegistry` é amplamente referenciado, a remoção do método `matchByInput` pode quebrar caminhos paralelos se existirem (auditoria necessária).

---

## PLANO DE VERIFICAÇÃO

### Testes Automatizados
- Criar `tests/KB047_flow_start_governance.test.ts`.
- Validar:
    - [ ] Matching por trigger direto.
    - [ ] Matching por tags (sistema de pontuação).
    - [ ] Prioridade entre flows conflitantes.
    - [ ] Registro de sinais de debug do Orchestrator no início do flow.

### Validação Manual
- Iniciar o flow de slides via comando direto e via tokens relacionados.
- Verificar se o log do Orchestrator registra a autoridade sobre o início do flow.

---

## PRÓXIMOS PASSOS

1. Obter aprovação do plano.
2. Criar os novos arquivos de tipos e decisões.
3. Refatorar o `FlowRegistry`.
4. Atualizar o `CognitiveOrchestrator`.
5. Validar com a suíte de testes.
