@echo off
cls
setlocal EnableExtensions EnableDelayedExpansion

cd /d "%~dp0"

if exist "i18n.bat" call i18n.bat

for /f %%a in ('echo prompt $E ^| cmd') do set "ESC=%%a"
set "RESET=%ESC%[0m"
set "BOLD=%ESC%[1m"
set "DIM=%ESC%[2m"
set "CYAN=%ESC%[36m"
set "GREEN=%ESC%[32m"
set "YELLOW=%ESC%[33m"
set "RED=%ESC%[31m"
set "STEP=%ESC%[96m"

set "TITLE=IALCLAW Updater"
set "STYLE=upgrade assistido"
if defined IALCLAW_T[app.title] (
    set "TITLE=!IALCLAW_T[app.title]!"
    if defined IALCLAW_T[app.updater] set "TITLE=!TITLE! !IALCLAW_T[app.updater]!"
    if defined IALCLAW_T[app.style.upgrade] set "STYLE=!IALCLAW_T[app.style.upgrade]!"
)

echo.
echo %DIM%========================================================%RESET%
echo %CYAN%  🐙 %TITLE%%RESET% %DIM%Updater%RESET%
echo %DIM%-----------------------------------------------%RESET%
call:print_val "app.style" "estilo:"
call:print_val "app.folder" "pasta:"
echo %DIM%========================================================%RESET%
echo.

:: --- DETECÇÃO E PARADA ---
set WAS_RUNNING=0
set "MSG=step.stop"
set "MSG_FALLBACK=Detectando e parando o agente para atualizacao..."
call:echo_simple_step "*" "%MSG%"

if exist ".ialclaw\pid" (
    set /p PID=<.ialclaw\pid
    tasklist /FI "PID eq !PID!" 2>NUL | find /I "!PID!" >NUL
    if !ERRORLEVEL!==0 (
        set WAS_RUNNING=1
        echo       Parando daemon manual (PID !PID!)...
        call node bin\ialclaw.js stop
    )
)
echo.

:: --- PASSO 1: BACKUP ---
set "MSG=step.backup.title"
set "MSG_FALLBACK=Realizando backup de seguranca (db.sqlite e .env)..."
call:echo_step "1/5" "%MSG%"

if not exist "backups" mkdir backups
set "B_DATE=%date:~-4,4%%date:~-7,2%%date:~-10,2%_%time:~0,2%%time:~3,2%%time:~6,2%"
set "B_DATE=!B_DATE: =0!"

if exist "ialclaw.sqlite" copy /y "ialclaw.sqlite" "backups\ialclaw_backup_!B_DATE!.sqlite" >nul
if exist "db.sqlite" copy /y "db.sqlite" "backups\db_backup_!B_DATE!.sqlite" >nul
if exist ".env" copy /y ".env" "backups\.env_backup_!B_DATE!" >nul

:: Limpeza automática: manter apenas os 30 backups mais recentes
pushd backups
for /f "skip=30 delims=" %%F in ('dir /b /a-d /o-d') do del /f "%%F"
popd

set "MSG=step.backup.ok"
set "MSG_FALLBACK=Backup concluido com sucesso."
call:echo_ok
echo.

:: --- PASSO 2: ATUALIZAÇÃO GIT ---
set GIT_DIRTY=0
for /f "delims=" %%i in ('git status --porcelain') do (
    echo %%i | findstr /r /c:"^[ MARCUD?!][ MARCUD?!] .*workspace/" >nul
    if errorlevel 1 set GIT_DIRTY=1
)
set STASHED=0
if %GIT_DIRTY%==1 (
    set "MSG=warning.local_changes.detected"
    set "MSG_FALLBACK=Alteracoes locais detectadas; guardando automaticamente..."
    set "MSG_HEADER=warning.local_changes"
    set "HEADER_FALLBACK=AVISO"
    call:echo_warn
    
    call git stash push -u -m "ialclaw-update-auto"
    if errorlevel 1 (
        set "MSG=warning.stash_failed"
        set "MSG_FALLBACK=Falha ao guardar alteracoes locais."
        call:echo_error
        set "MSG=warning.resolve_manually"
        set "MSG_FALLBACK=Resolva manualmente: git status"
        echo        !RESULT!
        pause
        exit /b 1
    )
    set STASHED=1
    set "MSG=step.backup.created"
    set "MSG_FALLBACK=Stash criado com sucesso."
    call:echo_ok
)

set "MSG=step.download.title"
set "MSG_FALLBACK=Baixando a versao mais recente do repositorio..."
call:echo_step "2/5"

call git fetch origin
if errorlevel 1 (
    set "MSG=error.fetch_failed"
    set "MSG_FALLBACK=Falha ao conectar com o GitHub (git fetch). Verifique sua internet."
    call:echo_error
    pause
    exit /b 1
)

call git pull --ff-only
if errorlevel 1 (
    set "MSG=error.pull_failed"
    set "MSG_FALLBACK=Falha ao aplicar a atualizacao (git pull --ff-only)."
    call:echo_error
    pause
    exit /b 1
)
set "MSG=step.download.ok"
set "MSG_FALLBACK=Download e sincronizacao concluidos."
call:echo_ok

if %STASHED%==1 (
    set "MSG=step.restore.title"
    set "MSG_FALLBACK=Restaurando alteracoes locais..."
    echo       !RESULT!
    call git stash pop
    if errorlevel 1 (
        echo.
        set "MSG=warning.conflict"
        set "MSG_FALLBACK=Conflito ao restaurar alteracoes locais."
        set "MSG_HEADER=warning.local_changes"
        set "HEADER_FALLBACK=AVISO"
        call:echo_warn
    ) else (
        set "MSG=warning.restored"
        set "MSG_FALLBACK=Alteracoes restauradas com sucesso."
        call:echo_ok
    )
)
echo.

:: --- PASSO 3: DEPENDÊNCIAS ---
set "MSG=step.deps.title"
set "MSG_FALLBACK=Instalando dependencias travadas do projeto (npm ci)..."
call:echo_step "3/5"

call npm ci
if errorlevel 1 (
    set "MSG=error.deps_failed"
    set "MSG_FALLBACK=Falha na instalacao de pacotes (npm ci)."
    call:echo_error
    pause
    exit /b 1
)
set "MSG=step.deps.ok"
set "MSG_FALLBACK=Dependencias atualizadas."
call:echo_ok
echo.

:: --- PASSO 4: COMPILAÇÃO ---
set "MSG=step.build.title"
set "MSG_FALLBACK=Compilando o IalClaw v3.0 (TypeScript)..."
call:echo_step "4/5"

call npx tsc --noEmit
if errorlevel 1 (
    set "MSG=error.build_failed"
    set "MSG_FALLBACK=Falha ao validar o codigo TypeScript."
    call:echo_error
    pause
    exit /b 1
)
set "MSG=step.build.ok"
set "MSG_FALLBACK=Compilacao concluida."
call:echo_ok
echo.

:: --- PASSO 5: FINALIZAÇÃO E REINÍCIO ---
set "MSG=step.finish.title"
set "MSG_FALLBACK=Atualizacao finalizada."
call:echo_step "5/5"

if !WAS_RUNNING!==1 (
    echo.
    set "RESULT=!IALCLAW_T[prompt.restart_after_update]!"
    if not defined RESULT set "RESULT=O agente estava rodando antes da atualizacao. Deseja iniciar novamente agora? [S/N]"
    choice /C SN /N /M "      !RESULT! "

    if !ERRORLEVEL!==1 (
        set "MSG=step.restart"
        set "MSG_FALLBACK=Reiniciando o agente..."
        call:echo_simple_step "*" "%MSG%"
        start /b node bin\ialclaw.js start --daemon
    ) else (
        set "RESULT=!IALCLAW_T[info.restart_skipped]!"
        if not defined RESULT set "RESULT=Reinicio ignorado. Voce pode iniciar depois com: node bin/ialclaw.js start --daemon"
        echo       %YELLOW%AVISO%RESET% !RESULT!
    )
)

echo.
set "MSG=step.finish.success"
set "MSG_FALLBACK=Seu IalClaw foi atualizado para a ultima versao oficial com sucesso."
call:echo_green
set "MSG=step.finish.preserved"
set "MSG_FALLBACK=Seu banco de dados e suas configuracoes permanecem intactos."
call:echo_dim
echo.

echo %DIM%========================================================%RESET%
set "MSG=info.start_title"
set "MSG_FALLBACK=Para iniciar o IalClaw"
echo %CYAN%  🐙 !RESULT!%RESET%
echo %DIM%========================================================%RESET%
echo.

set "MSG=info.foreground"
set "MSG_FALLBACK=Foreground"
echo   %BOLD%!RESULT!%RESET%  node bin/ialclaw.js start
set "MSG=info.background"
set "MSG_FALLBACK=Background"
echo   %BOLD%!RESULT!%RESET%  node bin/ialclaw.js start --daemon
set "MSG=info.debug"
set "MSG_FALLBACK=Debug"
echo   %BOLD%!RESULT!%RESET%       node bin/ialclaw.js start --debug
echo.

set "MSG=info.manage"
set "MSG_FALLBACK=Gerenciar"
echo   %BOLD%!RESULT!%RESET%
echo   node bin/ialclaw.js status
echo   node bin/ialclaw.js logs --follow
echo   node bin/ialclaw.js stop
echo.

set "MSG=prompt.press_key"
set "MSG_FALLBACK=Pressione qualquer tecla para fechar..."
call:echo_dim
pause >nul
exit /b 0

:echo_step
set "STEP_NUM=%~1"
set "RESULT=!IALCLAW_T[%MSG%]!"
if not defined RESULT set "RESULT=%MSG_FALLBACK%"
echo %STEP%[%STEP_NUM%]%RESET% %BOLD%%RESULT%%RESET%
exit /b 0

:echo_simple_step
set "STEP_CHAR=%~1"
set "RESULT=!IALCLAW_T[%~2]!"
if not defined RESULT set "RESULT=%MSG_FALLBACK%"
echo %STEP%[%STEP_CHAR%]%RESET% %BOLD%%RESULT%%RESET%
exit /b 0

:echo_ok
set "RESULT=!IALCLAW_T[%MSG%]!"
if not defined RESULT set "RESULT=%MSG_FALLBACK%"
echo       %GREEN%OK%RESET% %RESULT%
exit /b 0

:echo_error
set "RESULT=!IALCLAW_T[%MSG%]!"
if not defined RESULT set "RESULT=%MSG_FALLBACK%"
echo %RED%[ERRO]%RESET% %RESULT%
exit /b 0

:echo_warn
set "HEADER=!IALCLAW_T[%MSG_HEADER%]!"
if not defined HEADER set "HEADER=%HEADER_FALLBACK%"
set "RESULT=!IALCLAW_T[%MSG%]!"
if not defined RESULT set "RESULT=%MSG_FALLBACK%"
echo       %YELLOW%%HEADER%%RESET% %RESULT%
exit /b 0

:echo_green
set "RESULT=!IALCLAW_T[%MSG%]!"
if not defined RESULT set "RESULT=%MSG_FALLBACK%"
echo %GREEN%%RESULT%%RESET%
exit /b 0

:echo_dim
set "RESULT=!IALCLAW_T[%MSG%]!"
if not defined RESULT set "RESULT=%MSG_FALLBACK%"
echo %DIM%%RESULT%%RESET%
exit /b 0

:print_val
set "KEY=%~1"
set "LABEL=%~2"
set "VAL=!IALCLAW_T[%KEY%]!"
if not defined VAL set "VAL=%LABEL%"
echo   !VAL! %GREEN%%cd%%RESET%
exit /b 0
