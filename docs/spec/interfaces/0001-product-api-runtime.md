# Product API Runtime

## 状态

`Implemented @ 5ce628690ab0110b0525e8ebcbacbe673ced9c55`。本文只记录合入基线中可从 Nest API 进程观察到的启动、组合、探针和关闭行为；它不是部署目标或未来服务合同。

## 最后更新

2026-08-16。

## 组件定位

Product API Runtime 是 Cosmos 的 API 进程入口与组合根。它在一个 Node 进程内创建 Nest 应用，把 `PrismaCosmosRepository`、静态 manifest catalog、工作流入队控制、Workflow Host store 和日志器注入 `AppController`，并提供进程级 liveness/readiness 探针。

它只负责进程资源和依赖的生命周期，不拥有 Source、Run、Job 或内容的第二份状态；这些状态分别由 Application port 和持久化组件拥有。HTTP 资源、公开 DTO、SSE 和 400/404 语义见 [Product API HTTP](0002-product-api-http.md)，request id 与异常日志见 [API Observability](0003-api-observability.md)。

## 概念与定义

- **API 进程**：由 `apps/api/src/main.ts` 启动的单个 Nest/HTTP 进程，默认服务名为 `cosmos-api`。
- **组合根**：`AppModule` 中把端口实现绑定到 Controller 的 Nest module。组合根不把 Prisma client 或 Blob root 暴露给 HTTP 消费者。
- **Liveness**：根路径 `/healthz` 的进程存活响应，不访问数据库，也不表示 API 已完成监听。
- **Readiness**：根路径 `/readyz` 的监听就绪状态；本实现只由 API 监听成功与关闭标志驱动，不等待 Worker 在线。
- **Product health**：版本化路径 `/api/v1/health` 返回的存储、迁移和 Worker 状态快照；字段定义链接 [Public Contracts](../contracts/0001-public-contracts.md)。

## 外部行为

启动顺序是：记录 `api.bootstrap.started` → 初始化共享 Prisma repository → 创建 Nest `AppModule` → 安装 request context、CORS、全局 prefix、日志 interceptor 和异常 filter → 注册 `/healthz` 与 `/readyz` → 监听配置的 host/port → 将 readiness 设为可用并记录 `api.started`。Repository 初始化失败或 Nest/listen 失败会进入失败清理路径，不把进程伪装成 ready。

应用建立后，Controller 路由都位于 `/api/v1` 下；根探针是 adapter 级路由，故不带该 prefix。`/api/v1/health` 调用 repository health；其它资源行为在 [Product API HTTP](0002-product-api-http.md) 中定义。

收到第一次 `SIGINT` 或 `SIGTERM` 时，runtime 先把 readiness 设为不可用，再关闭 Nest HTTP 应用，随后关闭 repository，记录 `api.stopped`，最后 flush/关闭 logger。`api.stopped.status` 反映 app/repository 关闭阶段是否 degraded；logger close 在该日志之后执行，若失败会设置非零退出码但不能回写已经发出的日志。重复信号不会重复关闭。关闭阶段发生错误时仍尝试后续资源清理，并以 `process.exitCode = 1` 标记 degraded stop。

## 输入

### 环境输入

| 输入 | 默认值 | 作用 |
| --- | --- | --- |
| `COSMOS_API_HOST` | `127.0.0.1` | `app.listen` 的绑定 host。 |
| `COSMOS_API_PORT` | `4310` | `app.listen` 的端口，按 `Number` 转换。 |
| `COSMOS_ALLOWED_ORIGIN` | 未设置时传入 `true` | Nest CORS 的 `origin` 选项；设置字符串时只使用该 origin，未设置时使用 Nest 的允许跨域行为。 |
| `COSMOS_VERSION` | `0.1.0` | `/api/v1/health` 的服务版本。 |
| `COSMOS_SSE_REPLAY_LIMIT` | `100` | 由 HTTP SSE Controller 读取；详见 [Product API HTTP](0002-product-api-http.md)。 |
| `COSMOS_DATA_ROOT` | `.cosmos` | repository、日志等下游组件的默认数据根；runtime 本身不解析或拼接文件路径。 |
| `COSMOS_LOG_*` | 由 logging 组件的默认值决定 | logger 配置；详见 [Structured Logging](../runtime/0004-structured-logging.md)。 |

`COSMOS_API_PORT` 没有显式范围校验；重建时必须传入可被 Node `listen` 接受的数值。`COSMOS_ALLOWED_ORIGIN` 不是认证或授权机制，CORS 也不能把非 loopback 暴露变成受信部署。

### 依赖输入

`AppModule` 使用以下 Nest provider token：

- `COSMOS_PRODUCT_PORT` → `cosmosRepository`（Prisma repository）；
- `COSMOS_LOGGER` → `cosmosLogger`（service=`cosmos-api`、fileName=`api`）；
- `COSMOS_CATALOG` → builtin 静态 catalog；
- `COSMOS_WORKFLOW_CONTROL` → `IngestWorkflowControlService`，读取 Source execution snapshot 和 checkpoint 后入队 `cosmos.ingest@1`；
- `COSMOS_WORKFLOW_STORE` → `PrismaWorkflowHostStore`；
- `SourceProbeService` → 只读 manifest catalog 校验与 connector descriptor 查询。

## 输出

### 启动与探针

根路径响应如下，时间戳为每次请求生成的 ISO 字符串：

- `GET /healthz`：HTTP `200`，`{ status: "ok", service: "cosmos-api", timestamp }`。该路由不访问 repository。
- `GET /readyz`：初始化监听前或 shutdown 开始后为 HTTP `503`，body 的 `status` 为 `"starting"`；监听成功且未关闭时为 HTTP `200`，`status` 为 `"ready"`。body 同样包含 `service: "cosmos-api"` 和 `timestamp`。

两种探针均是 adapter 级 JSON 响应，不能推导 Worker 是否可用。成功启动日志中的 `health` 字段指向 `http://localhost:<port>/api/v1/health`。

### 组合后的公开服务

Nest controller 通过 `/api/v1` 暴露 Product API；它只接收/返回 contracts 中的公开 DTO 或 manifest 白名单投影，不向 HTTP 层传递 lease token、Secret、Blob storage key 或绝对路径。完整方法、状态码和字段见 [Product API HTTP](0002-product-api-http.md)。

## 状态与持久化

Runtime 的进程内状态只有：

- `apiReady`：初始 `false`，listen 成功后为 `true`，shutdown 开始时为 `false`；
- `shuttingDown`：用于保证信号处理只执行一次；
- `app` 引用和启动计时。

这些值均为内存状态，进程重启后丢失。Source、Run、Job、Attempt、Workflow envelope、Domain Event 和内容不由 runtime 保存；它们由 repository/workflow store 的持久边界负责。Logger 可能写 stdout/file，但日志不是业务状态。

## 状态转换

合法转换如下：

1. `created → initializing`：进入 `bootstrap`，记录启动事件并初始化 repository。
2. `initializing → listening-not-ready`：Nest 创建、middleware/filter/prefix/探针注册完成，开始监听但 `apiReady` 仍为 `false`。
3. `listening-not-ready → ready`：`app.listen` 成功，`/readyz` 从 503 变为 200。
4. `ready → stopping`：首次 SIGINT/SIGTERM，把 `apiReady` 设为 `false`；后续请求看到 `/readyz` 503。
5. `stopping → closed`：依次完成 app close、repository close、`api.stopped` 记录和 logger close；app/repository 失败时记录 degraded，logger close 失败发生在该状态日志之后但仍使进程以非零码退出。
6. `initializing → failed`：启动异常记录 `api.failed`，尝试关闭已创建资源，设置 `process.exitCode = 1`。

`stopping` 没有重新回到 `ready` 的转换；重复信号是 no-op。

## 副作用

- 启动时调用 repository `initialize()`，可能连接/迁移其持久化后端；runtime 不自行执行 SQL。
- 创建 Nest HTTP server，并安装 CORS、请求上下文 middleware、全局 interceptor/filter。
- 启动与关闭写结构化日志；失败日志包含阶段和信号，但不记录 Secret 或完整请求 payload。
- 关闭时调用 `app.close()`、`cosmosRepository.close()` 和 `cosmosLogger.close()`；关闭失败只影响退出码和日志，不跳过后续清理。

## 错误与降级

- Repository 初始化、Nest 创建、监听或其它 bootstrap 异常：记录 `api.failed`，清理已创建资源，设置非零退出码；没有成功启动的 HTTP 服务合同。
- `app.close` 或 repository close 失败：记录 `api.stop_failed`，继续清理；`api.stopped.status` 为 `degraded`，并设置非零退出码。
- logger close 本身失败发生在 `api.stopped` 记录之后：它不能改变已写出的 status，但会使 shutdown 结果以非零 `process.exitCode` 结束；不会重新打开服务。
- `/readyz` 不报告 repository 的细粒度状态；启动后持久层损坏由 `/api/v1/health` 和 API 请求的错误合同报告，而不是由本探针推断。
- CORS 配置错误、认证、HTTPS、远程 Worker/Gateway 和跨主机 fencing 不在本组件中实现。

## 依赖

- NestJS `NestFactory`、`AppModule` 和 platform HTTP adapter；
- `@cosmos/storage-prisma` 的 `PrismaCosmosRepository` 与 `PrismaWorkflowHostStore`；
- `@cosmos/application` 的 `IngestWorkflowControlService`、health projection 和 workflow ports；
- `@cosmos/logging` 的 structured logger；
- `@cosmos/contracts` 的 health 与公开 DTO；
- Controller 使用的 request logging 适配器，见 [API Observability](0003-api-observability.md)。

Runtime 不依赖 Gateway、Redis、远程执行服务或浏览器运行时。

## 配置

API 默认绑定 `127.0.0.1:4310`，适合本地/loopback 使用。改变 host 到其它接口不会自动获得身份验证、TLS、请求授权或安全文件访问。CORS 的允许 origin 与监听地址是独立配置，不能以 CORS 代替网络边界。

`COSMOS_VERSION` 只影响 health DTO；不会改变 protocol version（当前由 contracts 固定为 `v1`）。SSE replay 上限和日志配置由相邻组件消费；未设置时使用源码中的默认值。

## 重建验收

1. 在有效 `COSMOS_DATA_ROOT` 下启动 API，未设置 host/port 时，观察进程监听 `127.0.0.1:4310`，且成功后 `GET /readyz` 返回 HTTP 200、`status=ready`。
2. 在 repository 尚未完成初始化的启动窗口请求 `/readyz`，观察 HTTP 503 和 `status=starting`；请求 `/healthz` 仍返回 HTTP 200 且不触发数据库查询。
3. 请求 `GET /api/v1/health`，观察 `service=cosmos-api`、`protocolVersion=v1` 和 `COSMOS_VERSION` 的版本值，并确认 storage/migration/worker 状态来自 repository health，而非固定字符串。
4. 启动后发送一次 SIGTERM，再请求 `/readyz`，观察 readiness 变为 HTTP 503；日志中按顺序出现停止阶段，且第二次 SIGTERM 不重复关闭资源。
5. 让 repository 初始化或关闭抛错，观察对应失败日志和非零 `process.exitCode`，并确认已创建的后续资源仍被尝试关闭。
6. 将 `COSMOS_ALLOWED_ORIGIN` 设置为明确 origin，发送跨域请求，观察响应按该 CORS 配置处理；未设置时不把 CORS 当作认证授权。

## 实现与测试锚点

- 启动、prefix、CORS、探针、信号关闭：[`apps/api/src/main.ts`](../../../apps/api/src/main.ts)。
- Nest provider 组合：[`apps/api/src/app.module.ts`](../../../apps/api/src/app.module.ts)。
- health Product DTO：[`apps/api/src/app.controller.ts`](../../../apps/api/src/app.controller.ts)、[`packages/application/src/index.ts`](../../../packages/application/src/index.ts)。
- repository health 与 Worker heartbeat 投影：[`packages/storage-prisma/src/index.ts`](../../../packages/storage-prisma/src/index.ts)。
- API Controller 行为测试（SSE、probe、run projection）：[`apps/api/src/app.controller.test.ts`](../../../apps/api/src/app.controller.test.ts)。
- 相关共享字段与 Zod schema：[`packages/contracts/src/index.ts`](../../../packages/contracts/src/index.ts)。

## 非目标/边界

- 不把 `/healthz`/`/readyz` 写成数据库或 Worker liveness/readiness；它们只是当前 runtime 实现的 API 进程探针。
- 不实现认证、授权、HTTPS、CSRF、rate limit、Gateway、Redis、多主机部署或远程 Worker API。
- 不把 `docs/api` 中 Draft/Planned/Reserved 路由写成当前行为；当前路由以 [Product API HTTP](0002-product-api-http.md) 和 Controller 源码为准。
- Docker、浏览器/e2e、真实 RSS/Bilibili/OpenCLI、跨进程 recovery 和长时双 Worker fencing 不由本 runtime 文档宣称已验证。
