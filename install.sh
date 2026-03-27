#!/usr/bin/env bash
set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
source "$SCRIPT_DIR/i18n.sh"

echo "=========================================="
echo "    Instalando IalClaw Cognitive Agent    "
echo "=========================================="

REPO_URL=${1:-"https://github.com/rovanni/IalClaw.git"}

if ! command -v git &> /dev/null; then
    echo "[ERRO] $(t 'err.git_not_found')"
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "[ERRO] $(t 'err.node_not_found')"
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//g' | cut -d. -f1)

if [ "$NODE_VERSION" -lt 18 ]; then
    echo "[ERRO] $(t 'err.node_version')"
    exit 1
fi

if ! command -v ollama &> /dev/null; then
    echo "[INFO] $(t 'err.ollama_missing')"
    
    if command -v tty >/dev/null 2>&1 && [ -c "$(tty 2>/dev/null)" ]; then
        read -p "$(t 'prompt.ollama')" install_ollama < "$(tty)"
    elif [ -c /dev/tty ]; then
        read -p "$(t 'prompt.ollama')" install_ollama < /dev/tty
    else
        install_ollama="n"
    fi
    install_ollama=${install_ollama:-s}

    if [[ "$install_ollama" =~ ^[sS]$ ]]; then
        echo "$(t 'info.install_ollama')"
        curl -fsSL https://ollama.com/install.sh | sh
    else
        echo "$(t 'info.skip_ollama')"
    fi
else
    echo "$(t 'info.ollama_found') ✔"
    ollama list || true
fi

if [ ! -d "ialclaw" ]; then
    echo "$(t 'info.clone')"
    git clone "$REPO_URL" ialclaw
else
    echo "$(t 'info.sync_attempt')"
    if [ -d "ialclaw/.git" ]; then
        GIT_STATUS=$(git -C ialclaw status --porcelain | grep -vE '^[ MARCUD?!]{2} (.+ -> )?workspace/' || true)
        if [ -n "$GIT_STATUS" ]; then
            echo "[ERRO] $(t 'err.local_changes')"
            echo "[ERRO] $(t 'err.resolve_git')"
            echo "        cd ~/ialclaw"
            echo "        git status"
            echo "        git stash push -u -m 'ialclaw-install'"
            echo "        git pull --ff-only"
            exit 1
        fi

        if git -C ialclaw pull --ff-only; then
            echo "$(t 'info.sync_done')"
        else
            echo "[ERRO] $(t 'err.update_auto')"
            echo "[ERRO] $(t 'err.git_manual')"
            exit 1
        fi
    else
        echo "[ERRO] $(t 'err.not_git')"
        echo "[ERRO] $(t 'err.rename_folder')"
        exit 1
    fi
fi

cd ialclaw || { echo "[ERRO] $(t 'err.cant_access')"; exit 1; }

chmod +x update.sh 2>/dev/null || true

echo "$(t 'info.install_deps')"
npm ci

if [ ! -f .env ]; then
    echo "$(t 'info.create_env')"
    if [ -f .env.example ]; then
        cp .env.example .env
    else
        echo "OLLAMA_BASE_URL=http://localhost:11434" > .env
        echo "OLLAMA_MODEL=llama3.2" >> .env
        echo "TELEGRAM_BOT_TOKEN=" >> .env
    fi
fi

echo "$(t 'info.validate_ts')"
npx tsc --noEmit

if [ -f "src/scripts/bootstrap-identities.ts" ]; then
    echo "$(t 'info.seed_identities')"
    npx ts-node src/scripts/bootstrap-identities.ts
else
    echo "[AVISO] $(t 'warn.bootstrap_missing')"
    echo "[AVISO] $(t 'warn.update_repo')"
fi

echo "=========================================="
echo " $(t 'info.done')"
echo ""
echo " >> $(t 'info.next_step')"
echo " 1. $(t 'info.access_folder')"
echo "    cd ialclaw"
echo " 2. $(t 'info.configure_env')"
echo " 3. $(t 'info.validate_router')"
echo "    npx ts-node src/scripts/test-routing.ts"
echo " 4. $(t 'info.run_dev')"
echo "    npm run dev"
echo " 5. $(t 'info.future_update')"
echo "    bash update.sh"
echo "=========================================="
