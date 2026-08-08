$ErrorActionPreference = "Stop"

$root = Join-Path $env:TEMP ("cosmos-node-smoke-" + [guid]::NewGuid().ToString("N"))
$dataRoot = Join-Path $root "data"
$logRoot = Join-Path $root "logs"
$apiLog = Join-Path $root "api.out.log"
$apiErrorLog = Join-Path $root "api.err.log"
$workerLog = Join-Path $root "worker.out.log"
$workerErrorLog = Join-Path $root "worker.err.log"
$api = $null
$worker = $null

New-Item -ItemType Directory -Force -Path $root | Out-Null

try {
    $env:COSMOS_DATA_ROOT = $dataRoot
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
    $env:COSMOS_WORKSPACE_ROOT = (Get-Location).Path
    $env:COSMOS_API_HOST = "127.0.0.1"
    $env:COSMOS_API_PORT = "4321"
    $env:COSMOS_VERSION = "0.1.0"
    $env:COSMOS_WORKER_POLL_MS = "200"
    $env:COSMOS_WORKER_LEASE_MS = "5000"
    $env:COSMOS_LOG_ROOT = $logRoot
    $env:COSMOS_LOG_OUTPUT = "both"
    $env:COSMOS_LOG_LEVEL = "debug"

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

    $notFound = Invoke-WebRequest `
        -Uri "http://127.0.0.1:4321/api/v1/does-not-exist?token=should-not-log" `
        -TimeoutSec 2 `
        -UseBasicParsing `
        -SkipHttpErrorCheck
    $notFoundBody = $notFound.Content | ConvertFrom-Json
    if (($notFound.StatusCode -ne 404) -or ($notFoundBody.code -ne "not_found") `
        -or ([string]$notFoundBody.requestId -ne [string]$notFound.Headers["X-Request-Id"])) {
        throw "404 error contract did not include a matching requestId."
    }

    $validation = Invoke-WebRequest `
        -Method Post `
        -Uri "http://127.0.0.1:4321/api/v1/sources" `
        -ContentType "application/json" `
        -Body '{"name":123,"kind":"fixture-rss","config":{}}' `
        -TimeoutSec 2 `
        -UseBasicParsing `
        -SkipHttpErrorCheck
    $validationBody = $validation.Content | ConvertFrom-Json
    if (($validation.StatusCode -ne 400) -or ($validationBody.code -ne "validation_failed") `
        -or (-not $validationBody.requestId)) {
        throw "400 error contract was not stable."
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
        -Headers @{ "Idempotency-Key" = "smoke-run-1" } `
        -ResponseHeadersVariable queuedHeaders
    $queuedRequestId = [string]$queuedHeaders["X-Request-Id"]
    if (-not $queuedRequestId) {
        throw "Queued Run response did not contain X-Request-Id."
    }
    $probe = Invoke-RestMethod `
        -Method Post `
        -Uri "http://127.0.0.1:4321/api/v1/sources/$($source.id)/test" `
        -ResponseHeadersVariable probeHeaders
    $probeRequestId = [string]$probeHeaders["X-Request-Id"]
    if (-not $probeRequestId) {
        throw "Probe Job response did not contain X-Request-Id."
    }

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
    $probeState = $null
    for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
        try {
            $probeState = Invoke-RestMethod `
                -Uri "http://127.0.0.1:4321/api/v1/jobs/$($probe.id)" `
                -TimeoutSec 2
            if ($probeState.status -eq "succeeded") {
                break
            }
        } catch {
        }
        Start-Sleep -Milliseconds 200
    }
    if (-not $probeState -or $probeState.status -ne "succeeded") {
        throw "Worker did not finish the probe Job."
    }
    Start-Sleep -Milliseconds 250

    $apiStructuredLog = Join-Path $logRoot "api.jsonl"
    $workerStructuredLog = Join-Path $logRoot "worker.jsonl"
    if (-not (Test-Path -LiteralPath $apiStructuredLog)) {
        throw "API structured log was not created."
    }
    if (-not (Test-Path -LiteralPath $workerStructuredLog)) {
        throw "Worker structured log was not created."
    }
    if (Test-Path -LiteralPath (Join-Path $dataRoot "logs")) {
        throw "API or Worker ignored COSMOS_LOG_ROOT and wrote under Data Root."
    }
    $apiRecords = @(Get-Content -LiteralPath $apiStructuredLog | ForEach-Object {
        $_ | ConvertFrom-Json
    })
    $workerRecords = @(Get-Content -LiteralPath $workerStructuredLog | ForEach-Object {
        $_ | ConvertFrom-Json
    })
    $correlatedWorkerRecords = @($workerRecords | Where-Object {
        $_.runId -eq $queued.id -and $_.jobId -and $_.sourceId -eq $source.id
    })
    $correlatedConnectorRecords = @($workerRecords | Where-Object {
        $_.runId -eq $queued.id `
            -and $_.jobId `
            -and $_.sourceId -eq $source.id `
            -and $_.connectorId -eq "fixture-rss"
    })
    if ($correlatedWorkerRecords.Count -eq 0) {
        throw "Worker structured logs did not contain the queued Run and Job correlation."
    }
    $probeBridgeRecords = @($apiRecords | Where-Object {
        $_.event -eq "job.queued" `
            -and $_.jobId -eq $probe.id `
            -and $_.sourceId -eq $source.id `
            -and $_.requestId -eq $probeRequestId
    })
    $probeWorkerRecords = @($workerRecords | Where-Object {
        $_.jobId -eq $probe.id `
            -and $_.sourceId -eq $source.id `
            -and $_.connectorId -eq "fixture-rss"
    })
    if ($probeBridgeRecords.Count -eq 0) {
        throw "API structured logs did not bridge requestId to the probe Job."
    }
    if ($probeWorkerRecords.Count -eq 0) {
        throw "Worker structured logs did not contain probe Job correlation."
    }
    if (@($apiRecords | Where-Object { $_.requestId }).Count -eq 0) {
        throw "API structured logs did not contain requestId."
    }
    $runBridgeRecords = @($apiRecords | Where-Object {
        $_.event -eq "run.queued" `
            -and $_.runId -eq $queued.id `
            -and $_.sourceId -eq $source.id `
            -and $_.requestId -eq $queuedRequestId
    })
    if ($runBridgeRecords.Count -eq 0) {
        throw "API structured logs did not bridge requestId to the queued Run."
    }
    if ($correlatedConnectorRecords.Count -eq 0) {
        throw "Worker connector logs did not contain Run/Job/Source/Connector correlation."
    }

    $search = Invoke-RestMethod `
        -Uri "http://127.0.0.1:4321/api/v1/search?text=Cosmos"
    $story = Invoke-RestMethod `
        -Uri "http://127.0.0.1:4321/api/v1/stories/$($feed.items[0].storyId)"
    $sse = & curl.exe -sS -N --max-time 2 `
        "http://127.0.0.1:4321/api/v1/events?after=0" 2>$null
    $sseText = $sse -join "`n"
    if ($sseText -notmatch "run.queued.v1" -or $sseText -notmatch "feed.updated.v1") {
        throw "SSE did not return the persisted domain events. Raw output: $sse"
    }
    $rawStructuredLogs = @(
        Get-Content -LiteralPath $apiStructuredLog
        Get-Content -LiteralPath $workerStructuredLog
    ) -join "`n"
    if ($rawStructuredLogs -match '"(?:token|authorization|cookie|contentText|prompt|stdout|stderr|payload)"') {
        throw "Structured logs contain a forbidden sensitive field."
    }
    if ($rawStructuredLogs -match '"undefined"') {
        throw "Structured logs contain a serialized undefined value."
    }

    [pscustomobject]@{
        healthWorker = $health.workerStatus
        queuedStatus = $queued.status
        feedItems = @($feed.items).Count
        searchItems = @($search.items).Count
        storyTitle = $story.story.title
        sseHasRunEvent = [bool]($sseText -match "run.queued.v1")
        sseHasFeedEvent = [bool]($sseText -match "feed.updated.v1")
        apiStructuredRecords = $apiRecords.Count
        workerStructuredRecords = $workerRecords.Count
        correlatedWorkerRecords = $correlatedWorkerRecords.Count
        correlatedConnectorRecords = $correlatedConnectorRecords.Count
        requestIdBridgedToRun = $runBridgeRecords.Count
        requestIdBridgedToProbe = $probeBridgeRecords.Count
        probeWorkerRecords = $probeWorkerRecords.Count
        notFoundStatus = $notFound.StatusCode
        validationStatus = $validation.StatusCode
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
    Remove-Item Env:COSMOS_LOG_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:COSMOS_LOG_OUTPUT -ErrorAction SilentlyContinue
    Remove-Item Env:COSMOS_LOG_LEVEL -ErrorAction SilentlyContinue
    if ($root.StartsWith($env:TEMP, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}
