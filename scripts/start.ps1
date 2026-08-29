# ============ YatraFlow dev session launcher ============
# One entry point for the daily dev rituals:
#   scripts/start.ps1          -> install-if-needed + Vite dev server (logged to dev.log)
#   scripts/start.ps1 -Test    -> full test suite (vitest)
#   scripts/start.ps1 -Build   -> production build (vite build)
# Resolves paths relative to this script, so it works from any CWD.
param(
    [switch]$Test,
    [switch]$Build
)

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

# First run on a fresh clone: install dependencies before anything else.
if (-not (Test-Path (Join-Path $root 'node_modules'))) {
    Write-Host 'node_modules missing — installing dependencies...' -ForegroundColor Cyan
    npm install
    if ($LASTEXITCODE -ne 0) { Write-Error 'npm install failed' }
}

if ($Test) {
    npm test
    exit $LASTEXITCODE
}

if ($Build) {
    npm run build
    exit $LASTEXITCODE
}

# Default: dev server. Tee output to dev.log (your usual scratch log; git-ignored).
Write-Host "YatraFlow dev server starting — http://localhost:5173" -ForegroundColor Green
npm run dev 2>&1 | Tee-Object -FilePath (Join-Path $root 'dev.log') -Append
