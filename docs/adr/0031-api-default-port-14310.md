# ADR-0031：API 默认端口 14310

## Context

Cosmos 的 Product API 在开发、E2E 和 Compose 里长期默认使用 `4310`。这个默认值在开发机上并不稳定：`4310` 是 QQ 客户端常用的本机监听端口，启动 QQ 后它会占住 `127.0.0.1:4310`，于是 `bun run dev` 的端口探测会顺延到 `4311`、`4312` 等后续端口。历史上这已经造成过三类问题：

- 开发启动日志里的实际端口与文档、脚本、前端构建产物里写死的 `4310` 不一致，浏览器和 CLI 探测打到 QQ 的本地服务上，返回无意义的 HTTP 200，把「连不上 API」伪装成「API 正常」；
- E2E 与多套并行开发栈各自对同一首选端口做探测→绑定，出现竞态，多个栈探到同一个空闲端口；
- Compose 发布 `4310:4310` 与开发机的 QQ 直接冲突。

`docs/spec/operations/0002-development-runtime.md` 只规定了「首选端口由调用方显式传入、函数本身不声明默认值」，没有规定这个首选值本身该是多少，所以改动它不需要改合同语义，但需要一个可追溯的决定。

## Decision

开发编排、E2E、Compose 和文档中的 API 默认首选端口统一改为 `14310`。

- `scripts/dev.ts` 以 `findAvailablePort(14310)` 启动 API，Web 默认 `3000`、Worker Admin 默认 `9091` 不变。
- `scripts/dev-service.ts`（`bun run dev:api`）同样以 `14310` 为首选，并复用 `withApiTrustEnvironment` 注入模型配置写信任变量。
- `.env.example`、`README.md`、`docker/`、`e2e/`、`scripts/e2e/` 与 `docs/spec/` 的相关默认值同步为 `14310`。
- 端口冲突的处理方式不变：首选端口被占用时仍由 `findAvailablePort` 顺延，实际端口以启动日志为准。

选 `14310` 而不是继续留在 `43xx` 段，是因为该段在本机被常用客户端（QQ 等）密集占用；`14310` 落在动态端口范围（Windows 默认 `49152` 起）之外，也不在 Hyper-V 等系统保留段内。

## Consequences

### Positive

- 开发机不再因为启动 QQ 就改变 API 端口，文档、日志、前端构建产物与真实监听地址一致。
- 开发栈与 Compose 共用同一个默认值，减少「本机能跑、容器里地址不对」的分叉。
- 仍然保留顺延能力，`14310` 自身被占用时不会阻塞启动。

### Costs and risks

- 已经在本机 `.env`、脚本或书签里写死 `4310` 的开发者需要改一次；写死 `4310` 的第三方脚本会失效。
- 端口号变更本身不改变任何合同；但任何把 `4310` 当作 API 身份的判断（例如 E2E 的就绪探测）都必须改为读取实际端口，而不是硬编码。
- 这不是安全措施：`14310` 依然无认证，仍只允许本机或受信网络访问。

## Revisit Gate

仅在以下情况出现时重新评估：

1. `14310` 在本机或 CI 环境中也变成常见冲突端口；
2. 引入多实例开发栈，需要按实例分配不冲突的默认基线；
3. 生产或 Compose 的端口约定与开发默认值需要分开治理，而不是共用一个数字。

## Related

- 组件规格：[`docs/spec/operations/0002-development-runtime.md`](../spec/operations/0002-development-runtime.md)、[`0001-deployment.md`](../spec/operations/0001-deployment.md)
- 历史证据：[`.agents/tasks/36-reading-layout-and-object-details/walkthrough/rounds-0010-0012.md`](../../.agents/tasks/36-reading-layout-and-object-details/walkthrough/rounds-0010-0012.md)、[`.agents/tasks/02-rss-ingestion/readme/slices-2026-08-23-09-02.md`](../../.agents/tasks/02-rss-ingestion/readme/slices-2026-08-23-09-02.md)、[`.agents/tasks/35-frontend-redesign/walkthrough/rounds-8.md`](../../.agents/tasks/35-frontend-redesign/walkthrough/rounds-8.md)
