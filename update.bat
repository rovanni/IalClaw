@echo off
setlocal

echo ===================================================
echo     🔄 IALCLAW COGNITIVE AGENT - UPDATER
echo ===================================================
echo.

cd /d "%~dp0"

echo [1/5] 📦 Realizando backup de seguranca (db.sqlite e .env)...
if not exist "backups" mkdir backups
if exist "db.sqlite" copy /y "db.sqlite" "backups\db_backup_%date:~-4,4%%date:~-7,2%%date:~-10,2%.sqlite" >nul
if exist ".env" copy /y ".env" "backups\.env_backup_%date:~-4,4%%date:~-7,2%%date:~-10,2%" >nul
echo       Backup concluido com sucesso.
echo.

for /f "delims=" %%i in ('git status --porcelain') do (
    echo %%i | findstr /r /c:"^[ MARCUD?!][ MARCUD?!] .*workspace/" >nul
    if errorlevel 1 set GIT_DIRTY=1
)
if defined GIT_DIRTY (
    echo [ERRO] O repositorio possui alteracoes locais e a atualizacao automatica foi interrompida para evitar perda de trabalho.
    echo [ERRO] Resolva com commit ou stash antes de continuar. Exemplo:
    echo        git status
    echo        git stash push -u -m "ialclaw-update"
    echo        update.bat
    pause
    exit /b 1
)

echo [2/5] 🌐 Baixando a versao mais recente do repositorio...
call git fetch origin
if errorlevel 1 (
    echo [ERRO] Falha ao conectar com o GitHub (git fetch). Verifique sua internet.
    pause
    exit /b 1
)

call git pull --ff-only
if errorlevel 1 (
    echo [ERRO] Falha ao aplicar a atualizacao (git pull --ff-only).
    pause
    exit /b 1
)
echo       Download e sincronizacao concluidos.
echo.

echo [3/5] ⚙️ Instalando dependencias travadas do projeto (NPM CI)...
call npm ci
if errorlevel 1 (
    echo [ERRO] Falha na instalacao de pacotes (npm ci).
    pause
    exit /b 1
)
echo       Dependencias atualizadas.
echo.

echo [4/5] 🔨 Compilando o IalClaw v3.0 (TypeScript)...
call npx tsc --noEmit
if errorlevel 1 (
    echo [ERRO] Falha ao validar o typescript (npx tsc --noEmit).
    pause
    exit /b 1
)
echo       Compilacao concluida.
echo.

echo [5/5] 🎉 ATUALIZACAO FINALIZADA!
echo.
echo O seu IalClaw foi atualizado para a ultima versao oficial com sucesso.
echo Seu banco de dados e suas configuracoes estao intactos.
echo.
echo Pressione qualquer tecla para fechar e usar seu agente...
pause >nul
