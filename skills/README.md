# Skills do IalClaw

Esta pasta agrupa skills baseadas em conteúdo e instruções.

## Estrutura de pastas

```
skills/
  internal/          ← skills internas do IalClaw (confiáveis, sem auditoria)
    skill-auditor/   ← auditor de segurança de skills públicas
  public/            ← skills de terceiros (precisam passar pelo skill-auditor)
  quarantine/        ← skills bloqueadas após auditoria
```

## Regra operacional

1. **`skills/internal/`** — skills mantidas no próprio repositório do IalClaw. São carregadas diretamente no boot sem necessidade de auditoria.
2. **`skills/public/`** — skills de terceiros (ex: baixadas de skills.sh, ClawHub, etc). Só são ativadas pelo runtime após aprovação via `skill-auditor`. Skills sem entrada no log de auditoria são **ignoradas** por padrão.
3. **`skills/quarantine/`** — skills públicas com risco alto ou bloqueadas. Nunca são carregadas.

## Como adicionar uma skill pública

1. Copiar a pasta da skill para `skills/public/<nome>/`
2. Rodar `/skill-auditor <nome>` no Telegram para auditar
3. Se aprovada, a decisão é salva em `data/skill-audit-log.json`
4. No próximo boot do agente, a skill será carregada automaticamente

## Como remover uma skill pública

Basta excluir a pasta de `skills/public/<nome>/`. O agente não a encontrará no próximo boot.

## Como bloquear ou colocar em quarentena

Mover manualmente a pasta:
```bash
mv skills/public/<nome> skills/quarantine/<nome>
```
Ou deixar o `skill-auditor` mover automaticamente ao decidir QUARENTENA.