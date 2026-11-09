<#
  OmniPost - start everything on Windows (after scripts\setup.ps1 has run once).

  From the repository root, in PowerShell:
      powershell -ExecutionPolicy Bypass -File scripts\start.ps1

  Starts PostgreSQL and Redis, applies any new database changes, then opens four
  windows: API, worker, scheduler and web app. Close a window (or press Ctrl+C in it)
  to stop that part. Stop the database later with:  docker compose stop  (in backend).
#>
$ErrorActionPreference = "Continue"   # every program's exit code is checked explicitly below
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"
$vpy = Join-Path $Backend ".venv\Scripts\python.exe"

if (-not (Test-Path $vpy) -or -not (Test-Path (Join-Path $Frontend "node_modules"))) {
    Write-Host "Run the one-time setup first:  powershell -ExecutionPolicy Bypass -File scripts\setup.ps1" -ForegroundColor Red
    exit 1
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "Docker is not running. Open Docker Desktop and wait for 'Engine running'." -ForegroundColor Red; exit 1 }

Set-Location $Backend
docker compose up -d postgres redis
for ($i = 0; $i -lt 30; $i++) {
    & docker compose exec -T postgres pg_isready -U postgres *> $null
    if ($LASTEXITCODE -eq 0) { break }
    Start-Sleep -Seconds 2
}
& $vpy -m alembic upgrade head
if ($LASTEXITCODE -ne 0) { Write-Host "Database update failed (see above)." -ForegroundColor Red; exit 1 }

function Open-Window([string]$title, [string]$folder, [string]$command) {
    $script = "`$host.UI.RawUI.WindowTitle = '$title'; Set-Location -LiteralPath '$folder'; $command"
    Start-Process powershell -ArgumentList @("-NoExit", "-ExecutionPolicy", "Bypass", "-Command", $script)
}
Open-Window "OmniPost API" $Backend "& '$vpy' -m uvicorn app.main:app --reload --port 8000"
Open-Window "OmniPost worker" $Backend "& '$vpy' -m celery -A app.workers.celery_app worker --loglevel=info --pool=solo"
Open-Window "OmniPost scheduler" $Backend "& '$vpy' -m celery -A app.workers.celery_app beat --loglevel=info"
Open-Window "OmniPost web app" $Frontend "npm run dev"

Set-Location $Root
Write-Host "`nStarting in four windows: API, worker, scheduler, web app." -ForegroundColor Green
Write-Host "Open http://localhost:5173 in about 10 seconds and sign in with demo@example.com / DemoPassword123!"
