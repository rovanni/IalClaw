#!/usr/bin/env bash

declare -A I18N
export I18N

_IALCLAW_I18N_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
_IALCLAW_I18N_FILE="${_IALCLAW_I18N_DIR}/i18n.json"
_IALCLAW_LANG="${IALCLAW_LANG:-${LANG:-pt-BR}}"
_IALCLAW_FALLBACK="en-US"

_i18n_load_from_json() {
    if [[ ! -f "$_IALCLAW_I18N_FILE" ]]; then
        return 1
    fi

    if command -v jq &> /dev/null; then
        local lang_data
        lang_data=$(jq -r ".$_IALCLAW_LANG // .$_IALCLAW_FALLBACK" "$_IALCLAW_I18N_FILE" 2>/dev/null)
        if [[ "$lang_data" != "null" ]] && [[ -n "$lang_data" ]]; then
            while IFS= read -r line; do
                key=$(echo "$line" | sed 's/.*"\([^"]*\)".*/\1/')
                value=$(echo "$line" | sed 's/.*": *"\(.*\)".*/\1/')
                [[ -n "$key" ]] && [[ -n "$value" ]] && I18N["$key"]="$value"
            done < <(echo "$lang_data" | grep -E '^\s*"[^"]+":\s*"' | sed 's/^\s*//')
            return 0
        fi
        return 1
    fi

    _i18n_load_simple "$_IALCLAW_LANG" && return 0
    _i18n_load_simple "$_IALCLAW_FALLBACK" && return 0
    
    return 1
}

_i18n_load_simple() {
    local target_lang="$1"
    
    local lines
    lines=$(sed -n "/\"$target_lang\":/,/^  }/p" "$_IALCLAW_I18N_FILE" 2>/dev/null)
    
    if [[ -z "$lines" ]]; then
        return 1
    fi
    
    while IFS= read -r line; do
        parsed=$(echo "$line" | sed 's/.*"\([^"]*\)".*: *"\([^"]*\)".*/KEY=\1 VALUE=\2/')
        key=$(echo "$parsed" | sed 's/KEY=\([^ ]*\) .*/\1/')
        value=$(echo "$parsed" | sed 's/.*VALUE=//')
        [[ -n "$key" ]] && [[ "$key" != "$parsed" ]] && [[ -n "$value" ]] && I18N["$key"]="$value"
    done < <(echo "$lines" | grep -vE '^\s*"(pt-BR|en-US)' | grep -E '^\s+"[^"]+":\s+"')
    
    if [[ ${#I18N[@]} -gt 0 ]]; then
        return 0
    fi
    return 1
}

_i18n_fallback() {
    local lang="$1"
    
    case "$lang" in
        pt|pt-BR|pt_BR)
            I18N[app.title]="IALCLAW"
            I18N[app.subtitle]="Updater"
            I18N[app.style]="upgrade assistido"
            I18N[step.backup]="Realizando backup..."
            I18N[step.backup_done]="Backup concluido."
            I18N[step.fetch]="Baixando versao..."
            I18N[step.fetch_error]="Falha ao conectar."
            I18N[step.pull_error]="Falha no pull."
            I18N[step.sync_done]="Sincronizacao concluida."
            I18N[step.deps]="Instalando dependencias..."
            I18N[step.deps_error]="Falha ao instalar."
            I18N[step.deps_done]="Dependencias atualizadas."
            I18N[step.build]="Compilando..."
            I18N[step.build_error]="Falha na compilacao."
            I18N[step.build_done]="Compilacao concluida."
            I18N[step.done]="Atualizacao finalizada."
            I18N[step.final_success]="Atualizado com sucesso."
            I18N[step.final_preserve]="Dados preservados."
            I18N[msg.start]="Para iniciar"
            I18N[msg.foreground]="Foreground"
            I18N[msg.background]="Background"
            I18N[msg.debug]="Debug"
            I18N[msg.manage]="Gerenciar"
            I18N[msg.update_cmd]="Atualizar: bash update.sh"
            I18N[warn.local_changes]="Alteracoes detectadas..."
            I18N[warn.stash_error]="Falha no stash."
            I18N[warn.stash_done]="Stash criado."
            I18N[warn.restore]="Restaurando..."
            I18N[warn.restore_done]="Restaurado."
            I18N[warn.conflict]="Conflito."
            I18N[warn.stash_list]="Stash em: git stash list"
            I18N[warn.resolve_restore]="Resolva com: git stash pop"
            I18N[warn.bootstrap_missing]="Bootstrap nao encontrado."
            I18N[warn.update_repo]="Atualize o repositorio."
            I18N[err.git_not_found]="Git nao encontrado."
            I18N[err.node_not_found]="Node.js nao encontrado."
            I18N[err.node_version]="Node.js >= 18 necessario."
            I18N[err.ollama_missing]="Ollama nao encontrado."
            I18N[err.local_changes]="Alteracoes locais detectadas."
            I18N[err.resolve_git]="Resolva antes de continuar."
            I18N[err.not_git]="Nao e repositorio Git."
            I18N[err.rename_folder]="Remova/renomeie a pasta."
            I18N[err.cant_access]="Nao foi acessar pasta."
            I18N[err.update_auto]="Nao foi atualizar."
            I18N[err.git_manual]="Resolva o Git manualmente."
            I18N[info.ollama_found]="Ollama encontrado"
            I18N[info.clone]="Clonando..."
            I18N[info.sync_attempt]="Sincronizando..."
            I18N[info.sync_done]="Sincronizado."
            I18N[info.install_deps]="Instalando..."
            I18N[info.create_env]="Criando .env..."
            I18N[info.validate_ts]="Validando..."
            I18N[info.seed_identities]="Semeando..."
            I18N[info.install_ollama]="Instalando Ollama..."
            I18N[info.skip_ollama]="Ollama ignorado."
            I18N[info.next_step]="PROXIMO PASSO:"
            I18N[info.access_folder]="Acesse a pasta:"
            I18N[info.configure_env]="Configure o .env"
            I18N[info.validate_router]="Valide com:"
            I18N[info.run_dev]="Execute:"
            I18N[info.future_update]="Para atualizar:"
            I18N[info.done]="Instalacao concluida!"
            I18N[prompt.ollama]="Instalar Ollama? (s/n): "
            ;;
        *)
            I18N[app.title]="IALCLAW"
            I18N[app.subtitle]="Updater"
            I18N[app.style]="assisted upgrade"
            I18N[step.backup]="Creating backup..."
            I18N[step.backup_done]="Backup done."
            I18N[step.fetch]="Fetching version..."
            I18N[step.fetch_error]="Connection failed."
            I18N[step.pull_error]="Pull failed."
            I18N[step.sync_done]="Sync done."
            I18N[step.deps]="Installing deps..."
            I18N[step.deps_error]="Install failed."
            I18N[step.deps_done]="Deps updated."
            I18N[step.build]="Compiling..."
            I18N[step.build_error]="Build failed."
            I18N[step.build_done]="Build done."
            I18N[step.done]="Update finished."
            I18N[step.final_success]="Updated successfully."
            I18N[step.final_preserve]="Data preserved."
            I18N[msg.start]="To start"
            I18N[msg.foreground]="Foreground"
            I18N[msg.background]="Background"
            I18N[msg.debug]="Debug"
            I18N[msg.manage]="Manage"
            I18N[msg.update_cmd]="Update: bash update.sh"
            I18N[warn.local_changes]="Changes detected..."
            I18N[warn.stash_error]="Stash failed."
            I18N[warn.stash_done]="Stash done."
            I18N[warn.restore]="Restoring..."
            I18N[warn.restore_done]="Restored."
            I18N[warn.conflict]="Conflict."
            I18N[warn.stash_list]="Stash at: git stash list"
            I18N[warn.resolve_restore]="Resolve with: git stash pop"
            I18N[warn.bootstrap_missing]="Bootstrap not found."
            I18N[warn.update_repo]="Update repo."
            I18N[err.git_not_found]="Git not found."
            I18N[err.node_not_found]="Node.js not found."
            I18N[err.node_version]="Node.js >= 18 required."
            I18N[err.ollama_missing]="Ollama not found."
            I18N[err.local_changes]="Local changes detected."
            I18N[err.resolve_git]="Resolve before continuing."
            I18N[err.not_git]="Not a Git repo."
            I18N[err.rename_folder]="Remove/rename folder."
            I18N[err.cant_access]="Cannot access folder."
            I18N[err.update_auto]="Cannot update."
            I18N[err.git_manual]="Resolve Git manually."
            I18N[info.ollama_found]="Ollama found"
            I18N[info.clone]="Cloning..."
            I18N[info.sync_attempt]="Syncing..."
            I18N[info.sync_done]="Synced."
            I18N[info.install_deps]="Installing..."
            I18N[info.create_env]="Creating .env..."
            I18N[info.validate_ts]="Validating..."
            I18N[info.seed_identities]="Seeding..."
            I18N[info.install_ollama]="Installing Ollama..."
            I18N[info.skip_ollama]="Ollama skipped."
            I18N[info.next_step]="NEXT STEP:"
            I18N[info.access_folder]="Access folder:"
            I18N[info.configure_env]="Configure .env"
            I18N[info.validate_router]="Validate with:"
            I18N[info.run_dev]="Run:"
            I18N[info.future_update]="To update:"
            I18N[info.done]="Done!"
            I18N[prompt.ollama]="Install Ollama? (y/n): "
            ;;
    esac
}

i18n_init() {
    if ! _i18n_load_from_json; then
        _i18n_fallback "$_IALCLAW_LANG"
    fi
}

t() {
    local key="$1"
    echo "${I18N[$key]:-$key}"
}

i18n_init
