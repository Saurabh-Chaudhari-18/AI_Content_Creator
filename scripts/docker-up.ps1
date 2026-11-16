<#
  OmniPost - run the WHOLE project in Docker on Windows. Only Docker Desktop is needed
  (no Python or Node).

  From the repository root, in PowerShell:
      powershell -ExecutionPolicy Bypass -File scripts\docker-up.ps1

  Creates backend\.env with new secret keys (if missing), then builds and starts the
  database, Redis, API, worker, scheduler and web app. Demo data is added automatically.
  Web app: http://localhost:4173   (another port: set WEB_PORT first, e.g. $env:WEB_PORT = 4174)
  Stop:    docker compose -f backend\docker-compose.yml down     (data is kept)
#>
$ErrorActionPreference = "Continue"   # every program's exit code is checked explicitly below
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"

function NewKey([int]$bytes, [bool]$keepPadding) {
    $b = New-Object byte[] $bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    $k = [Convert]::ToBase64String($b).Replace('+', '-').Replace('/', '_')
    if ($keepPadding) { return $k } else { return $k.TrimEnd('=') }
}

if (-not (Get-Command docker -ErrorAction SilentlyContinue)) {
    Write-Host "Docker was not found. Install Docker Desktop: https://www.docker.com/products/docker-desktop/" -ForegroundColor Red; exit 1
}
& docker info *> $null
if ($LASTEXITCODE -ne 0) { Write-Host "Docker is not running. Open Docker Desktop and wait for 'Engine running'." -ForegroundColor Red; exit 1 }

$envFile = Join-Path $Backend ".env"
if (-not (Test-Path $envFile)) {
    $text = [IO.File]::ReadAllText((Join-Path $Backend ".env.example"))
    $text = $text -replace '(?m)^SECRET_KEY=CHANGE_ME.*$', ("SECRET_KEY=" + (NewKey 48 $false))
    $text = $text -replace '(?m)^FERNET_KEY=CHANGE_ME.*$', ("FERNET_KEY=" + (NewKey 32 $true))
    [IO.File]::WriteAllText($envFile, $text, (New-Object Text.UTF8Encoding $false))
    Write-Host "Created backend\.env with new secret keys (never commit or share it)." -ForegroundColor Green
}

Write-Host "Building and starting (the first time takes a few minutes)..." -ForegroundColor Cyan
docker compose -f (Join-Path $Backend "docker-compose.yml") up -d --build
if ($LASTEXITCODE -ne 0) { Write-Host "Docker could not start the project (see above)." -ForegroundColor Red; exit 1 }

$port = if ($env:WEB_PORT) { $env:WEB_PORT } else { "4173" }
$ready = $false
for ($i = 0; $i -lt 90; $i++) {
    try {
        $r = Invoke-RestMethod -Uri "http://127.0.0.1:$port/api/v1/ready" -TimeoutSec 3
        if ($r.status -eq "ready") { $ready = $true; break }
    } catch { }
    Start-Sleep -Seconds 2
}
if (-not $ready) {
    Write-Host "`nThe containers started, but the app did not answer on port $port within 3 minutes." -ForegroundColor Yellow
    Write-Host "Check the logs:  docker compose -f backend\docker-compose.yml logs --tail 50"
    Write-Host "If another program uses port $port, run:  `$env:WEB_PORT = 4174  and start this script again."
    exit 1
}
Write-Host "`nOmniPost is running: http://localhost:$port" -ForegroundColor Green
Write-Host "Sign in with demo@example.com / DemoPassword123!"
Write-Host "Logs:  docker compose -f backend\docker-compose.yml logs -f"
Write-Host "Stop:  docker compose -f backend\docker-compose.yml down   (or the stop button on 'omnipost' in Docker Desktop)"
