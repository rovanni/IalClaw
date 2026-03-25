#!/bin/bash

# Abort on errors
set -e

# Change to the directory where the script is located
cd "$(dirname "$0")"

echo "==================================================="
echo "    🔄 IALCLAW COGNITIVE AGENT - UPDATER"
echo "==================================================="
echo ""

echo "[1/5] 📦 Realizando backup de segurança (db.sqlite e .env)..."
mkdir -p backups
BACKUP_DATE=$(date +"%Y%m%d_%H%M%S")
[ -f "db.sqlite" ] && cp "db.sqlite" "backups/db_backup_$BACKUP_DATE.sqlite"
[ -f ".env" ] && cp ".env" "backups/.env_backup_$BACKUP_DATE"
echo "      Backup concluído com sucesso."
echo ""

if [ -n "$(git status --porcelain)" ]; then
	echo "[ERRO] O repositório possui alterações locais e a atualização automática foi interrompida para evitar perda de trabalho."
	echo "[ERRO] Resolva com commit ou stash antes de continuar. Exemplo:"
	echo "        git status"
	echo "        git stash push -u -m 'ialclaw-update'"
	echo "        bash update.sh"
	exit 1
fi

echo "[2/5] 🌐 Baixando a versão mais recente do repositório..."
git fetch origin || { echo "[ERRO] Falha ao conectar com o GitHub."; exit 1; }

git pull --ff-only || { echo "[ERRO] Falha ao sincronizar arquivos via fast-forward."; exit 1; }
echo "      Sincronização concluída."
echo ""

echo "[3/5] ⚙️ Instalando ou atualizando dependências (NPM)..."
npm install || { echo "[ERRO] Falha ao instalar pacotes NPM."; exit 1; }
echo "      Dependências atualizadas."
echo ""

echo "[4/5] 🔨 Compilando o IalClaw v3.0 (TypeScript)..."
npx tsc --noEmit || { echo "[ERRO] Falha ao validar o código TypeScript."; exit 1; }
echo "      Compilação concluída."
echo ""

echo "[5/5] 🎉 ATUALIZAÇÃO FINALIZADA!"
echo ""
echo "O seu IalClaw foi atualizado para a última versão oficial com sucesso."
echo "Seu banco de dados e suas configurações estão intactos."
echo ""
echo "O IalClaw está pronto para uso. Pode iniciá-lo normalmente!"
echo "Para próximas atualizações no Linux/macOS, prefira: bash update.sh"
