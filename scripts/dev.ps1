$root = Split-Path -Parent $PSScriptRoot
$api = Join-Path $root "apps\api"
$web = Join-Path $root "apps\web"

Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd '$api'; if (-not (Test-Path .venv)) { python -m venv .venv }; .\.venv\Scripts\python -m uvicorn main:app --reload --reload-exclude '$api\.venv' --host 127.0.0.1 --port 8000"
)
Start-Process powershell -ArgumentList @(
  "-NoExit",
  "-Command",
  "cd '$web'; npm run dev"
)
Write-Host "API 8000 and UI 3000 starting in two windows."
