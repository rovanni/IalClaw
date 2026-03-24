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

echo [2/5] 🌐 Baixando a versao mais recente do repositorio...
call git fetch origin
if errorlevel 1 (
    echo [ERRO] Falha ao conectar com o GitHub (git fetch). Verifique sua internet.
    pause
    exit /b 1
)

:: Forca o projeto local a ficar exatamente igual a versao oficial da nuvem
call git reset --hard origin/main
if errorlevel 1 (
    echo [ERRO] Falha ao aplicar a atualizacao (git reset).
    pause
    exit /b 1
)
:: Remove pastas vazias ou lixos criados acidentalmente pelo usuario que nao estao no Git
call git clean -fd >nul
echo       Download e sincronizacao concluidos.
echo.

echo [3/5] ⚙️ Instalando ou atualizando dependencias (NPM)...
call npm install
if errorlevel 1 (
    echo [ERRO] Falha na instalacao de pacotes (npm install).
    pause
    exit /b 1
)
echo       Dependencias atualizadas.
echo.

echo [4/5] 🔨 Compilando o IalClaw v3.0 (TypeScript)...
call npm run build
if errorlevel 1 (
    echo [ERRO] Falha ao compilar o typescript (npm run build).
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
