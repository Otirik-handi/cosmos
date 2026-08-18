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

function Invoke-SmokeWebRequest {
    param(
        [Parameter(Mandatory = $true)]
        [hashtable]$Parameters
    )

    try {
        return Invoke-WebRequest @Parameters
    } catch {
        $response = $_.Exception.Response
        if ($null -eq $response -or $null -eq $response.StatusCode) {
            throw
        }

        $content = $_.ErrorDetails.Message
        if ([string]::IsNullOrWhiteSpace([string]$content)) {
            $content = $null
        }
        if ($null -ne $response.PSObject.Methods["GetResponseStream"]) {
            if ($null -eq $content) {
                $stream = $null
                $reader = $null
                try {
                    $stream = $response.GetResponseStream()
                    if ($stream) {
                        if ($stream.CanSeek) {
                            $stream.Position = 0
                        }
                        $reader = New-Object System.IO.StreamReader($stream)
                        $content = $reader.ReadToEnd()
                    }
                } finally {
                    if ($reader) {
                        $reader.Dispose()
                    } elseif ($stream) {
                        $stream.Dispose()
                    }
                }
            }
            $headers = $response.Headers
        } else {
            if ($null -eq $content -and $response.Content) {
                try {
                    $content = $response.Content.ReadAsStringAsync().GetAwaiter().GetResult()
                } catch {
                    # PowerShell 7 may dispose HttpResponseMessage.Content before this catch.
                    $content = $_.ErrorDetails.Message
                }
            }
            $headers = @{}
            foreach ($header in $response.Headers) {
                $headers[[string]$header.Key] = [string]::Join(", ", [string[]]$header.Value)
            }
            if ($response.Content -and $response.Content.Headers) {
                foreach ($header in $response.Content.Headers) {
                    if (-not $headers.ContainsKey([string]$header.Key)) {
                        $headers[[string]$header.Key] = [string]::Join(", ", [string[]]$header.Value)
                    }
                }
            }
        }

        return [pscustomobject]@{
            StatusCode = [int]$response.StatusCode
            Content = $content
            Headers = $headers
        }
    }
}
function Read-SmokeStructuredLog {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return @()
    }

    $records = @()
    try {
        foreach ($line in @(Get-Content -LiteralPath $Path -ErrorAction Stop)) {
            if ([string]::IsNullOrWhiteSpace($line)) {
                continue
            }
            try {
                $records += ($line | ConvertFrom-Json)
            } catch {
                # The writer may still be finishing a JSONL line; retry on the next poll.
            }
        }
    } catch {
        # The writer may be opening or rotating the file; retry on the next poll.
    }
    return $records
}

function Get-SmokeLogTail {
    param(
        [Parameter(Mandatory = $true)]
        [string]$Path
    )

    if (-not (Test-Path -LiteralPath $Path)) {
        return "<missing: $Path>"
    }
    try {
        return ((Get-Content -LiteralPath $Path -Tail 40 -ErrorAction Stop) -join "`n")
    } catch {
        return ("<unavailable: {0}: {1}>" -f $Path, $_.Exception.Message)
    }
}

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
    $env:COSMOS_WORKFLOW_HOST_ENABLED = "true"
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

    $notFound = Invoke-SmokeWebRequest -Parameters @{
        Uri = "http://127.0.0.1:4321/api/v1/does-not-exist?token=should-not-log"
        TimeoutSec = 2
        UseBasicParsing = $true
    }
    $notFoundBody = $notFound.Content | ConvertFrom-Json
    if (($notFound.StatusCode -ne 404) -or ($notFoundBody.code -ne "not_found") `
        -or ([string]$notFoundBody.requestId -ne [string]$notFound.Headers["X-Request-Id"])) {
        throw "404 error contract did not include a matching requestId."
    }

    $validation = Invoke-SmokeWebRequest -Parameters @{
        Method = "Post"
        Uri = "http://127.0.0.1:4321/api/v1/sources"
        ContentType = "application/json"
        Body = '{"name":123,"kind":"fixture-rss","config":{}}'
        TimeoutSec = 2
        UseBasicParsing = $true
    }
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
    $queuedResponse = Invoke-SmokeWebRequest -Parameters @{
        Method = "Post"
        Uri = "http://127.0.0.1:4321/api/v1/sources/$($source.id)/runs"
        Headers = @{ "Idempotency-Key" = "smoke-run-1" }
        UseBasicParsing = $true
    }
    $queued = $queuedResponse.Content | ConvertFrom-Json
    $queuedHeaders = $queuedResponse.Headers
    $queuedRequestId = [string]$queuedHeaders["X-Request-Id"]
    if (-not $queuedRequestId) {
        throw "Queued Run response did not contain X-Request-Id."
    }
    $probeResponse = Invoke-SmokeWebRequest -Parameters @{
        Method = "Post"
        Uri = "http://127.0.0.1:4321/api/v1/sources/$($source.id)/test"
        UseBasicParsing = $true
    }
    $probe = $probeResponse.Content | ConvertFrom-Json
    $probeHeaders = $probeResponse.Headers
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
    $durableRunState = $null
    for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
        try {
            $durableRunState = Invoke-RestMethod `
                -Uri "http://127.0.0.1:4321/api/v1/runs/$($queued.id)" `
                -TimeoutSec 2
            if ($durableRunState.status -eq "succeeded" -and $durableRunState.sourceId -eq $source.id) {
                break
            }
        } catch {
        }
        Start-Sleep -Milliseconds 200
    }
    if (-not $durableRunState -or $durableRunState.status -ne "succeeded" -or $durableRunState.sourceId -ne $source.id) {
        $durableStatus = if ($durableRunState) { [string]$durableRunState.status } else { "unavailable" }
        $durableSourceId = if ($durableRunState) { [string]$durableRunState.sourceId } else { "unavailable" }
        throw ("Durable WorkflowRun did not complete for runId {0} after Feed ingestion (status={1}, sourceId={2}, expectedSourceId={3}). API stderr:`n{4}`nWorker stderr:`n{5}`nAPI output:`n{6}`nWorker output:`n{7}" -f `
            $queued.id,
            $durableStatus,
            $durableSourceId,
            $source.id,
            (Get-SmokeLogTail -Path $apiErrorLog),
            (Get-SmokeLogTail -Path $workerErrorLog),
            (Get-SmokeLogTail -Path $apiLog),
            (Get-SmokeLogTail -Path $workerLog))
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
    if (Test-Path -LiteralPath (Join-Path $dataRoot "logs")) {
        throw "API or Worker ignored COSMOS_LOG_ROOT and wrote under Data Root."
    }

    $apiRecords = @()
    $workerRecords = @()
    $durableLaneRecords = @()
    $probeBridgeRecords = @()
    $probeWorkerRecords = @()
    $runBridgeRecords = @()
    $logsReady = $false
    for ($attempt = 0; $attempt -lt 50; $attempt += 1) {
        $apiRecords = @(Read-SmokeStructuredLog -Path $apiStructuredLog)
        $workerRecords = @(Read-SmokeStructuredLog -Path $workerStructuredLog)
        $durableLaneRecords = @($workerRecords | Where-Object {
            ($_.event -eq "workflow.lanes.polled" -or $_.event -eq "worker.poll.completed") `
                -and $_.completionStatus -eq "completed"
        })
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
        $runBridgeRecords = @($apiRecords | Where-Object {
            ($_.event -eq "workflow.run.queued" -or $_.event -eq "run.queued") `
                -and $_.runId -eq $queued.id `
                -and $_.sourceId -eq $source.id `
                -and $_.requestId -eq $queuedRequestId
        })
        if ($durableLaneRecords.Count -gt 0 `
            -and $probeBridgeRecords.Count -gt 0 `
            -and $probeWorkerRecords.Count -gt 0 `
            -and $runBridgeRecords.Count -gt 0) {
            $logsReady = $true
            break
        }
        Start-Sleep -Milliseconds 200
    }

    if (-not (Test-Path -LiteralPath $apiStructuredLog) -or -not (Test-Path -LiteralPath $workerStructuredLog)) {
        throw ("Expected API and Worker structured log files after polling. apiExists={0}, workerExists={1}. API tail:`n{2}`nWorker tail:`n{3}" -f `
            (Test-Path -LiteralPath $apiStructuredLog),
            (Test-Path -LiteralPath $workerStructuredLog),
            (Get-SmokeLogTail -Path $apiStructuredLog),
            (Get-SmokeLogTail -Path $workerStructuredLog))
    }
    if (-not $logsReady) {
        throw ("Structured log records did not arrive after polling. durableLaneCompletedRecords={0}, probeBridgeRecords={1}, probeWorkerRecords={2}, queueBridgeRecords={3}. API tail:`n{4}`nWorker tail:`n{5}" -f `
            $durableLaneRecords.Count,
            $probeBridgeRecords.Count,
            $probeWorkerRecords.Count,
            $runBridgeRecords.Count,
            (Get-SmokeLogTail -Path $apiStructuredLog),
            (Get-SmokeLogTail -Path $workerStructuredLog))
    }
    if (@($apiRecords | Where-Object { $_.requestId }).Count -eq 0) {
        throw "API structured logs did not contain requestId."
    }

    $search = Invoke-RestMethod `
        -Uri "http://127.0.0.1:4321/api/v1/search?text=Cosmos"
    $story = Invoke-RestMethod `
        -Uri "http://127.0.0.1:4321/api/v1/stories/$($feed.items[0].storyId)"
    $nativeCommandPreference = Get-Variable -Name PSNativeCommandUseErrorActionPreference -ErrorAction SilentlyContinue
    $previousNativeCommandPreference = $null
    if ($null -ne $nativeCommandPreference) {
        $previousNativeCommandPreference = $nativeCommandPreference.Value
        $nativeCommandPreference.Value = $false
    }
    $previousErrorActionPreference = $ErrorActionPreference
    try {
        $ErrorActionPreference = "Continue"
        $sse = @(& curl.exe -sS -N --max-time 2 `
            "http://127.0.0.1:4321/api/v1/events?after=0" 2>&1)
        $sseExitCode = $LASTEXITCODE
    } finally {
        $ErrorActionPreference = $previousErrorActionPreference
        if ($null -ne $nativeCommandPreference) {
            $nativeCommandPreference.Value = $previousNativeCommandPreference
        }
    }
    $sseText = $sse -join "`n"
    if ($sseExitCode -ne 0 -and $sseExitCode -ne 28) {
        throw ("SSE curl failed with exit code {0}. Raw output: {1}" -f $sseExitCode, $sseText)
    }
    if ($sseText -notmatch "run.queued.v1" -or $sseText -notmatch "feed.updated.v1") {
        throw "SSE did not return the persisted domain events. Raw output: $sseText"
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
        durableRunStatus = $durableRunState.status
        durableRunSourceId = $durableRunState.sourceId
        feedItems = @($feed.items).Count
        searchItems = @($search.items).Count
        storyTitle = $story.story.title
        sseHasRunEvent = [bool]($sseText -match "run.queued.v1")
        sseHasFeedEvent = [bool]($sseText -match "feed.updated.v1")
        apiStructuredRecords = $apiRecords.Count
        workerStructuredRecords = $workerRecords.Count
        durableLaneCompletedRecords = $durableLaneRecords.Count
        requestIdBridgedToDurableRun = $runBridgeRecords.Count
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
    Remove-Item Env:COSMOS_WORKFLOW_HOST_ENABLED -ErrorAction SilentlyContinue
    Remove-Item Env:COSMOS_WORKER_LEASE_MS -ErrorAction SilentlyContinue
    Remove-Item Env:COSMOS_LOG_ROOT -ErrorAction SilentlyContinue
    Remove-Item Env:COSMOS_LOG_OUTPUT -ErrorAction SilentlyContinue
    Remove-Item Env:COSMOS_LOG_LEVEL -ErrorAction SilentlyContinue
    if ($root.StartsWith($env:TEMP, [System.StringComparison]::OrdinalIgnoreCase)) {
        Remove-Item -LiteralPath $root -Recurse -Force -ErrorAction SilentlyContinue
    }
}
