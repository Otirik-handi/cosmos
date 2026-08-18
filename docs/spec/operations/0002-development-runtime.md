## 状态

当前实现规格；后续代码变化应同步更新本文。

## 最后更新

2026-08-16

## 组件定位

本规格描述开发运行时的脚本组件：

- `scripts/dev-env.ts`：解析工作区开发环境的根目录和数据目录，并构造开发环境变量。
- `scripts/dev-port.ts`：查找可用 TCP 端口，并为 API 进程构造端口相关环境变量。
- `scripts/dev-service.ts`：启动单个 `api` 或 `worker` 开发服务，并处理服务停止。
- `scripts/dev.ts`：按固定顺序启动 `web`、`api`、`worker`，管理开发进程生命周期。
- `scripts/prisma.ts`：在工作区根目录和 `.cosmos` 数据目录下转发 Prisma 数据库命令。
- `scripts/smoke-node.ps1`：开发运行时的验收锚点脚本，仅用于验证构建后的 Node API 与 Worker 行为，不是产品组件。
- `scripts/e2e/helpers.ts`、`controlled-rss.ts`、`web-stack.ts`：Node/浏览器 E2E 的隔离根、动态端口、进程树清理和受控 RSS/Web Stack 边界。


### 在系统中的位置与作用
它是本地开发命令的协调层，连接工作区环境、端口分配、子进程生命周期和 Prisma 命令转发。

### 解决的问题
它把 web、api、worker 的启动顺序、数据目录、临时端口和停止行为统一起来，减少每位开发者手工拼接环境变量或命令的差异。

### 使用方式
开发者运行 `scripts/dev.ts` 或对应脚本；脚本依次准备环境和端口、启动服务，`scripts/prisma.ts` 在指定工作区/数据目录转发数据库命令，`smoke-node.ps1` 仅作验收锚点。

### 典型情景
本地启动完整 Cosmos、单独调试 API/Worker、准备 Prisma 数据库，或执行构建后 Node 行为验收时，选择相应脚本而不是手工启动一组不一致的进程。

## 概念与定义

**工作区根目录 `root`**

由 `scripts/dev-env.ts` 根据当前模块的 `import.meta` URL 解析其上级目录得到的工作区根目录。开发服务和 Prisma 命令均以该根目录作为工作目录。

**工作区数据根目录 `COSMOS_DATA_ROOT`**

由以下规则计算：

```text
resolve(root, configuredDataRoot || ".cosmos")
```

结果写入 `COSMOS_DATA_ROOT`。

**工作流主机开关 `COSMOS_WORKFLOW_HOST_ENABLED`**

开发环境中保留的工作流主机开关，默认值为 `true`。本规格只确认其保留和默认值，不扩展其环境覆盖、字符串解析或运行时语义。

**API 端口**

由 `findAvailablePort` 选择的可监听 TCP 端口。调用方在默认配置下显式传入首选端口 `4310`（即调用 `findAvailablePort(4310)`）；函数本身不声明无参默认值。主机默认值为 `127.0.0.1`，最多尝试连续 `50` 个候选端口。

**API URL**

端口注入后的固定 URL：

```text
http://localhost:<port>
```

该值同时用于：

- `COSMOS_API_URL`
- `NEXT_PUBLIC_COSMOS_API_URL`

**开发服务**

当前仅支持两种服务名：

- `api`
- `worker`

`web` 由 `scripts/dev.ts` 直接启动，不通过 `dev-service.ts` 的服务名校验。

**停止进程树**

Windows 使用：

```text
taskkill /pid <pid> /t /f
```

其中 `/t` 终止目标进程的子进程树，`/f` 强制终止。开发运行时在 Windows 上采用强制进程树终止，不依赖子进程优雅关闭。

非 Windows 使用向子进程发送 `SIGTERM`。`SIGTERM` 分支仅适用于非 Windows。

## 外部行为

**`scripts/dev-env.ts`**

- 解析工作区根目录。
- `createWorkspaceDevEnvironment` 返回的环境对象只包含以下三项：
  - `COSMOS_WORKFLOW_HOST_ENABLED`
  - `COSMOS_WORKSPACE_ROOT`
  - `COSMOS_DATA_ROOT`
- `COSMOS_WORKFLOW_HOST_ENABLED` 默认值为 `true`。
- `COSMOS_WORKSPACE_ROOT` 设置为解析出的 `root`。
- `COSMOS_DATA_ROOT` 设置为 `resolve(root, configuredDataRoot || ".cosmos")`。
- 不复制全部 `process.env` 到返回对象。

**`scripts/dev-port.ts`**

- `findAvailablePort(preferredPort, host = "127.0.0.1", maxAttempts = 50)` 从传入的首选端口开始查找可用端口；重建默认配置时调用方显式使用 `findAvailablePort(4310)`。
- 每个候选端口均通过 `listen` 尝试绑定，并在成功确认后 `close`。
- 最多尝试 `50` 个候选端口。
- `withApiPortEnvironment` 写入：
  - `COSMOS_API_PORT=<port>`
  - `COSMOS_API_URL=http://localhost:<port>`
  - `NEXT_PUBLIC_COSMOS_API_URL=http://localhost:<port>`

**`scripts/dev-service.ts`**

- 仅接受 `api` 或 `worker`。
- `api` 启动前重新查找可用端口，并注入三个 API 端口变量。
- `worker` 不查找端口，也不因自身启动而重新分配 API 端口。
- 服务命令均为对应目录的 package `dev` 脚本。
- 服务停止时：
  - Windows 调用 `taskkill /pid <pid> /t /f`。
  - 非 Windows 向子进程发送 `SIGTERM`。

**`scripts/dev.ts`**

- 创建工作区开发环境。
- 调用端口相关逻辑。
- 按以下固定顺序启动开发进程：
  1. `web`
  2. `api`
  3. `worker`
- 每个进程均使用以下形式启动：

```text
process.execPath run --cwd <dir> dev
```

- 子进程继承：
  - `stdio: "inherit"`
  - 环境变量 `env`
  - 工作目录 `cwd: root`
- 任一子进程非零退出时调用 `stopAll`。
- `SIGINT` 和 `SIGTERM` 到达主进程时调用 `stopAll`。
- 主进程退出时清理已记录的子进程。
- Windows 的 `stopAll` 对每个子进程执行强制进程树终止；非 Windows 执行 `SIGTERM`。

**`scripts/prisma.ts`**

- 使用工作区根目录 `root`。
- 使用数据根目录 `dataRoot`：
  - `COSMOS_DATA_ROOT` 去除首尾空白后非空时使用该值。
  - 否则使用 `.cosmos`。
- 创建数据库文件的父目录。
- 仅当 `databasePath` 不存在时创建空 SQLite 文件；已有数据库文件原样保留，不清空、不截断。
- 必须提供命令参数；无命令时抛出 `Usage`。
- 固定调用：

```text
packages/storage-prisma/node_modules/prisma/build/index.js
```

- 始终追加：

```text
--schema packages/storage-prisma/prisma/schema.prisma
```

- 子进程工作目录为 `root`。
- `DATABASE_URL` 优先使用环境中的值；没有该值时使用：

```text
file:<databasePath with slash>
```

- Prisma 子进程继承标准输入、标准输出和标准错误。
- `spawnSync` 的 `status` 原样透传为脚本退出状态。

**`scripts/smoke-node.ps1`**

- 在 `TEMP` 下创建隔离的 root、data、log、api、worker 环境。
- 执行 `bun run db:migrate`。
- 直接使用 `Start-Process` 启动：
  - `node apps/api/dist/main.js`
- 轮询 API health。
- 验证 fixture source、run、feed、search、story、SSE 和日志断言。
- 最终使用 `Stop-Process -Force` 停止进程。
- 仅作为验收脚本，不定义产品运行时能力；当前 smoke 已在 Windows 通过。

## 输入

**开发环境输入**

- 当前模块的 `import.meta` URL，用于解析工作区根目录。
- `configuredDataRoot`，用于计算 `COSMOS_DATA_ROOT`。
- 已存在的 `COSMOS_WORKFLOW_HOST_ENABLED` 值；没有该值时默认使用 `true`。
- 既有环境变量不会被整体复制到 `createWorkspaceDevEnvironment` 的返回对象。

**端口输入**

- `preferred`：首选端口；当前开发编排的默认配置值为 `4310`，由调用方显式传入 `findAvailablePort(4310)`，函数参数本身无默认值。
- `host`：监听主机，默认 `127.0.0.1`。
- 候选端口范围必须为整数 `1..65535`。
- 最大尝试次数为 `50`。

**服务输入**

- 服务名，只能是 `api` 或 `worker`。
- 服务所在目录。
- 工作区环境变量。
- API 服务所需的端口环境变量。

**开发编排输入**

- 工作区根目录 `root`。
- `web`、`api`、`worker` 对应目录。
- 工作区开发环境变量。
- 由端口逻辑生成的 API 环境变量。

**Prisma 输入**

- Prisma 命令及其参数。
- `COSMOS_DATA_ROOT`，仅在去除首尾空白后非空时用于选择数据根目录。
- `DATABASE_URL`，在环境中存在时优先使用。
- 工作区根目录 `root`。

**验收脚本输入**

- PowerShell 可用的临时目录。
- 已构建的 API 与 worker dist 文件。
- `bun`、Node、数据库迁移命令及对应 fixture。
- smoke 脚本定义的 health、业务接口、SSE 和日志断言条件。

## 输出

**`createWorkspaceDevEnvironment` 输出**

只包含以下三个键：

```text
COSMOS_WORKFLOW_HOST_ENABLED
COSMOS_WORKSPACE_ROOT
COSMOS_DATA_ROOT
```

不会返回完整的 `process.env` 副本。

**端口输出**

可用端口及对应环境变量：

```text
COSMOS_API_PORT=<port>
COSMOS_API_URL=http://localhost:<port>
NEXT_PUBLIC_COSMOS_API_URL=http://localhost:<port>
```

**开发进程输出**

- `web`、`api`、`worker` 的标准输入、标准输出和标准错误继承父进程。
- 子进程退出状态用于触发开发编排的停止逻辑。
- `dev-service.ts` 启动对应 package 的 `dev` 命令。

**Prisma 输出**

- Prisma 子进程的标准输入、标准输出和标准错误直接继承。
- Prisma 进程退出状态作为 `scripts/prisma.ts` 的退出状态。
- 无命令时输出或抛出 `Usage` 错误。

**smoke 输出**

- health、fixture source、run、feed、search、story、SSE 和日志断言结果。
- 验收结束时停止 smoke 进程。
- `Stop-Process -Force` 只表示测试进程被强制停止，不表示产品服务完成优雅 shutdown。

## 状态与持久化

**开发环境状态**

- 工作区根目录由脚本运行时解析。
- `COSMOS_WORKSPACE_ROOT` 和 `COSMOS_DATA_ROOT` 通过进程环境传递给开发子进程。
- `createWorkspaceDevEnvironment` 本身不持久化环境变量。

**端口状态**

- 可用端口是一次启动过程中的运行时状态。
- 端口通过 `listen` 验证后 `close`。
- `findAvailablePort` 不声明端口租约，也不持久化端口选择结果。
- API 端口通过环境变量传递给服务。

**进程状态**

- `dev.ts` 和 `dev-service.ts` 持有已启动子进程的运行时引用。
- 停止操作清理这些引用并终止对应进程。
- Windows 的进程树停止是强制操作。

**数据库状态**

- Prisma 脚本在数据根目录中准备 SQLite 数据库文件及其父目录；仅在文件不存在时创建空文件，已有 Data Root 中的数据库内容不会被脚本清空。
- `DATABASE_URL` 优先使用现有环境值，否则构造指向该数据库文件的 `file:` URL。
- 数据库迁移、生成、校验和状态检查由 Prisma 命令实际决定。

**smoke 状态**

- root、data、log、api、worker 位于 `TEMP` 隔离目录。
- smoke 运行期间产生的数据库、日志和进程属于验收环境。
- smoke 脚本不定义持久化产品数据边界。

## 状态转换

**工作区环境**

```text
未解析
  -> 解析 root
  -> 计算 COSMOS_DATA_ROOT
  -> 生成三项开发环境对象
```

**端口**

```text
首选端口
  -> 校验 preferred/host 参数
  -> 尝试 listen
  -> 成功后 close
  -> 返回可用端口
  -> 注入三个 API 环境变量
```

端口尝试失败时进入下一个候选端口，最多尝试 `50` 次。

**单个服务**

```text
未启动
  -> 校验 service 为 api 或 worker
  -> api 查找端口并注入环境，或 worker 保持不查端口
  -> spawn 对应 package dev
  -> 运行
  -> 正常退出或收到停止请求
  -> 清理/终止子进程
```

**开发编排**

```text
未启动
  -> 准备环境
  -> 启动 web
  -> 启动 api
  -> 启动 worker
  -> 任一子进程非零退出，或收到 SIGINT/SIGTERM
  -> stopAll
  -> 清理 children
  -> 退出
```

**Prisma 命令**

```text
未接收命令
  -> 校验命令参数
  -> 解析 root/dataRoot
  -> 创建数据库父目录；若数据库文件不存在则创建空 SQLite 文件，否则保留既有文件
  -> 组装固定 Prisma CLI、schema、DATABASE_URL 和命令参数
  -> spawnSync
  -> 透传 status
```

无命令时：

```text
未接收命令
  -> 抛出 Usage
```

## 副作用

- 解析并向子进程注入工作区环境变量。
- 在候选主机和端口上执行 TCP `listen`，随后关闭探测监听。
- 启动 `web`、`api` 和 `worker` 开发子进程。
- Windows 上执行 `taskkill /pid /t /f`，强制终止目标进程树。
- 非 Windows 上向子进程发送 `SIGTERM`。
- 创建 Prisma 数据库父目录。
- 仅在数据库文件不存在时创建空 SQLite 文件；已有 Data Root 内容保持不变。
- 同步启动 Prisma CLI，并透传其输出和退出状态。
- smoke 验收脚本在 `TEMP` 下创建隔离目录、迁移数据库、启动 Node 进程、轮询接口、读取日志并强制停止进程。

## 错误与降级

**环境解析**

- 未定义的环境覆盖边界、额外变量复制规则和额外解析规则不属于当前实现的已验证行为。
- `createWorkspaceDevEnvironment` 的返回值固定限制为三项环境变量。

**端口**

- `preferred` 必须是整数且位于 `1..65535`。
- 每次候选端口尝试均需完成 `listen/close`。
- 端口不可用时尝试下一个候选端口。
- 最多尝试 `50` 次；超过尝试上限时不能继续无限搜索。
- 本规格不额外定义端口耗尽时的错误类型或错误文本。

**服务**

- 服务名不是 `api` 或 `worker` 时校验失败。
- `api` 端口重新查找失败时不能按未验证端口启动。
- `worker` 不执行端口查找。
- 子进程非零退出时，开发编排进入 `stopAll`。

**开发编排**

- `SIGINT` 和 `SIGTERM` 触发 `stopAll`。
- Windows 停止采用 `taskkill /pid /t /f`，即强制终止进程树。
- 非 Windows 停止采用 `SIGTERM`。
- 子进程退出后主进程退出清理已记录的 children。
- 本实现不将 Windows 的强制停止解释为优雅 shutdown。

**Prisma**

- 无命令参数时抛出 `Usage`。
- `COSMOS_DATA_ROOT` 经过 `trim` 后为空时回退到 `.cosmos`。
- `DATABASE_URL` 存在时优先使用；其余覆盖规则不作推断。
- 数据库文件仅在不存在时创建；已有文件不因 wrapper 启动而被清空或截断。
- Prisma `spawnSync` 的非零 `status` 直接透传，不在脚本层重写为成功。
**smoke**

- smoke 断言失败表示验收失败。
- `Stop-Process -Force` 是验收清理动作，不是服务优雅关闭证据。
- smoke 不能用于推断 Docker、browser、真实来源或跨进程 recovery 能力。
- Docker/真实来源分别由 `bun run test:docker` 与 `bun run test:real:*` 显式执行，不属于默认开发或 CI 门禁。

## 依赖

- Bun，用于执行 package scripts 和 Prisma 转发命令。
- Node.js，用于 `process.execPath`、子进程启动和开发服务运行。
- Windows 环境下的 `taskkill`。
- 非 Windows 环境的 `SIGTERM` 进程信号语义。
- Node TCP server 的 `listen` 和 `close` 能力。
- `packages/storage-prisma/node_modules/prisma/build/index.js`。
- `packages/storage-prisma/prisma/schema.prisma`。
- `apps/web`、API package 和 worker package 的 `dev` scripts。
- PowerShell、`Start-Process` 和 `Stop-Process -Force`，仅供 `scripts/smoke-node.ps1` 验收使用。
- API health、fixture source、run、feed、search、story、SSE 和日志断言所依赖的已构建 Node 运行时。

## 配置

**开发根目录配置**

- root：由 `import.meta` URL 的上级目录解析。
- `COSMOS_WORKSPACE_ROOT`：始终写为解析出的 root。
- `configuredDataRoot`：参与 `resolve(root, configuredDataRoot || ".cosmos")`。
- 默认数据目录：`.cosmos`。
- `COSMOS_WORKFLOW_HOST_ENABLED`：默认 `true`；现有值保留。
- `createWorkspaceDevEnvironment` 返回对象只包含三项环境变量，不复制全部 `process.env`。

**端口配置**

- 当前开发编排的首选端口配置值：`4310`，通过显式调用 `findAvailablePort(4310)` 传入；`preferredPort` 参数没有函数默认值。
- 默认监听主机：`127.0.0.1`。
- 合法端口范围：整数 `1..65535`。
- 最大候选尝试次数：`50`。
- API URL 模板：`http://localhost:<port>`。
- API URL 变量：
  - `COSMOS_API_URL`
  - `NEXT_PUBLIC_COSMOS_API_URL`

**服务配置**

- 合法服务名：`api`、`worker`。
- `api`：启动前重新分配可用端口，并写入三个 API 端口变量。
- `worker`：不查找端口。
- `dev.ts` 的启动顺序：`web`、`api`、`worker`。
- 子进程工作目录：`root`。
- 子进程标准流：`inherit`。

**Prisma 配置**

- `COSMOS_DATA_ROOT`：`trim` 后非空时使用。
- `COSMOS_DATA_ROOT` 缺失或 `trim` 后为空：使用 `.cosmos`。
- `DATABASE_URL`：有值时优先使用。
- `DATABASE_URL` 缺失时：使用 `file:<databasePath with slash>`。
- 固定 Prisma CLI：

```text
packages/storage-prisma/node_modules/prisma/build/index.js
```

- 固定 schema：

```text
packages/storage-prisma/prisma/schema.prisma
```

- Prisma 工作目录：`root`。
- 无命令参数：`Usage`。

**package scripts**

```json
{
  "dev": "bun run scripts/dev.ts",
  "dev:web": "bun run --cwd apps/web dev",
  "dev:api": "bun run scripts/dev-service.ts api",
  "dev:worker": "bun run scripts/dev-service.ts worker",
  "db:validate": "bun run scripts/prisma.ts validate",
  "db:generate": "bun run scripts/prisma.ts generate",
  "db:migrate": "bun run scripts/prisma.ts migrate deploy",
  "db:migrate:dev": "bun run scripts/prisma.ts migrate dev",
  "db:status": "bun run scripts/prisma.ts migrate status"
}
```

`db:validate`、`db:generate`、`db:migrate` 和 `db:status` 均通过 `scripts/prisma.ts` 转发。

## 重建验收

- 给定：在工作区根目录运行开发环境构造逻辑，且未提供 `configuredDataRoot`；观察：`COSMOS_WORKSPACE_ROOT` 等于由 `import.meta` URL 上级解析出的 root，`COSMOS_DATA_ROOT` 等于 `resolve(root, ".cosmos")`，`COSMOS_WORKFLOW_HOST_ENABLED` 等于 `true`；且不发生：返回对象包含第四个环境变量或复制全部 `process.env`。
- 给定：调用方显式执行 `findAvailablePort(4310)`；观察：首选端口为 `4310`、监听主机为 `127.0.0.1`，候选端口逐个执行 `listen` 后 `close`；且不发生：依赖函数无参默认、尝试非整数、低于 `1`、高于 `65535` 的端口或无限尝试。
- 给定：首选端口 `4310` 被占用；观察：函数尝试后续候选端口并返回一个成功绑定后已关闭探测监听的端口；且不发生：复用已确认不可用的 `4310`。
- 给定：端口为 `4321`；观察：`COSMOS_API_PORT=4321`、`COSMOS_API_URL=http://localhost:4321`、`NEXT_PUBLIC_COSMOS_API_URL=http://localhost:4321`；且不发生：两个 URL 使用不同端口或使用 `127.0.0.1` URL。
- 给定：调用 `dev-service.ts api`；观察：服务名校验通过、重新查找可用端口、注入三个 API 端口变量并启动对应 package 的 `dev`；且不发生：沿用未重新验证的端口或跳过 API URL 注入。
- 给定：调用 `dev-service.ts worker`；观察：服务名校验通过并启动 worker package 的 `dev`；且不发生：worker 启动前执行端口查找或分配新的 API 端口。
- 给定：调用 `dev-service.ts` 时服务名不是 `api` 或 `worker`；观察：服务名校验失败；且不发生：启动未知服务。
- 给定：运行 `dev.ts`；观察：子进程按 `web`、`api`、`worker` 顺序启动，使用 `process.execPath run --cwd <dir> dev`，继承 `stdio`、`env`，工作目录为 root；且不发生：先启动 worker、使用不同的工作目录或吞掉子进程标准流。
- 给定：`web`、`api` 或 `worker` 任一子进程非零退出；观察：`dev.ts` 调用 `stopAll` 并清理已记录的 children；且不发生：其余开发进程继续作为孤儿进程运行。
- 给定：Windows 上开发主进程收到 `SIGINT` 或 `SIGTERM`；观察：对已启动子进程执行 `taskkill /pid <pid> /t /f`；且不发生：把 Windows 停止实现为 `SIGTERM` 或只终止父进程而遗留子进程树。
- 给定：非 Windows 上开发主进程收到 `SIGINT` 或 `SIGTERM`；观察：向已启动子进程发送 `SIGTERM` 并清理 children；且不发生：执行 Windows 专用 `taskkill`。
- 给定：运行 `scripts/prisma.ts` 且 `COSMOS_DATA_ROOT` 未设置或 `trim` 后为空；观察：使用 `.cosmos` 作为 dataRoot，创建数据库父目录，并仅在数据库文件不存在时创建空 SQLite 文件；且不发生：使用空字符串作为数据目录或清空已有数据库。
- 给定：目标 Data Root 中已有数据库文件；观察：运行 Prisma wrapper 前后既有文件内容保持不变，随后由 Prisma 命令自行决定是否迁移或修改模式；且不发生：wrapper 以“准备空文件”为由截断或覆盖数据库。
- 给定：运行 `scripts/prisma.ts` 且 `COSMOS_DATA_ROOT` 去除首尾空白后非空；观察：使用该值作为 dataRoot；且不发生：在本规格之外猜测其他环境变量对 dataRoot 的覆盖。
- 给定：运行 `db:validate`、`db:generate`、`db:migrate` 或 `db:status`；观察：调用固定 Prisma CLI，追加 `--schema packages/storage-prisma/prisma/schema.prisma`，cwd 为 root，并透传对应命令；且不发生：调用其他 Prisma CLI 路径或省略 schema 参数。
- 给定：`DATABASE_URL` 存在；观察：Prisma 使用该环境值；且不发生：脚本用自动生成的 `file:` URL 覆盖它。
- 给定：`DATABASE_URL` 不存在；观察：Prisma 使用 `file:<databasePath with slash>`；且不发生：生成反斜杠路径格式或空数据库 URL。
- 给定：运行 `scripts/prisma.ts` 时没有命令参数；观察：抛出 `Usage`；且不发生：执行无命令的 Prisma CLI。
- 给定：Prisma 子进程返回非零 status；观察：`scripts/prisma.ts` 以相同 status 退出；且不发生：把非零 status 转换为成功。
- 给定：执行 `scripts/smoke-node.ps1`；观察：在 `TEMP` 隔离 root、data、log、api、worker 环境中完成迁移，直接启动 API 与 worker dist，轮询 health 并执行 source、run、feed、search、story、SSE、日志断言，最后强制停止进程；且不发生：将 smoke 脚本当作产品组件或开发进程管理器。
- 给定：执行 `scripts/smoke-node.ps1` 的最后清理；观察：使用 `Stop-Process -Force`；且不发生：以该动作证明产品服务实现了优雅 shutdown。
- 给定：依据当前实现重建系统；观察：可以验证本规格列出的开发环境、端口、服务、编排、Prisma 和 smoke 行为；且不发生：把 smoke 结果解释为 Docker、browser、e2e、真实来源或跨进程 recovery 证据。

## 实现与测试锚点

**脚本实现**

- [`scripts/dev-env.ts`](../../../scripts/dev-env.ts)
  - `import.meta` URL 上级目录解析 root。
  - `createWorkspaceDevEnvironment` 仅返回 `COSMOS_WORKFLOW_HOST_ENABLED`、`COSMOS_WORKSPACE_ROOT`、`COSMOS_DATA_ROOT`。
  - `COSMOS_WORKFLOW_HOST_ENABLED` 默认 `true`。
  - `COSMOS_DATA_ROOT` 使用 `resolve(root, configuredDataRoot || ".cosmos")`。

- [`scripts/dev-port.ts`](../../../scripts/dev-port.ts)
  - 默认配置的调用方显式传入 `findAvailablePort(4310)`；函数要求调用方提供 `preferredPort`。
  - 默认 host `127.0.0.1`。
  - 最多尝试 `50` 次。
  - 校验整数范围 `1..65535`。
  - 每个候选端口执行 `listen/close`。
  - `withApiPortEnvironment` 写入 `COSMOS_API_PORT`、`COSMOS_API_URL` 和 `NEXT_PUBLIC_COSMOS_API_URL`。

- [`scripts/dev-service.ts`](../../../scripts/dev-service.ts)
  - 校验服务名 `api|worker`。
  - API 服务重新查找端口并注入三项 URL/端口变量。
  - worker 不查找端口。
  - 启动对应 package 的 `dev`。
  - Windows 使用 `taskkill /pid /t /f`，非 Windows 使用 `SIGTERM`。

- [`scripts/dev.ts`](../../../scripts/dev.ts)
  - 准备 root 和开发环境。
  - 按 `web -> api -> worker` 启动。
  - 使用 `process.execPath run --cwd <dir> dev`。
  - 继承 stdio、env，cwd 为 root。
  - 非零退出、`SIGINT`、`SIGTERM` 和 exit 路径均进入停止/清理逻辑。
  - Windows 使用强制进程树终止，非 Windows 使用 `SIGTERM`。

- [`scripts/prisma.ts`](../../../scripts/prisma.ts)
  - 解析 root 和 dataRoot。
  - `COSMOS_DATA_ROOT.trim()` 为空时回退 `.cosmos`。
  - 仅当数据库文件不存在时创建空 SQLite 文件；已有文件原样保留，不清空或截断。
  - 固定 Prisma CLI 路径和 schema 参数。
  - `DATABASE_URL` 优先环境值，否则使用 `file:` 数据库路径。
  - `spawnSync` status 透传。
  - 无命令抛出 `Usage`。

**package scripts 锚点**

- 根 `package.json` 的 `dev`：`bun run scripts/dev.ts`
- 根 `package.json` 的 `dev:web`：启动 `apps/web` 的 `dev`
- 根 `package.json` 的 `dev:api`：调用 `scripts/dev-service.ts api`
- 根 `package.json` 的 `dev:worker`：调用 `scripts/dev-service.ts worker`
- 根 `package.json` 的 `db:validate`、`db:generate`、`db:migrate`、`db:status`：通过 `scripts/prisma.ts` 转发对应命令

**测试与验收锚点**

- [`scripts/dev-port.test.ts`](../../../scripts/dev-port.test.ts)
  - 端口默认值、主机默认值、范围校验、候选端口探测和最大尝试次数的测试锚点。
- [`scripts/smoke-node.ps1`](../../../scripts/smoke-node.ps1)
  - TEMP 隔离运行、数据库迁移、API/worker dist 启动、health、fixture source/run/feed/search/story、SSE、日志断言和强制清理的验收锚点。
  - 不是产品组件。
  - 不得作为 Docker、browser/e2e、真实来源或跨进程 recovery 的证据。

## 非目标/边界

- 不包含容器部署。
- 不包含 Docker 运行时或 Docker 验收。
- 不包含 browser 或 e2e 产品测试。
- 不包含真实外部来源接入或真实来源正确性证明。
- 不包含跨进程 recovery。
- 不支持双 worker 运行拓扑。
- 不包含生产发布、生产进程管理或生产 shutdown 语义。
- `scripts/smoke-node.ps1` 仅是验收脚本，不是产品组件。
- smoke 脚本中的 `Stop-Process -Force` 不是优雅 shutdown 证明。
- Windows 开发停止固定为强制进程树终止，使用 `taskkill /pid /t /f`。
- `SIGTERM` 仅用于非 Windows 分支。
- 不根据未给出的环境变量、路径解析、覆盖优先级或错误文本推断额外行为。
- 不将 `smoke-node.ps1` 的通过结果解释为 Docker、browser/e2e、真实来源或跨进程 recovery 能力。
