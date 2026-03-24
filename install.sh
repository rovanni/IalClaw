#!/usr/bin/env bash
set -e

echo "=========================================="
echo "    Instalando IalClaw Cognitive Agent    "
echo "=========================================="

REPO_URL=${1:-"https://github.com/rovanni/IalClaw.git"}

# -------------------------
# CHECKS
# -------------------------

if ! command -v git &> /dev/null; then
    echo "[ERRO] Git não encontrado."
    exit 1
fi

if ! command -v node &> /dev/null; then
    echo "[ERRO] Node.js não encontrado."
    exit 1
fi

NODE_VERSION=$(node -v | sed 's/v//g' | cut -d. -f1)

if [ "$NODE_VERSION" -lt 18 ]; then
    echo "[ERRO] Node.js >= 18 é necessário."
    exit 1
fi

# -------------------------
# OLLAMA CHECK (IMPORTANTE)
# -------------------------

if ! command -v ollama &> /dev/null; then
    echo "[AVISO] Ollama não encontrado."
    echo "Instale em: https://ollama.com"
else
    echo "Ollama encontrado ✔"
    ollama list || true
fi

# -------------------------
# CLONE (Bypassed if directory exists)
# -------------------------
if [ ! -d "ialclaw" ]; then
    echo "Clonando repositório..."
    git clone "$REPO_URL" ialclaw
    cd ialclaw
else
    echo "Diretório local. Pulando clone."
fi

# -------------------------
# INSTALL
# -------------------------

echo "Instalando dependências..."
npm install

# -------------------------
# ENV
# -------------------------

if [ ! -f .env ]; then
    echo "Criando .env..."
    if [ -f .env.example ]; then
        cp .env.example .env
    else
        echo "OLLAMA_BASE_URL=http://localhost:11434" > .env
        echo "MODEL=llama3.2" >> .env
        echo "TELEGRAM_BOT_TOKEN=" >> .env
    fi
fi

# -------------------------
# BUILD TEST
# -------------------------

echo "Validando TypeScript..."
npx tsc --noEmit

# -------------------------
# DONE
# -------------------------

echo "=========================================="
echo " Instalação concluída com sucesso!"
echo ""
echo " >> PRÓXIMO PASSO:"
echo " 1. Configure o .env"
echo " 2. Valide o Router Cérebro com:"
echo "    npx ts-node src/scripts/test-routing.ts"
echo " 3. Execute:"
echo "    npm run dev"
echo "=========================================="
