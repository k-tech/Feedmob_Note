param([switch]$Headless)

# Minework dev server launcher.
# Intended to be driven by the HE control panel (pwsh -File this.ps1 -Headless).
# ASCII-only on purpose: Windows PowerShell 5.1 mis-parses non-BOM UTF-8.

$ErrorActionPreference = 'Stop'

$Root = Split-Path -Parent $PSScriptRoot
$RuntimeDir = Join-Path $Root '.runtime'
$OutLog = Join-Path $RuntimeDir 'dev.out.log'
$ErrLog = Join-Path $RuntimeDir 'dev.err.log'
$Port = 3001

$script:Stopping = $false
$script:OriginalTreatCtrlCAsInput = $null

function Write-Step {
  param(
    [string] $Message,
    [ConsoleColor] $Color = 'Cyan'
  )
  Write-Host $Message -ForegroundColor $Color
}

function Get-NpmCommand {
  $Command = Get-Command npm.cmd -ErrorAction SilentlyContinue
  if ($Command) { return $Command.Source }

  $Command = Get-Command npm -ErrorAction SilentlyContinue
  if ($Command) { return $Command.Source }

  throw 'npm was not found. Please install Node.js first.'
}

function Stop-Port {
  param([int] $TargetPort)

  $Connections = Get-NetTCPConnection -LocalPort $TargetPort -State Listen -ErrorAction SilentlyContinue
  $ProcessIds = $Connections |
    Select-Object -ExpandProperty OwningProcess -Unique |
    Where-Object { $_ -and $_ -ne $PID }

  foreach ($ProcessId in $ProcessIds) {
    try {
      Write-Step "Cleaning port ${TargetPort}: stopping PID $ProcessId" 'Yellow'
      Stop-Process -Id $ProcessId -Force -ErrorAction SilentlyContinue
      Wait-Process -Id $ProcessId -Timeout 5 -ErrorAction SilentlyContinue
    } catch {
      Write-Step "Cleaning port ${TargetPort}: process $ProcessId already stopped" 'DarkYellow'
    }
  }
}

# Ensure .runtime and fresh log files.
New-Item -ItemType Directory -Force -Path $RuntimeDir | Out-Null
foreach ($File in @($OutLog, $ErrLog)) {
  if (Test-Path -LiteralPath $File) {
    Remove-Item -LiteralPath $File -Force -ErrorAction SilentlyContinue
  }
  New-Item -ItemType File -Force -Path $File | Out-Null
}

if (-not $Headless) {
  try { [System.Console]::Title = 'Minework Dev Server' } catch { }
  $script:OriginalTreatCtrlCAsInput = [System.Console]::TreatControlCAsInput
  [System.Console]::TreatControlCAsInput = $true
}

Write-Step 'Minework dev server launcher' 'Cyan'
Write-Host ''

# First-run dependency install.
if (-not (Test-Path -LiteralPath (Join-Path $Root 'node_modules'))) {
  Write-Step 'Installing dependencies...' 'Cyan'
  Push-Location -LiteralPath $Root
  try {
    & (Get-NpmCommand) install
  } finally {
    Pop-Location
  }
}

# First-run database initialization (Prisma + seed).
if (-not (Test-Path -LiteralPath (Join-Path $Root 'prisma\dev.db'))) {
  Write-Step 'Initializing SQLite database...' 'Cyan'
  Push-Location -LiteralPath $Root
  try {
    & (Get-NpmCommand) run db:push
    & node prisma/seed.js
  } finally {
    Pop-Location
  }
}

Write-Step "Cleaning port ${Port} before start..." 'Cyan'
Stop-Port -TargetPort $Port

Write-Step "Starting Next.js (Turbopack) on port ${Port}..." 'Green'
$Proc = Start-Process `
  -FilePath (Get-NpmCommand) `
  -ArgumentList @('run', 'dev:turbo', '--', '-p', "$Port") `
  -WorkingDirectory $Root `
  -RedirectStandardOutput $OutLog `
  -RedirectStandardError $ErrLog `
  -WindowStyle Hidden `
  -PassThru

Write-Host ''
Write-Step "Dev server: http://localhost:${Port}/" 'Green'
Write-Host 'Logs: .runtime\dev.out.log / dev.err.log' -ForegroundColor DarkGray
Write-Host ''

if (-not $Headless) {
  Start-Sleep -Seconds 2
  Start-Process "http://localhost:${Port}/"
}

# Keep the launcher alive while the dev server runs. The panel stops the
# service by killing the port owner; the launcher then exits on its own.
while (-not $script:Stopping -and -not $Proc.HasExited) {
  if (-not $Headless -and [Console]::KeyAvailable) {
    $Key = [Console]::ReadKey($true)
    $isCtrlC = ($Key.Key -eq 'C') -and (($Key.Modifiers -band [ConsoleModifiers]::Control) -ne 0)
    if ($Key.Key -eq 'Q' -or $isCtrlC) {
      $script:Stopping = $true
    }
  }
  Start-Sleep -Milliseconds 500
}

Write-Step 'Dev server exited. Cleaning up port...' 'Yellow'
if ($script:Stopping -and -not $Proc.HasExited) {
  Stop-Process -Id $Proc.Id -Force -ErrorAction SilentlyContinue
}
Stop-Port -TargetPort $Port
if ($null -ne $script:OriginalTreatCtrlCAsInput) {
  [System.Console]::TreatControlCAsInput = $script:OriginalTreatCtrlCAsInput
}
Write-Step 'Done.' 'Green'
