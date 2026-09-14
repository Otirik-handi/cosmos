# G06 过程记录（append-only）

本文件是 G06 的过程、偏差与验证的唯一记录位置；README 只维护当前摘要、范围、门禁与下一步。追加规则与文档大小治理见根 `AGENTS.md`。

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

## 2026-09-14 切片 0：前置（worktree + 三对象基线 + contracts 导出面与契约测试）

### 载体

- 维护者 2026-09-14 批复「批准开工」。worktree `.worktree/g06-redline-code`，分支 `refactor/g06-redline-code`，基于本地 `master` `ebb9ddb`（`git fetch origin` 后与 `origin/master` 一致，无新提交，无需 ff 同步）。
- 环境前置：worktree 内 `bun install`（1,659 包，13.7s）+ `bun run db:generate`。G05 教训复用成功——缺 Prisma Client 时 typecheck 会报隐式 any。
- **与 G05 的差异**：立项文档（本目录 README/walkthrough）位于主工作区且**未提交**（维护者批复的是开工，未含 docs commit 授权）；G05 当时先 commit 立项文档再开 worktree。故本分支基线不含 `G06-redline-code/` 目录，收口时随 docs 提交一并处理。

### 基线（对象 = 文件 + 同名测试）

| 文件 | 行数 | 字节 |
|---|---|---|
| `packages/contracts/src/index.ts` | 1455 | 54,827 |
| `packages/contracts/src/index.test.ts` | 1011 | 36,369 |
| contracts 对象合计 | 2466 | 91,196（89.1 KB） |
| `apps/web/src/app/page.tsx` | 1680 | 63,657（62.2 KB） |
| `apps/web/src/components/cosmos/story-panel.tsx` | 1902 | 94,609（92.4 KB） |

- contracts 源码层形态：**2 处 `export *`**（第 1 行 `base.js`、第 1455 行 `action.js`）+ 296 处具名导出语句；**解析后导出面 432 个（219 值 / 213 类型）**——是 application（147）的近 3 倍，类型导出占近半，只看运行时 `Object.keys` 会漏掉大半个合同，零 diff 必须靠编译器解析。
- contracts 已有部分拆分痕迹：`base.ts`（411 行）、`action.ts`（357 行）已独立；`connection.test.ts`、`run-control.test.ts`、`trigger.test.ts` 三个测试文件已按聚合存在，但实现仍内联在 `index.ts`——切片 2/3 的聚合边界可沿用这套既有命名。
- 4 个测试文件全部从 `./index.js` 导入：拆分后门面 re-export 使其无需改导入，同时它们成为门面的额外护栏。
- 构建产物基线：`packages/contracts/dist` = 496 KB。
- madge 循环依赖基线：`packages/contracts/src/index.ts` **0 环**（application 当时有 3 个既有环）；守卫是「保持 0」，比 G05 的「不新增」更严。
- 消费面：`rg -l 'from "@cosmos/contracts"'`（排除测试）命中 56 个源文件。

### 新增资产

- `packages/contracts/entry-surface.txt`：432 行导出面快照，「允许存在的导出」唯一真相源。
- `packages/contracts/src/entry-contract.test.ts`：常驻契约测试，断言运行时值导出集合等于快照 `value` 行（219 个），复用 application 同款写法。

### 验证（全部在本 worktree 内执行）

| 命令 | 结果 |
|---|---|
| `bun run typecheck` | EXIT=0 |
| `bunx vitest run` | 515 用例全绿（主工作区基线 514 + 本切片新增契约测试 1 用例） |
| `bun run test:property` | 3 文件 / 4 用例全绿 |
| `bun run test:e2e` | 4 文件 / 4 用例全绿（真实 `bun.exe` 加入 PATH 后） |
| `bun run build:packages` | EXIT=0；`packages/contracts/dist` = 496 KB |
| `bunx madge --circular --extensions ts packages/contracts/src/index.ts` | 0 环 |

### 偏差与教训

1. **立项文档未提交**（见「载体」）。收口时需维护者授权 docs commit；在那之前它们一直是主工作区的未提交改动。
2. **原摸底数字有两处不准，已按实测修正**：其一，`export *` 是 **2 处**（最初只看到文件头的 base，漏了文件尾的 action）；其二，e2e 所需的真实 `bun.exe` 不在 worktree 的 `node_modules` 下（worktree 无 bun 包），实际在 npm 全局 `C:\Users\Otirik\AppData\Roaming\npm\node_modules\bun\bin\bun.exe`。G05 walkthrough 记的 `node_modules/bun/bin` 在本仓当前不可复现，本条目以实测为准。

### 未运行

浏览器用例（`bun run test:browser`，切片 0 的 UI 护栏基线，执行中，结果待本条目续记）；`docs:check`（本切片未改文档之外的文件，收口前统一跑）。

## 2026-09-14 切片 0 续：浏览器护栏基线 + 立项勘误

### 浏览器基线

`bun run test:browser`（先 `bun run build`，Playwright 自起 RSS fixture 与 Web 栈）：**17 用例全绿**（50.2s）。用例分布：

- `ingest.spec`：来源创建 → 录入 → 打开 Story 抽屉 → 保存 Revision → 归并 → 搜索 chip 回显 → 移动端 390px 无横向溢出 → 看板编辑模式；
- `media-policy.spec` ×3：媒体策略编辑与超限拒绝、清理预览不删字节、图片仅元数据终态；
- `offline.spec`：断网后 Story 内已存图片仍渲染；
- `phase2-organization.spec` ×5：Label 浏览与 Saved View、Story 时间线、证据关系正反视图、Story split、受管 subtype、Topic+Entity+收藏+Collection+批注；
- `theme.spec` ×6：明暗主题与两种 390/1440 溢出检查。

`test-results/ingest-story.png` 是 `ingest.spec.ts:181` 主动产出的全页截图，**不是失败产物**；本次 0 失败。

### 勘误：立项节的 UI 覆盖清单有误

立项记录称 StoryPanel 的「资产列表、子类型下拉、拆分选择」无专门断言——**实测三者都有**：

1. 资产列表：`media-policy.spec:123` 断言抽屉内 `[data-asset-status=metadata_only]`；
2. 子类型下拉：`phase2-organization.spec` 用 `getByLabel("Story subtype").selectOption("media.comic")` 并断言 `[data-story-subtype]` 显示「漫画」；
3. 拆分选择：同文件 split 用例走完整拆分流程（含归并两条单成员 Story 制造素材）。

**真正的残余缺口**是纯展示格式化与标签映射：`formatBytes`、`kindLabel`、`relationTypeLabel`、`formatTimelineDate` 以及 `RELATION_TYPE_LABELS`/`KIND_LABELS`/`STORY_KIND_LABELS`/`STATUS_LABELS` 四张映射表无断言。它们是无状态渲染辅助，拆分时按「同值搬运」处理并在切片 5 复核。

结论：UI 验收口径「现有浏览器用例即护栏」比立项时判断的更站得住——5 个 spec 已覆盖 StoryPanel 的全部交互面。

## 2026-09-14 切片 1：contracts 桶文件化（显式具名导出 + MODULE.md）

- 变更：`index.ts` 两处 `export *`（第 1 行 base、原第 1455 行 action）替换为显式导出块。清单由脚本按**解析结果**生成、不手抄：`scripts/entry-export-surface.ts` 分别解析 `base.ts`（83 导出：46 值 / 37 类型）与 `action.ts`（53：26 / 27），扣除 index.ts 本地导出名（296 个，遮蔽 0），按「值在前、类型内联 `type`、约 92 列密排」产出。值走 `export {}`，类型必须走 `export type`（仓库 `verbatimModuleSyntax: true`）。
- 实现零改动：两份导出块共 136 个名字，全部是原有导出面的搬运。
- 新资产 `packages/contracts/MODULE.md`（2.4 KB，≤3 KB）：职责、公共入口、子模块地图、阅读顺序、禁区（不新增 `export *`、类型导出写法、快照纪律）。
- 验证（worktree 内）：**导出面逐字节零 diff（仍 432）**；`grep -c "^export \*"` = 0；typecheck 0；unit 515；property 3/4；e2e 4/4；build:packages 0；madge **0 环**（保持基线）。
- 代价记录：`index.ts` 由 54,827 B 增至约 58,300 B（56.9 KB）——显式导出比 `export *` 多约 3.5 KB 枚举开销，是消除「静默导出面」的代价；红线目标靠切片 3 的门面化达成，不靠这点字节。

## 2026-09-14 切片 2：index.test.ts 按行为拆（6 个域文件）

- 原 `index.test.ts` 1011 行 / 9 个 describe / 37 个用例，按域拆为：
  - `entity-relation.test.ts` 239 行（4 用例）
  - `user-organization.test.ts` 195 行（5）
  - `topic.test.ts` 39 行（1）
  - `source.test.ts` 385 行（21；合并 source and job + source config probe + source definition catalog）
  - `board.test.ts` 125 行（4；合并 board + spotlight placement）
  - `story-subtype.test.ts` 48 行（2）
- 拆分方式：脚本按 describe 块边界逐段搬运**原文**，导入名按各文件实际引用从原 64 名中裁剪并保留原顺序；不改任何断言。
- 与切片 3 对齐：6 个文件对应切片 3 的目标模块边界（来源 / 实体关系 / 用户组织 / 主题 / 看板 / Story 子类型）。
- 验证（worktree 内）：contracts 包 11 文件 / **64 用例**（拆分前同数）；全仓 unit **81 文件 / 515 用例**（文件 76 → 81，用例数守恒——本次关键判据）；typecheck 0；property 3/4；e2e 4/4；build:packages 0。
- 偏差：`topic.test.ts`（39 行）与 `story-subtype.test.ts`（48 行）低于「100~600 行为佳」区间，但两者是独立单元（Topic 域 / 受管子类型注册表），按 G05 先例（24 行的 `connector-registry.test.ts` 保留）不合并成凑数的混合文件。

## 2026-09-14 提交状态说明

切片 0–2 的代码改动目前**全部未提交**（在 worktree 工作区）。根 `AGENTS.md` 规定「除非用户明确要求，不自行 commit」，维护者批复的是「批准开工」，未含 commit 授权；而提案 SOP 与本 Task 计划要求「每切片独立 commit（可单独 revert）」。切片 3 会再次改动 `index.ts`（与切片 1 同文件），**一旦开始切片 3，切片 1 与切片 3 就无法再拆成两个 commit**。已在本次汇报中提请维护者授权；授权前不开始切片 3。

**保险措施**：切片 0–2 的完整改动（含新增文件）已导出为补丁快照 `%TEMP%/g06-slice0-2.patch`（96,613 B，由 `git add -A -- packages/contracts && git diff --cached --binary` 生成，随后 `git reset` 复原索引）。若切片 3 覆盖 `index.ts` 后仍需把切片 1 与切片 3 分成两个 commit，可用该补丁先重建切片 0–2 的提交。

## 2026-09-14 切片 3：contracts 单体按聚合拆（入口 1455 → 167 行）

- 分析先行：解析 `index.ts` 的 **297 个顶层声明**（296 导出 + 1 个非导出 helper `blockLimitSchema`），用「声明间引用」建图并跑 Tarjan——**297 个强连通分量、无环**。结论：可以按域自由切分，只需保持依赖方向。
- 切分决策：`revisionDetail` 入 `entry-relation`（它 extend 自 `entryRevisionSnapshotSchema`）、`ingestResult` 入 `source`、Saved View 入 `user-organization`（与切片 2 的测试文件对齐）、事件与 SSE 入 `platform`（与 `eventEnvelope` 同域）;run 状态族（`runStatus`/`stepStatus`/`jobStatus`/`jobKind`/`jobSnapshot`）移入 `run-control`——**这一步专为消环**：`runStatusSchema` 留在 `source` 会让 source ↔ run-control 互指，移入后模块图无环。
- 结果：11 个域模块（38~298 行），入口成为纯门面 **167 行**（432 个显式导出、13 个导出块），含 application 同款说明头。
- 工具：`scripts/entry-export-surface.ts` 逐模块解析 `base.ts`/`action.ts` 的导出面，按「解析结果 − 本地声明名」生成显式再导出；类型走 `export type`。转换脚本是一次性的，用完即删（未入库）。
- **偏差 1（提案「入口 ≤100 行」对本对象不可达）**：application（147 导出）当时做到 98 行；contracts 的导出面 432 个（近 3 倍），显式门面的行数下限约为「名字密排 100+ 行 + 13 个导出块包装」≈130 行以上。实际 167 行，满足提案 §4.1 的**入口文件红线 >300 行**与文件红线（>800 行 / >50 KB），但高于「≤100 行」这一为 storage-prisma / application 设定的验收值。已同步改 README 的 Goal 与切片验收。
- **偏差 2（踩坑，由 typecheck 发现）**：首版转换脚本的引用检测只在「index.ts 自己的声明名」集合里匹配，**完全漏掉 base.ts / action.ts 的名字**（它们不是 index.ts 的顶层声明），生成的模块缺 base 导入，typecheck 报 6 处 TS2552/TS2304；修正为「声明名 ∪ base/action 面名」后一次通过。另一类假依赖是**注释里的提及**（`entry-relation → entity`、`story-subtype → story` 两条假边都来自 JSDoc 里写的 `Entity`/`StoryDetail`），已在检测前剥离注释。教训：搬运前先证明导入闭包完整，**typecheck 是唯一可信判据**；导出面零 diff 不覆盖「模块缺导入」这类错误。
- 代价：`packages/contracts/dist` 496 KB → **721 KB（+45%）**，模块数量带来的文件固定开销（G05 同类代价 +30%）。
- 验证（worktree 内）：**导出面逐字节零 diff（仍 432）**；typecheck 0；**madge 0 环**；unit 81 文件 / 515 用例；property 3/4；e2e 4/4；build:packages 0。
- 读取量：入口 **14,602 → 2,824 token（−81%）**；单域模块最大 `source.ts` 2,414 token、最小 `story-subtype.ts` 296 token。
- 未运行：浏览器用例（端到端确认，执行中，结果待续记）；`docs:check`（收口前统一跑）。

## 2026-09-14 切片 3 续：端到端确认

`bun run test:browser`（Playwright 自起 RSS fixture 与 Web 栈）：**17 用例全绿**（52.7s）。这是 contracts 拆分的端到端确认——Web/API/Worker 全部消费 `@cosmos/contracts`，导出面零 diff 与全仓构建通过之外，真实浏览器路径（录入、媒体策略、离线图片、拆分、子类型、Topic/Entity/收藏/批注、主题）无回归。

切片 3 至此收口并提交。
