## 状态

当前实现规格；后续代码变化应同步更新本文。

## 最后更新

`2026-08-16`

## 组件定位

本组件定义 Cosmos 的容器镜像和 Compose 部署草案：

- 使用一个 Dockerfile 构建一份包含 Web、API、Worker 产物的镜像。
- Compose 从同一镜像启动 `web`、`api`、`worker` 三个独立进程。
- `api` 持有数据库迁移与 HTTP 服务启动职责。
- `web` 和 `worker` 以 API 健康检查为启动门槛。
- SQLite 数据和文件日志通过命名卷持久化。
- 服务发现依赖 Compose 默认网络中的服务 DNS 名 `api`，不经过外部 Gateway。

除镜像构建定义外，Compose 行为是当前配置意图；当前配置尚未在当前机器上实际启动容器验证。


### 在系统中的位置与作用
它位于仓库交付和运行环境之间，描述 Dockerfile 构建产物以及 Compose 中 web、api、worker 三进程的部署关系。

### 解决的问题
它集中说明镜像阶段、服务启动依赖、健康检查、SQLite/日志卷和 Compose DNS，帮助部署者理解当前容器配置意图。

### 使用方式
需要评估或执行容器部署时，按 Dockerfile 构建镜像，再按 Compose 启动服务并以 API 健康检查作为 web/worker 门槛；本文明确的 Compose 行为尚未在当前机器实际启动验证。

### 典型情景
审查容器资源、服务发现、数据卷或迁移启动顺序时，查阅本规格；不要把草案描述当作已完成的生产验收。

## 概念与定义

- **构建阶段**：基于 `oven/bun:1.3.14` 安装依赖并构建整个工作区。
- **运行阶段**：基于 `node:24-bookworm-slim` 承载构建产物、Prisma CLI、Next standalone、API 和 Worker。
- **一镜像三进程**：`web`、`api`、`worker` 使用同一 Dockerfile 和构建上下文，但由不同 Compose 命令启动。
- **数据根目录**：`/var/lib/cosmos`，用于 SQLite 数据库及其他运行期持久数据。
- **日志目录**：`/var/lib/cosmos/logs`，由 `cosmos-logs` 命名卷持久化。
- **API 健康门槛**：`api` 的健康检查成功后，Compose 才允许 `web` 和 `worker` 启动。
- **迁移部署**：通过 Prisma `migrate deploy` 应用已经生成的前向迁移，不生成新迁移，也不提供自动回滚。
- **默认服务网络**：Compose 自动创建的默认网络；容器内通过 `http://api:4310` 访问 API。
- **接口所有权**：Product API、Feed、Search 和 SSE 契约由 [API 实现（接口所有者）](../../../apps/api/) 定义。`/api/v1/health` 在本组件中只作为容器就绪探针，不代表 Product API 的完整契约。

## 外部行为

| 服务 | 启动行为 | 容器监听 | 主机映射 | 启动约束 |
|---|---|---:|---:|---|
| `web` | 启动 Next standalone server | `0.0.0.0:3000` | `3000:3000` | 等待 `api` healthy |
| `api` | 创建数据目录和数据库文件，执行 Prisma 迁移，然后启动 `apps/api/dist/main.js` | `0.0.0.0:4310` | `4310:4310` | 迁移成功后才能启动 API |
| `worker` | 启动 `apps/worker/dist/main.js` | 无对外监听要求 | 无 | 等待 `api` healthy |

健康检查请求：

```text
GET http://127.0.0.1:4310/api/v1/health
```

检查参数：

| 参数 | 值 |
|---|---:|
| `interval` | `5s` |
| `timeout` | `3s` |
| `retries` | `20` |
| `start_period` | `10s` |

`depends_on: condition: service_healthy` 只约束依赖服务的初始启动顺序；API 在依赖服务已经启动后变为 unhealthy，不会由该配置自动停止或重启现有 Web、Worker 进程。

## 输入

**镜像构建输入**

- 构建上下文：`..`
- Dockerfile：`docker/Dockerfile`
- 构建参数：`COSMOS_API_URL`
- 构建参数默认值：`http://localhost:4310`
- Compose 构建参数值：`http://api:4310`
- 依赖与编译输入：package manifests、锁文件、TypeScript 配置和工作区源代码。
- 依赖安装命令：`bun install --frozen-lockfile`
- 构建命令：`bun run build`

**运行输入**

| 服务 | 输入 |
|---|---|
| `web` | `HOSTNAME=0.0.0.0`、`PORT=3000`、日志模式 `both`、`cosmos-logs` 卷；`COSMOS_API_URL=http://api:4310` 只作为 Web 构建阶段的 build arg，不作为 Compose Web 运行时环境变量 |
| `api` | API host `0.0.0.0`、API port `4310`、`COSMOS_DATA_ROOT=/var/lib/cosmos`、`DATABASE_URL=file:/var/lib/cosmos/cosmos.sqlite`、日志模式 `both`、`cosmos-data` 与 `cosmos-logs` 卷 |
| `worker` | workflow host `true`、`COSMOS_DATA_ROOT=/var/lib/cosmos`、`DATABASE_URL=file:/var/lib/cosmos/cosmos.sqlite`、poll interval `30000`、日志模式 `both`、`cosmos-data` 与 `cosmos-logs` 卷 |

## 输出

- 一份包含 Web、API、Worker 运行产物的 Node.js 运行镜像。
- `web` 进程及主机端口 `3000`。
- `api` 进程及主机端口 `4310`。
- 不暴露主机端口的 `worker` 进程。
- SQLite 数据库文件 `/var/lib/cosmos/cosmos.sqlite`。
- 写入控制台和文件的运行日志。
- 命名卷 `cosmos-data` 中的持久数据。
- 命名卷 `cosmos-logs` 中的持久日志。
- API 健康状态，供 Compose 依赖启动条件使用。

## 状态与持久化

- `cosmos-data` 挂载到 `/var/lib/cosmos`，由 `api` 和 `worker` 共享。
- `cosmos-logs` 挂载到 `/var/lib/cosmos/logs`，由 `web`、`api` 和 `worker` 共享。
- SQLite 数据库固定为 `file:/var/lib/cosmos/cosmos.sqlite`。
- 删除或重建服务容器不会自动删除命名卷，因此数据库和文件日志应跨容器重建保留。
- 执行会删除命名卷的操作，例如 `docker compose down -v`，会删除对应持久状态。
- API 启动前执行 Prisma `migrate deploy`，把现有数据库向当前已提交迁移版本推进。
- Worker 不执行数据库迁移，只消费 API 已完成迁移后的共享状态。
- 当前定义不保证迁移降级、自动回滚、跨主机文件锁或多节点 SQLite 一致性。

## 状态转换

1. Docker 进入 `oven/bun:1.3.14` 构建阶段，工作目录设为 `/app`。
2. 构建阶段注入 `COSMOS_API_URL` build arg，并在该阶段以同名 `ENV` 提供给 Web 构建；Compose Web 运行时不设置该变量。
3. 复制 package manifests、锁文件和 TypeScript 配置。
4. 执行 `bun install --frozen-lockfile`。
5. 复制其余工作区内容并执行 `bun run build`。
6. 进入 `node:24-bookworm-slim` 运行阶段。
7. 复制构建树，布置 Next standalone、static 和 public 资源，并创建 `/var/lib/cosmos`。
8. Compose 从同一镜像创建 `api`、`web`、`worker` 服务。
9. `api` 确保数据目录存在，并仅在 SQLite 文件不存在时创建 `/var/lib/cosmos/cosmos.sqlite`；已有文件不会被 `touch` 清空。
10. `api` 执行 Prisma `migrate deploy`。
11. 迁移成功后，`api` 启动 `apps/api/dist/main.js`。
12. `/api/v1/health` 连续满足 Compose 健康条件后，`api` 进入 healthy。
13. `web` 启动 Next standalone server，`worker` 启动 `apps/worker/dist/main.js`。
14. 若构建、数据库准备、迁移或 API 启动失败，API 无法进入 healthy，依赖健康状态的 Web 和 Worker 不会按当前 Compose 启动条件继续启动。

## 副作用

- 构建阶段下载并安装锁文件指定的依赖。
- 构建阶段生成 Web、API、Worker 产物。
- API 启动命令创建 `/var/lib/cosmos`，并仅在 SQLite 文件不存在时创建数据库文件；已有数据库不会被 `touch` 清空。
- Prisma 迁移可能修改数据库模式及迁移元数据。
- API 和 Worker 读写 `cosmos-data`。
- Web、API、Worker 向控制台和 `cosmos-logs` 写入日志。
- Web 在 `3000` 端口建立网络监听。
- API 在 `4310` 端口建立网络监听。
- 健康检查周期性向 API 本地回环地址发起 HTTP 请求。
- Worker 按 `30000` 的轮询间隔执行工作流相关轮询。

## 错误与降级

- package manifests、锁文件或工作区依赖不一致时，`bun install --frozen-lockfile` 失败并终止镜像构建。
- `bun run build` 任一工作区构建失败时，不产生可用运行镜像。
- Next standalone、static 或 public 产物缺失时，Web 进程可能无法启动或无法完整提供静态资源。
- 数据目录或数据库文件不可创建时，API 启动命令终止。
- Prisma CLI、schema 或迁移文件缺失时，迁移失败，API 主进程不会启动。
- 迁移执行失败时，不保证数据库自动恢复到迁移前状态。
- API 未监听、启动过慢或健康端点未成功响应时，健康检查最终失败，Web 和 Worker 保持未启动状态。
- Worker 自身不执行迁移，不能在 API 迁移失败时接管数据库准备。
- Worker 没有外部端口，不能通过端口探针直接确认其业务进度。
- 当前 Compose 未定义 Redis、Gateway、外部负载均衡或跨主机故障转移。
- 当前测试没有容器运行验证，因此不能把已声明的健康门槛、卷权限和容器内文件布局视为已通过实机验收。

## 依赖

| 依赖 | 用途 |
|---|---|
| `oven/bun:1.3.14` | 安装锁定依赖并执行工作区构建 |
| `node:24-bookworm-slim` | 运行 Next standalone、API、Worker 和 Prisma CLI |
| Bun 锁文件 | 保证 `--frozen-lockfile` 安装输入固定 |
| Prisma CLI | 执行 `migrate deploy` |
| `packages/storage-prisma/prisma/schema.prisma` | Prisma 迁移 schema |
| Next standalone 产物 | 提供 Web 服务 |
| `apps/api/dist/main.js` | API 进程入口 |
| `apps/worker/dist/main.js` | Worker 进程入口 |
| Compose 默认网络 | 提供 `api` 服务 DNS 和容器间通信 |
| `cosmos-data` | 持久化 SQLite 数据 |
| `cosmos-logs` | 持久化文件日志 |
| API healthy 状态 | Web 和 Worker 的 Compose 启动门槛 |

## 配置

**Dockerfile 默认值**

| 配置 | 值 |
|---|---|
| build image | `oven/bun:1.3.14` |
| runtime image | `node:24-bookworm-slim` |
| `WORKDIR` | `/app` |
| `ARG COSMOS_API_URL` | `http://localhost:4310` |
| `ENV COSMOS_API_URL` | 构建阶段使用同名 build arg 注入；不是 Compose Web 运行时环境变量 |
| `NODE_ENV` | `production` |
| `COSMOS_DATA_ROOT` | `/var/lib/cosmos` |
| `DATABASE_URL` | `file:/var/lib/cosmos/cosmos.sqlite` |
| exposed Web port | `3000` |
| exposed API port | `4310` |
| Prisma schema | `packages/storage-prisma/prisma/schema.prisma` |
| Dockerfile 默认主进程 | 数据库准备 → Prisma `migrate deploy` → `node apps/api/dist/main.js` |

**Compose 默认值**

| 配置 | 值 |
|---|---|
| services | `web`、`api`、`worker` |
| build context | `..` |
| Dockerfile | `docker/Dockerfile` |
| build `COSMOS_API_URL` | `http://api:4310` |
| Web host | `0.0.0.0` |
| Web port | `3000` |
| API host | `0.0.0.0` |
| API port | `4310` |
| data root | `/var/lib/cosmos` |
| database URL | `file:/var/lib/cosmos/cosmos.sqlite` |
| workflow host | `true` |
| worker poll interval | `30000` |
| log mode | `both` |
| API health URL | `http://127.0.0.1:4310/api/v1/health` |
| health interval | `5s` |
| health timeout | `3s` |
| health retries | `20` |
| health start period | `10s` |
| data volume | `cosmos-data` |
| log volume | `cosmos-logs` |
| service network | Compose default network |
| internal API DNS | `api` |

## 重建验收

- 给定当前实现和完整锁文件 → 观察 `oven/bun:1.3.14` 阶段完成冻结依赖安装及工作区构建 → 且不发生锁文件更新或未锁定依赖安装。
- 给定 Compose 的三个服务构建配置 → 观察 `web`、`api`、`worker` 均使用上下文 `..`、`docker/Dockerfile` 和 `COSMOS_API_URL=http://api:4310` → 且不发生三个服务各自构建不同应用镜像。
- 给定一份新建的 `cosmos-data` 卷 → 观察 API 创建 `/var/lib/cosmos/cosmos.sqlite`、成功执行 Prisma `migrate deploy` 后才启动 API → 且不发生 API 在迁移失败后继续监听 `4310`。
- 给定 API 尚未达到 healthy → 观察 Web 和 Worker 受 `service_healthy` 条件阻塞 → 且不发生 Web 或 Worker 绕过初始 API 健康门槛启动。
- 给定 API 已在 `127.0.0.1:4310` 成功响应健康检查 → 观察 Web 启动 Next standalone server且 Worker 启动其生产入口 → 且不发生健康端点被视为完整 Product API 合约验收。
- 给定三个服务均已启动 → 观察主机只映射 Web `3000` 和 API `4310` → 且不发生 Worker 端口暴露。
- 给定容器通过 Compose 默认网络通信 → 观察 Web 使用 `http://api:4310` 定位 API → 且不发生对外部 Gateway、Redis 或主机回环地址的服务发现依赖。
- 给定 API 或 Worker 写入 SQLite 状态后重建服务容器但保留命名卷 → 观察 `/var/lib/cosmos` 中的数据仍可见 → 且不发生仅因容器重建而清空数据库。
- 给定任一服务产生文件日志后重建服务容器但保留 `cosmos-logs` → 观察日志卷中的既有内容仍保留 → 且不发生仅因容器重建而清空文件日志。
- 给定执行当前 `smoke-node` 验收锚点 → 观察隔离数据根目录下的 Node 生产 API 与 Worker 完成迁移、持久结果、Feed、Search、SSE 和日志验证 → 且不发生将该结果解释为 Docker 镜像、Compose 网络、健康检查、端口映射或命名卷已验证。
- 给定迁移命令返回非零状态 → 观察 shell 命令链停止且 API 主进程不启动 → 且不发生自动回滚保证或 Worker 代替 API 执行迁移。
- 给定当前机器尚未执行容器验收 → 观察上述容器项保持为待运行验证的重建标准 → 且不发生把 Compose 配置意图记录为已通过运行验证。

## 实现与测试锚点

- [docker/Dockerfile](../../../docker/Dockerfile)：镜像构建、运行时基础镜像、默认环境、构建产物复制、Next standalone 布置、数据目录准备、Prisma 迁移和默认 API 启动命令。
- [docker/compose.yml](../../../docker/compose.yml)：`web`、`api`、`worker` 三服务命令、环境、端口、健康检查、依赖关系、命名卷和默认网络配置。
- [API 实现（接口所有者）](../../../apps/api/)：Product API、Feed、Search、SSE 及健康路由的实际接口实现；Compose 只消费健康路由作为就绪信号。
- [`scripts/smoke-node.ps1`](../../../scripts/smoke-node.ps1)：当前唯一验收锚点，不属于本部署组件。它验证隔离数据根目录中的 Node 生产 API 与 Worker、迁移、持久结果、Feed、Search、SSE 和日志，但不构建或运行容器，也不验证 Compose 服务 DNS、端口映射、健康门槛、镜像文件布局、卷挂载或容器权限。

## 非目标/边界

- 当前机器未实际构建或运行 Docker 镜像与 Compose 服务。
- 不声明浏览器行为或端到端用户流程已经验证。
- 不声明真实外部数据源已经接入或验证。
- 不声明跨进程崩溃恢复、处理中任务恢复或重复执行语义已经验证。
- 不提供或验证外部 Gateway。
- 不提供或验证 Redis。
- 不提供多主机编排、集群调度、共享文件系统或多节点 SQLite。
- 不提供数据库迁移自动回滚或降级保证。
- 不由 Worker 执行数据库迁移。
- 不对外暴露 Worker 端口。
- 不把 `/api/v1/health` 等同于 Product API 完整契约。
- 不把 `smoke-node` 的 Node 进程验收结果扩展为容器验收结果。
- 不保证 API 在 Web 或 Worker 已启动后变为 unhealthy 时，Compose 会自动停止、重启或隔离依赖服务。
