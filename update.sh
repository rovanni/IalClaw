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

GIT_STATUS=$(git status --porcelain | grep -vE '^[ MARCUD?!]{2} (.+ -> )?workspace/' || true)
STASHED=false
if [ -n "$GIT_STATUS" ]; then
	echo "      Alterações locais detectadas — guardando automaticamente..."
	git stash push -u -m "ialclaw-update-$(date +%Y%m%d_%H%M%S)" || {
		echo "[ERRO] Falha ao guardar alterações locais (git stash)."
		echo "        Resolva manualmente: git status"
		exit 1
	}
	STASHED=true
	echo "      Stash criado com sucesso."
fi
echo ""

echo "[2/5] 🌐 Baixando a versão mais recente do repositório..."
git fetch origin || { echo "[ERRO] Falha ao conectar com o GitHub."; exit 1; }

git pull --ff-only || { echo "[ERRO] Falha ao sincronizar arquivos via fast-forward."; exit 1; }
echo "      Sincronização concluída."

if [ "$STASHED" = true ]; then
	echo "      Restaurando alterações locais..."
	if git stash pop; then
		echo "      Alterações restauradas com sucesso."
	else
		echo ""
		echo "[AVISO] Conflito ao restaurar alterações locais."
		echo "        Suas alterações estão salvas em: git stash list"
		echo "        Resolva depois com: git stash pop"
	fi
fi
echo ""

echo "[3/5] ⚙️ Instalando dependências travadas do projeto (NPM CI)..."
npm ci || { echo "[ERRO] Falha ao instalar pacotes NPM com npm ci."; exit 1; }
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
echo "=================================================="
echo "  🐙 Para iniciar o IalClaw:"
echo "=================================================="
echo ""
echo "  Foreground (dev):    node bin/ialclaw.js start"
echo "  Background (VPS):    node bin/ialclaw.js start --daemon"
echo "  Debug:               node bin/ialclaw.js start --debug"
echo ""
echo "  Gerenciar:"
echo "    node bin/ialclaw.js status"
echo "    node bin/ialclaw.js logs --follow"
echo "    node bin/ialclaw.js stop"
echo ""
echo "Para próximas atualizações: bash update.sh"
