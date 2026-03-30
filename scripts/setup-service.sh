#!/bin/bash
# Automates the systemd service installation for IalClaw on Linux

set -e

# Cores para o terminal
GREEN='\033[0;32m'
CYAN='\033[0;36m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${CYAN}==========================================${NC}"
echo -e "${CYAN}    Configuração Automática de Serviço    ${NC}"
echo -e "${CYAN}==========================================${NC}"

if [[ $EUID -ne 0 ]]; then
   echo -e "${RED}[ERRO] Este script precisa ser executado com sudo.${NC}"
   echo -e "Tente novamente com: ${GREEN}sudo bash scripts/setup-service.sh${NC}"
   exit 1
fi

# Detectar diretório e usuário (usando logname para pegar o usuário real, não o root do sudo)
CURRENT_DIR=$(pwd)
REAL_USER=$(logname || echo $SUDO_USER || whoami)
NODE_EXEC=$(which node || echo "/usr/bin/node")

if [ ! -f "ialclaw.service.start" ]; then
    echo -e "${RED}[ERRO] Arquivo ialclaw.service.start não encontrado na raiz do projeto.${NC}"
    exit 1
fi

echo -e "Detectado Usuário: ${GREEN}$REAL_USER${NC}"
echo -e "Detectado Caminho: ${GREEN}$CURRENT_DIR${NC}"
echo -e "Detectado Node:    ${GREEN}$NODE_EXEC${NC}"

# Aplicar substituições no template e salvar no systemd
sed "s|%USER%|$REAL_USER|g; s|%PATH%|$CURRENT_DIR|g; s|/usr/bin/node|$NODE_EXEC|g" ialclaw.service.start > /etc/systemd/system/ialclaw.service

echo -e "${CYAN}Recarregando systemd...${NC}"
systemctl daemon-reload

echo -e "${CYAN}Ativando serviço no boot...${NC}"
systemctl enable ialclaw

echo -e "${CYAN}Iniciando serviço agora...${NC}"
systemctl restart ialclaw

echo -e ""
echo -e "${GREEN}==========================================${NC}"
echo -e "${GREEN}   Serviço IalClaw configurado com sucesso! ${NC}"
echo -e "${GREEN}==========================================${NC}"
echo -e "Status: ${CYAN}systemctl status ialclaw${NC}"
echo -e "Logs:   ${CYAN}journalctl -u ialclaw -f${NC}"
echo -e "=========================================="
