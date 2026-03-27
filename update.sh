#!/bin/bash

set -e

cd "$(dirname "$0")"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/i18n.sh"

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

print_step "1" "$(t 'step.backup')"
mkdir -p backups
BACKUP_DATE=$(date +"%Y%m%d_%H%M%S")
[ -f "db.sqlite" ] && cp "db.sqlite" "backups/db_backup_$BACKUP_DATE.sqlite"
[ -f ".env" ] && cp ".env" "backups/.env_backup_$BACKUP_DATE"
print_success "$(t 'step.backup_done')"
echo ""

GIT_STATUS=$(git status --porcelain | grep -vE '^[ MARCUD?!]{2} (.+ -> )?workspace/' || true)
STASHED=false
if [ -n "$GIT_STATUS" ]; then
    print_warn "$(t 'warn.local_changes')"
    git stash push -u -m "ialclaw-update-$(date +%Y%m%d_%H%M%S)" || {
        print_error "$(t 'warn.stash_error')"
        echo "        Resolva manualmente: git status"
        exit 1
    }
    STASHED=true
    print_success "$(t 'warn.stash_done')"
fi
echo ""

print_step "2" "$(t 'step.fetch')"
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
        echo "        $(t 'warn.stash_list')"
        echo "        $(t 'warn.resolve_restore')"
    fi
fi
echo ""

print_step "3" "$(t 'step.deps')"
npm ci || { print_error "$(t 'step.deps_error')"; exit 1; }
print_success "$(t 'step.deps_done')"
echo ""

print_step "4" "$(t 'step.build')"
npx tsc --noEmit || { print_error "$(t 'step.build_error')"; exit 1; }
print_success "$(t 'step.build_done')"
echo ""

print_step "5" "$(t 'step.done')"
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
