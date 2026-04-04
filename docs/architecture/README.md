# Docs de Arquitetura

Esta pasta guarda documentacao tecnica e arquitetural do sistema.

## Divisao recomendada
- specs/: especificacoes formais do sistema, contratos e comportamento esperado.
- docs/architecture/: mapas tecnicos, analises, decisoes de design, material de refatoracao e referencia arquitetural.
- docs/architecture/kanban/: acompanhamento operacional do trabalho em andamento, pendencias, concluido e historico.

## O que fica em docs/architecture
- Mapas da arquitetura atual
- Anti-patterns e diagnosticos
- Planos de refatoracao e mudancas propostas
- Templates e guias de execucao arquitetural
- Documentos de walkthrough e referencia estrutural

## Estrutura atual
- diagnostics/: diagnosticos e anti-patterns
- maps/: mapas, walkthroughs e arvores estruturais
- plans/: planos de mudanca e modularizacao
- templates/: templates operacionais de implementacao
- kanban/: acompanhamento operacional e historico

## O que fica em docs/architecture/kanban
- Quadro operacional
- Pendencias por prioridade
- Itens em andamento
- Itens concluidos
- Historico de checklists e changelogs de entrega

## Indices
- Quadro Kanban: docs/architecture/kanban/README.md
- Mudancas propostas: docs/architecture/plans/ProposedChanges.md
- Plano KB-003 (AgentLoop Linear): docs/architecture/plans/KB-003_Correcao_AgentLoop_SingleBrain.md
- Template de implementacao: docs/architecture/templates/prompt_template.md
- Anti-patterns: docs/architecture/diagnostics/AntiPatterns.md
- Mapas: docs/architecture/maps/

## Regra pratica
- Se o documento descreve o que o sistema deve fazer, ele tende a pertencer a specs/.
- Se o documento descreve como o sistema esta estruturado, ele tende a pertencer a docs/architecture/.
- Se o documento descreve status, prioridade, progresso ou historico de execucao, ele tende a pertencer a docs/architecture/kanban/.
