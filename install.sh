#!/usr/bin/env bash
clear
set -e

REPO_URL=${1:-"https://github.com/rovanni/IalClaw.git"}

echo "=========================================="
echo "    Instalando IalClaw Cognitive Agent    "
echo "=========================================="

echo "Verificando prerequisites..."

if ! command -v git &> /dev/null; then
    echo "[ERRO] Git nao encontrado. Instale antes de continuar."
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "[ERRO] Node.js nao encontrado. Instale antes de continuar."
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//g' | cut -d. -f1)

if [ "$NODE_VERSION" -lt 18 ]; then
    echo "[ERRO] Node.js precisa ser versao 18 ou superior."
    exit 1
fi

echo "Node.js OK (v$NODE_VERSION)"

if ! command -v ollama &> /dev/null; then
    echo "[INFO] Ollama nao encontrado."
    read -p "Deseja instalar o Ollama? (s/n): " install_ollama
    if [[ "$install_ollama" =~ ^[sS]$ ]]; then
        echo "Instalando Ollama..."
        curl -fsSL https://ollama.com/install.sh | sh
    else
        echo "Pulando instalacao do Ollama."
    fi
else
    echo "Ollama ja instalado"
    ollama list || true
fi

echo "Baixando IalClaw..."

if [ ! -d "ialclaw" ]; then
    git clone "$REPO_URL" ialclaw
    cd ialclaw
else
    if [ -d "ialclaw/.git" ]; then
        cd ialclaw
        GIT_STATUS=$(git status --porcelain | grep -vE '^[ MARCUD?!]{2} (.+ -> )?workspace/' || true)
        if [ -n "$GIT_STATUS" ]; then
            echo "[ERRO] Alteracoes locais detectadas."
            echo "Resolva com: cd ialclaw && git stash && git pull"
            exit 1
        fi
        git pull --ff-only
    else
        echo "[ERRO] Pasta ialclaw existe mas nao e um repositorio git."
        exit 1
    fi
fi

source "./i18n.sh"

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
