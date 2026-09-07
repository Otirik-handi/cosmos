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
