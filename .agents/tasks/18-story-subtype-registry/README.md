# Task 18：Story subtype 受管注册表 v1（静态清单 + 写入校验 + 目录查询，Phase 2 第八切片）

## User Request / Topic

2026-09-09 用户指示「执行 Phase 2 下一个切片开发任务」。Proposal [`story-subtype-registry-v1`](../../../docs/proposals/story-subtype-registry-v1.md) 经评审接受（三项裁决：做 ORG-013、注册表取代码内静态清单、写入侧拒绝新值并保留旧值；同时授权建 worktree、任务分支与 Task 18 编号），稳定决定沉淀于 [`ADR-0013`](../../../docs/adr/0013-story-subtype-registry-v1.md)，PRD §7.5 第八切片注记与信息模型 §Story Subtype Registry 注记已同步。

## Goal

交付 ORG-013 的受管部分：

```text
注册表          -> packages/domain 的 storySubtypeRegistry（id/kind/version/label/description/status/identityPolicy/owner）
写入边界        -> updateStoryRevision 与 splitStory 只接受该 kind 下 active 注册项；既有未知值不改写
读取兼容        -> StoryDetail.story.subtype 保持字符串形状；未知 subtype 继续按核心 kind 降级展示
目录与消费      -> GET /api/v1/story-subtypes + Web 编辑/拆分下拉选择
```

## Scope / Non-goals

Scope：

- domain：`storySubtypeRegistry`、`StorySubtypeRegistration`、查找与校验辅助函数。
- application：`StorySubtypeInvalidError`（`code: "validation"`）。
- storage：`updateStoryRevision`、`splitStory` 的 subtype 校验。
- contracts：`storySubtypeSchema`、目录 DTO 与查询 schema。
- transport-http + API：`listStorySubtypes` 与 `GET /api/v1/story-subtypes`。
- Web：编辑 Story 与拆分后继的 subtype 下拉；组件实验室 fixture。
- 文档：`docs/spec`（domain/contracts/storage/interfaces）、`docs/testing`、`PROJECT-STATUS`。

Non-goals（见 Proposal / ADR-0013）：

- 插件运行时注册与扩展 SDK 版本声明。
- `identityPolicy` 的判定执行（ORG-021）。
- subtype 重命名、合并、迁移工具。
- 改写既有未知 subtype 数据。
- Prisma schema、migration、回填。

## 权威合同

- Proposal [`story-subtype-registry-v1`](../../../docs/proposals/story-subtype-registry-v1.md)（accepted，2026-09-09）。
- ADR [`0013`](../../../docs/adr/0013-story-subtype-registry-v1.md)；ADR [`0006`](../../../docs/adr/0006-story-domain-v1.md) 决策 4。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) ORG-001/005/013 与 §7.5 第八切片注记。
- 信息模型 [`0002`](../../../docs/architecture/0002-information-model.md) §Story Subtype Registry。
- 现状 spec：domain/0001、contracts/0001、storage/0001、interfaces/0002 与 0005。

## 实施切片（capability map，无环依赖）

1. **切片 1：domain 注册表 + storage 写入校验**（无公共面）
   - 注册项类型、首批三条 `media` 注册项、查找与校验辅助；
   - `updateStoryRevision` / `splitStory` 拒绝未注册、跨 kind、`retired` 的 subtype。
2. **切片 2：公共合同与 Product API**（contracts + application + transport-http + apps/api）
   - 目录 DTO 与查询 schema；错误类；transport client；API 端点与错误映射。
3. **切片 3：Web + 组件实验室 + 浏览器 E2E**
   - 编辑与拆分表单改用下拉；组件实验室 fixture 带目录；浏览器用例覆盖选中与拒绝。

## Current State

- 生命周期阶段：切片 1（domain + storage）、切片 2（合同 + API + transport）与切片 3（Web + 组件实验室 + 浏览器 E2E）均已实现并通过门禁，已随 `087544b` 合入并推送 `master`（用户授权 commit/push/merge）。
- 连贯目标：让 subtype 成为可查、可校验的受管理取值，而不是任意字符串。
- 可观察验收（≤3 条）：
  1. 编辑 Story 时 subtype 从目录下拉选择，选中的值保存后仍能在详情读回；
  2. 提交一个未注册的 subtype 返回 400 并说明原因，Story 内容不变；
  3. 既有未知 subtype 的 Story 仍可打开并展示（按核心 kind 降级），只改标题时不被迫修改 subtype。
- 依赖：Task 10（Story Revision 与 subtype 读取降级）、Task 17（split 的后继 subtype 写入）。
- 受影响合同：domain（新注册表）、application（错误）、storage-prisma（写入校验）、contracts（目录 DTO）、api（新端点）、transport-http（client 方法）、web（编辑/拆分表单）。
- 验证层级：focused（domain/storage/contracts）→ API 集成 → 浏览器 → 全量门禁。

## Decisions and Deviations

- 以 ADR-0013 五条为稳定边界（静态清单、写入严格 + 读取降级、只读目录与 Web 下拉、首批最小清单、身份规则只声明不执行）。
- 未注册 subtype 的拒绝走 400 `validation_failed`（输入错误），不复用 Story 写冲突的 409。
- **修复既有缺陷（本切片范围内）**：`updateStoryRevision` 此前只把 kind/subtype 计入 fingerprint，从未写回 `Story` 行，因此改 kind/subtype 只追加 Revision、读取投影仍是旧值（Web 下拉保存后不生效）。本切片在同一事务里把 `kind`/`subtype` 写回 Story 行，并补了对应断言。
- **写入规则的非对称**：`updateStoryRevision` 允许「保留 Story 上既有的未注册 subtype」（kind 与 subtype 都没变时不校验），但 `splitStory` 的后继一律要求 `active` 注册项——后继是新对象，继承未注册值属于新赋值。Web 拆分表单因此把未注册的壳 subtype 默认清成「无 subtype」。
- Web 编辑表单新增「类型」下拉：受管目录首批只有 `media.*`，不暴露 kind 选择的话，ingest 默认的 `document` Story 根本选不到任何注册项。kind 变化时清空不兼容的 subtype，避免服务端 400。
- Web 编辑表单按钮文案由「更新标题」改为「保存修改」（现在同时改标题/类型/subtype），并同步 `e2e/browser/ingest.spec.ts` 的定位。

## Implementation Walkthrough（2026-09-09）

1. **domain**：`storySubtypeStatuses`/`StorySubtypeRegistration`/`storySubtypeRegistry`（首批 `media.comic`/`media.anime`/`media.video`）、`listStorySubtypes`（默认只出 `active`+`deprecated`）、`checkStorySubtype`（`empty`/`unregistered`/`kind_mismatch`/`not_active` 四类拒绝，带可选注册表参数供未来插件注册表复用）。
2. **application**：新增 `StorySubtypeInvalidError`（`code: "validation"`）与 `CosmosRepository.listStorySubtypes` 端口。
3. **storage**：`assertStorySubtype` 把 domain 判定翻译成可读错误；`updateStoryRevision` 在 CAS 后按「新赋值才校验」判定并拒绝；`splitStory` 在每个后继循环里校验；`tx.story.update` 一并写回 `kind`/`subtype`；`listStorySubtypes` 直接投影注册表。
4. **contracts**：`storySubtypeStatusSchema`/`storySubtypeSchema`/`storySubtypePageSchema`/`storySubtypeQuerySchema`。
5. **transport/API**：client `listStorySubtypes({kind?})`；API `GET /api/v1/story-subtypes`（`catalogPage` 包装、未知 kind 400）；`sourceCommandError` 增加 `code: "validation"` → 400 `validation_failed` 映射。
6. **Web**：`page.tsx` 加载目录并传给 StoryPanel；StoryPanel 头部新增类型/subtype 徽章、编辑表单新增类型与 subtype 下拉（`StorySubtypeSelect`，未注册旧值显示「（未注册）」）、拆分表单每个后继新增 subtype 下拉且换 kind 时清空不兼容值；组件实验室新增 `labStorySubtypeOptions` 与 Legacy subtype 场景。
7. **文档**：ADR-0013 + ADR 索引 + ADR-0006 决策 4 注记、PRD §7.5 第八切片注记、信息模型 §Story Subtype Registry 注记、`docs/spec`（domain/contracts/storage/interfaces 0002/0004/0005）、`docs/testing/README.md`、Task 导航与 `PROJECT-STATUS.md`。

## Verification / Gate

验证（2026-09-09，实际运行）：

- `bun run typecheck` 全仓通过；`bun run lint:web` 0 error（2 个既有 warning）；`bun run build`（含 Next standalone）通过；`bun run docs:check` 368 文件 failures=[]；`git diff --check` 干净。
- focused：domain 14/14（新增注册表 3 例）、contracts 34/34（新增目录 2 例）、transport-http 15/15（新增目录端点 1 例）、api controller 37/37（新增目录页与 400 映射 2 例）、storage `story-subtype-registry` 5/5、component-lab registry 12/12 全部通过。
- 先红后绿：临时移除校验与 kind/subtype 持久化后，storage `story-subtype-registry` 5 例全部失败；恢复后 5/5 通过。
- 全量 `bun run test`：49 文件 / 430 用例，368 通过；62 例失败全部集中在 storage-prisma 的 `prisma migrate deploy` 5s 超时 + EBUSY（既有 Windows SQLite 并行负载抖动），`bunx vitest run --no-file-parallelism packages/storage-prisma` 串行 13 文件 / 108 用例全部通过。
- 浏览器产品 E2E：`COSMOS_E2E_WEB_PORT=4200 bunx playwright test --config playwright.config.ts` **14/14 通过**（新增「改类型为媒体 + 选中漫画 → 徽章变化；API 提交未注册 subtype → 400 且 Story 不变」用例；`e2e/browser/ingest.spec.ts` 的按钮定位同步为「保存修改」）。首轮曾因新增用例断言写成 `toEqual`（多出投影字段）与未过滤故意 400 的浏览器资源错误各失败一次，修正后全绿。
- 组件实验室浏览器：`bun run test:browser:component-lab` **13/13 通过**（含新增 Legacy subtype 场景渲染）。
- Node 进程 E2E：`BUN_BINARY=<真实 bun.exe> bun run test:e2e` **4/4 通过**。
- 未运行：Windows Node smoke（`scripts/smoke-node.ps1`）、Docker/Compose、发布部署（均为既有后置边界）。

## Follow-ups

- `identityPolicy` 在 ORG-021 落地时接上真实判定，或删除。
- 插件运行时注册与注册项兼容 SDK 版本。
- Phase 2 需求清单其余条目：自动聚类/Knowledge Workflow（ORG-021）与平台面（ING-009、RUN-004、Connection/StateStore、Trigger/SDK、OPS-003/004）。
