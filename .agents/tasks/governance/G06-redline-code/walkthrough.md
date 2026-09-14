# G06 过程记录（append-only）

本文件与归档分册共同承载 G06 的过程、偏差与验证记录；README 只维护当前摘要、范围、门禁与下一步。追加规则与文档大小治理见根 `AGENTS.md`。

（2026-09-14 起草完毕；切片 0–5b-1 的过程记录已按文档大小治理归档到 [`walkthrough/slices-2026-09-14.md`](walkthrough/slices-2026-09-14.md)，本文件保留立项、口径更正、5b-2 之后的记录与收尾。）

## 2026-09-14 立项

### 指令与摸底

- 维护者指令：开启 G06，治理门禁扫描超红线的 3 个代码文件（contracts 入口、page、story-panel）。
- 门禁实测（2026-09-14，`python scripts/size-governance.py -c code tests --check`）：三个对象为当前全部超红线代码文件，门禁 PASS（均为基线内存量）；code-baseline 18 条中 7 条已回健康区（切片 6 顺带移除登记）。
- contracts 摸底：`index.ts` 1455 行 / 53.5 KB，1 处 `export * from "./base.js"` + 共 298 处行首 export 语句，含公开 DTO；包内已有 base/action/connection/run-control/trigger 模块与其测试。消费面：`rg -l 'from "@cosmos/contracts"'`（排除测试）命中 56 个源文件，比 application（44）更宽，导出面零 diff 是唯一可行守护。单元覆盖率 100%（G05 评分表 V=10，同日实测）。源码层 export 语句计数只是近似，解析后导出面以切片 0 的快照为准。
- page.tsx 摸底：1680 行 / 62.2 KB，唯一默认导出 `Home`（第 125 行起），尾部 helper（`readError`/`toBoundaryIso`/`toDateInputValue` 等）；页面承担来源表单、Feed、搜索、看板编辑、移动端适配。
- story-panel.tsx 摸底：1902 行 / 92.4 KB，唯一具名导出 `StoryPanel`（第 360 行起），内含 `TimelineSection`/`SplitTargetSelect`/`EntityRow`/`RevisionAssets`/`StorySubtypeSelect` 等子组件与多组标签映射；消费方为 `page.tsx` 与 `component-lab/product-fixtures.tsx`。

### 浏览器护栏现状（UI 对象验收依据）

现有 5 个 spec（约 18 用例）实际触达两个 UI 文件：`ingest.spec`（打开 Story 抽屉、保存 Revision、归并、搜索回显、移动端溢出、看板编辑）、`offline.spec`（Story 内已存图片渲染、断网）、`phase2-organization.spec`（时间线、证据关系挂接与解除）、`media-policy.spec`、`theme.spec`。**无专门断言的子块**：RevisionAssets 资产列表、StorySubtypeSelect 子类型下拉、SplitTargetSelect 拆分选择。该缺口不前置补用例，记 README Follow-ups。

### 提请裁决与默认执行

立项时向维护者提请 3 项裁决（任务范围组织 / UI 验收口径 / worktree 审批），未获批复。按原始指令与推荐默认：范围 = 一个 G06 治 3 个文件（偏离提案 SOP「单 Task 只治一个文件」，记入 README Decisions）；UI 验收 = 现有浏览器用例即护栏。**worktree/分支创建未获批，代码不动**；批复后从切片 0 开始（worktree 环境前置沿用 G05 教训：`bun install` 后必须 `bun run db:generate`，本机 e2e 需把真实 `bun.exe` 目录加进 PATH）。

### 未运行

全部验证命令（尚无代码改动；基线与验证在切片 0 的 worktree 内执行）。

## 2026-09-14 提交状态说明

切片 0–2 的代码改动目前**全部未提交**（在 worktree 工作区）。根 `AGENTS.md` 规定「除非用户明确要求，不自行 commit」，维护者批复的是「批准开工」，未含 commit 授权；而提案 SOP 与本 Task 计划要求「每切片独立 commit（可单独 revert）」。切片 3 会再次改动 `index.ts`（与切片 1 同文件），**一旦开始切片 3，切片 1 与切片 3 就无法再拆成两个 commit**。已在本次汇报中提请维护者授权；授权前不开始切片 3。

**保险措施**：切片 0–2 的完整改动（含新增文件）已导出为补丁快照 `%TEMP%/g06-slice0-2.patch`（96,613 B，由 `git add -A -- packages/contracts && git diff --cached --binary` 生成，随后 `git reset` 复原索引）。若切片 3 覆盖 `index.ts` 后仍需把切片 1 与切片 3 分成两个 commit，可用该补丁先重建切片 0–2 的提交。

## 2026-09-14 切片 5b-2：剩余 5 个区块搬出，story-panel 离开红线

- 结果：story-panel.tsx **1453 → 757 行**（**低于 800 行红线**）。新增 5 个子组件：`story-actions.tsx`（Story 操作，94 行原区块）、`split.tsx`（拆分 Story，134）、`organization.tsx`（用户组织，309）、`link-entity.tsx`（关联/创建 Entity，92）、`topic-join.tsx`（加入/创建 Topic，76）。
- 与 5b-1 的差异：这 5 个区块多数由**多个 `{cond && (...)}` 组成**（link-entity 3 段、topic-join 2 段），因此改为**子组件自持条件判断**（组件内返回 `<>…</>`），调用点只剩一行 `<XSection … />`；5b-1 的单区块仍把条件留在调用点。
- props：15 / 18 / 42 / 13 / 13 个，全部显式传值 + setter + 处理器，状态与提交处理器仍在主组件。
- **踩坑（3 个，全部由 typecheck 拦下）**：
  1. 区间起始行差一：link-entity 的条件行 `{story.entities.length > 0 && (` 在 1280 而非 1281，漏搬后父组件残留半截条件、括号不平衡（TS2657）。教训：**多段条件区块的起始行要含条件行本身**。
  2. 可选 props 正则漏配：`(\w+):` 匹配不到 `name?:`，生成的解构缺了可选参数。
  3. 修 (2) 时用「从 `: Props` 往后找 `}`」定位闭合括号，实际应往前找（`}: Props` 的 `}` 在 `: Props` 之前），把签名与函数体开头整段删掉——因该文件是派生产物，直接回滚重跑比就地修补更省事。
- 验证：`apps/web` tsc 0；`bun run lint:web` 0 error（86 warning）；浏览器 **17/17 全绿**。
- **切片 5 完成**：story-panel 系（1902 行单体）现为 `story-panel.tsx` **757 行** + `story-panel/` 下 15 个文件（子组件 11 + 标签 1 + 其余支撑）。

## 2026-09-14 切片 6：收口

- **repo-map 重生成**：`python scripts/size-governance.py --map` → `docs/doc-governance/repo-map.json`（39 个包/应用目录）。
- **基线下调**：`--write-baseline` 重写后 **18 → 8 条**，10 条移除、**0 条新增**（含 3 个红线对象与 7 条已回健康区/已不存在的文件，如 `packages/contracts/src/index.test.ts` 已被按域拆为 6 个文件）。按「登记值只允许下调」把 `workflow-host-runtime.ts` 的登记值手动改回原值（43.77 KB），保留其增长 warning。
- **门禁结果**：`-c code tests --check` PASS；**红线以上文件 0 个**（G06 目标达成），警戒区 8 个（全部已登记）；`docs:check` 见下。
- **最终读数**：

| 对象 | 行数 | 字节 | token |
|---|---|---|---|
| `packages/contracts/src/index.ts` | 1455 → **168** | 53.5 → **11.2 KB** | 13,566 → **2,882**（−79%） |
| `apps/web/src/app/page.tsx` | 1680 → **738** | 62.2 → **28.1 KB** | 16,475 → **7,357**（−55%） |
| `apps/web/src/components/cosmos/story-panel.tsx` | 1902 → **757** | 92.4 → **32.6 KB** | 24,080 → **8,496**（−65%） |

- **PROJECT-STATUS.md 未改**：核查确认该文件从不记录治理任务（G01–G05 均无提及），治理状态只维护在 `.agents/tasks/governance/README.md` 索引，故本次沿用惯例、不做虚增。
- 未做的事（需维护者授权）：**推送**、**合并 master**、清理 worktree 与分支。

## 2026-09-14 收尾：合并、推送与清理（维护者授权「完成 G06 收尾工作」）

- **合并**：`git merge --no-ff refactor/g06-redline-code` → merge commit **`df76e96`**（基于 `ebb9ddb`，本地 master 当时领先 origin 8 个提交、远端无新提交，无需 ff 同步）。
- **master 上重验**（G05 惯例，合并后必须重跑）：typecheck 0；unit 81 文件 / 515 用例；property 4；e2e 4；浏览器 **17/17**；`lint:web` 0 error；两份体积门禁 PASS；`docs:check` **600 文件 0 失败**。
- **推送**：`ebb9ddb..df76e96` → `origin/master`（`Otirik-handi/cosmos`）；**CI 已触发**（run `34831687620`，Quality + 其它作业）。G05 踩过的 `gh` 仓库解析坑已避开（显式 `--repo Otirik-handi/cosmos`）。
- **清理**：`git worktree remove` 注销成功但目录有残留（Windows 长路径/junction）；按仓库规则先复核——**2,555 个 junction 全部指向该 worktree 内部**（outside=0），再用 `cmd /c rmdir /s /q` 删除（不跟随 junction）。清理前后主工作区 `node_modules` 文件数均为 **50,670**，确认无损伤。本地分支 `refactor/g06-redline-code` 已删除（`-d`，已合并）。
- **口径更正（重要）**：本任务早期汇报的「代码红线文件 3 → 0」只对**字节/token 门禁**成立。按提案 §4.1 的完整红线（源码/测试 **>800 行** 或 >50 KB 或 >15k token），仓库仍有 **10 个文件超红线**，全部是「行数越界、字节未越界」——脚本门禁不拦行数（该缺口治理索引早有记载）。清单见治理索引「待治理候选」。
