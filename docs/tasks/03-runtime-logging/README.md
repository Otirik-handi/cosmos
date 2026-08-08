# Cosmos 运行日志系统

## User Request / Topic

为 Cosmos 建立第一版运行诊断日志，贯穿 API、Worker、Connector、存储和 Web 服务端，支持通过稳定 ID 定位一次请求或持久任务。

## Goal

提供不改变业务状态模型的结构化 `log.v1` JSONL：

```text
HTTP request / SSE
  -> requestId
  -> Run / Job / Source / Connector context
  -> stdout + <Data Root>/logs/*.jsonl
```

日志不是业务审计、Domain Event 或 Delivery 账本。

## Scope / Non-goals

- Scope：共享 logger、AsyncLocalStorage context、脱敏、限长、stdout/文件双写、按服务文件、轮转清理、HTTP requestId、API/Worker/Connector/存储/Web instrumentation。
- Non-goals：日志数据库、日志查询 API/UI、浏览器日志上报、OpenTelemetry、Trace 平台和业务审计模型。

## Decisions

- 新增 `@cosmos/logging`，使用 Node 标准能力，不引入第三方 Logger。
- 服务文件为 `api.jsonl`、`worker.jsonl`、`web.jsonl`。
- 默认级别开发 `debug`、生产 `info`；`COSMOS_LOG_LEVEL` 可覆盖。
- 默认输出 `both`；日志文件日期切换或达到 16 MiB 时轮转。
- 日志根目录默认 `<Data Root>/logs`，保留 7 天、总量上限 256 MiB。
- `COSMOS_LOG_ROOT` 对 API、Worker 和 Web 统一生效；空值回退到 `<Data Root>/logs`。
- API 在 Nest 路由前生成/校验 `requestId`，通过 `X-Request-Id` 响应头和错误体返回；请求上下文覆盖 SSE 的整个订阅生命周期。
- 文件 sink 失败时回退 stdout，并通过 stderr 单次报告 sink 故障；日志异常不阻断 API、Worker 或 Connector。
- 记录安全元数据和受限错误摘要；不记录 Secret、Cookie、Token、完整 payload、正文、Prompt 或外部 stdout/stderr。

## Implementation

- `packages/logging` 提供 `Logger`、child/context、错误序列化、脱敏、异步文件 sink 和 retention。
- Application 增加可选 `LoggerPort`，Probe prepare、Run、Connector fetch、Job claim/lease/retry/complete 和持久化失败使用统一事件。
- API 错误 details 仅保留受限校验信息；claim 竞争和最大 attempts terminal 日志保留 Job/Run/Source 关联。
- Nest API 使用 request middleware、request interceptor 和 exception filter；SSE 记录连接、失败和关闭，health 成功请求降为 debug；4xx/5xx 分别使用 warn/error。
- RSS、AI HOT 和 OpenCLI 只记录来源类型、状态、字节数、数量、耗时和错误码。
- Application 层记录 Run/Job 边界，Connector transport 层使用 `connector.transport.*`，避免与 Application 的 `connector.fetch.*` 重复。
- Next instrumentation 记录 Web server 启动和服务端请求错误，不接收浏览器日志。
- Docker 使用独立 `cosmos-logs` 卷；Web 只挂载日志目录。

## Verification

- Logging package tests cover levels, JSONL, context, redaction, truncation, rotation, retention and sink fallback.
- API tests cover request ID header/body, health noise reduction, error detail limits, SSE failure/close and internal error normalization.
- Current full suite passes 13 test files and 57 tests; focused coverage includes Probe prepare, Job claim/terminal, Storage health and Web instrumentation.
- `bun run typecheck` and `bun run build` pass.
- Node smoke asserts separate Data/Log Roots, API 404/400 contracts, `requestId -> Run/Job -> Source/Connector` correlation, Probe Job bridging, SSE replay and sensitive-field absence.
- Web standalone smoke writes `web.jsonl` and records `web.started`.
- Docker/Compose validation remains environment-dependent and must be reported separately.

## Follow-ups

- Future product log viewer or audit query needs an independent requirement and permission/retention design; it must not expose local JSONL directly.
