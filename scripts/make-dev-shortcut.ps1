# ============ YatraFlow desktop launcher generator ============
# Creates a "YatraFlow Dev" desktop shortcut that opens VS Code at this repo
# and boots the dev server via scripts/start.ps1. Windows-only, run once:
#   powershell -File scripts\make-dev-shortcut.ps1
# Paths are auto-detected (VS Code may be a per-user or system install), so
# this works on any collaborator's machine unchanged.
$ErrorActionPreference = 'Stop'

if ($PSVersionTable.PSVersion.Major -lt 5) { Write-Error 'Windows PowerShell 5.1+ required' }

$root = Split-Path -Parent $PSScriptRoot

# Locate VS Code (per-user install first, then system-wide)
$codePaths = @(
    (Join-Path $env:LOCALAPPDATA 'Programs\Microsoft VS Code\Code.exe'),
    'C:\Program Files\Microsoft VS Code\Code.exe'
)
$codeExe = $codePaths | Where-Object { Test-Path $_ } | Select-Object -First 1
if (-not $codeExe) { Write-Warning 'VS Code not found — shortcut will use the default icon.' }

$ws = New-Object -ComObject WScript.Shell
$lnkPath = Join-Path ([Environment]::GetFolderPath('Desktop')) 'YatraFlow Dev.lnk'
$lnk = $ws.CreateShortcut($lnkPath)
$lnk.TargetPath = (Get-Command pwsh -ErrorAction SilentlyContinue).Source ?? 'powershell.exe'
$lnk.Arguments = "-NoProfile -WindowStyle Hidden -Command `"code '$root'; & '$root\scripts\start.ps1'`""
$lnk.WorkingDirectory = $root
if ($codeExe) { $lnk.IconLocation = "$codeExe,0" }
$lnk.Description = 'YatraFlow: open VS Code (with Cline) + start dev server'
$lnk.Save()

Write-Host "Created: $lnkPath" -ForegroundColor Green
Write-Host 'Double-click it to open VS Code + start the dev server (http://localhost:5173).'
