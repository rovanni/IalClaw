$Utf8NoBom = [System.Text.UTF8Encoding]::new($false)

function Set-IalClawConsoleUtf8 {
    try { [Console]::InputEncoding = $Utf8NoBom } catch {}
    try { [Console]::OutputEncoding = $Utf8NoBom } catch {}
    try { $global:OutputEncoding = $Utf8NoBom } catch {}
    try { chcp.com 65001 | Out-Null } catch {}
}

Set-IalClawConsoleUtf8

$Global:IalClawFallback = "pt-BR"

if (Test-Path (Join-Path $PSScriptRoot "config.json")) {
    try {
        $config = Get-Content (Join-Path $PSScriptRoot "config.json") -Raw | ConvertFrom-Json
        if ($config.language) { $Global:IalClawLang = $config.language }
    }
    catch { $Global:IalClawLang = $env:IALCLAW_LANG }
}
elseif (Test-Path (Join-Path $PSScriptRoot ".env")) {
    $envContent = Get-Content (Join-Path $PSScriptRoot ".env") -Raw
    if ($envContent -match "APP_LANG=([^\s#]+)") {
        $Global:IalClawLang = $matches[1]
    }
}
else {
    $Global:IalClawLang = if ($env:IALCLAW_LANG) { $env:IALCLAW_LANG } else { "pt-BR" }
}

$Global:IalClawTranslations = @{}

$Global:IalClawI18nDir = Split-Path -Parent $PSCommandPath
$Global:IalClawI18nFile = Join-Path $Global:IalClawI18nDir "i18n.json"

function Import-IalClawI18n {
    if (-not (Test-Path $Global:IalClawI18nFile)) {
        Use-IalClawI18nFallback
        return
    }

    try {
        $json = Get-Content $Global:IalClawI18nFile -Raw | ConvertFrom-Json
        
        $langData = $json.$Global:IalClawLang
        if (-not $langData) {
            $langData = $json.$Global:IalClawFallback
        }
        
        if ($langData) {
            $langData.PSObject.Properties | ForEach-Object {
                $Global:IalClawTranslations[$_.Name] = $_.Value
            }
            return
        }
    }
    catch {
    }

    Use-IalClawI18nFallback
}

function Use-IalClawI18nFallback {
    if ($Global:IalClawLang -eq "pt-BR") {
        $Global:IalClawTranslations = @{
            "app.title" = "IALCLAW"
            "app.subtitle" = "Updater"
            "app.style" = "upgrade assistido"
            "step.backup" = "Realizando backup..."
            "step.backup_done" = "Backup concluido."
            "step.fetch" = "Baixando versao..."
            "step.fetch_error" = "Falha ao conectar."
            "step.pull_error" = "Falha no pull."
            "step.sync_done" = "Sincronizacao concluida."
            "step.deps" = "Instalando dependencias..."
            "step.deps_error" = "Falha ao instalar."
            "step.deps_done" = "Dependencias atualizadas."
            "step.build" = "Compilando..."
            "step.build_error" = "Falha na compilacao."
            "step.build_done" = "Compilacao concluida."
            "step.done" = "Atualizacao finalizada."
            "step.final_success" = "Atualizado com sucesso."
            "step.final_preserve" = "Dados preservados."
            "msg.start" = "Para iniciar"
            "msg.foreground" = "Foreground"
            "msg.background" = "Background"
            "msg.debug" = "Debug"
            "msg.manage" = "Gerenciar"
            "msg.update_cmd" = "Atualizar: bash update.sh"
            "warn.local_changes" = "Alteracoes detectadas..."
            "warn.stash_error" = "Falha no stash."
            "warn.stash_done" = "Stash criado."
            "warn.restore" = "Restaurando..."
            "warn.restore_done" = "Restaurado."
            "warn.conflict" = "Conflito."
            "warn.stash_list" = "Stash em: git stash list"
            "warn.resolve_restore" = "Resolva com: git stash pop"
            "warn.bootstrap_missing" = "Bootstrap nao encontrado."
            "warn.update_repo" = "Atualize o repositorio."
            "err.git_not_found" = "Git nao encontrado."
            "err.node_not_found" = "Node.js nao encontrado."
            "err.node_version" = "Node.js >= 18 necessario."
            "err.ollama_missing" = "Ollama nao encontrado."
            "err.local_changes" = "Alteracoes locais detectadas."
            "err.resolve_git" = "Resolva antes de continuar."
            "err.not_git" = "Nao e repositorio Git."
            "err.rename_folder" = "Remova/renomeie a pasta."
            "err.cant_access" = "Nao foi acessar pasta."
            "err.update_auto" = "Nao foi atualizar."
            "err.git_manual" = "Resolva o Git manualmente."
            "info.ollama_found" = "Ollama encontrado"
            "info.clone" = "Clonando..."
            "info.sync_attempt" = "Sincronizando..."
            "info.sync_done" = "Sincronizado."
            "info.install_deps" = "Instalando..."
            "info.create_env" = "Criando .env..."
            "info.validate_ts" = "Validando..."
            "info.seed_identities" = "Semeando..."
            "info.install_ollama" = "Instalando Ollama..."
            "info.skip_ollama" = "Ollama ignorado."
            "info.next_step" = "PROXIMO PASSO:"
            "info.access_folder" = "Acesse a pasta:"
            "info.configure_env" = "Configure o .env"
            "info.validate_router" = "Valide com:"
            "info.run_dev" = "Execute:"
            "info.future_update" = "Para atualizar:"
            "info.done" = "Instalacao concluida!"
            "prompt.ollama" = "Instalar Ollama? (s/n): "
            "prompt.lang" = "Selecione o idioma (pt-BR/en-US): "
            "env.select_lang" = "Selecionando idioma..."
            "env.lang_selected" = "Idioma definido para"
        }
    }
    else {
        $Global:IalClawTranslations = @{
            "app.title" = "IALCLAW"
            "app.subtitle" = "Updater"
            "app.style" = "assisted upgrade"
            "step.backup" = "Creating backup..."
            "step.backup_done" = "Backup done."
            "step.fetch" = "Fetching version..."
            "step.fetch_error" = "Connection failed."
            "step.pull_error" = "Pull failed."
            "step.sync_done" = "Sync done."
            "step.deps" = "Installing deps..."
            "step.deps_error" = "Install failed."
            "step.deps_done" = "Deps updated."
            "step.build" = "Compiling..."
            "step.build_error" = "Build failed."
            "step.build_done" = "Build done."
            "step.done" = "Update finished."
            "step.final_success" = "Updated successfully."
            "step.final_preserve" = "Data preserved."
            "msg.start" = "To start"
            "msg.foreground" = "Foreground"
            "msg.background" = "Background"
            "msg.debug" = "Debug"
            "msg.manage" = "Manage"
            "msg.update_cmd" = "Update: bash update.sh"
            "warn.local_changes" = "Changes detected..."
            "warn.stash_error" = "Stash failed."
            "warn.stash_done" = "Stash done."
            "warn.restore" = "Restoring..."
            "warn.restore_done" = "Restored."
            "warn.conflict" = "Conflict."
            "warn.stash_list" = "Stash at: git stash list"
            "warn.resolve_restore" = "Resolve with: git stash pop"
            "warn.bootstrap_missing" = "Bootstrap not found."
            "warn.update_repo" = "Update repo."
            "err.git_not_found" = "Git not found."
            "err.node_not_found" = "Node.js not found."
            "err.node_version" = "Node.js >= 18 required."
            "err.ollama_missing" = "Ollama not found."
            "err.local_changes" = "Local changes detected."
            "err.resolve_git" = "Resolve before continuing."
            "err.not_git" = "Not a Git repo."
            "err.rename_folder" = "Remove/rename folder."
            "err.cant_access" = "Cannot access folder."
            "err.update_auto" = "Cannot update."
            "err.git_manual" = "Resolve Git manually."
            "info.ollama_found" = "Ollama found"
            "info.clone" = "Cloning..."
            "info.sync_attempt" = "Syncing..."
            "info.sync_done" = "Synced."
            "info.install_deps" = "Installing..."
            "info.create_env" = "Creating .env..."
            "info.validate_ts" = "Validating..."
            "info.seed_identities" = "Seeding..."
            "info.install_ollama" = "Installing Ollama..."
            "info.skip_ollama" = "Ollama skipped."
            "info.next_step" = "NEXT STEP:"
            "info.access_folder" = "Access folder:"
            "info.configure_env" = "Configure .env"
            "info.validate_router" = "Validate with:"
            "info.run_dev" = "Run:"
            "info.future_update" = "To update:"
            "info.done" = "Done!"
            "prompt.ollama" = "Install Ollama? (y/n): "
            "prompt.lang" = "Select language (pt-BR/en-US): "
            "env.select_lang" = "Selecting language..."
            "env.lang_selected" = "Language set to"
        }
    }
}

function t {
    param([string]$Key)
    if ($Global:IalClawTranslations.ContainsKey($Key)) {
        return $Global:IalClawTranslations[$Key]
    }
    return "[$Key]"
}

Import-IalClawI18n
