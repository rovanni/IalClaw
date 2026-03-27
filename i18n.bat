@echo off
setlocal EnableExtensions EnableDelayedExpansion

set "IALCLAW_LANG=%IALCLAW_LANG%"
if not defined IALCLAW_LANG set "IALCLAW_LANG=pt-BR"

goto :IALCLAW_I18N_SETUP

:IALCLAW_I18N_SETUP
if /i "%IALCLAW_LANG%"=="en-US" goto :IALCLAW_I18N_EN
goto :IALCLAW_I18N_PT

:IALCLAW_I18N_PT
set "IALCLAW_T[app.title]=IALCLAW"
set "IALCLAW_T[app.updater]=Updater"
set "IALCLAW_T[app.style]=estilo:"
set "IALCLAW_T[app.folder]=pasta:"
set "IALCLAW_T[app.style.upgrade]=upgrade assistido"

set "IALCLAW_T[step.backup.title]=Realizando backup de seguranca (db.sqlite e .env)..."
set "IALCLAW_T[step.backup.ok]=Backup concluido com sucesso."
set "IALCLAW_T[step.backup.created]=Stash criado com sucesso."

set "IALCLAW_T[warning.local_changes]=AVISO"
set "IALCLAW_T[warning.local_changes.detected]=Alteracoes locais detectadas; guardando automaticamente..."
set "IALCLAW_T[warning.stash_failed]=Falha ao guardar alteracoes locais."
set "IALCLAW_T[warning.resolve_manually]=Resolva manualmente: git status"
set "IALCLAW_T[warning.conflict]=Conflito ao restaurar alteracoes locais."
set "IALCLAW_T[warning.stash_list]=Suas alteracoes estao salvas em: git stash list"
set "IALCLAW_T[warning.resolve_later]=Resolva depois com: git stash pop"
set "IALCLAW_T[warning.restored]=Alteracoes restauradas com sucesso."

set "IALCLAW_T[step.download.title]=Baixando a versao mais recente do repositorio..."
set "IALCLAW_T[error.fetch_failed]=Falha ao conectar com o GitHub (git fetch). Verifique sua internet."
set "IALCLAW_T[error.pull_failed]=Falha ao aplicar a atualizacao (git pull --ff-only)."
set "IALCLAW_T[step.download.ok]=Download e sincronizacao concluidos."

set "IALCLAW_T[step.restore.title]=Restaurando alteracoes locais..."

set "IALCLAW_T[step.deps.title]=Instalando dependencias travadas do projeto (npm ci)..."
set "IALCLAW_T[error.deps_failed]=Falha na instalacao de pacotes (npm ci)."
set "IALCLAW_T[step.deps.ok]=Dependencias atualizadas."

set "IALCLAW_T[step.build.title]=Compilando o IalClaw v3.0 (TypeScript)..."
set "IALCLAW_T[error.build_failed]=Falha ao validar o codigo TypeScript."
set "IALCLAW_T[step.build.ok]=Compilacao concluida."

set "IALCLAW_T[step.finish.title]=Atualizacao finalizada."
set "IALCLAW_T[step.finish.success]=Seu IalClaw foi atualizado para a ultima versao oficial com sucesso."
set "IALCLAW_T[step.finish.preserved]=Seu banco de dados e suas configuracoes permanecem intactos."

set "IALCLAW_T[info.start_title]=Para iniciar o IalClaw"
set "IALCLAW_T[info.foreground]=Foreground"
set "IALCLAW_T[info.background]=Background"
set "IALCLAW_T[info.debug]=Debug"
set "IALCLAW_T[info.manage]=Gerenciar"

set "IALCLAW_T[prompt.press_key]=Pressione qualquer tecla para fechar..."

goto :IALCLAW_I18N_DONE

:IALCLAW_I18N_EN
set "IALCLAW_T[app.title]=IALCLAW"
set "IALCLAW_T[app.updater]=Updater"
set "IALCLAW_T[app.style]=style:"
set "IALCLAW_T[app.folder]=folder:"
set "IALCLAW_T[app.style.upgrade]=assisted upgrade"

set "IALCLAW_T[step.backup.title]=Creating security backup (db.sqlite and .env)..."
set "IALCLAW_T[step.backup.ok]=Backup completed successfully."
set "IALCLAW_T[step.backup.created]=Stash created successfully."

set "IALCLAW_T[warning.local_changes]=WARNING"
set "IALCLAW_T[warning.local_changes.detected]=Local changes detected; stashing automatically..."
set "IALCLAW_T[warning.stash_failed]=Failed to stash local changes."
set "IALCLAW_T[warning.resolve_manually]=Resolve manually: git status"
set "IALCLAW_T[warning.conflict]=Conflict when restoring local changes."
set "IALCLAW_T[warning.stash_list]=Your changes are saved in: git stash list"
set "IALCLAW_T[warning.resolve_later]=Resolve later with: git stash pop"
set "IALCLAW_T[warning.restored]=Changes restored successfully."

set "IALCLAW_T[step.download.title]=Downloading latest version from repository..."
set "IALCLAW_T[error.fetch_failed]=Failed to connect to GitHub (git fetch). Check your internet connection."
set "IALCLAW_T[error.pull_failed]=Failed to apply update (git pull --ff-only)."
set "IALCLAW_T[step.download.ok]=Download and sync completed."

set "IALCLAW_T[step.restore.title]=Restoring local changes..."

set "IALCLAW_T[step.deps.title]=Installing locked project dependencies (npm ci)..."
set "IALCLAW_T[error.deps_failed]=Failed to install packages (npm ci)."
set "IALCLAW_T[step.deps.ok]=Dependencies updated."

set "IALCLAW_T[step.build.title]=Compiling IalClaw v3.0 (TypeScript)..."
set "IALCLAW_T[error.build_failed]=Failed to validate TypeScript code."
set "IALCLAW_T[step.build.ok]=Compilation completed."

set "IALCLAW_T[step.finish.title]=Update finished."
set "IALCLAW_T[step.finish.success]=Your IalClaw has been updated to the latest official version successfully."
set "IALCLAW_T[step.finish.preserved]=Your database and settings remain intact."

set "IALCLAW_T[info.start_title]=To start IalClaw"
set "IALCLAW_T[info.foreground]=Foreground"
set "IALCLAW_T[info.background]=Background"
set "IALCLAW_T[info.debug]=Debug"
set "IALCLAW_T[info.manage]=Manage"

set "IALCLAW_T[prompt.press_key]=Press any key to close..."

goto :IALCLAW_I18N_DONE

:IALCLAW_I18N_DONE
goto :eof

:ialclaw_t
set "IALCLAW_T_RESULT=!IALCLAW_T[%~1]!"
if not defined IALCLAW_T_RESULT set "IALCLAW_T_RESULT=[%~1]"
exit /b 0
