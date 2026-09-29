$root = Split-Path -Parent $PSScriptRoot
$phone = Join-Path $root "AI_HarnessPhone"

Set-Location $phone
if (-not (Test-Path (Join-Path $phone "node_modules"))) {
  npm install
}
npm run build

$apiOk = $false
try {
  $r = Invoke-WebRequest -Uri "http://127.0.0.1:8000/api/health?ping=1" -UseBasicParsing -TimeoutSec 4
  if ($r.StatusCode -eq 200) { $apiOk = $true }
} catch {
  $apiOk = $false
}

if ($apiOk) {
  Write-Host "API is answering on 127.0.0.1:8000."
} else {
  Write-Host "API is not answering on 127.0.0.1:8000. Start it first (scripts/dev.ps1), then re-run Tailscale Serve."
}

$hostname = $null
try {
  $status = tailscale status --json | ConvertFrom-Json
  if ($status.Self.DNSName) {
    $hostname = $status.Self.DNSName.TrimEnd(".")
  }
} catch {
  $hostname = $null
}

Write-Host "Restart the API once after the first phone build so it serves AI_HarnessPhone/out."
Write-Host ""
Write-Host "Publish HTTPS to the tailnet (API stays on loopback):"
Write-Host "  tailscale serve --bg 8000"
Write-Host ""
if ($hostname) {
  Write-Host "On the iPhone, open Safari at:"
  Write-Host "  https://$hostname"
} else {
  Write-Host "On the iPhone, open Safari at:"
  Write-Host "  https://<pc-name>.<tailnet>.ts.net"
}
Write-Host "Share → Add to Home Screen."
Write-Host ""
Write-Host "Did not build apps/web. Leave its next dev on :3000 alone."
