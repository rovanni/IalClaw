# Kanban de Arquitetura - Single Brain

Objetivo: centralizar acompanhamento em um quadro simples e objetivo, com fluxo por arquivos.

O kanban é o ponto central de rastreio. Os documentos técnicos continuam como fonte de diagnóstico e desenho; o quadro concentra prioridade, coluna e status operacional.

## Estrutura
- Mapa geral:
  - mapa_problemas_sistema.md
- Pendente:
  - Pendente/problemas_criticos.md
  - Pendente/problemas_medios.md
  - Pendente/problemas_baixos.md
- Em andamento:
  - em_andamento.md
- Concluido:
  - concluido.md
- Historico:
  - historico/checklist_vivo.md
  - historico/prs/

## Fluxo de centralizacao
- Todo problema novo identificado deve ser registrado primeiro em mapa_problemas_sistema.md.
- O mapa deve apontar, por componente, quais problemas existem, qual a origem técnica e em qual coluna/prioridade do quadro cada item está.
- Depois do registro no mapa, o problema deve virar card na coluna apropriada.
- O diagnóstico longo continua em docs/architecture/diagnostics, docs/architecture/maps e docs/architecture/plans; o kanban não duplica análise extensa.

## Regras
- Cada card deve ter um id unico no formato KB-XXX.
- Ao iniciar, mover o card de Pendente para em_andamento.md.
- Ao finalizar com validacao, mover para concluido.md com data e evidencia.
- Nao iniciar card critico novo sem fechar ou pausar explicitamente o critico atual.
- Todo card concluido precisa de evidencia objetiva: compilacao, teste ou log de validacao.
- Todo problema novo identificado deve ser registrado primeiro em mapa_problemas_sistema.md.
