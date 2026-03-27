@echo off
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "RESET=%ESC%[0m"
set "BOLD=%ESC%[1m"
set "DIM=%ESC%[2m"
set "CYAN=%ESC%[36m"
set "GREEN=%ESC%[32m"
set "YELLOW=%ESC%[33m"
set "RED=%ESC%[31m"
set "BLUE=%ESC%[34m"

echo.
echo %DIM%========================================================%RESET%
echo %CYAN%  IALCLAW%RESET% %DIM%Updater%RESET%
echo %DIM%  -----------------------------------------------%RESET%
echo   estilo:  %GREEN%upgrade assistido%RESET%
echo   pasta:   %GREEN%%cd%%RESET%
echo %DIM%========================================================%RESET%
echo.

echo %BLUE%[1/5]%RESET% %BOLD%Realizando backup de seguranca (db.sqlite e .env)...%RESET%
if not exist "backups" mkdir backups
if exist "db.sqlite" copy /y "db.sqlite" "backups\db_backup_%date:~-4,4%%date:~-7,2%%date:~-10,2%.sqlite" >nul
if exist ".env" copy /y ".env" "backups\.env_backup_%date:~-4,4%%date:~-7,2%%date:~-10,2%" >nul
echo       %GREEN%OK%RESET% Backup concluido com sucesso.
echo.

set GIT_DIRTY=0
for /f "delims=" %%i in ('git status --porcelain') do (
    echo %%i | findstr /r /c:"^[ MARCUD?!][ MARCUD?!] .*workspace/" >nul
    if errorlevel 1 set GIT_DIRTY=1
)
set STASHED=0
if %GIT_DIRTY%==1 (
    echo       %YELLOW%AVISO%RESET% Alteracoes locais detectadas; guardando automaticamente...
    call git stash push -u -m "ialclaw-update-auto"
    if errorlevel 1 (
        echo %RED%[ERRO]%RESET% Falha ao guardar alteracoes locais.
        echo        Resolva manualmente: git status
        pause
        exit /b 1
    )
    set STASHED=1
    echo       %GREEN%OK%RESET% Stash criado com sucesso.
)
echo.

echo %BLUE%[2/5]%RESET% %BOLD%Baixando a versao mais recente do repositorio...%RESET%
call git fetch origin
if errorlevel 1 (
    echo %RED%[ERRO]%RESET% Falha ao conectar com o GitHub ^(git fetch^). Verifique sua internet.
    pause
    exit /b 1
)

call git pull --ff-only
if errorlevel 1 (
    echo %RED%[ERRO]%RESET% Falha ao aplicar a atualizacao ^(git pull --ff-only^).
    pause
    exit /b 1
)
echo       %GREEN%OK%RESET% Download e sincronizacao concluidos.

if %STASHED%==1 (
    echo       Restaurando alteracoes locais...
    call git stash pop
    if errorlevel 1 (
        echo.
        echo       %YELLOW%AVISO%RESET% Conflito ao restaurar alteracoes locais.
        echo         Suas alteracoes estao salvas em: git stash list
        echo         Resolva depois com: git stash pop
    ) else (
        echo       %GREEN%OK%RESET% Alteracoes restauradas com sucesso.
    )
)
echo.

echo %BLUE%[3/5]%RESET% %BOLD%Instalando dependencias travadas do projeto ^(npm ci^)...%RESET%
call npm ci
if errorlevel 1 (
    echo %RED%[ERRO]%RESET% Falha na instalacao de pacotes ^(npm ci^).
    pause
    exit /b 1
)
echo       %GREEN%OK%RESET% Dependencias atualizadas.
echo.

echo %BLUE%[4/5]%RESET% %BOLD%Compilando o IalClaw v3.0 ^(TypeScript^)...%RESET%
call npx tsc --noEmit
if errorlevel 1 (
    echo %RED%[ERRO]%RESET% Falha ao validar o codigo TypeScript.
    pause
    exit /b 1
)
echo       %GREEN%OK%RESET% Compilacao concluida.
echo.

echo %BLUE%[5/5]%RESET% %BOLD%Atualizacao finalizada.%RESET%
echo.
echo %GREEN%Seu IalClaw foi atualizado para a ultima versao oficial com sucesso.%RESET%
echo %DIM%Seu banco de dados e suas configuracoes permanecem intactos.%RESET%
echo.
echo %DIM%========================================================%RESET%
echo %CYAN%  Para iniciar o IalClaw%RESET%
echo %DIM%========================================================%RESET%
echo.
echo   %BOLD%Foreground%RESET%  node bin/ialclaw.js start
echo   %BOLD%Background%RESET%  node bin/ialclaw.js start --daemon
echo   %BOLD%Debug%RESET%       node bin/ialclaw.js start --debug
echo.
echo   %BOLD%Gerenciar%RESET%
echo   node bin/ialclaw.js status
echo   node bin/ialclaw.js logs --follow
echo   node bin/ialclaw.js stop
echo.
echo %DIM%Pressione qualquer tecla para fechar...%RESET%
pause >nul
