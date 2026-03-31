#!/bin/bash
# setup-permissions.sh - Configura permissões de sudo sem senha para IalClaw

set -e

# Detectar usuário alvo
if [ -n "$IALCLAW_USER" ]; then
    TARGET_USER="$IALCLAW_USER"
else
    # Pega o usuário real se rodando via sudo, senão whoami
    TARGET_USER=$(logname || echo $SUDO_USER || whoami)
fi

echo "log.system.setup_permissions_started: Iniciando configuração para $TARGET_USER"

# Proteção contra root
if [ "$TARGET_USER" = "root" ]; then
    echo "log.system.setup_permissions_skipped_already_configured: Usuário root detectado, nenhuma configuração necessária."
    exit 0
fi

SUDOERS_FILE="/etc/sudoers.d/ialclaw-${TARGET_USER}"

# Idempotência: verificar se já existe
if [ -f "$SUDOERS_FILE" ]; then
    echo "log.system.setup_permissions_skipped_already_configured: Arquivo $SUDOERS_FILE já existe."
    exit 0
fi

echo "log.system.user_detected: Configuracoes para o usuario $TARGET_USER"

# Criar arquivo temporário para validação
TEMP_SUDOERS=$(mktemp)
echo "${TARGET_USER} ALL=(ALL) NOPASSWD: /usr/bin/apt, /usr/bin/apt-get" > "$TEMP_SUDOERS"

# Validar sintaxe com visudo
if sudo visudo -cf "$TEMP_SUDOERS"; then
    # Aplicar configuração de forma segura
    cat "$TEMP_SUDOERS" | sudo tee "$SUDOERS_FILE" > /dev/null
    sudo chmod 440 "$SUDOERS_FILE"
    echo "log.system.sudoers_created: Arquivo $SUDOERS_FILE criado com sucesso."
    echo "log.system.setup_permissions_completed: Configuração finalizada."
else
    echo "log.system.setup_permissions_failed: Erro na validação do sudoers."
    rm -f "$TEMP_SUDOERS"
    exit 1
fi

rm -f "$TEMP_SUDOERS"
