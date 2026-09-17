# G08：CI 门禁分区 + 状态文档减负

## User Request / Topic

维护者 2026-09-17 采纳建议，指示「先做 1+2」：

1. 把 CI 的**文档门禁**与**代码门禁**拆成两个 job，使任一门的红不再让另一门与其后的检查全部被跳过；
2. 把 `PROJECT-STATUS.md` 里 2026-09-15/16 的收尾记录切进分册，让主文档回到健康区。

触发事实（两次同因事故）：`.github/workflows/ci.yml` 把 `bun run docs:check` 与 size 门禁排在 `bun run db:validate` **之前**，文档门禁一红，其后的 typecheck / 单测 / property / lint / build 与三个 E2E job（`needs: quality`）全部被跳过。

- 2026-09-15 ~ 09-16：体积门禁遮住全部检查（记录见 Task 14 walkthrough 与 `PROJECT-STATUS.md`）；
- 2026-09-17：`PROJECT-STATUS.md` 一度只剩 40 token 余量，差一点让同一遮蔽重演（Task 27 修复 CI 当天的实测记录）。

## Goal

- 文档门禁与代码门禁的结论**各自独立可见**：文档红不再跳过代码检查，反之亦然；
- `PROJECT-STATUS.md` 回到健康区并留出后续状态更新的余量（目标：主文档 ≤24 KB 且 ≤8k token，余量 ≥1.5k token）。

## Scope / Non-goals

Scope：

- 切片 1：`.github/workflows/ci.yml` —— 新增 `docs` job（`docs:check` + size 门禁），`quality` job 只保留代码门禁（`db:validate` → `build`）；三个 E2E job 维持 `needs: quality`。门禁命令逐字不变。
- 切片 2：`PROJECT-STATUS.md` —— 2026-09-15/16 的**完成记录**移入新分册 `PROJECT-STATUS/history-2026-09-4.md`，原位留指针；分册索引表补一行。

Non-goals：

- 不改任何门禁命令、阈值、基线或检查项数量；不新增/删除 CI 检查（拆 job 不改变「有哪些检查」）。
- **不启用或修改远端 branch protection / ruleset**：2026-09-17 核实 master 远端**无任何保护**（`gh api .../branches/master/protection` → 404，rulesets 为空），「是否设 required checks」仍待维护者拍板。
- 不动产品代码、测试、Prisma、锁文件与 `BUN_VERSION`。
- 不修已登记的两个不稳定用例（`docs/testing/known-unstable-cases.md`）。
- 不处理锁文件/工具链漂移（npmmirror 源、`configVersion`、Dockerfile 的 bun 版本）。
- 不修 code 侧既有 2 个未登记警戒区文件（见 Follow-ups）。

## 权威合同

- [`docs/standards/repository-workflow.md`](../../../../docs/standards/repository-workflow.md)：准入决策表（纯机械仓库迁移 → 需要 Task、不需要 Proposal/公开 Issue）与「远端门禁事实」节（远端是否强制必须用 API 核实后才能标为已验证）。
- [`docs/proposals/oversized-doc-splitting-v1.md`](../../../../docs/proposals/oversized-doc-splitting-v1.md)：阈值与「追加型文档只切历史、不切当前状态和有效决定」。
- [`README.md`](../README.md)（G 系列章程）：编号、分支/ worktree 命名、记录规则。
- `.github/workflows/ci.yml` 现有步骤顺序与依赖关系（改动前）。

## 实施切片

| # | 切片 | 可观察验收 | 状态 |
|---|---|---|---|
| 1 | `ci.yml` 门禁分区 | ① 分支上 `workflow_dispatch` 后 Doc 与 Quality 并行独立运行；② **负向验证**：临时制造文档门禁失败时，Quality 与三个 E2E 仍照常运行（此前会被跳过）；③ 两门命令与改前逐字一致 | ①③ 达成（run 35182347816 五 job 全绿、Docs 7s 与 Quality 同秒起跑）；② 待跑 |
| 2 | `PROJECT-STATUS.md` 切分册 | ① 主文档 ≤24 KB / ≤8k token；② 新分册 ≤30 KB；③ 标题、代码围栏、列表项数量拆分前后守恒；④ `docs:check` 与 size 门禁 PASS（worktree 内） | 本地 ①②③④ 全部达成（22,855 B / 7,289 token；分册 5,578 B；逐字一致；659 文件 0 失败）；远端 CI 复核待跑 |

## Current State

- 生命周期阶段：**切片 1 已完成、切片 2 本地完成**（2026-09-17）；待做：切片 1 的负向验证、合并前在分支上复跑一次 CI、合并 master。
- 连贯目标：让「文档门禁红」不再等于「代码检查全部跳过」，并把状态文档的余量恢复到可继续更新的水平。
- 依赖：无（与 Task 26/27 无文件交叠：本任务只改 `ci.yml`、`PROJECT-STATUS.md`、`PROJECT-STATUS/` 分册与本目录）。
- 受影响合同：CI 的 job 依赖关系（新增一个 job；现有 job 名与 `needs` 语义不变）；`PROJECT-STATUS.md` 的分册边界。
- 验证层级：分支 `workflow_dispatch`（含负向验证）→ 合并后 master 推送触发 CI 复核。

## Decisions and Deviations

- **实施在独立 worktree**（`.worktree/g08-ci-gate-split-status-doc`，分支 `chore/g08-ci-gate-split-status-doc`）：与 G01/G04 的「纯文档改在主工作区」先例不同，原因是切片 1 需要**在分支上制造一次文档门禁失败**做负向验证，不能污染 master 或主工作区。
- **`docs` job 不跑 `bun install`**：`docs:check` 与 size 门禁只依赖 bun 与 python3；已在**无 `node_modules` 的 worktree** 里实跑通过（`docs:check` 656 文件 0 失败、size 门禁 PASS）。这样文档门禁连依赖安装都不依赖，进一步与代码门禁解耦。
- **三个 E2E job 保持 `needs: quality`**：与改前一致（它们此前也是被 `quality` 阻塞）。本切片只解除「文档门禁对代码检查的阻塞」，不改变 E2E 的门槛。
- 不改 job 名 `Quality`：即便将来启用 ruleset 指向该 check 名，语义仍是「代码质量门禁」；文档结论由新增 `Docs` 承担。

## Verification / Gate

过程、命令、实际结果与未运行项的唯一记录见 [`walkthrough.md`](walkthrough.md)。

## Follow-ups

- **master 远端无保护**（2026-09-17 核实）：CI 目前只是事后信号。是否启用 ruleset / required checks（至少 `Docs` 与 `Quality`）待维护者拍板；若不启用，建议在 `PROJECT-STATUS.md` 的「当前运维边界」写明这一事实。
- code 侧门禁有两个**既有**未登记警戒区文件（`python scripts/size-governance.py -c code tests --check …` → FAIL）：`e2e/browser/phase2-organization.spec.ts`（32.64 KB / 约 9.0k token）、`apps/web/src/component-lab/product-fixtures.tsx`（31.17 KB / 约 8.2k token）。该门禁不在 CI 中，本任务未处理；若将来把 `-c code tests` 纳入 CI，需先按治理规则处置这两个文件。
- 治理章程记录的机制缺口仍在：`size-governance.py --check` 不拦行数阈值。
