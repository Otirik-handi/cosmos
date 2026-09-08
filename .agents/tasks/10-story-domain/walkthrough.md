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
