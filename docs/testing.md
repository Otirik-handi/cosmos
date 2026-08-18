# 测试入口与验收边界

本文记录 Cosmos 当前可执行的测试入口、隔离规则和验证边界。默认门禁离线、可重复，不读取用户真实 `.cosmos` 数据，也不要求 Docker、公网来源或 OpenCLI。

## 分层入口

| 层级          | 命令                                                                         | 当前覆盖                                                                                                       |
| ------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 单元          | `bun run test`                                                               | 包内和应用单元行为测试                                                                                         |
| 属性          | `bun run test:property`                                                      | 幂等、租约 fencing、Worker recovery priority；独立配置只收集 `*.property.test.ts`                              |
| 类型/数据库   | `bun run typecheck`、`bun run db:validate`、`bun run db:generate`            | 全仓 TypeScript、Prisma schema 与 Client                                                                       |
| 构建          | `bun run build`                                                              | packages、API、Worker、Next Web 生产产物                                                                       |
| Node 进程 E2E | `bun run test:e2e`                                                           | 构建后的真实 API/Worker、隔离 SQLite、HTTP、SSE、结构化日志；包含 ingest、Admin、跨进程 recovery、调度失败隔离 |
| 浏览器 E2E    | `bun run test:browser`                                                       | 真实 Next/API/Worker Stack 中的来源创建、录入、Feed 和 Story 用户流程                                          |
| Windows smoke | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-node.ps1` | Windows Node API/Worker、迁移、health、fixture、Feed/Search/Story、SSE、requestId 和脱敏日志                   |

`bun run test:e2e` 使用独立的 `vitest.e2e.config.ts`，先构建 API/Worker，再串行运行 `e2e/**/*.e2e.test.ts`。`bun run test:property` 使用独立的 `vitest.property.config.ts`，不会继承全仓单元测试 include。

## 隔离与进程

Node E2E 通过 `scripts/e2e/helpers.ts` 为每个场景创建 `.agent/tmp/<name>-<uuid>/`，分别放置 Data、Blob 和 Log Root，并调用 Prisma migration。API、Worker 和 Worker Admin 使用动态端口；测试不能假设 `9091` 空闲。Windows 停止进程树使用 `taskkill /t /f`，POSIX 使用进程组终止；所有测试在 finally 中停止服务。

受控 RSS recovery 使用 `scripts/e2e/controlled-rss.ts` 的真实 HTTP 请求、请求到达和 lease expiry 同步，不使用固定 sleep 伪造接管。验证从 API、SQLite、结构化日志和最终 Feed/Run 读取，不接受进程自报成功。

浏览器 Stack 由 `scripts/e2e/web-stack.ts` 管理隔离 API/Worker/Next 进程。动态 API 端口在 Next production build 前注入，Web 使用 same-origin `/api` rewrite；需要先安装 Chromium：

```text
bunx playwright install chromium
```

测试监听 `pageerror`、未预期 console error 和网络失败，并在 teardown 清理全部子进程。截图和 trace 位于被忽略的 `test-results/`，不作为业务状态来源。

## 可选验收

Docker 只通过显式命令执行：

```text
bun run test:docker
```

命令检查 Docker CLI/daemon，执行 `docker compose -f docker/compose.yml up --build -d`，等待 API/Web/Worker，完成 fixture Run 和 Feed 验收，最后执行 `down --volumes --remove-orphans`。Docker 不属于 `test`、`test:e2e` 或默认 CI；缺少 Docker 前置时命令明确失败。

真实来源只通过显式命令执行，并且每种来源独立校验前置：

```text
COSMOS_REAL_RSS_URL=<url> bun run test:real:rss
COSMOS_ALLOW_REAL_NETWORK=true bun run test:real:aihot
COSMOS_ALLOW_REAL_NETWORK=true COSMOS_OPENCLI_PATH=<path> OPENCLI_PROFILE=<profile> bun run test:real:bilibili
```

真实来源脚本使用隔离 API/Worker/SQLite，要求 Run 成功、item count 在 bounded 范围内并通过日志脱敏检查。缺变量、联网许可或 OpenCLI/Browser Bridge 前置时立即失败；这些命令不进入默认 CI，也不把网络错误解释为离线 Worker 回归。

## CI 分层

`.github/workflows/ci.yml` 将质量、Node E2E、浏览器 E2E 和 Windows smoke 分为独立 job。质量 job 执行数据库检查、类型检查、单元测试、Web lint 和构建；Node/browser/smoke job 分别报告自己的结果。Docker 和真实来源没有加入默认 CI。

## 证据边界

测试通过只证明对应层的可观察合同：单元测试不替代进程 E2E，Node E2E 不替代浏览器验收，浏览器验收不替代 Docker 或真实来源。当前已验证离线 fixture 的四个 Node E2E、一个 Playwright 用户流程和 Windows smoke；Docker 因本机没有 Docker CLI 未运行，真实 RSS、AI HOT、Bilibili 因缺少显式外部前置未运行。本文不引入 Agent/LLM replay；受控 RSS、SSE 消费和结构化日志是当前 Cosmos 的可复现边界。
