# Task 15：Phase 2 验收补完（分类/Topic 浏览、Story 时间线、相关内容）

## User Request / Topic

2026-09-09 用户在核对「Phase 2 还剩余哪些内容未完成」并听取下一步建议后，设定目标「补完 Phase 2 验收」，随后分配 Task 编号 15 并授权提交与推送。本轮只补 PRD Phase 2 四条验收标准中尚缺的展示能力，不启动 Phase 2 需求清单里的其余条目。

## Goal

让 PRD §12「Phase 2：组织与可配置看板」的四条验收标准全部成立：

```text
分类（Label）/Topic 浏览 -> 搜索表单多选筛选 chip（复用 search.labelIds/topicIds）
Saved View 条件        -> 保存/套用包含分类与 Topic 的查询条件
Story 时间线           -> 成员 Revision/Observation 展平为按时间倒序的事件流
Story 相关内容         -> 共享分类或共享 Entity 的其它 Story（REC-008 v1）
```

不新增 Prisma 模型、migration、公共合同或 API 端点。

## Scope / Non-goals

Scope：

- `searchSchema` 新增 `labelIds`/`topicIds` 数组；`FeedBrowser` 渲染分类与 Topic 多选 chip，命中条件回显为筛选 chip。
- `page.tsx`：搜索提交、Saved View 保存/套用、表单默认值与清除都带上这两个条件。
- `StoryPanel` 新增时间线区块与相关内容区块；新增 `lib/story-timeline.ts`、`lib/related-stories.ts` 两个纯逻辑模块。
- 组件实验室 fixture 更新；`docs/spec/interfaces/0005-web-client.md` 与 `docs/testing/README.md` 同步；新增浏览器产品 E2E。

Non-goals：

- 相关内容的服务端排序/推荐策略（REC-008 完整形态）与 Artifact 目标（Phase 3 对象）。
- Read State「未读」过滤；看板级「Feed Block 绑定分类/Topic」的独立配置（搜索与 Saved View 已支持条件本身）。
- Phase 2 需求清单其余条目：Story split（ORG-014）、`evidence_for`/`mentions`（ORG-011）、自动聚类/Knowledge Workflow（ORG-021）、subtype 受管注册表（ORG-013）、Trigger/Connection/StateStore/媒体策略/Run 控制/OPS。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke、长时故障恢复。

## 权威合同

- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) §12 Phase 2 验收、ORG-017（Story Revision 表达时间范围）、REC-008（相关内容）、LIB-005（Saved View 条件）。
- 既有合同（无新增）：contracts `searchQuerySchema`/`savedViewConditionsSchema`/`storyDetailSchema`/`entityDetailSchema`。
- 现状 spec：[`interfaces/0005-web-client.md`](../../../docs/spec/interfaces/0005-web-client.md)。

## 实施切片（单切片，三个可独立验证的能力）

1. **分类/Topic 浏览 + Saved View 条件**：搜索表单多选 chip + 保存/套用条件。
2. **Story 时间线**：纯客户端投影，不新增读合同。
3. **Story 相关内容**：组合既有 `search`/`entity`/`story` 读端点。

## Current State

- 生命周期阶段：实现、门禁与浏览器验收完成；随本次提交合入 `master` 并推送。
- 连贯目标：让 PRD Phase 2 的四条验收标准全部成立。
- 可观察验收（≤3 条）：
  1. 点选分类或 Topic chip 后搜索，请求带 `labelIds`/`topicIds`，筛选区回显“分类：<名称>”/“Topic：<标题>”；
  2. 打开多来源 Story 能看到时间线事件（时间、事件类型、来源、标题）；
  3. 两条 Story 共享分类或共享 Entity 后，其中一条的“相关内容”列出另一条并标注相关原因。
- 依赖：Task 13（Label/SavedView 与 `search` 的 labelIds/topicIds 过滤）、Task 10（`StoryDetail.entries` 的 Revision/Observation）、Task 12（Story↔Entity 关联）。
- 受影响合同：无公共合同变化；仅 Web 内部表单状态与两个新 lib 模块。
- 验证层级：unit（新 lib 与 component-lab）→ 浏览器产品 E2E → 全量门禁。

## Decisions and Deviations

- 分类/Topic 用 chip 多选而不是 `<select multiple>`：保持搜索表单横向布局，并用 `aria-pressed`/`aria-label` 提供可测试、可键盘访问的入口。
- 相关内容只组合既有读端点，因此不新增公共接口或持久化，不需要 Proposal；服务端排序与更大候选集留给 Phase 4 推荐体系。
- 相关内容在打开 Story、改标签、改实体后重算；切换 Story 时用 `openStoryIdRef` 丢弃旧请求结果，避免面板内容与列表不一致。
- 时间线不进 Story Revision：ORG-017 的「时间范围」仍由成员 Entry 的时间投影推导，未改 Revision 字段集与 fingerprint 语义（记为后续事项）。
- 保存视图此前硬写空的 `labelIds`/`topicIds`（代码注释即缺口），本轮改为记录表单全部条件；套用视图会把多选回填。

## Implementation Walkthrough

1. **搜索表单**（[`feed-browser.tsx`](../../../apps/web/src/components/cosmos/feed-browser.tsx)）：`searchSchema` 增加 `labelIds`/`topicIds` 数组；新增 `labels`/`topics` props 渲染两组多选 chip（`按分类筛选 <名称>`/`按 Topic 筛选 <标题>`），点选经 `searchForm.setValue` 写入；`activeFilterLabels` 增加分类与 Topic 的回显 chip。
2. **页面接线**（[`page.tsx`](../../../apps/web/src/app/page.tsx)）：表单默认值与 `reset` 带上两个数组；`onSearch` 拼成逗号串提交；`saveCurrentSearchAsView` 保存全部条件；`applySavedView` 回填多选；`FeedBrowser` 传入 `labels.items` 与 `topics`。
3. **时间线**（[`lib/story-timeline.ts`](../../../apps/web/src/lib/story-timeline.ts)）：把每个成员的 Revision 与 Observation 展平成事件（TemporalValue 取 `exact`，退化为 `fallback.lowerBound`，都没有则用 `createdAt`），按时间倒序、上限 50 条；`StoryPanel` 新增时间线区块。
4. **相关内容**（[`lib/related-stories.ts`](../../../apps/web/src/lib/related-stories.ts)）：先按共享分类走一次 `search`（1 次请求、带标题），再取最多 2 个关联 Entity 的关联 Story（每个最多 2 条）并逐条取标题；去重、排除当前 Story、上限 5 条、单信号失败只丢该信号；`StoryPanel` 新增相关内容区块，条目可点击切换到该 Story。
5. **测试与文档**：新增两个 lib 的 unit 测试与浏览器 E2E `phase2-organization.spec.ts`（2 例）；更新组件实验室 fixture、`docs/spec/interfaces/0005-web-client.md`、`docs/testing/README.md` 与 `PROJECT-STATUS.md`。

偏差与已知限制：

- 相关内容当前是 Web 侧组合读端点，最多 5 条且无排序信号；同分类但不同事件的 Story 会一并列出（符合“相关但不同事件”，但不是推荐排序）。
- 时间线只渲染成员来源的 Revision 与 Observation，不包含 Topic 成员变更、批注等用户操作事件。
- 浏览器 E2E 的卡片定位改为「来源名 + 标题」双重过滤：同一浏览器栈内其它 spec 也有同名 fixture 标题，且 Feed 排序在同秒创建时不稳定（首轮全量套件暴露）。

## Verification / Gate

验证（2026-09-09，实际运行）：

- `bun run typecheck` 全仓通过；`bun run lint:web` 0 error（2 个既有 warning）；`bun run build`（含 Next standalone）通过；`bun run docs:check` 353 文件 failures=[]；`git diff --check` 干净。
- focused：新增 `story-timeline.test.ts` 3 例、`related-stories.test.ts` 4 例通过；`bunx vitest run apps/web` 9 文件 / 49 用例全部通过（含 component-lab 登记与快照）。
- 全量 `bun run test`：46 文件 / 399 用例，373 通过；26 例失败全部集中在 storage-prisma 的 `prisma migrate deploy` 5s 超时 + EBUSY（既有 Windows SQLite 并行负载抖动），`bunx vitest run --no-file-parallelism packages/storage-prisma` 串行 10 文件 / 93 用例全部通过。
- 浏览器产品 E2E：`COSMOS_E2E_WEB_PORT=4190 bunx playwright test --config playwright.config.ts` **11/11 通过**（ingest、offline、theme 与新增 `phase2-organization.spec.ts` 2 例同栈串行）。
- 组件实验室浏览器：`bun run test:browser:component-lab` **13/13 通过**。
- Node 进程 E2E：`BUN_BINARY=<真实 bun.exe> bun run test:e2e` **4/4 通过**。
- 未运行：Windows Node smoke（`scripts/smoke-node.ps1`）、Docker/Compose、发布部署（均为既有后置边界）。

## Follow-ups

- 相关内容的服务端排序与更大候选集并入 Phase 4 推荐体系；ORG-017 的 Story Revision「时间范围」字段仍未落地。
- Phase 2 需求清单其余条目（Story split、`evidence_for`/`mentions`、自动聚类、subtype 注册表）与平台面（Trigger/Connection/StateStore/媒体策略/Run 控制/OPS）继续按 PROJECT-STATUS「当前下一步」排序。
- 看板「Feed Block 绑定分类/Topic 条件」的独立配置、Read State「未读」过滤仍待后续切片。
