# ADR-0012：Story split v1（历史壳 / `replaced_by[]` / 显式关系迁移）

> 状态：Accepted design contract
>
> 日期：2026-09-09
>
> 关联：[`story-split-v1` Proposal](../proposals/story-split-v1.md)、信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §4.6、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ORG-004/014/020/022、ADR [`0006`](0006-story-domain-v1.md)（merge 进 v1、split 后置与 Revisit Gate）、[`0007`](0007-topic-domain-v1.md)、[`0008`](0008-entity-relation-v1.md)、[`0009`](0009-user-organization-v1.md)、[`0010`](0010-board-section-block-v1.md)、[`0011`](0011-entry-story-evidence-v1.md)（Revisit Gate 要求定义证据关系在 split 时的去向）

## Context

Story merge 已可用（ADR-0006），旧 ID 通过 `StoryAlias` 永久重定向到 canonical。split 是方向相反的补偿操作：一次错误的归并或一次把两个事件塞进同一个 Story 的录入，需要拆开。ORG-014 与 ORG-020 已经给出目标形态，信息模型 §4.6 把它写成稳定设计；ADR-0011 的 Revisit Gate 把「split 时证据关系是否随成员迁移、历史壳上的关系如何处理」列为触发项。

2026-09-09 用户评审接受 [`story-split-v1`](../proposals/story-split-v1.md) 的两项裁决：映射范围取「单命令全映射」，`StoryDetail.entry` 放宽为可空。本文沉淀这些稳定决定。

## Decision

### 1. 历史壳由 `StoryReplacement` 关系表表达，状态派生

新增 `StoryReplacement`（`storyId` → `successorStoryId`，`(storyId, successorStoryId)` 唯一、按 `successorStoryId` 建索引、级联到 Story）。旧 Story 保留原 ID、原 Revision 与历史，不写 `StoryAlias`，因此旧 ID 永远解析到自己（历史壳），不会被静默重定向到单一后继。`StoryDetail.story` 新增 `status`（`active`/`split`）与 `replacedBy[]`（后继 id/标题/kind），状态由是否存在后继行派生，不新增 `Story.status` 列，避免第二个真相。

### 2. `StoryDetail.entry` 可空、`entries` 可为空

历史壳可能没有剩余成员，此时没有「代表成员」。`entry` 放宽为可空、`entries` 允许空数组；读取历史壳仍要求它有当前 Revision。这是读侧破坏性放宽，Web 在「历史壳且无成员」时只渲染标题/摘要/后继列表/批注。当前产品单机单用户、无外部客户端，不做双字段兼容过渡。

### 3. split 是单命令 + 显式映射，范围为内容身份关系

`POST /api/v1/stories/:storyId/splits` 一次事务完成：至少 2 个后继，每个后继至少 1 个主成员，并可为每个后继显式指定从历史壳迁移的四组关系——主成员（`entryIds`）、Entry↔Story 证据链接（`evidenceEntryIds`）、Story↔Entity（`entityIds`）、Topic 成员（`topicIds`）。四组 id 必须当前属于历史壳且跨后继不重叠；未列出的关系留在历史壳，保持「未决」。每个后继用给定 title/summary/kind/subtype 建立新 Story 与初始 Revision。同一后继不得既把某 Entry 作为主成员迁入、又把它指向该后继的证据链接迁入（ADR-0011 决策 3）。

理由：ADR-0011 的 Revisit Gate 与 ORG-020 都要求本切片定义辅助关系的去向；若全部留在历史壳，后继会变成没有证据、没有实体、没有 Topic 的空壳。放进同一条显式清单既满足「不自动复制」，也不需要第二个命令。

### 4. 用户状态留在历史壳，v1 不迁移

`Favorite`、`LabelAssignment`、`CollectionItem`、`Annotation`、`SpotlightPlacement` 一律留在历史壳，不自动扇出到后继（信息模型 §4.6）。批量、撤销与确认边界属 PRD 待决定事项 10，本切片不定义。

### 5. 映射审计靠领域事件加关系行本身

写入 `story.split.v1`（历史壳聚合，payload 含每个后继与四组映射 id）与每个后继的 `story.revision_created.v1`；关系行本身指向后继，就是当前真相。不新增映射表，避免与关系行形成第二个真相（merge 侧同样只有事件）。

### 6. 历史壳的写边界

历史壳拒绝 `mergeStories`（作为 canonical 或 obsolete）、`updateStoryRevision` 与再次 `splitStory`，均返回 409；`moveEntryToStory` 允许指向历史壳，作为补偿手段。重复提交同一条 split 命令会因为 id 不再是历史壳的当前关系而返回冲突，天然拒绝重复创建。

## Consequences

### Positive

- ORG-014/020 的 split 语义落地：旧 ID 不再有「指向谁」的歧义，后继成为正常可用的 Story。
- 四类内容身份关系一次事务显式迁移，拆分后不需要用户重做整理；未指定的关系留在壳，不会被伪装。
- 复用既有的「当前关系」形态与领域事件命名，实现与测试形态与 merge 对称。

### Costs and risks

- 一次 split 要在同一事务里创建多个 Story 与 Revision 并改指四张关系表，SQLite 上的写入放大明显；Windows 上必须串行跑 storage 测试。
- 历史壳的 `entry` 可空是读侧破坏性变化，Web 与既有测试需要同步改造。
- 用户状态留在历史壳意味着拆开后收藏/标签/批注不会跟着走；这是接受的保守取舍，显式迁移后置。

## Alternatives considered

### 用 `Story.status` 列表达历史壳

拒绝。状态列与后继关系表会形成两个真相，merge、ingest 与未来归档都要同时维护。

### 旧 ID 写 alias 指向「主要后继」

拒绝。直接违反 ORG-014「不得静默重定向到单一后继」。

### 要求历史壳至少保留一个成员

拒绝。会禁止合法的「两个成员各拆一边」，而历史壳本来就应该允许没有当前成员。

### 最小 split：只映射主成员，辅助关系全部留在壳

备选，未采用。切片更小，但后继失去证据、实体与 Topic，ADR-0011 的 Revisit Gate 与 ORG-020 的迁移语义要再等一片。

### 用户状态迁移命令进 v1

拒绝。批量、撤销与确认边界尚未定义（待决定事项 10）。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 需要用户状态（收藏/标签/收藏夹/批注/Spotlight）的显式迁移、批量与撤销（待决定事项 10）；
- Story Read State 上线后，需要定义 split 后 `updated_since_last_seen` 的投影（待决定事项 9）；
- 自动拆分建议/聚类（ORG-021）开始设计，需要定义自动 split 的 actor、接受边界与人工修正保护；
- Story↔Story 类型化关系（信息模型 §4.5）开始设计，需要与 split 后的历史壳语义统一；
- 需要查询化的「成员拆分历史」（当前只有领域事件），再评估是否新增映射表。
