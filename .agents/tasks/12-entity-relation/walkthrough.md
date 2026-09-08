# Task 12 Walkthrough：Entity/关系 v1

## 2026-09-08：切片启动——提案评审与稳定文档落地

- Phase 2 第三切片确定为 Entity/关系 v1（实体本体 + Story↔Entity + Entity↔Entity，手动优先）。
- Proposal [`entity-relation-v1`](../../../docs/proposals/entity-relation-v1.md) 起草并评审；用户接受七项默认建议：
  1. 实体类型枚举 `person`/`organization`/`product`/`project`/`model`/`location` + 未知降级；
  2. Entity 名字走不可变 `EntityRevision`（fingerprint name+type）；
  3. 名称别名用 `EntityAlias` 表、不进 revision 链；
  4. Story↔Entity/Entity↔Entity 用「当前关系 + provenance」而非 revision 链；
  5. 关系类型枚举 `founded`/`works_at`/`located_in`/`produced`/`part_of`/`related_to` + 未知降级；
  6. Entity merge/dedup 后置（本片只做名称别名）；
  7. `evidence_for`/`mentions` 继续后置。
- 稳定文档已同步：PRD §7.5 第三切片注记、信息模型 §9 v1 注记、ADR-0008、ADR 索引、Task 12 README；commit `05f604f`（`docs: record Entity/relation v1 proposal/ADR/Task 12...`，master，未推送）。
- 维护者授权创建 worktree `.worktree/entity-relation` 与分支 `feat/t12-entity-relation`（base `05f604f`）后开工。

## 2026-09-08：实现（三切片一次合入）

维护者授权开工（创建 worktree 与分支）。按依赖顺序实现切片，每层有对应聚焦测试：

**切片 A（domain + contracts）**：

- domain：`entityTypes`/`entityRelationTypes` 受管枚举 + `EntityRevisionContent` + `fingerprintEntityRevision`（name+type 的 SHA-256 指纹）。
- contracts：`entityTypeSchema`/`entityRelationTypeSchema`（写入侧受管枚举）、`entityLinkProvenanceSchema`（写入侧全部 nullish，缺省由 storage 兜底 human/1）、`EntityDetail`/`EntitySummary`/`EntityPage`/`storyEntitySummary` DTO（读取侧 type/relationType 放宽字符串）与 create/update/alias/link/relation 八个命令 schema；**StoryDetail 增加 `entities`（向后兼容新增数组）**。
- 偏差记录：provenance schema 最初用 `.default("human")/.default(1)`，导致 client 调用必须携带 producer/confidence；改为 nullish + storage 兜底，恢复 Topic/Story 命令“可只传核心字段”的形态。

**切片 B（Prisma + application + storage）**：

- Prisma：`Entity`/`EntityRevision`/`EntityAlias`/`StoryEntity`/`EntityRelation` 五张表 + migration `20260908120000_entity_relation_v1`（forward-only、只增不改、无 backfill）；`Story` 加 `storyEntities` 反向关系。
- application：`EntityNotFoundError`/`EntityRevisionConflictError`/`EntityRelationConflictError` + `CosmosRepository` 十个 Entity 方法签名。
- storage：create/update Entity（`baseRevisionId` CAS + fingerprint no-op）、别名 add/remove（重复/缺失 no-op）、`linkStoryEntity`/`unlinkStoryEntity`（幂等 + provenance 兜底）、`createEntityRelation`/`removeEntityRelation`（方向唯一、未知类型/自环 conflict）、`entity`/`listEntities`（详情含 aliases/stories/双向 relations，列表含 storyCount/relationCount）。
- **`mergeStories` 扩展**：同一事务把指向 obsolete Story 的 `StoryEntity` 迁到 canonical（`(canonical, entity)` 已有则删除 duplicate 并写 `story_entity.merged.v1`）——与 ADR-0007 决策 4 的 membership 迁移对称。**偏差记录**：Proposal/ADR-0008 未显式覆盖 Story merge 对 StoryEntity 的迁移；实现按一致性补上并写行为测试（move/collision 两路径），在 Task README 的 Follow-ups 前以偏差记录。
- 行为测试 `entity-relation-domain.test.ts`（5 例）：create/update/alias、link/unlink + Story detail entities、typed relations、Story merge 迁移、list 计数。

**切片 C（transport-http + API + Web）**：

- transport-http：Entity/relation client 十个方法与端点（`/api/v1/entities`、`/entities/:entityId/revisions`、`/aliases`、`/alias-removals`、`/story-entity-links`(+`/removals`)、`/entity-relations`(+`/removals`)）。
- API controller：十一个端点（含 `GET /entities`、`GET /entities/:entityId`）；错误沿用 `sourceCommandError`（not_found→404、conflict→409）。
- Web：新增 `entity-panel.tsx`（名称/类型/别名/关联 Story/关系 + 就地维护，导出类型/关系选项供 StoryPanel 复用）；`story-panel.tsx` 扩展实体区（已关联列表可解除 + 关联已有 Entity + 创建 Entity 并关联）；`page.tsx` 侧栏 Entities 列表 + EntityPanel/StoryPanel 接线 + loadEntities。
- 组件实验室：登记 `entity-panel`（linked/empty 两场景）与 registry.test 公共模块清单；`product-fixtures.tsx` StoryDetail fixture 补 `entities: []`（StoryDetail 加字段后的类型收敛）。

## 验证（2026-09-08，实际运行）

- 聚焦：domain 8、contracts 21（含 entity 2）、transport-http 7（含 entity client 1）、api controller 25（含 entity 4）、storage-prisma `entity-relation-domain` 5、component-lab registry 12 全部通过；`bun run --cwd apps/web tsc --noEmit` 通过；migration 在 fresh 临时库 `migrate deploy` 成功。
- 运行中待补：全仓 `bun run typecheck`、`bun run test`、`bun run build`、`bun run lint:web`、`git diff --check`（见提交前门禁）。
- 未运行：浏览器产品 E2E（Entity/关系流程）、`test:browser:component-lab`、Node 进程 E2E、Windows smoke、Docker/Compose、发布部署（沿用 Phase 2 既有边界，Entity 流程浏览器验收留待后续）。
