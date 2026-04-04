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
- Concluído:
  - concluido.md
- Histórico:
  - historico/checklist_vivo.md
  - historico/prs/

## Fluxo de centralização
- Todo problema novo identificado deve ser registrado primeiro em mapa_problemas_sistema.md.
- O mapa deve apontar, por componente, quais problemas existem, qual a origem técnica e em qual coluna/prioridade do quadro cada item está.
- Depois do registro no mapa, o problema deve virar card na coluna apropriada.
- O diagnóstico longo continua em docs/architecture/diagnostics, docs/architecture/maps e docs/architecture/plans; o kanban não duplica análise extensa.

## Regras
- Cada card deve ter um ID único no formato KB-XXX.
- Ao iniciar, mover o card de Pendente para em_andamento.md.
- Ao finalizar com validação, mover para concluido.md com data e evidência.
- Não iniciar card crítico novo sem fechar ou pausar explicitamente o crítico atual.
- Todo card concluído precisa de evidência objetiva: compilação, teste ou log de validação.
- Todo problema novo identificado deve ser registrado primeiro em mapa_problemas_sistema.md.
