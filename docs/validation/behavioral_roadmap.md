# Roadmap de Validação Comportamental (KB-047)

Este documento descreve os cenários de teste reais para validar o comportamento emergente da arquitetura "Single Brain".

## 🎯 Objetivos de Estabilidade
1.  **Centralidade**: Nenhuma decisão de flow deve ser tomada fora do `CognitiveOrchestrator`.
2.  **Precedência**: `Pending Actions` devem sempre barrar o início de novos flows.
3.  **Justificativa**: Cada decisão deve ter um log auditável explicando o "porquê".
4.  **Resiliência**: O sistema não deve entrar em loops ou comportamentos erráticos diante de inputs ambíguos.

---

## 🧪 Cenários de Teste

### 1. 🔀 Mudança de Intenção Mid-Flow
*   **Contexto**: O usuário está no meio de um flow de `html_slides` (ex: "Qual o título do slide?").
*   **Input**: "Na verdade, me ajude a organizar meus arquivos agora."
*   **Critério**:
    *   O Orchestrator identifica que há um flow ativo.
    *   Deve avaliar se o novo input inicia um novo flow ou se é um "ruído" que deve ser ignorado para manter a continuidade.
    *   **Esperado**: Se o input for forte o suficiente (match alto em outro flow), deve sugerir `INTERRUPT_FLOW` ou `START_FLOW` com transição explicada.

### 2. ⏳ Pending Action + Novo Estímulo (Alta Prioridade)
*   **Contexto**: O agente está esperando uma confirmação (`confirm_delete`).
*   **Input**: "Quero criar slides."
*   **Critério**:
    *   O sistema deve ver que há uma ação pendente crítica.
    *   **Esperado**: `EXECUTE_PENDING` ou `ASK` para resolver a pendência ANTES de iniciar o flow de slides. O flow de slides não deve iniciar.

### 3. 🧠 Input Ambíguo (Conflitos de Flow)
*   **Contexto**: Sessão limpa. Múltiplos flows com tags similares (ex: `slides`, `presentation`).
*   **Input**: "Faz uma apresentação pra mim."
*   **Critério**:
    *   O Orchestrator deve retornar um score consistente.
    *   **Esperado**: Escolha do flow com maior score de triggers > tags. Justificativa deve citar os termos que deram match.

### 4. 🔁 Retorno ao Contexto Anterior
*   **Contexto**: Flow de slides interrompido por um erro ou pergunta lateral.
*   **Input**: "Ok, cansei disso. Voltando pros slides..."
*   **Critério**:
    *   Capacidade de reconhecer a intenção de retornar.
    *   **Esperado**: Recuperação do estado do flow anterior ou início de um novo de forma coerente.

### 5. 🚫 Anti-Regressão Crítica
*   **Contexto**: Reprodução de bugs passados.
*   **Input**: (Inputs a serem definidos na fase de execução).
*   **Critério**:
    *   Ausência de recursão infinita.
    *   Ausência de múltiplas respostas conflitantes pro mesmo input.
