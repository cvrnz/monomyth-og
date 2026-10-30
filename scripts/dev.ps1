# Runs Monomyth with no exe of its own (Windows PowerShell): the Node server (server/) on
# :34115, Vite on :9245, and an app window (Edge or Chrome with --app, on its own profile).
# Closing the window or Ctrl+C stops everything.
#
#   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1            # in a window
#   powershell -ExecutionPolicy Bypass -File scripts\dev.ps1 -Browser   # no window

param([switch]$Browser)
$ErrorActionPreference = 'Stop'
$root = Split-Path -Parent $PSScriptRoot
Set-Location $root
$url = 'http://127.0.0.1:9245'

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

$procs = @()
try {
    $procs += Start-Process node -ArgumentList 'server/src/main.ts' -NoNewWindow -PassThru
    if ($Browser) {
        pnpm --dir frontend dev
        return
    }
    $procs += Start-Process cmd -ArgumentList '/c', 'pnpm --dir frontend dev >nul 2>&1' -WindowStyle Hidden -PassThru
    while ($true) {
        try { Invoke-WebRequest -UseBasicParsing $url -TimeoutSec 2 | Out-Null; break } catch {}
        if ($procs[1].HasExited) { throw 'vite stopped' }
        Start-Sleep -Milliseconds 300
    }
    $bin = @(
        "${env:ProgramFiles(x86)}\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Microsoft\Edge\Application\msedge.exe",
        "$env:ProgramFiles\Google\Chrome\Application\chrome.exe",
        "$env:LOCALAPPDATA\Google\Chrome\Application\chrome.exe"
    ) | Where-Object { Test-Path $_ } | Select-Object -First 1
    if (-not $bin) {
        Write-Host "No Edge or Chrome found; open $url (Ctrl+C to stop)"
        Wait-Process -Id $procs[1].Id
        return
    }
    Write-Host 'Monomyth is open in its window; close it (or Ctrl+C) to stop.'
    # Its own profile, so the window is its own process and this waits until it's closed.
    $window = Start-Process $bin -PassThru -ArgumentList "--app=$url", "--user-data-dir=$env:LOCALAPPDATA\monomyth\window",
        '--window-size=1400,900', '--no-first-run', '--no-default-browser-check'
    Wait-Process -Id $window.Id
} finally {
    # Also stops shells opened in the app's terminals.
    foreach ($p in $procs) { if (-not $p.HasExited) { taskkill /PID $p.Id /T /F | Out-Null } }
}
