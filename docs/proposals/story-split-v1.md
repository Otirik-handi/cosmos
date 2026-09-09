# Proposal：Story split v1（历史壳 + `replaced_by[]` + 显式关系迁移）

> 状态：accepted
>
> 日期：2026-09-09
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) ORG-004、ORG-014、ORG-020、ORG-022
>
> 关联设计：[信息模型 §4.6](../architecture/0002-information-model.md)；ADR [`0006`](../adr/0006-story-domain-v1.md)（merge 进 v1、split 后置）、[`0007`](../adr/0007-topic-domain-v1.md)、[`0008`](../adr/0008-entity-relation-v1.md)、[`0009`](../adr/0009-user-organization-v1.md)、[`0010`](../adr/0010-board-section-block-v1.md)、[`0011`](../adr/0011-entry-story-evidence-v1.md)（Revisit Gate 要求本切片定义证据关系在 split 时的去向）
>
> 关联既有切片：Task 10（Story 域 v1）、Task 16（Entry↔Story 证据关系 v1）

## 1. 问题

Story merge 已经可用：把一个 Story 并进另一个，旧 ID 通过 `StoryAlias` 永久重定向到 canonical。但反向的补偿操作 split 没有落点——当一次错误的归并、或一次 ingest 把两个事件塞进同一个 Story 时，用户无法把 Story 拆开：

- 没有「历史壳」概念，任何改指都会让旧链接指向错误的单一对象；
- 当前关系（主成员、证据链接、Story↔Entity、Topic 成员）没有「拆分时去向」的语义；
- 用户状态（收藏、标签、收藏夹、批注、Spotlight）在拆开后是否扇出没有定义。

ORG-014 与 ORG-020 已经给出目标形态，[信息模型 §4.6](../architecture/0002-information-model.md) 把它写成稳定设计，[ADR-0006](../adr/0006-story-domain-v1.md) 把 split 后置为独立切片，[ADR-0011](../adr/0011-entry-story-evidence-v1.md) 的 Revisit Gate 明确要求「实现 Story split 时定义证据关系是否随成员迁移、历史壳上的关系如何处理」。本 Proposal 回答这些问题。

## 2. 目标与非目标

### 目标（对应 ORG-014/020 的可观察验收）

1. 把一个当前 Story 拆成 2 个或更多后继 Story；旧 Story 保留原 ID 成为历史壳，读取旧 ID 返回「历史壳 + 全部后继」，不被静默重定向到某一个后继。
2. 拆分时对每条当前关系显式指定去向：主成员、Entry↔Story 证据链接、Story↔Entity、Topic 成员。未指定的关系留在历史壳，保持「未决」状态，而不是被伪装成某个后继的关系。
3. 用户状态（收藏、标签、收藏夹、批注、Spotlight）留在历史壳，不自动复制到后继；历史 revision、批注与审计仍可查看。
4. 历史壳不能被继续改写或并掉：`updateStoryRevision`、`mergeStories`、再次 `splitStory` 对历史壳都拒绝。

### 非目标

- 自动聚类与自动建议拆分（ORG-021，依赖 Knowledge Workflow 与 Agent 边界）；
- 用户状态的显式迁移命令、批量与撤销（[待决定事项 10](../requirements/0002-product-requirements.md)）；
- `updated_since_last_seen` 在 split/merge 后的投影（待决定事项 9；Story Read State 尚未实现，本切片不引入）；
- Story↔Story 类型化关系（信息模型 §4.5）；
- 「撤销 split」操作（架构规定撤销通过补偿操作完成，不删除历史）；
- 拆分后的推荐排序、Spotlight 自动策略变化。

## 3. 当前行为与证据

- 旧 ID 的重定向只有 merge 一条路径：`StoryAlias` 加 `resolveCanonicalStoryId`（`packages/storage-prisma/src/index.ts:1830`）。split 只要不写 alias，就天然满足「旧 ID 不静默重定向」。
- `mergeStories`（`packages/storage-prisma/src/index.ts:1976-2299`）在一个事务里迁移 9 类 Story 键关联：`Entry.storyId`、`EntryStoryLink`、`TopicMembership`、`StoryEntity`、`CollectionItem`、`Favorite(targetType=story)`、`LabelAssignment(targetType=story)`、`Annotation(targetType=story)`、`SpotlightPlacement(targetType=story)`。split 必须对同一组关系给出明确的反向语义，否则会留下悬空或语义错误的关系。
- `story()`（`packages/storage-prisma/src/index.ts:2301`）目前要求 Story 至少有一个成员（成员数为 0 时返回 null），并且 `StoryDetail.entry` 取 `entries[0]`（`packages/storage-prisma/src/index.ts:2444`）。历史壳可能没有剩余成员，这两点必须处理。
- Feed 与搜索按 Entry 驱动（`packages/storage-prisma/src/index.ts:1635`、`:1655`），因此不需要为历史壳增加过滤：壳上仍有成员时照常出现，成员全部迁走的壳自然不再出现在 Feed/搜索。
- Web 已有 merge 入口（`apps/web/src/components/cosmos/story-panel.tsx:944`），没有 split 入口；Web 有多处直接读取 `story.entry.*`（`:328`、`:714`、`:897-912`），`entry` 可空会影响这些位置。
- 领域事件按 `<aggregate>.<verb>.v1` 命名（例如 `story.merged.v1`），审计面可以直接复用，不需要新的审计机制。

## 4. 方案

### 决策 1：历史壳用新关系表表达，不新增 Story 状态列

新增 `StoryReplacement` 表：一行表示「历史壳指向一个后继 Story」，字段为 `storyId`、`successorStoryId`、`createdAt`、可空 `actorJson`/`reason`，`(storyId, successorStoryId)` 唯一、按 `successorStoryId` 建索引、两列都级联到 Story。

`StoryDetail.story` 新增两个读取字段：

- `status`：`active` 或 `split`（存在后继行即 `split`）；
- `replacedBy[]`：全部后继的 id、标题与 kind（标题取后继的当前 Revision）。

状态由关系派生，不引入第二个真相；旧 ID 不写 `StoryAlias`。

理由：如果给 `Story` 加 `status` 列，就要在 merge、ingest、未来归档里同时维护状态列和关系表；派生状态让「历史壳」的定义永远等于「存在后继」。

### 决策 2：`StoryDetail.entry` 放宽为可空

历史壳可能没有剩余成员，此时 `entry`（`entries[0]`）不存在。`entry` 改为可空、`entries` 允许空数组；Web 在 `status=split` 且没有成员时渲染历史壳视图（标题、摘要、后继列表、批注、审计），不再渲染成员详情。

这是读侧的破坏性放宽：需要同步 Web 与既有测试。本产品当前是单机单用户、没有外部客户端，按「不为未提出的旧合同保留兼容代码」直接放宽，不做双字段过渡。

### 决策 3：split 是「单命令 + 显式映射」，映射范围限于内容身份关系

新增命令 `POST /api/v1/stories/:storyId/splits`，一次事务完成：

```text
{
  successors: [
    {
      title, summary?, kind, subtype?,
      entryIds: [...],            // 主成员，必填且至少 1 个
      evidenceEntryIds?: [...],   // 从历史壳迁移的 Entry↔Story 证据链接
      entityIds?: [...],          // 从历史壳迁移的 Story↔Entity
      topicIds?: [...]            // 从历史壳迁移的 Topic 成员
    }
  ],
  actor?, reason?
}
```

规则：

- 至少 2 个后继，每个后继至少 1 个主成员——保证后继立即可读，不产生空 Story。
- 四组 id 必须当前分别属于历史壳（主成员 / 证据链接的目标 / Story↔Entity / TopicMembership），且跨后继不重叠；未列出的关系留在历史壳。
- 每个后继用给定的 title/summary/kind/subtype 建立新 Story 与初始 StoryRevision（revision=1），actor/reason 记录为人工编排。
- 校验：同一个后继不能既把某个 Entry 作为主成员迁入、又把它指向该后继的证据链接迁入，否则会违反 ADR-0011 决策 3 的自链接禁止。
- 幂等：重复提交同一条命令会因为「这些 id 已不是历史壳的当前关系」而返回冲突，天然拒绝重复创建；不引入幂等键。

理由（为什么证据、实体、Topic 也进 v1）：ADR-0011 的 Revisit Gate 要求本切片定义证据关系在 split 时的去向；ORG-020 要求 Topic 成员不自动扇出、但可以显式迁移。如果三者全部留在历史壳，后继会变成没有证据、没有实体、没有 Topic 的空壳，等于把用户刚完成的整理作废。放进同一条显式清单既满足「不自动复制」，也不需要第二个命令。

### 决策 4：用户状态留在历史壳，v1 不迁移

`Favorite`、`LabelAssignment`、`CollectionItem`、`Annotation`、`SpotlightPlacement` 一律留在历史壳（§4.6 的保守策略）；用户通过 `replacedBy[]` 进入后继后重新表达偏好。批量与撤销语义属于待决定事项 10，本切片不定义。

### 决策 5：映射的审计靠领域事件加关系行本身，不建第二张映射表

写入一条 `story.split.v1`（历史壳聚合，payload 含每个后继与四组映射 id）以及每个后继的 `story.revision_created.v1`；关系行本身已经指向后继，就是当前真相。不新增 `StorySplitMapping` 表。

理由：映射表会与关系行形成第二个真相；merge 侧也只有事件、没有映射表；现有的 events 读取与 SSE 足以审计。

### 决策 6：历史壳的写边界

- `mergeStories`：历史壳作为 canonical 或 obsolete 都拒绝（不允许把历史并掉）。
- `updateStoryRevision`：对历史壳拒绝（不允许改写历史壳的当前表示）。
- `splitStory`：对历史壳拒绝（已拆分的对象不能再拆）；后继本身可以再拆。
- `moveEntryToStory`：允许指向历史壳，作为补偿手段（把成员搬回去）；与决策 2 的「历史壳可以零成员」不冲突。

## 5. 取舍与备选

| 备选 | 结论 |
| --- | --- |
| 用 `Story.status` 列表达历史壳 | 拒绝：两个真相，merge/ingest/未来归档都要同时维护 |
| 旧 ID 写 alias 指向「主要后继」 | 拒绝：直接违反 ORG-014「不得静默重定向到单一后继」 |
| 要求历史壳至少保留一个成员，从而保持 `entry` 非空 | 拒绝：会禁止合法的「两个成员各拆一边」，而历史壳本来就应该允许没有当前成员 |
| 最小 split：只映射主成员，证据/实体/Topic 全部留在壳 | 备选：切片更小，但后继失去证据、实体和 Topic，ADR-0011 的 Revisit Gate 与 ORG-020 的迁移语义要再等一片；如果希望本片更小可以选它 |
| 把用户状态迁移命令也放进 v1 | 拒绝：待决定事项 10 的批量、撤销与确认边界还没定，先不定义 |

## 6. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：新增 `StoryReplacement` 表（无回填、前向 migration）；split 只新增后继行并改指关系，不删除任何行。
- **接口**：新增 `splitStory` 命令与 `POST /api/v1/stories/:storyId/splits`；`StoryDetail.story` 新增 `status` 与 `replacedBy[]`（向后兼容新增）；`StoryDetail.entry` 由必填放宽为可空（读侧破坏性，见决策 2）。
- **安全与权限**：单机单用户，无变化；actor/reason 沿用既有命令的记录方式。
- **迁移与发布**：在既有 migration 序列末尾追加一个；本切片不修改版本号、不发布、不部署。
- **回滚**：migration 前向，没有数据回滚脚本；split 本身靠补偿操作（`moveEntryToStory`、后续显式迁移命令）修正，不提供「撤销 split」。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- `docs/requirements/0002-product-requirements.md`：新增 Phase 2 第七切片注记。
- `docs/architecture/0002-information-model.md`：§4.6 增加 v1 切片注记（历史壳的读投影、映射范围、用户状态留在壳）。
- `docs/adr/0012-story-split-v1.md`（新）：冻结决策 1–6；同步 ADR 索引，并更新 ADR-0006 与 ADR-0011 的 Revisit Gate 状态。
- `docs/spec/`：contracts（命令 schema、`StoryDetail` 变化）、storage（新表、关系投影、写边界）、interfaces（HTTP 与 Web）、domain（如需生命周期词汇）。
- `.agents/tasks/{新编号}-story-split/README.md`：由维护者分配编号后创建。

## 8. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-09 | 起草，状态 `reviewing`，等待评审 | Agent |
| 2026-09-09 | **接受**：映射范围取「单命令全映射」（主成员 + 证据链接 + Story↔Entity + Topic 成员，用户状态留在历史壳）；接受 `StoryDetail.entry` 放宽为可空 | 用户（评审接受） |
