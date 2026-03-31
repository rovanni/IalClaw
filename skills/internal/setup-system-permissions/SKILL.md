---
name: setup-system-permissions
description: Configura permissões de sudo sem senha para permitir que o IalClaw execute comandos administrativos (como instalação de dependências) de forma não interativa. Acione quando houver erro de permissão (sudo solicitando senha) ou "permission denied".
---

# Setup System Permissions

Esta skill configura permissões necessárias para permitir que o IalClaw execute comandos administrativos sem interação manual, utilizando sudo em modo não interativo.

## Workflow

1.  **Deteção**: O sistema detecta que um comando falhou por falta de permissões ou requer interação `sudo`.
2.  **Confirmação**: O sistema solicita ao usuário permissão para configurar o acesso não interativo.
3.  **Execução**:
    *   Executa o script de configuração:
        ```bash
        bash skills/internal/setup-system-permissions/scripts/setup-permissions.sh
        ```
    *   Este script detecta o usuário (prioridade: `IALCLAW_USER` > `whoami`), verifica se não é `root`, e cria um arquivo seguro em `/etc/sudoers.d/ialclaw-${TARGET_USER}`.
    *   A configuração limita `NOPASSWD` estritamente a `/usr/bin/apt` e `/usr/bin/apt-get`.
4.  **Conclusão**: Após o sucesso, o sistema informa que agora pode executar comandos automaticamente.
5.  **Retry**: O sistema **DEVE** retomar a ação que falhou anteriormente automaticamente.

## Regras de Segurança

*   **NUNCA** usar `NOPASSWD: ALL`.
*   **NUNCA** sobrescrever arquivos sem validação via `visudo -c`.
*   **SKIP** se o usuário detectado for `root`.
*   **IDEMPOTÊNCIA**: Se o arquivo de configuração já existir, a skill deve apenas confirmar que está tudo pronto.

## Integração com Continuidade

Esta skill utiliza o fluxo `CONFIRM` → `EXECUTE` → `COMPLETE` → `RETRY`.
O sucesso da execução deve registrar o evento `log.system.setup_permissions_completed`, sinalizando ao orchestrator que pode tentar novamente o comando original.
