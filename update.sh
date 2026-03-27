#!/bin/bash

set -e

cd "$(dirname "$0")"

RESET='\033[0m'
BOLD='\033[1m'
DIM='\033[2m'
CYAN='\033[36m'
GREEN='\033[32m'
YELLOW='\033[33m'
RED='\033[31m'
STEP='\033[96m'

print_divider() {
    printf "%b\n" "${DIM}========================================================${RESET}"
}

print_banner() {
    echo ""
    print_divider
    printf "%b\n" "${CYAN}  IALCLAW${RESET} ${DIM}Updater${RESET}"
    printf "%b\n" "${DIM}  -----------------------------------------------${RESET}"
    printf "%b\n" "  estilo:  ${GREEN}upgrade assistido${RESET}"
    printf "%b\n" "  pasta:   ${GREEN}$(pwd)${RESET}"
    print_divider
    echo ""
}

print_step() {
    printf "%b\n" "${STEP}[$1/5]${RESET} ${BOLD}$2${RESET}"
}

print_success() {
    printf "%b\n" "      ${GREEN}OK${RESET} $1"
}

print_warn() {
    printf "%b\n" "      ${YELLOW}AVISO${RESET} $1"
}

print_error() {
    printf "%b\n" "${RED}[ERRO]${RESET} $1"
}

print_banner

print_step "1" "Realizando backup de seguranca (db.sqlite e .env)..."
mkdir -p backups
BACKUP_DATE=$(date +"%Y%m%d_%H%M%S")
[ -f "db.sqlite" ] && cp "db.sqlite" "backups/db_backup_$BACKUP_DATE.sqlite"
[ -f ".env" ] && cp ".env" "backups/.env_backup_$BACKUP_DATE"
print_success "Backup concluido com sucesso."
echo ""

GIT_STATUS=$(git status --porcelain | grep -vE '^[ MARCUD?!]{2} (.+ -> )?workspace/' || true)
STASHED=false
if [ -n "$GIT_STATUS" ]; then
    print_warn "Alteracoes locais detectadas; guardando automaticamente..."
    git stash push -u -m "ialclaw-update-$(date +%Y%m%d_%H%M%S)" || {
        print_error "Falha ao guardar alteracoes locais (git stash)."
        echo "        Resolva manualmente: git status"
        exit 1
    }
    STASHED=true
    print_success "Stash criado com sucesso."
fi
echo ""

print_step "2" "Baixando a versao mais recente do repositorio..."
git fetch origin || { print_error "Falha ao conectar com o GitHub."; exit 1; }
git pull --ff-only || { print_error "Falha ao sincronizar arquivos via fast-forward."; exit 1; }
print_success "Sincronizacao concluida."

if [ "$STASHED" = true ]; then
    echo "      Restaurando alteracoes locais..."
    if git stash pop; then
        print_success "Alteracoes restauradas com sucesso."
    else
        echo ""
        print_warn "Conflito ao restaurar alteracoes locais."
        echo "        Suas alteracoes estao salvas em: git stash list"
        echo "        Resolva depois com: git stash pop"
    fi
fi
echo ""

print_step "3" "Instalando dependencias travadas do projeto (npm ci)..."
npm ci || { print_error "Falha ao instalar pacotes NPM com npm ci."; exit 1; }
print_success "Dependencias atualizadas."
echo ""

print_step "4" "Compilando o IalClaw v3.0 (TypeScript)..."
npx tsc --noEmit || { print_error "Falha ao validar o codigo TypeScript."; exit 1; }
print_success "Compilacao concluida."
echo ""

print_step "5" "Atualizacao finalizada."
echo ""
printf "%b\n" "${GREEN}Seu IalClaw foi atualizado para a ultima versao oficial com sucesso.${RESET}"
printf "%b\n" "${DIM}Seu banco de dados e suas configuracoes permanecem intactos.${RESET}"
echo ""
print_divider
printf "%b\n" "${CYAN}  Para iniciar o IalClaw${RESET}"
print_divider
echo ""
printf "%b\n" "  ${BOLD}Foreground${RESET}  node bin/ialclaw.js start"
printf "%b\n" "  ${BOLD}Background${RESET}  node bin/ialclaw.js start --daemon"
printf "%b\n" "  ${BOLD}Debug${RESET}       node bin/ialclaw.js start --debug"
echo ""
printf "%b\n" "  ${BOLD}Gerenciar${RESET}"
printf "%b\n" "  node bin/ialclaw.js status"
printf "%b\n" "  node bin/ialclaw.js logs --follow"
printf "%b\n" "  node bin/ialclaw.js stop"
echo ""
printf "%b\n" "${DIM}Para proximas atualizacoes: bash update.sh${RESET}"
