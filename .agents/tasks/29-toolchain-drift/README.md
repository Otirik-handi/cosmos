# Task 29：工具链与依赖源固定

## User Request / Topic

2026-09-17 维护者采纳建议「先处理锁文件 / 工具链漂移」，并裁定**显式保留国内镜像**；分配编号 29、批准 worktree 与分支 `chore/t29-toolchain-drift`。

要解决的三件事（起因是 Task 27 的 CI 故障复盘：同一份代码，不同 bun 版本装出不同的 `node_modules` 布局，脚本写死了其中一种）：

1. 仓库里没有任何地方声明「依赖从国内镜像下载」——它只藏在 `bun.lock` 的 1,026 条地址里；
2. 三处 bun 版本引用互不相同：`package.json` 的 `packageManager: bun@1.3.14`、CI 的 `BUN_VERSION: 1.4.2`、`docker/Dockerfile` 的 `oven/bun:1.3.14`；
3. 锁文件缺 `configVersion` 字段（`a270079`/Task 14 那次写入时丢掉）。

## Goal

- 「用哪个源、用哪个 bun」成为仓库的显式、单一决定，不再依赖每台机器的本机配置；
- 锁文件与当前工具链同格式，且**不改变任何依赖解析结果**。

## Scope / Non-goals

Scope：

- 新增 `bunfig.toml`，显式声明镜像源（含实测结论与改源需重生成锁文件的提示）。
- `package.json` 的 `packageManager` 与 `docker/Dockerfile` 的基础镜像统一到 **1.4.2**（CI 已是 1.4.2）；`ci.yml` 注释改为「三处同一个版本」。
- `bun install --lockfile-only` 补回 `configVersion`（实测 +1 行、+22 字节、零依赖变化）。
- 记录：Task 29 README/walkthrough、Task 索引、`PROJECT-STATUS.md` 运维边界。

Non-goals：

- **不重生成锁文件、不换回官方源**：那会重新解析全部依赖（`^6.0.0` 一类范围可能升版），需要单独切片 + 完整验证。本轮只让「已有解析结果」与格式对齐。
- 不改任何依赖版本、不改 CI 检查项、不再动 Prisma CLI 解析（Task 27 已做）。
- 不做 Docker 容器实跑：本机没有 Docker CLI（`oven/bun:1.4.2` 这个 tag 已用 Docker Hub API 核实存在）。

## 权威合同

- 维护者 2026-09-17 裁定（显式保留国内镜像）。
- 准入决策表：不改变用户行为、产品数据、公开接口的纯机械仓库迁移 → 需要 Task，不需要 Proposal/公开 Issue。
- Task 27 walkthrough：不同 bun 版本产生不同 `node_modules` 布局的实测证据。

## 实施切片

| # | 切片 | 可观察验收 | 状态 |
| --- | --- | --- | --- |
| 1 | 依赖源显式化 | `bunfig.toml` 存在且声明 npmmirror；连续两次 `bun install --lockfile-only` 锁文件哈希不变（声明与锁内容一致） | 达成 |
| 2 | bun 版本单一来源 | 三处引用都是 1.4.2；`bun install --frozen-lockfile` 通过 | 达成 |
| 3 | 锁文件格式对齐 | 锁文件 diff 恰好 +1 行（`"configVersion": 0,`），依赖解析零变化 | 达成 |

## Current State

- 生命周期阶段：**三个切片均已完成**（2026-09-17），待 commit / push / 合并（另行申请）。
- 连贯目标：让「用哪个源、用哪个 bun」不再依赖本机配置。
- 依赖：无（与 Task 26 无文件交叠）。
- 受影响合同：仓库级依赖源与 bun 版本声明；锁文件格式。**不改产品行为**。
- 验证层级：`bun install --frozen-lockfile` + 文档门禁 + 合并后 master CI；Docker 保持未验证。

## Decisions and Deviations

- 用 `bunfig.toml`（而不是 `.npmrc` 或只写文档）声明源：它是 bun 读取的配置文件，改了会立刻影响新解析的条目，而不是只写给人看。
- Dockerfile 的基础镜像一并升到 1.4.2：三处同一个版本才有意义；该 tag 经 Docker Hub API 核实存在，但**本机没有 Docker CLI，未做容器实跑**。
- 有意保留 `configVersion` 的补齐而不重生成锁：Task 14 之后锁文件一直能用（CI 也在用），补齐只是让格式与当前 bun 一致。

## Verification / Gate

见 [`walkthrough.md`](walkthrough.md)。

## Follow-ups

- 若要换回官方源：需要重生成锁文件，并单独做一次完整验证（安装 + typecheck + 全量单测 + property + E2E + 浏览器 + build），可能有传递依赖的小版本漂移。
- Docker 容器实跑仍未做过（本机无 Docker CLI）：`oven/bun:1.4.2` 已核实存在，但「构建 + `--frozen-lockfile` + 启动」没有运行证据。
- `docs/testing/README.md` 与 `PROJECT-STATUS.md` 都贴近 9k token 警戒线，后续追加前需要先决定切分册或调整登记值。
