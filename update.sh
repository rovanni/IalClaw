#!/bin/bash
clear
set -e

if [[ "${BASH_SOURCE[0]}" == *"/"* ]]; then
    SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
else
    SCRIPT_DIR="$(pwd)"
fi

cd "$SCRIPT_DIR"

source "./i18n.sh"

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
    printf "%b\n" "${CYAN}  🐙 $(t 'app.title')${RESET} ${DIM}$(t 'app.subtitle')${RESET}"
    printf "%b\n" "${DIM}  -----------------------------------------------${RESET}"
    printf "%b\n" "  estilo:  ${GREEN}$(t 'app.style')${RESET}"
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

# --- DETECÇÃO E PARADA ---
WAS_RUNNING=false
RUN_MODE="none"

printf "%b\n" "${STEP}[*]${RESET} ${BOLD}$(t 'step.stop')${RESET}"

if systemctl is-active --quiet ialclaw 2>/dev/null; then
    WAS_RUNNING=true
    RUN_MODE="systemd"
    echo "      $(t 'info.stop_systemd' 2>/dev/null || echo "Parando serviço systemd...")"
    sudo systemctl stop ialclaw
elif [ -f ".ialclaw/pid" ]; then
    PID=$(cat .ialclaw/pid)
    if ps -p $PID > /dev/null 2>&1; then
        WAS_RUNNING=true
        RUN_MODE="daemon"
        echo "      $(t 'info.stop_daemon' 2>/dev/null || echo "Parando daemon manual...")"
        node bin/ialclaw.js stop
    fi
fi
echo ""

# --- PASSO 1: BACKUP ---
print_step "1" "$(t 'step.backup')"
mkdir -p backups
BACKUP_DATE=$(date +"%Y%m%d_%H%M%S")
[ -f "ialclaw.sqlite" ] && cp "ialclaw.sqlite" "backups/ialclaw_backup_$BACKUP_DATE.sqlite"
[ -f "db.sqlite" ] && cp "db.sqlite" "backups/db_backup_$BACKUP_DATE.sqlite"
[ -f ".env" ] && cp ".env" "backups/.env_backup_$BACKUP_DATE"
print_success "$(t 'step.backup_done')"

# Limpeza automática: manter apenas os 30 backups mais recentes
if [ -d "backups" ]; then
    (cd backups && ls -1t | tail -n +31 | xargs rm -f 2>/dev/null || true)
fi
echo ""

# --- PASSO 2: ATUALIZAÇÃO GIT ---
print_step "2" "$(t 'step.fetch')"
GIT_STATUS=$(git status --porcelain | grep -vE '^[ MARCUD?!]{2} (.+ -> )?workspace/' || true)
STASHED=false
if [ -n "$GIT_STATUS" ]; then
    print_warn "$(t 'warn.local_changes')"
    git stash push -u -m "ialclaw-update-$(date +%Y%m%d_%H%M%S)" || {
        print_error "$(t 'warn.stash_error')"
        exit 1
    }
    STASHED=true
    print_success "$(t 'warn.stash_done')"
fi

git fetch origin || { print_error "$(t 'step.fetch_error')"; exit 1; }
git pull --ff-only || { print_error "$(t 'step.pull_error')"; exit 1; }
print_success "$(t 'step.sync_done')"

if [ "$STASHED" = true ]; then
    echo "      $(t 'warn.restore')..."
    if git stash pop; then
        print_success "$(t 'warn.restore_done')"
    else
        echo ""
        print_warn "$(t 'warn.conflict')"
    fi
fi
echo ""

# --- PASSO 3: DEPENDÊNCIAS ---
print_step "3" "$(t 'step.deps')"
npm ci || { print_error "$(t 'step.deps_error')"; exit 1; }
print_success "$(t 'step.deps_done')"
echo ""

# --- PASSO 4: COMPILAÇÃO ---
print_step "4" "$(t 'step.build')"
npx tsc --noEmit || { print_error "$(t 'step.build_error')"; exit 1; }
print_success "$(t 'step.build_done')"
echo ""

# --- PASSO 5: FINALIZAÇÃO E REINÍCIO ---
print_step "5" "$(t 'step.done')"

if [ "$WAS_RUNNING" = true ]; then
    echo ""
    printf "%b\n" "${STEP}[*]${RESET} ${BOLD}$(t 'step.restart')${RESET}"
    if [ "$RUN_MODE" = "systemd" ]; then
        echo "      $(t 'info.restart_systemd' 2>/dev/null || echo "Reiniciando via systemctl...")"
        sudo systemctl start ialclaw
    else
        echo "      $(t 'info.restart_daemon' 2>/dev/null || echo "Reiniciando via daemon...")"
        node bin/ialclaw.js start --daemon
    fi
fi

echo ""
printf "%b\n" "${GREEN}$(t 'step.final_success')${RESET}"
printf "%b\n" "${DIM}$(t 'step.final_preserve')${RESET}"
echo ""
print_divider
printf "%b\n" "${CYAN}  🐙 $(t 'msg.start')${RESET}"
print_divider
echo ""
printf "%b\n" "  ${BOLD}$(t 'msg.foreground')${RESET}  node bin/ialclaw.js start"
printf "%b\n" "  ${BOLD}$(t 'msg.background')${RESET}  node bin/ialclaw.js start --daemon"
printf "%b\n" "  ${BOLD}$(t 'msg.debug')${RESET}       node bin/ialclaw.js start --debug"
echo ""
printf "%b\n" "  ${BOLD}$(t 'msg.manage')${RESET}"
printf "%b\n" "  node bin/ialclaw.js status"
printf "%b\n" "  node bin/ialclaw.js logs --follow"
printf "%b\n" "  node bin/ialclaw.js stop"
echo ""
printf "%b\n" "${DIM}$(t 'msg.update_cmd')${RESET}"
