$ErrorActionPreference = "Stop"

$root = Join-Path $env:TEMP ("cosmos-node-smoke-" + [guid]::NewGuid().ToString("N"))
$apiLog = Join-Path $root "api.out.log"
$apiErrorLog = Join-Path $root "api.err.log"
$workerLog = Join-Path $root "worker.out.log"
$workerErrorLog = Join-Path $root "worker.err.log"
$api = $null
$worker = $null

New-Item -ItemType Directory -Force -Path $root | Out-Null

try {
    $env:COSMOS_DATA_ROOT = $root
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    $env:COSMOS_WORKSPACE_ROOT = (Get-Location).Path
    $env:COSMOS_API_HOST = "127.0.0.1"
    $env:COSMOS_API_PORT = "4321"
    $env:COSMOS_VERSION = "0.1.0"
    $env:COSMOS_WORKER_POLL_MS = "200"
    $env:COSMOS_WORKER_LEASE_MS = "5000"

    bun run db:migrate
    $api = Start-Process -FilePath node `
        -ArgumentList "apps/api/dist/main.js" `
        -WorkingDirectory (Get-Location) `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $apiLog `
        -RedirectStandardError $apiErrorLog
    $worker = Start-Process -FilePath node `
        -ArgumentList "apps/worker/dist/main.js" `
        -WorkingDirectory (Get-Location) `
        -PassThru `
        -WindowStyle Hidden `
        -RedirectStandardOutput $workerLog `
        -RedirectStandardError $workerErrorLog

    $health = $null
    for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
        try {
            $health = Invoke-RestMethod `
                -Uri "http://127.0.0.1:4321/api/v1/health" `
                -TimeoutSec 2
            if ($health.storageStatus -eq "ready") {
                break
            }
        } catch {
            Start-Sleep -Milliseconds 200
        }
    }
    if (-not $health) {
        throw "API did not become ready. $((Get-Content $apiErrorLog -Raw).Trim())"
    }

    $source = Invoke-RestMethod `
        -Method Post `
        -Uri "http://127.0.0.1:4321/api/v1/sources" `
        -ContentType "application/json" `
        -Body (@{
            name = "Production smoke"
            kind = "fixture-rss"
            config = @{
                fixturePath = "fixtures/rss/basic.xml"
            }
            enabled = $true
        } | ConvertTo-Json -Depth 5)
    $queued = Invoke-RestMethod `
        -Method Post `
        -Uri "http://127.0.0.1:4321/api/v1/sources/$($source.id)/runs" `
        -Headers @{ "Idempotency-Key" = "smoke-run-1" }

    $feed = $null
    for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
        try {
            $feed = Invoke-RestMethod `
                -Uri "http://127.0.0.1:4321/api/v1/feed" `
                -TimeoutSec 2
            if (@($feed.items).Count -ge 3) {
                break
            }
        } catch {
        }
        Start-Sleep -Milliseconds 200
    }
    if (-not $feed -or @($feed.items).Count -lt 3) {
        throw "Worker did not ingest fixture. $((Get-Content $workerErrorLog -Raw).Trim())"
    }

    $search = Invoke-RestMethod `
        -Uri "http://127.0.0.1:4321/api/v1/search?text=Cosmos"
    $story = Invoke-RestMethod `
        -Uri "http://127.0.0.1:4321/api/v1/stories/$($feed.items[0].storyId)"
    $sse = & curl.exe -sS -N --max-time 2 `
        "http://127.0.0.1:4321/api/v1/events?after=0" 2>$null

    [pscustomobject]@{
        healthWorker = $health.workerStatus
        queuedStatus = $queued.status
        feedItems = @($feed.items).Count
        searchItems = @($search.items).Count
        storyTitle = $story.story.title
        sseHasRunEvent = [bool]($sse -match "run.queued.v1")
        sseHasFeedEvent = [bool]($sse -match "feed.updated.v1")
    } | ConvertTo-Json -Compress
} finally {
    if ($worker) {
        Stop-Process -Id $worker.Id -Force -ErrorAction SilentlyContinue
    }
    if ($api) {
        Stop-Process -Id $api.Id -Force -ErrorAction SilentlyContinue
    }
    Remove-Item Env:COSMOS_DATA_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    Remove-Item Env:COSMOS_WORKSPACE_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:COSMOS_API_HOST -ErrorAction SilentlyContinue
    Remove-Item Env:COSMOS_API_PORT -ErrorAction SilentlyContinue
    Remove-Item Env:COSMOS_VERSION -ErrorAction SilentlyContinue
    Remove-Item Env:COSMOS_WORKER_POLL_MS -ErrorAction SilentlyContinue
    Remove-Item Env:COSMOS_WORKER_LEASE_MS -ErrorAction SilentlyContinue
    if ($root.StartsWith($env:TEMP, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}
