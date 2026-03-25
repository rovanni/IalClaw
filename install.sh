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
    echo "[INFO] Ollama não encontrado localmente."
    
    # Prompt user (handling curl | bash pipe)
    if command -v tty >/dev/null 2>&1 && [ -c "$(tty 2>/dev/null)" ]; then
        read -p "Deseja instalar o Ollama agora para rodar modelos locais? (s/n) [s]: " install_ollama < "$(tty)"
    elif [ -c /dev/tty ]; then
        read -p "Deseja instalar o Ollama agora para rodar modelos locais? (s/n) [s]: " install_ollama < /dev/tty
    else
        install_ollama="n" # Fallback em non-interactive
    fi
    install_ollama=${install_ollama:-s}

    if [[ "$install_ollama" =~ ^[sS]$ ]]; then
        echo "Baixando e instalando Ollama (Linux/macOS)..."
        curl -fsSL https://ollama.com/install.sh | sh
    else
        echo "Instalação do Ollama ignorada. Você pode instalar depois em: https://ollama.com"
    fi
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
else
    echo "Diretório local encontrado. Tentando sincronizar com o repositório remoto..."
    if [ -d "ialclaw/.git" ]; then
        GIT_STATUS=$(git -C ialclaw status --porcelain | grep -vE '^[ MARCUD?!]{2} (.+ -> )?workspace/' || true)
        if [ -n "$GIT_STATUS" ]; then
            echo "[ERRO] O repositório local possui alterações não commitadas e não pode ser atualizado automaticamente."
            echo "[ERRO] Resolva isso antes de continuar. Fluxo recomendado:"
            echo "        cd ~/ialclaw"
            echo "        git status"
            echo "        git stash push -u -m 'ialclaw-install'"
            echo "        git pull --ff-only"
            exit 1
        fi

        if git -C ialclaw pull --ff-only; then
            echo "Repositório local atualizado com sucesso."
        else
            echo "[ERRO] Não foi possível atualizar o repositório local automaticamente."
            echo "[ERRO] Resolva o estado do Git manualmente ou use ./update.sh após limpar a árvore local."
            exit 1
        fi
    else
        echo "[ERRO] ./ialclaw existe, mas não parece ser um repositório Git."
        echo "[ERRO] Renomeie ou remova a pasta atual para permitir um clone limpo."
        exit 1
    fi
fi

cd ialclaw || { echo "[ERRO] Não foi possível acessar a pasta ialclaw."; exit 1; }

chmod +x update.sh 2>/dev/null || true

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
        echo "OLLAMA_MODEL=llama3.2" >> .env
        echo "TELEGRAM_BOT_TOKEN=" >> .env
    fi
fi

# -------------------------
# BUILD TEST
# -------------------------

echo "Validando TypeScript..."
npx tsc --noEmit

if [ -f "src/scripts/bootstrap-identities.ts" ]; then
    echo "Semeando identidades iniciais do gateway..."
    npx ts-node src/scripts/bootstrap-identities.ts
else
    echo "[AVISO] Bootstrap de identidades não encontrado nesta cópia local. Etapa ignorada."
    echo "[AVISO] Atualize o repositório local para obter o script src/scripts/bootstrap-identities.ts."
fi

# -------------------------
# DONE
# -------------------------

echo "=========================================="
echo " Instalação concluída com sucesso!"
echo ""
echo " >> PRÓXIMO PASSO:"
echo " 1. Acesse a pasta do agente:"
echo "    cd ialclaw"
echo " 2. Configure o .env (defina seu provedor como Ollama, OpenAI, etc)"
echo " 3. Valide o Router Cérebro com:"
echo "    npx ts-node src/scripts/test-routing.ts"
echo " 4. Execute:"
echo "    npm run dev"
echo " 5. Para futuras atualizações no Linux/macOS, prefira:"
echo "    bash update.sh"
echo "=========================================="
