# Task 27：Prisma CLI 调用改为按候选位置解析（远端 CI 恢复）

## User Request / Topic

维护者 2026-09-16 诊断出 master 的远端 CI 卡在 `bun run db:validate`：CI 报
`error: Module not found "packages/storage-prisma/node_modules/prisma/build/index.js"`，
其后 typecheck / 全量单测 / property / lint / build / Node E2E / 浏览器 E2E 全部被跳过；
把 `ci.yml` 的 `BUN_VERSION` 对齐到 1.4.2（提交 `4a0a5a3`）无效。维护者指示本轮修复，
并分配本 Task 编号 27、批准 worktree `.worktree/t27-prisma-cli-resolution` 与分支
`fix/t27-prisma-cli-resolution`。改动性质：不改变用户行为、产品数据与公开接口的纯机械仓库迁移，
按[准入决策表](../../../docs/standards/repository-workflow.md#准入决策表)不需要 Proposal、不需要公开 Issue。

## Goal

让 `bun run db:validate`、`db:generate` 与 storage 测试不再假定 Prisma CLI 的单一位置：

```text
一个解析器   -> packages/storage-prisma/src/prisma-cli.ts 的 resolvePrismaCliPath()
候选位置     -> Node 模块解析（包内 node_modules / 提升到工作区根 / 软链指向 bun store）
               -> 逐级向上 node_modules/prisma/build/index.js
               -> 逐级向上 node_modules/.bun/prisma@*/node_modules/prisma/build/index.js
找不到时     -> 抛错并列出已尝试的位置，提示在仓库根运行 bun install
```

行为等价：仍然是「用 Node 执行 Prisma CLI + `--schema` + 透传退出码」，只把固定路径换成解析结果。

## Scope / Non-goals

Scope：

- 新增 `packages/storage-prisma/src/prisma-cli.ts` 与 `prisma-cli.test.ts`。
- 替换 27 处固定路径引用：`scripts/prisma.ts`、`docker/Dockerfile`、`docker/compose.yml`、
  `docs/spec/operations/0002-development-runtime.md`（3 处文档描述）、20 个 storage 测试与夹具、
  `apps/worker/src/workflow-ingest.test.ts`。
- Docker 运行时入口收敛到新增的 `docker/start-api.sh`（`Dockerfile` 的 `CMD` 与
  `compose.yml` 的 api `command` 都指向它）。
- 文档：`docs/spec/operations/0002` 记为当前行为；`docs/spec/operations/0001` 的 Docker 锚点补该脚本；
  `.github/workflows/ci.yml` 只改注释（`BUN_VERSION` 值不动）。
- Task 记录与 `PROJECT-STATUS.md` 状态更新。

Non-goals：

- 不改 `bun.lock`、不换 registry、不补 `configVersion`、不动 `BUN_VERSION`：已被诊断的驱动因素
  （G02 `cc97d4c`、G03 `cb2b082`、Task 14 `a270079` 把 lock 换成 npmmirror 源并丢了 `configVersion`）
  本轮只通过「调用方不再依赖布局」绕开，锁文件本身的取舍留给维护者决定。
- 不给 CI 增加或减少门禁步骤；不改 Prisma schema / migration；不改任何业务行为。
- 不合并 20 处测试各自复制的 `prepareDatabase`/`deployMigrations`（见 Follow-ups）。

## 权威合同

- [`docs/spec/operations/0002-development-runtime.md`](../../../docs/spec/operations/0002-development-runtime.md)：
  `scripts/prisma.ts` 与 Prisma 配置的当前行为。
- [`docs/spec/operations/0001-deployment.md`](../../../docs/spec/operations/0001-deployment.md)：Dockerfile 默认主进程。
- [`.github/workflows/ci.yml`](../../../.github/workflows/ci.yml)：质量门禁顺序（`db:validate` → `db:generate` → typecheck → test → property → lint → build）。
- [`PROJECT-STATUS.md`](../../../PROJECT-STATUS.md) 2026-09-16 的两条 CI bullet（诊断与暂不修改的指示）。

## Current State

- 生命周期阶段：**实现与本地验证完成**，未 commit / 未 push，远端 CI 结论待推送后核验。
- 连贯目标：CI 的质量门禁能越过 `db:validate`，一路跑到 typecheck / 单测 / build。
- 可观察验收（≤3 条）：
  1. 在「包内没有 `prisma`、CLI 被提升到工作区根」的布局下，`bun run db:validate` 与 `bun run db:generate` 通过；
  2. 仓库内不再有调用方引用 `packages/storage-prisma/node_modules/prisma/build/index.js` 这一固定位置；
  3. 远端 CI 的 `db:validate` 通过且其后步骤真正执行（待 push 后核验）。
- 依赖：无（Task 独立；`bun.lock` 现状与 CI 配置是背景，不是前置）。
- 受影响合同：`scripts/prisma.ts` 的调用方式、Docker/Compose 的 API 启动入口、测试夹具的 Prisma 调用方式。
- 验证层级：解析器单测（RED→GREEN）→ 真实布局复现（修前红 / 修后绿）→ 聚焦 storage 用例 → 全量门禁 → 远端 CI。

## Decisions and Deviations

- 解析器放在 `packages/storage-prisma/src/`：该包 `tsconfig.json` 是 `rootDir: src`，把解析器放 `scripts/`
  会让包内测试无法 typecheck；同时不加入 `index.ts` 公共导出，避免测试/运维辅助进入生产 API 面。
- 候选顺序按证据定：本机两套真实布局分别是「包内软链 + `.bun` store」（bun 1.3.14 生成的 node_modules）
  与「提升到工作区根、无 `.bun`」（bun 1.4.2 + 当前 lock 的全新安装），两者都由候选 1（Node 模块解析）覆盖。
  候选 3（bun store）是**纯防御性兜底**，未被任一实测布局需要；命中多个 store 条目时按版本号数值比较取最高，
  同版本按目录名定序（保证确定性）。
- Docker 运行时是纯 Node 镜像、跑不了 TS 源码，因此 `docker/start-api.sh` 动态 import 构建产物 `packages/storage-prisma/dist/prisma-cli.js` 里的**同一个解析器**取 CLI（初版脚本内自写 `node -p require.resolve`，等于两份实现，已按独立审查 O3 收敛）；顺带把最后的 API 启动改为 `exec`（原先 `sh -c "a && b"` 的末条命令不保证被 exec），`set -e` 与原来的 `&&` 链在「迁移失败就不启动 API」上等价。
- `ci.yml` 只改注释：原注释把「仓库按固定路径调用 Prisma CLI」当作 pin 的理由，修复后该理由已失效。

## Verification / Gate

过程、命令、实际结果与未运行项的唯一记录见 [`walkthrough.md`](walkthrough.md)。

## Follow-ups

- `bun.lock` 仍是 npmmirror 源且缺 `configVersion`，`package.json` 的 `packageManager: bun@1.3.14`
  与 CI 的 `BUN_VERSION: 1.4.2` 也不一致；是否恢复默认源、补 `configVersion` 或统一版本需维护者决定。
- 20 处 storage 测试各自复制 `prepareDatabase`/`deployMigrations`（含 schema 路径拼装）；可收敛为一个共享夹具，
  本切片只替换路径，未合并。
- Docker/Compose 仍无本机运行验收（本机无 Docker CLI）；`docker/start-api.sh` 只做了静态检查与 shell 语义复核。
- `PROJECT-STATUS.md` 未登记且已贴近 **9k token 警戒线**（改动前 8,951 / 9,000，本切片的 bullet 已压到 8,931）：任何后续追加都会直接触发 CI 的 size 门禁。需要维护者决定是切历史分册、登记进基线，还是压缩该文件的其它段落——本轮只保证不越线，未做治理动作。
