<#
  OmniPost - one-time setup on Windows (run it again any time; it is safe to repeat).

  From the repository root, in PowerShell:
      powershell -ExecutionPolicy Bypass -File scripts\setup.ps1

  Does: checks the tools, creates backend\.env with new secret keys (if missing),
  creates the Python virtual environment and installs packages, starts PostgreSQL
  and Redis in Docker, creates the tables, adds demo data, installs web app packages.
#>
$ErrorActionPreference = "Continue"   # every program's exit code is checked explicitly below
$Root = Split-Path -Parent $PSScriptRoot
$Backend = Join-Path $Root "backend"
$Frontend = Join-Path $Root "frontend"

function Step([string]$m) { Write-Host "`n==> $m" -ForegroundColor Cyan }
function Ok([string]$m) { Write-Host "    $m" -ForegroundColor Green }
function Fail([string]$m) { Write-Host "`nSetup stopped: $m" -ForegroundColor Red; exit 1 }
function Need([string]$cmd, [string]$hint) {
    if (-not (Get-Command $cmd -ErrorAction SilentlyContinue)) { Fail "'$cmd' was not found. $hint" }
}
# Run a program and stop if it fails
function Run {
    param([Parameter(ValueFromRemainingArguments = $true)] $Cmd)
    & $Cmd[0] $Cmd[1..($Cmd.Count - 1)]
    if ($LASTEXITCODE -ne 0) { Fail "this command failed: $($Cmd -join ' ')" }
}
function NewKey([int]$bytes, [bool]$keepPadding) {
    $b = New-Object byte[] $bytes
    [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b)
    $k = [Convert]::ToBase64String($b).Replace('+', '-').Replace('/', '_')
    if ($keepPadding) { return $k } else { return $k.TrimEnd('=') }
}

Step "Checking the tools"
Need git "Install Git: https://git-scm.com/downloads"
Need python "Install Python 3.12 from https://www.python.org/downloads/ and tick 'Add python.exe to PATH'."
Need node "Install Node.js 20 LTS or newer: https://nodejs.org/"
Need npm "It comes with Node.js: https://nodejs.org/"
Need docker "Install Docker Desktop: https://www.docker.com/products/docker-desktop/"
$py = (& python -c "import sys; print('%d.%d' % sys.version_info[:2])").Trim()
if ([version]$py -lt [version]"3.12") { Fail "Python $py found; 3.12 or newer is needed." }
$nodeMajor = [int]((& node --version).TrimStart('v').Split('.')[0])
if ($nodeMajor -lt 20) { Fail "Node $(& node --version) found; 20 or newer is needed." }
& docker info *> $null
if ($LASTEXITCODE -ne 0) { Fail "Docker is installed but not running. Open Docker Desktop, wait for 'Engine running', then run this again." }
Ok "Python $py, Node $(& node --version), Docker running"

Step "Settings file (backend\.env)"
$envFile = Join-Path $Backend ".env"
if (Test-Path $envFile) {
    Ok "backend\.env already exists - kept as it is"
} else {
    $text = [IO.File]::ReadAllText((Join-Path $Backend ".env.example"))
    $text = $text -replace '(?m)^SECRET_KEY=CHANGE_ME.*$', ("SECRET_KEY=" + (NewKey 48 $false))
    $text = $text -replace '(?m)^FERNET_KEY=CHANGE_ME.*$', ("FERNET_KEY=" + (NewKey 32 $true))
    [IO.File]::WriteAllText($envFile, $text, (New-Object Text.UTF8Encoding $false))
    Ok "Created backend\.env with new SECRET_KEY and FERNET_KEY (never commit or share it)"
}

Step "Python virtual environment and packages"
Set-Location $Backend
if (-not (Test-Path ".venv\Scripts\python.exe")) { Run python -m venv .venv }
$vpy = Join-Path $Backend ".venv\Scripts\python.exe"
Run $vpy -m pip install --quiet --upgrade pip
Run $vpy -m pip install --quiet -r requirements.txt
Ok "Backend packages installed in backend\.venv"

Step "Database and Redis (Docker)"
Run docker compose up -d postgres redis
$ready = $false
for ($i = 0; $i -lt 30; $i++) {
    & docker compose exec -T postgres pg_isready -U postgres *> $null
    if ($LASTEXITCODE -eq 0) { $ready = $true; break }
    Start-Sleep -Seconds 2
}
if (-not $ready) { Fail "PostgreSQL did not become ready. Check 'docker compose ps' in the backend folder." }
Ok "PostgreSQL and Redis are running"

Step "Tables and demo data"
Run $vpy -m alembic upgrade head
Run $vpy -m seeds.seed
Ok "Database is up to date and has demo data"

Step "Web app packages"
Set-Location $Frontend
Run npm ci --no-audit --no-fund
Ok "Web app packages installed"

Set-Location $Root
Write-Host "`nSetup complete." -ForegroundColor Green
Write-Host "Start everything with:  powershell -ExecutionPolicy Bypass -File scripts\start.ps1"
Write-Host "Then open http://localhost:5173 and sign in with demo@example.com / DemoPassword123!"
