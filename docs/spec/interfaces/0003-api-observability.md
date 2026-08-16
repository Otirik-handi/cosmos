# API Observability

## 状态

`Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55`。本文记录 API request
context、请求日志和异常响应的当前行为；结构化日志底层完整合同归
[Structured Logging](../runtime/0004-structured-logging.md)，公共错误 DTO 归
[Public Contracts](../contracts/0001-public-contracts.md)。

## 最后更新

2026-08-16。

## 组件定位

API Observability 是 `apps/api/src/request-logging.ts` 提供的 Nest middleware、全局
interceptor 与 exception filter。它为每个 HTTP 请求建立 request id，上下文传给 logger，
在 response header 中桥接 `X-Request-Id`，按请求类型记录完成/失败/SSE 生命周期，并把
Nest `HttpException` 或未知异常规范化为有限大小的 `ServiceError`。

该组件没有业务控制权、查询副作用或持久化账本；日志只帮助关联 HTTP 行为，不能代替
Domain Event、Job/Run 状态或 SSE replay。

## 概念与定义

- **Request context**：挂在 request 对象上的 `cosmosRequestId` 和
  `cosmosRequestStartedAt`；logger 通过 AsyncLocalStorage/context callback 读取 request id。
- **Request id**：首个合法 `X-Request-Id` header 值，或由 API 生成的 UUID。合法字符是
  `[A-Za-z0-9._:-]`，长度 1–128；其它值被丢弃。
- **ServiceError**：面向客户端的错误白名单投影，包含 code/message/requestId、可选
  validation details 和 retryable；未知异常不把原始 stack/payload 直接发给客户端。
- **SSE request**：request path 以 `/events` 结尾的长连接。Interceptor 对其使用单独
  的 connected/failed/closed 事件，但仍共享 request id 和完成时间字段。
- **Sanitization**：底层 logger 对敏感 key/text、嵌套深度、数组/对象数量、字符串与
  record 大小实施脱敏和截断；query/header/body 等字段默认命中敏感 key 规则。

## 外部行为

请求首先经过 `requestContextMiddleware`：从 `request.headers["x-request-id"]` 读取
header（字符串数组取第一个），调用 `createRequestId` 校验或生成 UUID，写入 request
上下文，并在 headers 尚未发送时设置 `X-Request-Id` 响应 header。然后通过 logger
`withContext({ requestId }, next)` 进入 Nest pipeline。

全局 `RequestLoggingInterceptor` 在 handler 执行前得到 request/response，创建 child
logger 并识别 SSE path。SSE 连接立即记录 `http.sse.connected`。handler 成功/失败后，
`finalize` 记录：普通成功请求按 status 分为 `debug`（路径以 `/health` 结尾且 status<400）、
`info`（其它 <400）或 `warn`（>=400）；普通 handler 错误不重复记录 completed，只交给
exception filter。SSE 无论成功关闭还是失败都分别记录 `http.sse.closed` 或
`http.sse.failed`。

`RequestExceptionFilter` 捕获所有异常：HttpException 使用其 status/response，未知异常
使用 500；生成规范 ServiceError，若 headers 未发送则设置 `X-Request-Id`、status 和
JSON body。若 response 已发送或 writableEnded，filter 不再写第二个 body，但仍记录错误，
并在 fields 中标记 `headersSent: true`。

## 输入

### Request headers/context

- `X-Request-Id`：大小写不敏感的 HTTP header；只接受单个字符串或字符串数组首项，且
  必须匹配 `^[A-Za-z0-9._:-]{1,128}$`。缺失、空、超长或含其它字符时生成 `randomUUID()`。
- request method、route/path/url、statusCode、headersSent/writableEnded 和开始时间由
  HTTP adapter 提供；`requestPath` 优先 `request.route.path`，否则取 path/originalUrl/
  url 并去除 `?` 后 query。
- Exception：任意 unknown；HttpException 的 `getStatus()` 与 `getResponse()` 可用，
  其它异常只作为 logger error context。

### Error candidate

如果 HttpException response 是 record，filter 读取 `code`、`message`、`details`、
`retryable`；只有 contracts `serviceErrorCodeSchema` 中允许的 code 被保留。Validation
`details` 只接受 record 中的 `formErrors` 与 `fieldErrors`，每个 field 最多 3 条消息、
最多 16 个 field；field/message 会脱敏并截断。

## 输出

### Response header/body

所有尚未发送 header 的请求都会获得 `X-Request-Id`。错误 JSON 形状是公共
`ServiceError`：

- 认可的 code 原样保留；未知/缺失 code 按 HTTP status 回退：`>=500 → service_unavailable`、
  `404 → not_found`、`409 → conflict`、其它 `>=400 → validation_failed`，其它状态为
  `uncertain`；
- message 是候选字符串或默认值，经过 logger 同样的敏感文本脱敏并截断到 1024 字符；
  未知 5xx 使用通用 `The Cosmos service could not complete the request.`，其它失败使用
  `Request failed.`；
- requestId 是当前 request id；candidate 的 boolean retryable 保留，否则 status>=500
  默认 true，其它 false；
- validation code 才允许输出经过限额的 `details`，details JSON 大小超过 16 KiB 时
  整体省略。

### Structured log records

Logger record 带 `schemaVersion: "log.v1"`、timestamp、level、service、instanceId、
事件名、相关 context（包括 requestId，如果处于 context）、以及事件字段。API 事件包括
`http.request.completed`、`http.request.failed`、`http.sse.connected`、
`http.sse.failed`、`http.sse.closed`；具体 stdout/file/rotation 属于 logging owner。

### 日志级别与字段

- 完成：健康 API GET 成功为 debug；其它成功为 info；HTTP 4xx/其它 status>=400 为 warn；
  handler 失败由 filter 记录 warn（<500）或 error（>=500）。
- SSE connected/closed 为 info；SSE handler error 为 error，含 method/path/status/durationMs。
- 错误 fields 包含 requestId、method、path、status、durationMs；headers 已发送时再带
  `headersSent: true`。
- 普通完成 fields 包含 method、path、status、durationMs，失败时带 `failed: true`。

`requestPath` 默认去掉 query，避免把 query 直接写进完成日志；logger 的底层 key/text
规则会对 `query`、`headers`、`body`、`payload`、`content`、`token`、`authorization`、
`cookie`、`password` 等敏感字段输出 `[REDACTED]`。

## 状态与持久化

组件没有持久状态。一次 request 期间在内存保存 request id、开始时间、SSE 是否正在运行
以及 interceptor 的 subscription；AsyncLocalStorage context 随调用栈传播。请求结束后
context/subscription 释放。Logger 可能将脱敏后的 `log.v1` 记录写 stdout、file 或两者，
但这些文件不构成 Product API 的业务真相。

## 状态转换

1. `received → contextualized`：middleware 接受/生成 request id，设置 response header 和
   start time。
2. `contextualized → executing`：interceptor 创建 child logger，并进入 handler。
3. `executing → completed`：handler 返回，普通请求按 status 记录完成日志；SSE 记录 closed。
4. `executing → failed`：handler/Observable 抛错；SSE 记录 failed，普通错误交由 filter。
5. `failed → error-response`：headers 未发送时写 ServiceError；headers 已发送时只记录
   `headersSent` 并结束/保持底层连接语义。
6. `completed/failed → released`：RxJS subscription unsubscribe，context 不再用于后续请求。

同一个 request id 在 response header、ServiceError 和日志中保持一致；middleware 未运行时
interceptor/filter 会再次从原始 header 生成/读取 id，但 runtime 正常组合会先运行
middleware。

## 副作用

- 设置一个响应 header（仅 headers 未发送时）。
- 通过 logger child/context 写 request completion/error/SSE 记录。
- 对 Observable 建立并最终 unsubscribe subscription；不写 Source、Run、Job、Event 或
  content。
- Exception filter 只在安全窗口内写 HTTP status/JSON；不尝试覆盖已发送的 SSE/stream
  headers。

## 错误与降级

- 无法接受 caller request id 时安全生成 UUID，不拒绝请求。
- HttpException code 非公共 enum 时回退到 status 推导 code；未知异常转 500、通用 message、
  `service_unavailable`、retryable true。
- Validation details 非 record、无有效消息或超 16 KiB 时省略 details，不让未验证 payload
  进入响应。
- `headersSent`/`writableEnded` 为真时 fail closed：不发送第二个 JSON 响应，避免破坏
  SSE/文件流；仍记录错误。
- 日志底层失败、输出、轮转、保留和文本脱敏由 [Structured Logging](../runtime/0004-structured-logging.md) 处理；本组件不把日志失败升级为业务响应失败。
- 该组件不实现分布式 trace、认证审计、metrics endpoint、采样、OpenTelemetry 或请求
  body 记录。

## 依赖

- Nest `NestInterceptor`、`ExceptionFilter`、`HttpException` 与 HTTP context；
- RxJS `Observable`、`catchError`、`finalize`、`throwError`；
- Node `randomUUID`；
- `@cosmos/contracts` 的 `serviceErrorCodeSchema` 与 `ServiceError`；
- `@cosmos/logging` 的 `Logger`、`sanitizeLogText` 与 structured sink；
- Runtime 在 [`apps/api/src/main.ts`](../../../apps/api/src/main.ts) 安装 middleware、
  interceptor 和 filter。

## 配置

请求观测组件自身没有环境变量。日志 level/output/root/retention/size 通过 logging 组件
的 `COSMOS_LOG_LEVEL`、`COSMOS_LOG_OUTPUT`、`COSMOS_LOG_ROOT`、`COSMOS_LOG_RETENTION_DAYS`
和 `COSMOS_LOG_MAX_BYTES` 等输入解析；默认 level 在 production 为 info、其它环境为
 debug，默认 output 为 both。敏感 key/text、深度、字段数和 64 KiB record 上限是源码固定
边界。

## 重建验收

1. 发送合法 `X-Request-Id: client_01` 到任意 API 路由，观察响应 `X-Request-Id`、
   `http.request.completed`/错误日志和错误 body（如有）均使用 `client_01`；发送含空格或
   超过 128 字符的值，观察请求继续处理且 id 为新 UUID。
2. 发送没有 request id 的成功 `/api/v1/health`，观察生成 UUID 桥接到 response/header
   与 info/debug completion record；确认 `/health` 成功按 debug 而不是 info 记录。
3. 让 Controller 抛出 400 validation exception，观察 HTTP status 不变、body code 为
   `validation_failed`、retryable=false，并最多保留 16 fields、每 field 3 条、总 details
   不超过 16 KiB。
4. 让 handler 抛出未知 Error，观察 HTTP 500、通用 message、`service_unavailable` 和
   retryable=true；确认 stack 只在日志 error serialization，不在客户端 body。
5. 在 query/header/body/payload/authorization 字段中放入 token、cookie、password 或
   content，观察结构化日志中对应值为 `[REDACTED]`，且 query 不出现在 `requestPath`。
6. 建立 `/api/v1/events` SSE 后观察 connected 与 closed 日志；使 poll 抛错，观察
   `http.sse.failed` 含 status/duration/request id，且 headers 已发送时不产生第二个 JSON
   response。
7. 配置 `COSMOS_LOG_OUTPUT=stdout` 和 level，观察低于阈值的记录不输出；配置不可信长
   字符串，观察记录保持相关 correlation id 且不超过固定 record 上限。

## 实现与测试锚点

- Middleware、request id、path、interceptor、exception filter：[`apps/api/src/request-logging.ts`](../../../apps/api/src/request-logging.ts)。
- Runtime 安装顺序：[`apps/api/src/main.ts`](../../../apps/api/src/main.ts)。
- Error/DTO schema：[`packages/contracts/src/index.ts`](../../../packages/contracts/src/index.ts)。
- Sanitization、log.v1、level/filter/rotation：[`packages/logging/src/index.ts`](../../../packages/logging/src/index.ts)。
- Logging behavior tests including redaction, truncation, level filtering and fallback：[`packages/logging/src/index.test.ts`](../../../packages/logging/src/index.test.ts)。
- Controller/SSE error paths and request id bridge are exercised by the API behavior test and smoke script: [`apps/api/src/app.controller.test.ts`](../../../apps/api/src/app.controller.test.ts)、[`scripts/smoke-node.ps1`](../../../scripts/smoke-node.ps1)。

## 非目标/边界

- 不新增认证、授权、访问审计、distributed tracing、metrics、OpenTelemetry 或 log shipping。
- 不把 request log 当作 Domain Event、Run/Job 状态、SSE replay 或业务审计账本。
- 不记录 lease token、Secret、storage key、绝对路径、完整外部 payload、正文或未经脱敏
  query；具体 logger regex 可能比本节列举更广。
- SSE/stream headers 已发送后的错误不保证 ServiceError JSON；这是当前 fail-closed 传输
  语义。
- 浏览器、Docker、跨进程和生产日志收集器未在本基线完成端到端验收。
