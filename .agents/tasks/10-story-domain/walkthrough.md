# Task 10 walkthrough：Story 域模型 v1

> append-only 过程记录；Task 摘要、范围与门禁见 [README.md](README.md)。

## 2026-09-07：任务建立与切片计划

- 用户评审通过 [`story-domain-v1`](../../../docs/proposals/story-domain-v1.md)（三项默认建议全部认可）；Proposal 已标 accepted，PRD/信息模型/ADR-0006 同步并随 master 提交 `6f6651d` 推送 fork。
- 用户授权执行实现准备：从 master `6f6651d` 建立 worktree `.worktree/story-domain` 与分支 `feat/t10-story-domain`（已创建，见下方命令证据）。
- 建立本 Task（编号 `10-story-domain`）并登记 capability map 与无环依赖顺序。
- 决策：切片从 domain/存储开始；无公共 API 变更不先行打开 contracts；每切片独立验收。

证据：

```text
git worktree add -b feat/t10-story-domain .worktree/story-domain master
  -> Preparing worktree (new branch 'feat/t10-story-domain')
     HEAD is now at 6f6651d docs: accept story-domain v1 and record Phase 2 baseline
```

## 2026-09-07：切片 1a 完成——StoryRevision 版本化数据基础（RED→GREEN）

切片 1a 只落 StoryRevision 版本化的数据与 ingest 写入语义，不引入 move/merge/update 命令（1b）与公共 API（切片 2）：

- `schema.prisma`：`StoryRevision` 增加 `revision Int @default(1)`、可空 `fingerprint`，并加 `@@unique([storyId, revision])`。
- 新 migration `20260907120000_story_revision_versioning`：RedefineTables 加列；backfill 按 `(storyId, createdAt, id)` 为每个旧 Story 的 revision 从 1 起编号；legacy 行 `fingerprint` 保持 NULL（命令层把 NULL 视为“需重写”而非可比较内容）。
- `@cosmos/domain`：新增 `StoryRevisionContent` 与 `fingerprintStoryRevision`（仅覆盖 title/summary/kind/subtype 展示字段），domain focused 测试覆盖变更/不变与确定性。
- `PrismaCosmosRepository.persistIngestItemInternal`：写入 StoryRevision 时携带 revision 序号与 fingerprint；**展示字段无实质变化的 Entry 修订不再追加 StoryRevision**（ADR-0006 决策 3 的 no-op 语义，同时避免重复 display fingerprint）。
- 迁移升级测试 `packages/storage-prisma/src/story-revision-versioning.test.ts`：legacy 库（截至 `20260824100000`）→ seed 3 条旧 revision → 部署新 migration → 断言 per-story revision 编号、fingerprint NULL、`(storyId, revision)` 唯一约束生效。

偏差记录：既有 spec（domain/0001 状态转换 5）“每次 Entry 修订追加 StoryRevision”的旧描述已被本切片的 no-op 语义取代；spec 文档在切片收口时统一同步，避免半更新。

验证（2026-09-07，worktree `feat/t10-story-domain`，全部实际运行）：

```text
bun run db:generate                       -> 通过（Prisma Client 6.19.3 生成）
bunx vitest run packages/domain           -> 6/6 通过
bunx vitest run packages/storage-prisma   -> 66/66 通过（含升级测试 1、index 18、host store 21、backend 24、source-identity 2）
bun run typecheck                         -> 全仓通过
```

未运行：`bun run test` 全量、浏览器、Node E2E、build（worktree 尚未同步 Task/代码到 master，发布门禁在切片合入前统一跑）。

下一步：切片 1b（Story 编排仓储命令：move entry、update Story Revision、merge canonical/alias），仍无公共 API。

## 2026-09-07：切片 1b 完成——Story 编排仓储命令（RED→GREEN）

1a 已提交（`bd64bfc` 文档、`d76ec5b` 实现）。1b 在 application port 与 storage 落地编排命令，仍无公共 API：

- `schema.prisma`：`StoryRevision` 增加可空 `actorJson`/`reason`；新增 `StoryAlias` 表（id=obsolete Story id → canonicalStoryId）；`Story.aliases` 反向关系。
- 新 migration `20260907130000_story_merge_alias`：加 actor/reason 列 + StoryAlias 表与 `canonicalStoryId` 索引（fresh/旧库均验证）。
- `@cosmos/application`：新增 `StoryNotFoundError`、`StoryRevisionConflictError`、`StoryMergeConflictError`；`CosmosRepository` 增加 `moveEntryToStory`、`updateStoryRevision`、`mergeStories` 三个命令签名（kind 使用 domain `StoryKind`；update 带 `baseRevisionId` CAS）。
- `PrismaCosmosRepository`：实现私有 `resolveCanonicalStoryId`（merge alias 优先）并让 `story()` 读取 alias 重定向；三个命令均在事务内写入并落 `story.entry_moved.v1`/`story.revision_created.v1`/`story.merged.v1` 领域事件（payload 含 actor/reason）。
- 语义：move 幂等 no-op；update 仅在展示字段 fingerprint 变化时追加 Revision，stale `baseRevisionId` 抛 conflict；merge 移动成员、保留 obsolete Story 历史壳、创建 alias，已 merge Story 再次 merge 抛 conflict。

偏差记录：`StoryDetail` 公共 shape 仍是单 Entry（契约层切片 2 扩展为多成员）；1b 验收通过直接数据库断言与命令返回值，多成员详情 UI/API 归切片 2。

验证（2026-09-07，全部实际运行）：

```text
bunx vitest run packages/storage-prisma/src/story-orchestration.test.ts        -> 2/2 通过
bunx vitest run packages/storage-prisma/src/story-revision-versioning.test.ts   -> 1/1 通过
bunx vitest run packages/storage-prisma/src/index.test.ts                       -> 18/18 通过
bun run typecheck:storage                                                      -> 通过
bun run typecheck:application                                                  -> 通过
```

未运行：全量 `bun run test`、浏览器、Node E2E、build（在切片 2/3 或合入前统一跑）。

下一步：切片 2——公共合同与 Product API（Story 命令 schema、详情多 Entry、HTTP 端点）。

## 2026-09-08：切片 2 主体完成——公共合同与 Product API

- `@cosmos/contracts`：`storyDetailSchema` additive 增加 `entries: entryDetailSchema.array()`（`entry` 保留为 `entries[0]` 兼容位）；新增 `moveEntryToStoryCommandSchema`、`updateStoryRevisionCommandSchema`（带 baseRevisionId CAS、kind 枚举、可选 actor/reason）、`mergeStoriesCommandSchema` 与对应类型。
- `PrismaCosmosRepository.story()`：详情返回完整成员列表（`entries` 按 updatedAt desc），保留 entry 兼容字段；无成员或无 currentRevision 的 Story 仍返回 null（空 canonical 读取边界记录，后续切片再决定）。
- Product API：`POST /api/v1/stories/:storyId/entry-moves`、`POST /api/v1/stories/:storyId/revisions`、`POST /api/v1/stories/merges`；错误经既有 command 漏斗映射 Story*Error → 404/409，Zod → 400；missing entry → 404。
- `@cosmos/transport-http`：新增 `moveEntryToStory`/`updateStoryRevision`/`mergeStories` client 方法与 schema 校验。
- Web 组件 fixture 补 `entries` 兼容（切片 3 才消费多成员 UI）。

验证（2026-09-08，全部实际运行）：

```text
bun run typecheck        -> 全仓通过
bunx vitest run packages/contracts/src/index.test.ts        -> 18/18
bunx vitest run apps/api/src/app.controller.test.ts         -> 18/18（新增 3 个 Story 端点场景）
bunx vitest run packages/transport-http/src/index.test.ts   -> 6/6
bunx vitest run packages/storage-prisma/src/story-orchestration.test.ts
                         + story-revision-versioning.test.ts -> 3/3（首次并行出现既有 EBUSY 抖动，重跑全绿）
```

未运行/待收口：Node E2E 真实 HTTP 验收（随 Web 切片浏览器 E2E 一并覆盖三个新端点）、`docs/api` Draft 与 `docs/spec` contracts/interfaces/domain 同步、`docs/testing` 说明；这些在切片 3 完成或合入 master 前统一补齐。

下一步：切片 3——Web Story 详情多成员展示与操作入口（StoryPanel 消费 `entries`、move/update/merge 调用 transport client、组件实验室 + 浏览器 E2E）。

## 2026-09-08：切片 3 完成——Web Story 详情多成员与编排操作

- `StoryPanel` 增加"来源成员"区块（渲染 `story.entries` 全部成员，语义化 `data-story-member-id`）；新增"Story 操作"区：标题编辑（构造 `UpdateStoryRevisionCommand`，带当前 `baseRevisionId`）与归并表单（输入 obsolete Story id，回调 `mergeStories` canonical=当前 Story）；busy/错误状态走 `role=alert`。
- 编排通过 props 回调上抛（不引入面板内网络依赖，组件实验室可 stub）；`page.tsx` 注入真实 transport client 调用并刷新详情。
- 组件实验室 fixture 补 stub callbacks（组件实验室仍无 Product API 请求）；registry/unit 测试通过。
- 浏览器 E2E（`e2e/browser/ingest.spec.ts`）新增真实流程：打开 Story → 更新标题（Revision 变化）→ 归并第二个 Story → 断言"来源成员（2）"→ 通过 `/api/v1/stories/:obsoleteId` 验证旧 ID 重定向到 canonical 且成员数为 2。

验证（2026-09-08，全部实际运行）：

```text
bun run typecheck                                  -> 通过
bun run lint:web                                   -> 通过（仅 2 个既有 warning）
bunx vitest run apps/web/src/component-lab ...      -> 34/34 通过
COSMOS_E2E_WEB_PORT=4183 bunx playwright test -g "creates an RSS source, runs ingest, and opens a Story"
                                                    -> 1/1 通过（真实 API/Worker/Next + 编排）
```

未收口（合入 master 前完成）：`docs/api`（0002 endpoints、0003 DTO Draft）、`docs/spec`（contracts/0001、domain/0001、storage/0001、interfaces/0002、interfaces/0005）同步与 `docs/testing` 说明；PROJECT-STATUS 合入后更新。

## 2026-09-08：合入与收尾——人工浏览器验证推迟

- Story domain v1 已合入 master（`82a90b8`…`452c8c2`），`docs/api`/`docs/spec`/`docs/testing`/PROJECT-STATUS 同步完成；master 与 origin 同步。
- 用户决定：人工浏览器验收因操作成本推迟到后续开发后再执行。补充说明——归并表单要求输入 Story ID，但 UI 不展示 Story ID（E2E 通过 API 响应获取），人工验证存在可用性障碍；Story ID 展示方式与 move entry 是否需要 UI 入口留待后续决策。
- 清理：worktree `.worktree/story-domain` 与分支 `feat/t10-story-domain`（尖端 `b0bc432`，已并入 master）已删除；Windows 长路径残留（node_modules 等忽略产物）经 robocopy 镜像清空法清理。

证据：

```text
git worktree remove .worktree/story-domain    -> 完成
git branch -d feat/t10-story-domain           -> Deleted (was b0bc432)
robocopy <empty> .worktree/story-domain /MIR && rm -rf
                                              -> .worktree 目录已完全移除
```

未运行：人工浏览器验收（推迟，非门禁失败）；自动化浏览器 E2E 切片 3 已在 worktree 通过 1/1。

## 2026-09-16：追加切片「Story 表示扩展字段 v1」——后端切片实施与验证

- 背景：ORG-017 剩余两项（关键事实、时间范围）由 Proposal [`story-key-facts-and-time-range-v1`](../../../docs/proposals/story-key-facts-and-time-range-v1.md)（2026-09-16 accepted）与 [ADR-0021](../../../docs/adr/0021-story-key-facts-and-time-range-v1.md) 冻结；切片定义见 README「实施切片 4」。worktree `.worktree/t10-story-representation`、分支 `feat/t10-story-representation`、base `085c217`（经维护者 2026-09-16 批准）。
- 实现（域 + 持久化 + 合同 + API + transport）：`StoryTimeRange`/`StoryKeyFact` 类型与共用归一化 `normalizeStoryRepresentation`（指纹与持久化同一份归一化，ADR-0021 决定 4）；`StoryRevision` 加 `timeRangeJson`/`keyFactsJson` 两个可空列 + forward-only migration `20260916120000_story_representation_v1`（不回填）；`updateStoryRevision`/`splitStory` 写入与 `story()` 投影；contracts 新增 `storyTimeRangeSchema`/`storyKeyFactSchema`（复用 `temporalValueSchema`，上限 20 条 / 500 字，`end < start` 拒绝）并扩展更新命令、split 后继与 `StoryDetail`；API 与 transport 透传。
- 分工与偏差：后端切片由实施代理完成，**代理未返回报告**，由 leader 逐项复核（非接受其自述）。复核发现并处理三处：① worktree 的 `bun.lock` 因 `bun install` 被写入 `configVersion: 0`，与本切片无关，已 `git checkout -- bun.lock` 还原；② 新增公共导出使 `packages/contracts/entry-surface.txt` 守卫失败，按入口治理规则显式重生成（diff 仅新增 `type StoryKeyFact`、`type StoryTimeRange`、`value storyKeyFactSchema`、`value storyTimeRangeSchema`；application 与 transport-http 的导出面未变）；③ 代理未补存储层行为测试，由 leader 新增 `packages/storage-prisma/src/story-representation.test.ts`（2 例）并在 `story-split.test.ts` 既有拆分用例上补「后继各自带自己的表示、壳的值不被复制」断言。
- 关键护栏（独立复算，非信任实现）：`packages/domain/src/index.test.ts` 中 6 个「扩展字段为空时指纹与升级前逐字节相同」的期望值，由 leader 用独立的 node:crypto 脚本按旧算法 `sha256(JSON.stringify({title,summary,kind,subtype}))` 重算，6/6 一致；存储侧另有一份不 import domain 的同类护栏（`story-representation.test.ts` 的 `preExtensionFingerprint`）。
- 验证（2026-09-16，worktree 内实际运行）：
  - `bunx vitest run packages/domain packages/contracts` → **12 文件 / 83 用例全绿**（重生成导出面快照后复跑；重生成前 1 例失败，即导出面守卫）。
  - `bunx vitest run --no-file-parallelism packages/storage-prisma/src/story-representation.test.ts packages/storage-prisma/src/story-split.test.ts packages/storage-prisma/src/story-orchestration.test.ts` → **3 文件 / 8 用例全绿**（含「pre-extension Revision 不改内容仍 no-op」「改 / 重复提交 / 清空各产生一次新版本并落库」「拆分后继各自带自己的表示」）。
  - `bun run typecheck` 全仓 → **exit 0**。
- 未运行（本节仅覆盖后端切片）：全量 `bun run test`、`bun run build`、`bun run lint:web`、浏览器 E2E、Node 进程 E2E、Docker/Compose、真实来源验收。Web 切片、全量门禁与 `docs/spec` 同步的证据记在下一节。

## 2026-09-16：追加切片「Story 表示扩展字段 v1」——Web 切片、全量门禁与浏览器验收

- Web 切片（实施代理完成，leader 复核）：新增 `apps/web/src/lib/story-time-range-draft.ts`（表单 ↔ `StoryTimeRange` 映射：准确时刻 / 只有原文 + 天月年精度 / 未定；`end < start` 与「有 end 无 start」在前端拦下，后端仍会拒）、`story-event-time.ts`（显示口径：有准确时刻按本地分钟显示，只有原文则显示原文 + 「不精确」，出处找不到显示「出处已删除」）、`story-panel/representation-form.tsx` 与 `representation.tsx`（表单与详情两块）、组件实验室新场景；`story-panel.tsx` / `story-actions.tsx` / `use-story-workspace.ts` / `page.tsx` 接入全量提交与出处候选；`apps/api/src/app.controller.story-domain.test.ts` 增加 `timeRange`/`keyFacts` 透传断言（含「省略 → null / 空数组」）。
- leader 超出代理报告的整理（三处，均为治理或护栏需要）：① 新浏览器用例原本追加在 `e2e/browser/phase2-organization.spec.ts`，该文件既在体积警戒区（32.6 KB）又是登记在案的间歇失败文件，追加后涨到 39.6 KB；已把它拆成独立文件 `e2e/browser/story-representation.spec.ts`（8.7 KB），原文件逐字节回到 HEAD 状态（`git diff` 为空）。② 存储层行为测试由 leader 补写（代理未写）。③ worktree 的 `bun.lock` 因 `bun install` 被写入 `configVersion`，已还原。
- 验证（2026-09-16，worktree 内实际运行）：
  - `bun run typecheck` → **exit 0**。
  - `bun run test` → **93 文件 / 563 用例全绿**（本轮未出现既有的 Windows SQLite 抖动）。
  - `bun run lint:web` → **0 error，83 warning**（均为既有告警；本次改动文件 0 warning；总数比改动前少 5 条，因为顺带清掉了改动文件里原本未使用的 import/props）。
  - `bun run build`（packages + api + worker + Next standalone）→ **通过**（由 Web 代理在最终代码状态下运行；leader 未重跑，理由：其后只有测试文件改动，不属于 build 输入）。
  - 浏览器整套：**20/21**，失败的正是 [`docs/testing/known-unstable-cases.md`](../../../docs/testing/known-unstable-cases.md) 登记的拆分场景 `splits a Story into successors and keeps a historical shell`。诊断：单跑复现失败 1 次、再单跑通过；合计本轮 3 次运行 2 失败 1 通过。失败现场是测试用 API 直读拿到的仍是「迁移写入之前」的状态（撤销那一步期望状态在壳上、实际仍在后继），与登记条目里**未排除**的假设「某次写入晚于读取才落库 / 某个连接看到了提交前的视图」一致。**本轮不能证明该失败与本次改动无关，也不能证明相关**；本次改动让面板多了一个表单与一次取数，可能加剧原有抖动，但没有证据支持因果。
  - 新增浏览器用例 `e2e/browser/story-representation.spec.ts`：单跑 **1 passed**（覆盖填时间范围 + 两条事实 → 顺序保持 → 刷新后仍在 → 重复提交版本指针不动 → 换成「只有原文」后按原文 + 不精确显示 → 再提交仍 no-op）。组件实验室 `story-panel` 场景单跑 **1 passed**（代理运行）。
  - `bun run docs:check`（worktree 内，含 `docs/spec` 同步后）→ **645 文件 `failures=[]`**；`git diff --check` → exit 0。
  - `docs/spec` 同步（代理完成，leader 复核）：`domain/0001`、`contracts/0001`、`storage/0001`、`interfaces/0002`、`interfaces/0005` 与 `docs/testing/README.md` 六个文件按**实现实际行为**补齐（含「扩展为空时指纹与升级前逐字节相同且不回填」「空扩展序列化为 NULL，所以既有 Story 的编辑仍是 no-op」「entryId 不校验存在性、悬空出处由读取侧降级」）。
- 两处需要维护者裁定的事项（本轮未自行改合同）：
  1. **Proposal 与实现的偏差**：Proposal 附录写 keyFacts 的 `entryId`「必须存在（不存在按现有错误映射 404/400）」，**实现未做该校验**——仓储原样落库、原样投影，只有 Web 在候选列表找不到该 id 时显示「出处已删除」。ADR-0021 决定 3 未要求写入时校验，故 `docs/spec` 按实际行为记录；是否补写入校验（或反向修正 ADR/Proposal 措辞）待维护者决定。
  2. **文档治理天花板**：`docs/spec/domain/0001`（8986 token / 9000 上限）与 `docs/testing/README.md`（8963 token）都是**未登记**文件，越过即可触发 CI 违规，本次同步被迫压缩（放弃 domain 的重建验收第 16 条与 `StoryTimeRange`/`StoryKeyFact` 独立定义段）。要完整展开需先拆分或把这两个文件登记进 `docs/doc-governance/docs-baseline.json`。
- 既有欠账（本切片未改）：`docs/spec/contracts/0001` 的实现锚点仍引用已不存在的 `packages/contracts/src/index.test.ts`（contracts 已拆成 story.ts/topic.ts 等分册），该节测试覆盖描述也与现状不符。
- 未运行（本切片整体）：`bun run test:property`（独立配置，未单独运行）、Node 进程 E2E、Windows Node smoke、Docker/Compose、发布部署、真实来源联网验收。
- 未做（需维护者授权）：commit、push、合并 `master`、清理 worktree 与分支。

## 2026-09-16：合并与推送（切片 4）

- 维护者手动验收：四件事全部通过——准确时刻按本地时间显示、原文模式显示「不精确」、关键事实顺序与出处正确、重复保存后版本不变。这是本切片 UI 行为第一次经过真人确认（自动化用例只覆盖到同一批断言）。
- 提交：worktree 分支提交 `545f9f4`（36 文件：代码 + `docs/spec` + `docs/testing` + 两个新 e2e 用例）；主工作区流程文档提交 `7661f93`（ADR-0021/0022、两份 Proposal、PRD §7.5/§7.4 注记、Task 10/26、治理基线增补、PROJECT-STATUS）。
- 合并与推送：`--no-ff` 合入 master `6809c0b` 并推送 `origin`（`085c217..6809c0b`）。核对 `git diff 545f9f4 HEAD -- packages apps e2e docs/spec docs/testing` 为 **0 行**，即 master 上的切片文件与跑过全部门禁的分支尖端逐字节一致，因此分支上的 typecheck / 全量单测 / build / lint / 浏览器结论对 master 成立。
- master 上实际重跑的门禁：`bun run docs:check` **658 文件 0 失败**；`git diff --check` 干净。未在 master 重跑 typecheck / 全量单测 / build（主工作区未安装依赖），依据是上面的逐字节一致。
- **远端 CI 没有结论**：`gh` 核验显示 master 最近一次运行停留在 2026-09-09，此后的推送（含 Task 14 合并与本切片）**没有产生运行记录**，而工作流 `CI` 状态为 active。不能声称本切片过了远端 CI；这是仓库当前状态，不是本切片引入。
- 未做：worktree `.worktree/t10-story-representation` 与分支 `feat/t10-story-representation` 保留（删除需另行授权）；`.agents/learning/` 仍未纳管。
