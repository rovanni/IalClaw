# Mapeamento de Short-Circuit no AgentLoop

## Escopo
- Arquivo investigado: src/engine/AgentLoop.ts
- Objetivo: localizar onde o fluxo pode pular execucao real (tools/loop) e ainda retornar resposta final.

## Pontos de short-circuit e bypass

### 1) Gate de estrategia direta (DIRECT_LLM)
- Local: buildRouteAutonomySignal
- Referencia: src/engine/AgentLoop.ts:639
- Condicao: decision.route === ExecutionRoute.DIRECT_LLM && isLowRisk
- Efeito: recommendedStrategy = DIRECT_LLM

### 2) Ativacao explicita de bypass do loop
- Local: runInternal
- Referencia: src/engine/AgentLoop.ts:872
- Condicao: routeAutonomySignal.recommendedStrategy === 'DIRECT_LLM'
- Efeito: loga short_circuit_activated com bypass_loop: true e retorna executeContentGenerationDirect(...)

### 3) Caminho hibrido que tambem bypassa tools
- Local: runInternal -> executeHybridStrategy
- Referencias: src/engine/AgentLoop.ts:884, src/engine/AgentLoop.ts:347
- Condicao: routeAutonomySignal.recommendedStrategy === 'HYBRID'
- Efeito: executeHybridStrategy chama executeContentGenerationDirect(...)

### 4) Execucao direta de content generation
- Local: executeContentGenerationDirect
- Referencia: src/engine/AgentLoop.ts:3011
- Efeito: chama llm.generate(...) e retorna resposta final sem passar pelo loop de tools
- Log associado: short_circuit_content_generation com bypass_loop: true

### 5) Bypass evitado (controle contrario)
- Local: runInternal
- Referencia: src/engine/AgentLoop.ts:965
- Condicao: currentTaskType === 'content_generation' && recommendedStrategy === 'TOOL_LOOP' && decision.route === ExecutionRoute.TOOL_LOOP
- Efeito: loga bypass_short_circuit e segue no loop normal

## Bypass reais adicionais (sem rotulo short-circuit)

### 6) Retorno final sem tool obrigatoria
- Local: runInternal
- Referencia: src/engine/AgentLoop.ts:1570
- Condicao: response.final_answer
- Efeito: encerra com resposta final mesmo quando toolCallsCount pode ser 0

### 7) Fallback final sem tools apos max iterations
- Local: runInternal
- Referencias: src/engine/AgentLoop.ts:1618, src/engine/AgentLoop.ts:1673
- Condicao: fim do loop / fallback
- Efeito: chama llm.generate(messages, []) e retorna resposta final

## Fluxo real resumido
- input
- classify/setOriginalInput
- decideRoute (ActionRouter ou policy)
- decideAutonomy (ou policy)
- buildRouteAutonomySignal
- se DIRECT_LLM/HYBRID: bypass do loop -> executeContentGenerationDirect -> llm.generate -> retorno
- se TOOL_LOOP: loop normal, mas ainda pode finalizar sem tool por final_answer/fallback

## Divergencia intencao vs execucao
- Ponto em que o sistema "decide executar" algo: fase de roteamento/autonomia em runInternal.
- Ponto em que abandona execucao via tools: gate DIRECT_LLM/HYBRID e retornos finais por final_answer/fallback.

## Responsabilidade atual da decisao
- AgentLoop: compoe e aplica a estrategia final de execucao na pratica.
- ActionRouter + decideAutonomy: influenciam fortemente a estrategia.
- Policy orchestrationResult: pode sobrescrever route/autonomy.
- CognitiveOrchestrator: neste recorte, nao aparece como decisor direto do gate de short-circuit.

## Risco principal observado
- Em cenarios de route/autonomy cognitivos, o sistema pode produzir resposta com cara de execucao sem executar tools, especialmente quando o input sugere acao concreta.
