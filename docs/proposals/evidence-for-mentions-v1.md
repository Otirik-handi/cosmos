# Proposal：Entry↔Story 证据关系 v1（evidence_for / mentions，Phase 2 下一切片）

> 状态：accepted
>
> 日期：2026-09-09
>
> 需求真相源：[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md)（ORG-011、ORG-005、ORG-022、§7.5 首切片注记）与 [`../requirements/0001-original-requirements.md`](../requirements/0001-original-requirements.md)（“Entry 可以通过 evidence_for、mentions 或文本片段关联多个其它 Story”）
>
> 关联：信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §4.4「主 Story 与其它 Story」、§4.5「Related」、§9 关系图、§11 架构不变量；ADR [`0006`](../adr/0006-story-domain-v1.md)（决定 1/5：主归属单外键、跨 Story 引用后置）与 [`0008`](../adr/0008-entity-relation-v1.md)（引入时需与 Story↔Entity 边界统一）；Task 10/12/15 walkthrough [`../../.agents/tasks/10-story-domain/README.md`](../../.agents/tasks/10-story-domain/README.md)、[`../../.agents/tasks/12-entity-relation/README.md`](../../.agents/tasks/12-entity-relation/README.md)、[`../../.agents/tasks/15-phase2-acceptance/README.md`](../../.agents/tasks/15-phase2-acceptance/README.md)

## 问题

PRD ORG-011 要求：一个 Entry 只有一个主 Story，但可以通过 `evidence_for`、`mentions` 或文本片段关联多个其它 Story；验收是“一篇讨论多个事件的文章仍属于 document Story，同时可以作为多个 event Story 的证据”。当前实现只有 `Entry.storyId` 单主归属，跨 Story 的证据关系完全不存在：

- 一篇同时讨论“Jeff Dean 离职”和“Discovery Loop 创立”的长文，只能属于它的 document Story；两个 event Story 的详情看不到它作为证据。
- ORG-005（背景教程/项目材料不得误入 event Story 成员）与 ORG-022（Story 的证据关系）因此没有落点。
- 信息模型 §4.4 已给出目标形态（`Entry → primary Story (document)` + `Entry → evidence_for → 两个 event Story`），§9 关系图里 `E -.->|"evidence_for / mentions"| S` 是虚线相关关系，与实线主归属分开。

ADR-0006 决定 5 明确：主归属用单外键即可表达，“跨 Story 证据引用真正需要时再引入独立关联，不影响本切片”。本 Proposal 就是引入这张独立关联表，并保持主归属唯一真相不变。

## 当前行为与证据

- `packages/storage-prisma/prisma/schema.prisma`：`Entry.storyId` 是唯一主归属外键；已有 `StoryEntity`（Task 12）、`TopicMembership`（Task 11）、`SpotlightPlacement`（Task 14）三种“当前关系 + provenance”模式，可作为同一形态的参照；无任何 Entry↔Story 附加关系表。
- `packages/domain/src/index.ts`：`storyKinds`/`topicMemberRoles`/`entityTypes`/`entityRelationTypes`/`blockTypes` 受管枚举 + 未知值降级读取的模式已存在。
- `packages/contracts/src/index.ts`：`storyDetailSchema` 有 `entry`/`entries`/`entities`/`labels`/`favorited`；`entryDetailSchema` 有 `revisions`/`observations`；无跨 Story 关系字段。
- `packages/storage-prisma/src/index.ts`：`mergeStories` 已在同一事务内迁移 `TopicMembership`/`StoryEntity`/`CollectionItem`/`Favorite`/`LabelAssignment`/`SpotlightPlacement`——新表必须进入同一 merge 事务，否则 merge 后证据关系会指向已归并的旧 Story。
- `apps/web/src/components/cosmos/story-panel.tsx`：已展示来源成员、时间线、相关内容、关联实体与用户组织；没有证据关系入口。
- 相关需求边界已由 PRD 冻结：ORG-011 是本切片核心；ORG-005/ORG-022 依赖它；ORG-021 的自动抽取属 Knowledge Workflow（后置）。

## 目标与非目标

### 目标

1. **Entry↔Story 证据关系**：`(entryId, storyId)` 唯一当前关系，`relationType` 受管枚举 `evidence_for`（该 Entry 是目标 Story 的证据）与 `mentions`（该 Entry 提到目标 Story，但不作为证据）；带 provenance（producer/producerVersion/confidence/evidence/actor/reason），与 StoryEntity 同形。
2. **主归属不变**：`Entry.storyId` 仍是唯一主归属真相；证据关系是附加关联，且不允许指向该 Entry 自己的主 Story（同一 Story 的主归属已表达该语义）。
3. **读取**：Story 详情返回「证据来源」列表（条目 id、来源、标题、关系类型、provenance）；Entry 详情返回「关联 Story」列表（Story id、标题、关系类型）。两者由同一张表投影，均为向后兼容新增字段。
4. **一致性**：`mergeStories` 在同一事务内把指向 obsolete Story 的关系重定向到 canonical（`(entryId, storyId)` 冲突时丢弃 obsolete 侧）；`moveEntryToStory` 改变主归属后删除指向新主 Story 的冗余关系。
5. **Product API 写命令与 Web 最小验证面**（沿用 Task 12 story-entity-links 的形态）。

### 非目标

- 正文片段字符级锚点（ORG-011 的“文本片段”）：与 Annotation 的字符级锚点同批后置，v1 用可选 `evidence` 文本字段表达依据。
- 自动抽取/提议流（ORG-021 的 Knowledge Workflow，依赖 LLM/Agent）。
- Story↔Story 类型化关系（信息模型 §4.5 的 `followed_by`/`background_for`，服务于 REC-008 完整形态，独立切片）。
- Story split 的关系迁移（split 本身尚未实现）。
- Artifact/Workspace 目标、多用户权限、审批 UI、embedding。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke、长时故障恢复。

## 方案与取舍

### 1. 领域与持久化

- 受管枚举 `entryStoryRelationTypes = ["evidence_for", "mentions"]`，写入侧校验、读取侧未知值降级（同既有枚举模式）。
- 新表 `EntryStoryLink`：`id`、`entryId`、`storyId`、`relationType`、`producer`、`producerVersion`、`confidence`、`evidence`、`actorJson`、`reason`、`createdAt`、`updatedAt`；`(entryId, storyId)` 唯一。
- 全新表、无既有数据 backfill、migration forward-only；既有表只加反向关系字段，不改列。

取舍：

- **`(entryId, storyId)` 唯一，而不是 `(entryId, storyId, relationType)`**：同一对 Entry/Story 只保留一个语义，避免“既算证据又算提及”的冲突解释；改类型是覆盖写，命令幂等。
- **关系挂在 Entry 的稳定身份上，不锁 Entry Revision**：证据指向内容身份而非某次修订；若将来需要“固定当时版本”，加可空 `targetRevisionId` 即可（与 Annotation 同形），v1 不做。
- **“当前关系 + provenance”而非 revision 链**：与 StoryEntity/SpotlightPlacement 一致，详情页 O(1) 读取；历史只在审计字段保留 actor/reason 与时间戳。

### 2. 公共边界

- 写命令：`POST /api/v1/entry-story-links`（`entryId` + `storyId` + `relationType` + 可选 `confidence`/`evidence`/`actor`/`reason`，携带幂等键）与 `POST /api/v1/entry-story-links/removals`，沿用 Task 12 `story-entity-links` 的形态。
- 读取扩展：`StoryDetail.evidence`（数组）与 `EntryDetail.relatedStories`（数组），均为向后兼容新增。
- 校验：Entry 与 Story 必须存在（Story 走 canonical 解析）；`storyId === entry.storyId` 返回 409 conflict；`relationType` 写侧受管、读侧放宽；`confidence` 缺省 1.0。

### 3. 一致性与审计

- `mergeStories`：同一事务重定向（冲突丢弃 obsolete 侧，与 `SpotlightPlacement` 同规则），并写领域事件。
- `moveEntryToStory`：主归属变更后删除指向新主 Story 的关系，保持“不指向自己主 Story”的不变量。
- 每次写入记录 actor/reason；`producer` 固定 `human`（v1 手动优先，自动写入落地时无需迁移即可复用同一字段）。

### 4. Web 最小验证面

- Story 面板新增「证据来源」区块：列出证据/提及条目（来源、标题、关系类型、理由），支持解除；添加方式为「从最近条目选择 + 关系类型 + 理由」，用既有 `GET /entries` 拉取候选并排除已是本 Story 成员的条目。
- Story 面板的来源成员列表里，每个成员显示它作为证据关联到的其它 Story（来自 `EntryDetail.relatedStories`），这是反向视图，不额外发请求。
- 组件实验室登记对应场景；生产行为与 API 合同同步进 `docs/spec/`。

## 影响

- **数据**：新增 1 张表 + 1 条 migration；`Entry`/`Story` 增加反向关系字段，不改既有列。
- **公开合同**：contracts 新增关系类型枚举、命令 schema、`StoryDetail.evidence` 与 `EntryDetail.relatedStories`；既有 DTO 字段语义不变。
- **一致性**：`mergeStories`/`moveEntryToStory` 事务扩展；这是本切片风险最高的部分，需要 storage 行为测试覆盖冲突与冗余删除。
- **安全**：本地单用户最大权限沿用；写入口参数白名单化，关系写入记录 actor/reason。
- **迁移/回滚**：migration forward-only；回滚只回退代码路径，已建立的证据关系保留。
- **发布**：本切片不涉及发布与部署（后置债）。

## 验收草案（设计通过后归 Task）

- **domain focused**：关系类型枚举校验与未知值降级。
- **storage/迁移**：fresh + 旧库 upgrade 两态；`(entryId, storyId)` 唯一与并发写入；`mergeStories` 重定向（含冲突丢弃）；`moveEntryToStory` 后冗余关系删除。
- **contracts/API focused**：命令 Zod 校验、自关联 409、canonical 解析、读取投影字段。
- **浏览器**：一篇长文（document Story）作为证据关联到另一个 event Story → event Story 详情「证据来源」出现该条目并标注类型与理由；解除后消失；merge 后关系跟随 canonical；document Story 侧能看到“本条目是哪些 Story 的证据”。
- **明确不运行**：Docker/Compose、发布部署、真实公网长时定时、非 Windows 平台 smoke、长时间故障恢复。

## 对稳定文档的预期改动（接受后执行）

- `docs/requirements/0002-product-requirements.md`：§7.5 增加本切片注记（v1 边界：文本片段锚点、自动抽取、Story↔Story 关系后置）。
- `docs/architecture/0002-information-model.md` §4.4/§9：注记 v1 实现边界。
- `docs/adr/`：新增 ADR-0011 沉淀稳定决定（`(entryId, storyId)` 唯一一关系一语义、关系挂稳定身份、禁止自关联、merge 重定向与 move 冗余删除、手动优先）。
- `docs/spec/`：domain/0001、contracts/0001、storage/0001、interfaces/0002 与 0005 按行为同步；`docs/testing/README.md` 补充测试数据边界。
- 新建 Phase 2 Task（编号待维护者分配）记录实施切片；本 Proposal 状态 reviewing → accepted 前不修改任何代码或稳定文档。

## 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-09 | Phase 2 下一切片选定为 Entry↔Story 证据关系（evidence_for/mentions），排在 Story split 之前：split 的成员与关系迁移需要先有证据关系语义 | 用户 |
| 2026-09-09 | **接受六项默认建议**：`(entryId, storyId)` 唯一、一关系一语义；关系挂 Entry 稳定身份、不锁 Revision；禁止指向自己的主 Story（409）；merge 同事务重定向、move 删除冗余关系；v1 手动优先、自动抽取后置；文本片段锚点与 Story↔Story 关系后置 | 用户（评审接受） |
