# KB-048 - Excecao Controlada ao Template

Data: 2026-04-06
Status: Ativa e governada
Escopo: Memory Introspection (`MEMORY_QUERY`, `MEMORY_CHECK`, `MEMORY_STORE`)

## Contexto

O template arquitetural recomenda que novas capacidades decisorias passem primeiro por refatoracao estrutural completa.
No KB-048, a decisao de introspeccao de memoria foi ativada no `CognitiveOrchestrator` antes do fechamento de toda a trilha documental estrutural para evitar regressao funcional de classificacao e roteamento.

## Justificativa da Excecao

- Necessidade funcional imediata: consultas de introspeccao estavam caindo em `QUESTION` e perdendo governanca especifica.
- Risco controlado: a ativacao foi limitada ao ponto de decisao do Orchestrator, sem criar decisor paralelo em outros componentes.
- Beneficio arquitetural direto: preserva Single Brain ao concentrar o roteamento de introspeccao no cerebro central.

## Garantias de Governanca

- Sem bypass do Orchestrator: toda decisao de introspeccao e tomada no `CognitiveOrchestrator.decide(...)`.
- Sem bypass do Final Gate: toda saida passa por `consolidateAndReturn(...)`.
- Sem consumo implicito de estado: introspeccao usa `usedInputGap: false`.
- Consumo de `input_gap` permanece centralizado no Final Gate e apenas quando `decision.usedInputGap === true`.

## Classificacao Formal

Excecao controlada ao template - necessaria para viabilizar introspeccao governada.

## Condicoes de Revisao

- Revisar esta excecao quando a trilha de padronizacao do template para features de introspeccao estiver consolidada.
- Manter testes de regressao de classificacao e governanca do `input_gap` como gate obrigatorio para alteracoes futuras.
