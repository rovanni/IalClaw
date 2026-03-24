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

echo "[2/5] 🌐 Baixando a versão mais recente do repositório..."
git fetch origin || { echo "[ERRO] Falha ao conectar com o GitHub."; exit 1; }

# Força a versão local a espelhar a remota (apaga commits acidentais do usuário)
git reset --hard origin/main || { echo "[ERRO] Falha ao sincronizar arquivos."; exit 1; }
git clean -fd || true # Remove lixo untracked
echo "      Sincronização concluída."
echo ""

echo "[3/5] ⚙️ Instalando ou atualizando dependências (NPM)..."
npm install || { echo "[ERRO] Falha ao instalar pacotes NPM."; exit 1; }
echo "      Dependências atualizadas."
echo ""

echo "[4/5] 🔨 Compilando o IalClaw v3.0 (TypeScript)..."
npm run build || { echo "[ERRO] Falha ao compilar o código."; exit 1; }
echo "      Compilação concluída."
echo ""

echo "[5/5] 🎉 ATUALIZAÇÃO FINALIZADA!"
echo ""
echo "O seu IalClaw foi atualizado para a última versão oficial com sucesso."
echo "Seu banco de dados e suas configurações estão intactos."
echo ""
echo "O IalClaw está pronto para uso. Pode iniciá-lo normalmente!"
