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
    Write-Host "[AVISO] Ollama nao encontrado." -ForegroundColor Yellow
    Write-Host "Instale em: https://ollama.com" -ForegroundColor Yellow
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
    Set-Location ialclaw
}
else {
    Write-Host "Diretorio 'ialclaw' ja existe. Pulando clone." -ForegroundColor Yellow
}

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
        Set-Content -Path .env -Value "OLLAMA_BASE_URL=http://localhost:11434`nMODEL=llama3.2`nTELEGRAM_BOT_TOKEN="
    }
}

# -------------------------
# BUILD TEST
# -------------------------

Write-Host "Validando TypeScript codebase..."
cmd.exe /c "npx tsc --noEmit"

# -------------------------
# DONE
# -------------------------

Write-Host "==========================================" -ForegroundColor Cyan
Write-Host " Instalacao concluida com sucesso!        " -ForegroundColor Green
Write-Host ""
Write-Host " >> PROXIMO PASSO:" -ForegroundColor Yellow
Write-Host " 1. Configure o arquivo .env"
Write-Host " 2. Valide o Router Cerebro de teste rodando:"
Write-Host "    npx ts-node src/scripts/test-routing.ts" -ForegroundColor Gray
Write-Host " 3. Se tudo passar, execute:"
Write-Host "    npm run dev" -ForegroundColor Green
Write-Host "==========================================" -ForegroundColor Cyan
