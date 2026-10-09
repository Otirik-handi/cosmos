# Task 37：自动化页交互补完（连接创建模态框与计划行图标提示）

> 编号 37 由维护者 2026-10-08 分配。

## User Request / Topic

2026-10-08 维护者在 `/automation` 文案修正（提交 `958cce4`、`f3399eb`）之后，批准把 Task 35 记录的另两条交互缺口单开一个 Task 完成：

> 当然要做，批准单开一个Task来完成这两项内容，编号为37。

两条缺口的原始记录在 Task [`35`](../35-frontend-redesign/README.md) 的 Follow-ups（2026-10-01 维护者裁定「本 task 只记录，不在本 task 修」）：

- **②** `/automation` 的「创建连接」应改成**按钮 → 模态框 → 表单 → 确认/取消**，并把现在的连接表单位置改成**连接列表（要有空状态）**。
- **③** 采集计划列表行的操作按钮（启动/暂停等）**只有图标没有文字，需要 tooltip**。

该请求是**非公开的维护者明确请求**，按 [`repository-workflow.md` 准入决策表](../../../docs/standards/repository-workflow.md#准入决策表) 的例外条款替代公开 Issue 的记录与实现授权；它不授权 commit、push、创建 PR、合并或其它外部操作。

## Goal

让 `/automation` 上「创建连接」与「操作计划」两个动作，在**不依赖猜测**的前提下可用：

```text
连接创建：内联常驻表单 -> 「新建连接」按钮 + 模态框（表单 + 确认/取消）
         连接区常驻内容变成连接列表，无连接时给出空状态
计划行操作：纯图标按钮 -> 悬停与键盘聚焦都能看到文字提示（与 sr-only 文案同源）
验收：4 个依赖连接表单的浏览器用例在新交互下全绿；两道文案门禁与全量测试无回归
```

## Scope / Non-goals

Scope：

- **切片 1（连接创建模态框）**：`ConnectionPanel` 的创建表单从常驻内联改为 `Dialog` 承载，入口是「新建连接」按钮；提交成功后关闭模态框并清空表单；确认/取消语义完整（取消丢弃输入、Esc 与遮罩关闭、关闭后焦点回到触发按钮）。
- **切片 2（连接列表与空状态）**：连接区常驻内容只剩列表（含状态徽标、账号、授权范围、失效原因、上次检查与行内动作），无连接时显示空状态；创建入口不再占据列表位置。
- **切片 3（计划行图标提示）**：`CollectionPlanList` 行的纯图标按钮（启用/停用、运行、Webhook 入口、媒体策略、删除）加 `Tooltip`，悬停与键盘聚焦都能看到；提示文案与既有 `sr-only` 文案同源，不新增第二份措辞。
- **切片 4（回归与文档）**：改写依赖旧内联表单的浏览器用例；同步 `docs/spec/interfaces/0005-web-client.md` 的连接面板与计划列表描述。

Non-goals：

- **不改连接的数据合同**：`ConnectionInstance`、`createConnection`／`updateConnection`／`deleteConnection` 与连接探测（`createConnectionProbe`）行为不变，本次是纯界面交互重排。
- **不改计划行的动作集合与语义**：按钮做什么、什么时候禁用、删除的二次确认语义都不变，只补提示。
- **不做 `/automation` 的其余交互诉求**：运行记录区的改造不在本次；来源表单模态框化是本轮维护者补充确认的范围，已与连接创建一起落地。
- **不引入新的 primitive**：`Dialog` 与 `Tooltip` 都已在 `apps/web/src/components/ui/` 存在，本次只接线。
- **不做移动端适配**：按 ADR-0029 决定 3，产品 PC 优先，1024 px 以下只显示「窗口过窄」提示。

## 权威合同

- Task [`35`](../35-frontend-redesign/README.md) Follow-ups（两条缺口的原始记录与 2026-10-01 裁定）
- ADR [`0029`](../../../docs/adr/0029-ui-surface-layout-and-visual-direction-v1.md)（界面版面与视觉方向；决定 1 冻结「来源与计划的创建入口只在 `/automation`」）
- Proposal [`frontend-redesign-v1`](../../../docs/proposals/frontend-redesign-v1.md)（accepted；界面重做的设计合同）
- Proposal [`ui-copy-review-v1`](../../../docs/proposals/ui-copy-review-v1.md)（reviewing；判据 R4「每个按钮说明点了会发生什么」是本次 ③ 的直接依据）
- 实现规格 [`0005-web-client.md`](../../../docs/spec/interfaces/0005-web-client.md)（连接面板与计划列表的当前行为描述）
- 组件规范：`apps/web/src/components/ui/dialog.tsx` 与 `tooltip.tsx` 的文件头注释（焦点陷阱、Esc 关闭、关闭后焦点归位由 Base UI 提供；**tooltip 不得承载操作**）

## Current State

- 生命周期阶段：**实现完成，待维护者复核**（本轮补齐来源模态框与立即抓取文案；过程与验证记录见 `walkthrough.md`）。
- 连贯目标：让 `/automation` 的连接创建与计划行操作不再依赖图标猜测与常驻表单。
- 可观察验收（≤3）：
  1. 连接创建走「按钮 → 模态框 → 表单 → 确认/取消」：取消与 Esc 丢弃输入且焦点回到「新建连接」按钮，提交成功后模态框关闭、表单清空、列表出现新连接。
  2. 计划行每个纯图标按钮在**鼠标悬停**与**键盘聚焦**时都显示文字提示，且提示内容与 `sr-only` 文案一致（不出现第二份措辞）。
  3. 4 个依赖旧内联表单的浏览器用例在新交互下全绿；全量 `bun run test`、两道文案门禁与 `docs:check` 无回归。
- 依赖：无新增依赖。`Dialog`／`Tooltip` 组件与 `components/cosmos/connection-panel.tsx`、`components/cosmos/collection-plan-list.tsx` 均已存在。
- 受影响合同：**无数据合同变更**。受影响的是 Web 界面行为与 `docs/spec/interfaces/0005-web-client.md` 的行为描述。
- 实际改动文件：
  - `apps/web/src/components/cosmos/connection-panel.tsx`（内联文案登记 46 → 44）
  - `apps/web/src/components/cosmos/collection-plan-list.tsx`（内联文案登记 71 → 72，运行按钮为「立即抓取 + 来源名」）
  - `apps/web/src/app/(shell)/automation/page.tsx`、`apps/web/src/app/home/use-source-workspace.ts`、`apps/web/src/components/cosmos/source-form.tsx`（本轮新增来源模态框接线）
  - `apps/web/src/components/cosmos/collection-plan-list/icon-action-tooltip.tsx`（**新增**，按需加载的提示层）
  - `apps/web/src/copy/areas/automation.ts` 与 `apps/web/src/copy/inline-copy-baseline.json`
  - `packages/storage-prisma/src/repository/sources.ts`（连接列表倒序）
  - `e2e/browser/collection-plan-multi.spec.ts`、`collection-plan-connectors.spec.ts`、`connection-visibility.spec.ts`、`e2e/component-lab/connection-panel.spec.ts`
  - `docs/spec/interfaces/0005-web-client.md`
- 验证层级：focused（`apps/web` 单元 + 文案门禁）→ 全量 `bun run test` → 浏览器产品 E2E（`test:browser`）→ `docs:check` 与 `git diff --check`。

## 已知约束（开工前必须守住）

1. **4 个浏览器用例依赖旧内联表单的 label 与按钮名**，改模态框必然打断它们，必须同批改写：
   - `collection-plan-multi.spec.ts:35-37`（`连接名称`／`连接 Connector`／`新建连接`）
   - `collection-plan-connectors.spec.ts:28-31`（同上 + `连接适配器配置`）
   - `connection-visibility.spec.ts:20-22`、`75-78`（`连接名称`／`连接授权范围`／`连接适配器配置`／`新建连接`）
   改写时**保留这些 label 与按钮名**可以最小化改动面：模态框只是换了承载容器，`aria-label` 不必改。是否保留由切片 1 的实现决定，但**不允许**只改产品代码而让这 4 条用例变红后不处理。
2. **「内联文案只减不增」门禁要求命中数精确等于登记值**（`apps/web/src/copy/inline-copy-baseline.json`）。本 Task 当前登记值是 `connection-panel.tsx = 44`、`collection-plan-list.tsx = 72`。新增用户可见文案必须迁进 `apps/web/src/copy/`，否则命中数增长会直接失败；文案减少或本轮确认的文案增加都必须同步登记值。
3. **组件实验室登记门禁扫描 `components/cosmos/*.tsx` 与 `components/ui/*.tsx` 的每个文件**（`component-lab/registry-integrity.ts` 的 `discoverPublicComponentModules`）。本次**不应新增**这两个目录下的文件；若确需新增，必须同批登记到 `component-lab/registry.tsx`。
4. **`TooltipProvider` 当前未在任何 layout 挂载**（`Tooltip` 只在 `component-lab/primitive-fixtures.tsx` 里自带 provider 使用）。切片 3 必须决定 provider 挂在哪一层，且不能因此让每个计划行各挂一个 provider。
5. **tooltip 不得承载操作**（`tooltip.tsx` 文件头硬约束）：本次只把已有按钮的**说明**放进提示，动作仍在按钮上。
6. **`PROJECT-STATUS.md` 已接近 9k token 警戒线**（2026-10-08 实测 8,977 token，余量约 23）。本 Task 若要往 `PROJECT-STATUS.md` 追加指针，**必须先做滚动归档**，否则 CI 会因新增警戒区文件失败。

## 实施切片

capability map（无环）：切片 1 → 切片 2（1 与 2 同属连接面板，可合并为一次交付）→ 切片 3（独立文件，可并行）→ 切片 4（收口）。

1. **切片 1 连接创建模态框**：`Dialog` 承载创建表单，「新建连接」按钮触发；确认/取消语义完整。
2. **切片 2 连接列表与空状态**：列表常驻、创建入口移出列表位置、空状态文案就位。
3. **切片 3 计划行图标提示**：5 类图标按钮接 `Tooltip`，provider 挂载层级确定。
4. **切片 4 回归与文档**：改写 4 个浏览器用例、同步 spec、跑全量门禁。

## Decisions and Deviations

- **2026-10-08 维护者批准单开 Task 37**（而非复用 Task 35）：Task 35 已合并并收尾，其 Follow-ups 明确「不在本 task 修」；两条缺口是独立的界面交互改动，按准入表应独立记录。
- **本次不含 Task 35 Follow-ups 里的其余条目**：`/automation` 的另两条（来源表单模态框化、运行记录改造）未被维护者列入本次批准范围，不做。
- **2026-10-08 维护者裁定（原待定项一：创建成功后的可见反馈）**：选择「**新增排最前**」——连接列表改为**倒序**（`createdAt` 降序、`id` 降序兜底）——新建的连接直接出现在列表最前面，因此**不做**滚动定位、也**不做**高亮。理由：维护者认为「排在最前」已让新连接无需定位即可看到，高亮是多余的第二套反馈机制。落地在 `packages/storage-prisma/src/repository/sources.ts` 的 `listConnections()`；`listSources()` 仍保持升序（不在本次范围）。
- **2026-10-08 维护者裁定（原待定项二：`TooltipProvider` 挂载层级）**：选择「**包在 `CollectionPlanList` 组件内部**」。该组件同时被 `/automation` 与首页看板的 `planListSlot`（`board-view/blocks.tsx` 的 `source-health`）渲染，挂在任一页面都会漏掉另一处，挂外壳 layout 又超出本 Task 范围。Base UI 的 `TooltipProvider` 只做「相邻提示共享延迟」的优化，**不是 Tooltip 的前置条件**，因此本 Task 最终没有引入 provider：`delay={200}` 直接给在 `TooltipTrigger` 上。
- **2026-10-08 偏差（切片 3 实现方式）：提示层改为按需加载，而不是静态引入。** 静态引入 `Tooltip` 会把首页首屏 JS 从 320.9 KB 顶到 339.4 KB，超过 E7 的 335.9 KB 预算（`layout-and-budget.spec.ts` 实测，CI 硬门禁）。根因是 `@base-ui/react` 的浮层依赖 `floating-ui-react` 未压缩约 450 KB，且该包**没有任何子入口能绕开它**（`root`／`trigger`／`provider`／`positioner`／`popup` 五个入口都 require 它）。因此新增 `collection-plan-list/icon-action-tooltip.tsx` 独立模块，由 `CollectionPlanList` 在 `load` 之后 `import()`，符合 `docs/proposals/frontend-redesign/layer-1-5-engineering.md` 对 primitive「按需加载」的既定意图。可访问名（`sr-only`）留在按钮自身，提示层未就位或加载失败时按钮照常可用，只是少一个鼠标提示。

## Verification

完整命令、实际输出与未运行项记录在 [`walkthrough.md`](walkthrough.md)。摘要：

| 层级 | 命令 | 结果 |
| --- | --- | --- |
| 文案门禁 | `bun run vitest run apps/web/src/copy/messages.test.ts` | 5/5 通过（`collection-plan-list.tsx` 72、`connection-panel.tsx` 44，与登记值精确相等） |
| 组件实验室门禁 | `bun run vitest run apps/web/src/component-lab/registry.test.ts` | 12/12 通过（新增模块在子目录内，不触发登记门禁） |
| 类型检查 | `bun run --cwd apps/web tsc --noEmit` | 通过，无输出 |
| Lint | `bun run lint:web` | 0 error（18 warning 均为其它文件既有问题） |
| 首屏 JS 预算 | `bun run test:browser -- --grep "首屏可交互与路由切换在预算内"` | 通过：首屏 JS **321.5 KB**（16 个脚本），上限 335,974 B；可交互 164 ms，路由切换 124 ms |
| Task 37 浏览器 E2E | `bun run test:browser -- --grep "creates two plans under one connection|shows a text hint|connection|connector|Webhook|media policy|媒体"` | **12/12 通过** |
| 完整浏览器 E2E | `bun run test:browser` | **58 通过、1 失败**；失败在既有 Story 分裂迁移与本地数据筛选状态，不涉及本 Task |
| 组件实验室 E2E | `bun run test:browser:component-lab -- --grep "source-form"` | 未执行到用例：当前开发服务占用 Next dev 进程，配置禁止复用，启动第二实例时冲突 |
| 全量单元测试 | `bun run test` | **137 文件 / 788 测试全通过** |
| 文档检查 | `bun run docs:check` | 通过：`{"failures": [], "checkedFiles": 966}` |
| 文档大小门禁 | `python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` | PASS（含 warning） |
| 代码大小门禁 | `python scripts/size-governance.py -c code tests --check --baseline docs/doc-governance/code-baseline.json --fail-on-new --warn-lines 800 --fail-lines 800 --entry-warn-lines 300 --entry-fail-lines 300` | PASS（含 warning） |
| 空白与冲突标记 | `git diff --check` | 通过，无输出 |

## Follow-ups

- **首屏 JS 预算余量已接近耗尽**：HEAD 实测 320.9 KB，上限 328.1 KB（298.1 KB 基线 + 30 KB 增量预算），只剩约 7.2 KB。本次靠按需加载才没有顶穿。任何**从首页可达**的新 primitive 都会触发同一问题，这不是 Task 37 独有的；若要继续加 primitive，需要先按 ADR-0029「未达标时按实测调整预算，不静默放宽」走一次预算复核。
- **完整浏览器套件仍有两类非本轮失败**：Story 分裂迁移用例失败，以及 `/library` 筛选用例受本地数据状态影响（预期 14 条、实际 12 条）。Task 37 相关 12 个浏览器用例全部通过；这些失败没有被隐藏，保留给后续独立诊断。
- **`Tooltip` 的按需加载模式可以复用**：`collection-plan-list/icon-action-tooltip.tsx` 是仓库第一处 `import()` 懒加载。若后续别的组件也要用 `Tooltip`／`Dialog`／`Menu`，建议照此模式（可访问名留在触发元素上，浮层在 `load` 之后取回），而不是各自再想一遍。
- **本轮补丁**：运行按钮的提示/可访问名由仅来源名称改为「立即抓取 + 来源名」；`/automation` 的新建来源入口现在与新建连接一致，采用按钮 → 模态框 → `SourceForm`。`SourceForm` 增加 `embedded` 展示模式，业务校验与保存逻辑仍由 `useSourceWorkspace` 持有。
- 若本次改写让 4 个浏览器用例的断言变复杂，考虑把「建连接」抽成 `e2e/support/` 下的共享步骤（Task 35 Round 8 已有 `story-flow.ts` 的先例）。
- `docs/spec/interfaces/0005-web-client.md` 已 59.5 KB，是 `docs-baseline.json` 里的存量登记债；本次同步会小幅增长，拆分建议见 Task 35 Follow-ups。
