param (
    [string]$RepoUrl = "https://github.com/rovanni/IalClaw.git"
)

$ErrorActionPreference = "Stop"

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host "    Instalando IalClaw Cognitive Agent    " -ForegroundColor Cyan
Write-Host "==========================================" -ForegroundColor Cyan

# -------------------------
# CHECKS
# -------------------------

Write-Host "Verificando dependencias..."

if (-not (Get-Command git -ErrorAction SilentlyContinue)) {
    Write-Error "[ERRO] Git nao encontrado."
    exit 1
}

if (-not (Get-Command node -ErrorAction SilentlyContinue)) {
    Write-Error "[ERRO] Node.js nao encontrado."
    exit 1
}

$NodeVersionOutput = (node -v)
$NodeMajorVersion = [int]($NodeVersionOutput -replace 'v', '' -split '\.')[0]

if ($NodeMajorVersion -lt 18) {
    Write-Error "[ERRO] Node.js v18 ou superior e necessario. Versao atual: $NodeVersionOutput"
    exit 1
}

# -------------------------
# OLLAMA CHECK (IMPORTANTE)
# -------------------------

if (-not (Get-Command ollama -ErrorAction SilentlyContinue)) {
    Write-Host "[INFO] Ollama nao encontrado localmente." -ForegroundColor Cyan
    $installOllama = Read-Host "Deseja instalar o Ollama agora para rodar modelos locais? [S/n]"
    if ($installOllama -eq "" -or $installOllama -match "^[sS]") {
        Write-Host "Baixando e instalando Ollama (Windows)..." -ForegroundColor Green
        irm https://ollama.com/install.ps1 | iex
    }
    else {
        Write-Host "Instalacao do Ollama ignorada. Voce pode configurar outro provedor (.env) ou instalar depois." -ForegroundColor Cyan
    }
}
else {
    Write-Host "Ollama encontrado ✔" -ForegroundColor Green
    # Try to list, ignore error if service is stopped
    try { ollama list } catch {}
}

# -------------------------
# CLONE (Bypassed if directory exists)
# -------------------------

if (-not (Test-Path "ialclaw")) {
    Write-Host "Clonando repositorio..."
    git clone $RepoUrl ialclaw
}
else {
    Write-Host "Diretorio 'ialclaw' encontrado. Tentando sincronizar com o repositorio remoto..." -ForegroundColor Yellow
    if (Test-Path "ialclaw/.git") {
        $workingTreeDirty = $false
        $statusOutput = cmd.exe /c "git -C ialclaw status --porcelain"
        $filteredStatus = $statusOutput | Where-Object { $_ -notmatch '^[ MARCUD?!]{2}\s+(.+ -> )?workspace/' }
        if ($LASTEXITCODE -eq 0 -and -not [string]::IsNullOrWhiteSpace(($filteredStatus | Out-String))) {
            $workingTreeDirty = $true
        }

        if ($workingTreeDirty) {
            Write-Host "[ERRO] O repositorio local possui alteracoes nao commitadas e nao pode ser atualizado automaticamente." -ForegroundColor Red
            Write-Host "[ERRO] Resolva isso antes de continuar. Fluxo recomendado:" -ForegroundColor Red
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
                Write-Host "Repositorio local atualizado com sucesso." -ForegroundColor Green
            }
            else {
                Write-Host "[ERRO] Nao foi possivel atualizar o repositorio local automaticamente." -ForegroundColor Red
                Write-Host "[ERRO] Resolva o estado do Git manualmente ou use update.bat apos limpar a arvore local." -ForegroundColor Red
                exit 1
            }
        }
        finally {
            Pop-Location
        }
    }
    else {
        Write-Host "[ERRO] .\ialclaw existe, mas nao parece ser um repositorio Git." -ForegroundColor Red
        Write-Host "[ERRO] Renomeie ou remova a pasta atual para permitir um clone limpo." -ForegroundColor Red
        exit 1
    }
}

Set-Location ialclaw

# -------------------------
# INSTALL
# -------------------------

Write-Host "Instalando dependencias via npm..."
cmd.exe /c "npm install"

# -------------------------
# ENV
# -------------------------

if (-not (Test-Path .env)) {
    Write-Host "Criando o arquivo .env..."
    if (Test-Path .env.example) {
        Copy-Item .env.example .env
    }
    else {
        Set-Content -Path .env -Value "OLLAMA_BASE_URL=http://localhost:11434`nOLLAMA_MODEL=llama3.2`nTELEGRAM_BOT_TOKEN="
    }
}

# -------------------------
# BUILD TEST
# -------------------------

Write-Host "Validando TypeScript codebase..."
cmd.exe /c "npx tsc --noEmit"

if (Test-Path "src/scripts/bootstrap-identities.ts") {
    Write-Host "Semeando identidades iniciais do gateway..."
    cmd.exe /c "npx ts-node src/scripts/bootstrap-identities.ts"
}
else {
    Write-Host "[AVISO] Bootstrap de identidades nao encontrado nesta copia local. Etapa ignorada." -ForegroundColor Yellow
    Write-Host "[AVISO] Atualize o repositorio local para obter o script src/scripts/bootstrap-identities.ts." -ForegroundColor Yellow
}

# -------------------------
# DONE
# -------------------------

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Instalacao concluida com sucesso!        " -ForegroundColor Green
Write-Host ""
Write-Host " >> PROXIMO PASSO:" -ForegroundColor Yellow
Write-Host " 1. Acesse a pasta do agente:"
Write-Host "    cd ialclaw" -ForegroundColor Gray
Write-Host " 2. Configure o arquivo .env (Ollama, OpenAI, Anthropic, etc)"
Write-Host " 3. Valide o Router Cerebro de teste rodando:"
Write-Host "    npx ts-node src/scripts/test-routing.ts" -ForegroundColor Gray
Write-Host " 4. Se tudo passar, execute:"
Write-Host "    npm run dev" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
