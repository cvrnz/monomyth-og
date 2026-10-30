# Runs Monomyth in a browser, with no exe (Windows PowerShell): the Node server (server/) on
# :34115 and Vite on http://127.0.0.1:9245. Ctrl+C stops both.
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1

$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root

foreach ($tool in 'node', 'pnpm') {
    if (-not (Get-Command $tool -ErrorAction SilentlyContinue)) { throw "$tool not found on PATH" }
}

foreach ($dir in 'frontend', 'server') {
    if (-not (Test-Path "$dir\node_modules")) {
        pnpm --dir $dir install
        if ($LASTEXITCODE) { exit $LASTEXITCODE }
    }
}

# Containers need the Go agent (built once, uploaded to the pod); local folders don't.
if (-not (Test-Path 'internal\remote\agentbin\agent-linux-amd64')) {
    if (Get-Command go -ErrorAction SilentlyContinue) {
        go run ./scripts/buildagent
        if ($LASTEXITCODE) { exit $LASTEXITCODE }
    } else {
        Write-Warning "Go isn't installed, so connecting to containers won't work (local folders will)"
    }
}

$server = Start-Process node -ArgumentList 'server/src/main.ts' -NoNewWindow -PassThru
try {
    pnpm --dir frontend dev
} finally {
    # Also stops shells opened in the app's terminals.
    if (-not $server.HasExited) { taskkill /PID $server.Id /T /F | Out-Null }
}
