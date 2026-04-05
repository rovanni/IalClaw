
# Forçar nome do repositório em minúsculo para compatibilidade Linux
param (
    [string]$RepoUrl = "https://github.com/rovanni/ialclaw.git"
)

$ErrorActionPreference = "Stop"

. "$PSScriptRoot\i18n.ps1"

try { chcp.com 65001 | Out-Null } catch {}

Write-Host (t "app.header_line") -ForegroundColor Cyan
Write-Host "    $(t 'app.title')" -ForegroundColor Cyan
Write-Host (t "app.header_line") -ForegroundColor Cyan

# -------------------------
# CHECKS
# -------------------------

Write-Host (t "check.deps")

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error (t "error.git_missing")
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error (t "error.node_missing")
    exit 1
}

$NodeVersionOutput = (node -v)
$NodeMajorVersion = [int]($NodeVersionOutput -replace 'v', '' -split '\.')[0]

if ($NodeMajorVersion -lt 18) {
    Write-Error "$(t 'error.node_version')$NodeVersionOutput"
    exit 1
}

# -------------------------
# OLLAMA CHECK (IMPORTANTE)
# -------------------------

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host (t "ollama.check") -ForegroundColor Cyan
    $installOllama = Read-Host (t "ollama.prompt_install")
    if ($installOllama -eq "" -or $installOllama -match "^[sSyY]") {
        Write-Host (t "ollama.downloading") -ForegroundColor Green
        irm https://ollama.com/install.ps1 | iex
    }
    else {
        Write-Host (t "ollama.ignored") -ForegroundColor Cyan
    }
}
else {
    Write-Host "$(t 'ollama.found')" -ForegroundColor Green
    # Try to list, ignore error if service is stopped
    try { ollama list } catch {}
}

# -------------------------
# CLONE (Bypassed if directory exists)
# -------------------------

if (-not (Test-Path "ialclaw")) {
    Write-Host (t "clone.start")
    git clone $RepoUrl ialclaw
}
else {
    Write-Host (t "sync.found_folder") -ForegroundColor Yellow
    if (Test-Path "ialclaw/.git") {
        $workingTreeDirty = $false
        $statusOutput = cmd.exe /c "git -C ialclaw status --porcelain"
        $filteredStatus = $statusOutput | Where-Object { $_ -notmatch '^[ MARCUD?!]{2}\s+(.+ -> )?workspace/' }
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($filteredStatus | Out-String))) {
            $workingTreeDirty = $true
        }

        if ($workingTreeDirty) {
            Write-Host (t "sync.local_changes") -ForegroundColor Red
            Write-Host (t "sync.resolve_steps") -ForegroundColor Red
            Write-Host "       cd ~/ialclaw" -ForegroundColor Gray
            Write-Host "       git status" -ForegroundColor Gray
            Write-Host "       git stash push -u -m 'ialclaw-install'" -ForegroundColor Gray
            Write-Host "       git pull --ff-only" -ForegroundColor Gray
            exit 1
        }

        Push-Location ialclaw
        try {
            cmd.exe /c "git pull --ff-only"
            if ($LASTEXITCODE -eq 0) {
                Write-Host (t "sync.updated") -ForegroundColor Green
            }
            else {
                Write-Host (t "sync.update_failed") -ForegroundColor Red
                Write-Host (t "sync.manual_resolve") -ForegroundColor Red
                exit 1
            }
        }
        finally {
            Pop-Location
        }
    }
    else {
        Write-Host (t "sync.not_git") -ForegroundColor Red
        Write-Host (t "sync.rename_folder") -ForegroundColor Red
        exit 1
    }
}

Set-Location ialclaw

# -------------------------
# INSTALL
# -------------------------

Write-Host (t "install.deps")
cmd.exe /c "npm ci"

# -------------------------
# LANGUAGE
# -------------------------

Write-Host (t "env.select_lang")
Write-Host "pt-BR - Portugues" -ForegroundColor Gray
Write-Host "en-US - English" -ForegroundColor Gray
$selectedLang = Read-Host (t "prompt.lang")
if ($selectedLang.Trim() -eq "en-US" -or $selectedLang.Trim() -eq "en") {
    $Global:IalClawLang = "en-US"
    Import-IalClawI18n
}
Write-Host "$(t 'env.lang_selected'): $Global:IalClawLang" -ForegroundColor Green
Write-Host ""

# -------------------------
# ENV
# -------------------------

if (-not (Test-Path .env)) {
    Write-Host (t "env.creating")
    if (Test-Path .env.example) {
        Copy-Item .env.example .env
    }
    else {
        Set-Content -Path .env -Value "OLLAMA_BASE_URL=http://localhost:11434`nOLLAMA_MODEL=llama3.2`nTELEGRAM_BOT_TOKEN="
    }
}

$envContent = Get-Content .env -Raw
if ($envContent -notmatch "APP_LANG=") {
    $envContent = "APP_LANG=$Global:IalClawLang`n" + $envContent
    Set-Content -Path .env -Value $envContent
}

# -------------------------
# BUILD TEST
# -------------------------

Write-Host (t "build.validating")
cmd.exe /c "npx tsc --noEmit"

if (Test-Path "src/scripts/bootstrap-identities.ts") {
    Write-Host (t "bootstrap.seeding")
    cmd.exe /c "npx ts-node src/scripts/bootstrap-identities.ts"
}
else {
    Write-Host (t "bootstrap.not_found") -ForegroundColor Yellow
    Write-Host (t "bootstrap.update_hint") -ForegroundColor Yellow
}


# Execução automática do setup interativo
Write-Host "\nIniciando configuração interativa do ambiente..." -ForegroundColor Cyan
cmd.exe /c "npm run setup"

# DONE
Write-Host (t "app.header_line") -ForegroundColor Cyan
Write-Host " $(t 'done.success')" -ForegroundColor Green
Write-Host ""
Write-Host (t "done.next_step") -ForegroundColor Yellow
Write-Host " $(t 'done.step1')"
Write-Host "    cd ialclaw" -ForegroundColor Gray
Write-Host " $(t 'done.step2')"
Write-Host "    npm run dev" -ForegroundColor Gray
Write-Host " $(t 'done.step3')"
Write-Host "    npx ts-node src/scripts/test-routing.ts" -ForegroundColor Gray
Write-Host " $(t 'done.step4')"
Write-Host "    npm run dev" -ForegroundColor Green
Write-Host (t "app.header_line") -ForegroundColor Cyan
