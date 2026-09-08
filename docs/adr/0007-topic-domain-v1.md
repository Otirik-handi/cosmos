# ADR-0007：Topic 域模型 v1（Topic 版本化、Membership revision 与人工 merge）

> 状态：Accepted design contract
>
> 日期：2026-09-08
>
> 关联：[`topic-domain-v1 Proposal`](../proposals/topic-domain-v1.md)、信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §5、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ORG-002/006/008/009/012/015/016/020、ADR [`0006`](0006-story-domain-v1.md)（Story 域模型 v1，本切片复用其模式）

## Context

Task 10（Story 域模型 v1）已交付多成员 Story：多 Entry 主归属、版本化 `StoryRevision`、merge canonical/alias 与 Product API 编排命令。PRD §9.2 要求“用户能按来源、分类、时间、全文和 Topic 浏览”，示例验收句是“创建/关注一个 Topic，把多个 Story 组织在一起”；ORG-008 规定 Topic、Workspace、Spotlight、Feed 等上层体验以 Story 为内容单位。信息模型 §5 已冻结 Topic 语义（最小语义、六个成员角色、单一当前角色 + revision history、按成员来源区分的移除权限），但当前 schema 没有任何 Topic 相关模型。

2026-09-08 用户对齐：Phase 2 下一切片 = Topic/Topic Membership，Entity/关系不进本切片；评审接受四项默认建议（见 Decision）。本文沉淀这些稳定决定。

## Decision

### 1. Topic 自身走不可变 `TopicRevision`

Topic 的 title、purpose、scope 走不可变 Revision：确定性 fingerprint、展示字段实质变化才追加 revision、无实质变化的更新命令 no-op、当前指针指向当前表示。与 `StoryRevision`（ADR-0006 第 3 条）同构，避免 Topic 修改语义与 Story 分叉，同时满足信息模型 §5.2 的“revision 与协作历史”和 PRD NFR-003 的可追溯要求。

### 2. Membership 用“当前关系表 + 不可变 revision 链”

一个 `(Topic, Story)` 组合只有一个当前成员角色，由当前关系表 + 唯一当前指针表达；纳入、移除、角色变更都追加不可变 `TopicMembershipRevision`（role、reason、actor、tombstone 标记、可选关联 Run）。移除是可恢复的 tombstone revision，v1 不保存并列 assertion。成员角色使用 §5.2 六个受管枚举 `core`/`update`/`background`/`analysis`/`counterpoint`/`tutorial`，未知值读取时降级展示（同 Story subtype 模式）。

### 3. Topic merge 进 v1，canonical/alias + 成员去重迁移

merge 是 v1 最小编排的一部分：指定 canonical 与 obsolete Topic；obsolete 成员迁入 canonical——`(canonical, story)` 已有当前成员时保留 canonical 当前角色，obsolete 独有成员原样迁入并保留其 role/reason/actor；obsolete Topic 保留为 alias/redirect，历史 revision 与 membership history 不删除。复用 `StoryAlias`（ADR-0006 第 5 条）模式。

### 4. Story merge 同步迁移 membership（ORG-020 merge 侧语义）

Task 10 已交付的 `mergeStories` 在 Topic 存在后必须在同一事务内把指向 obsolete Story 的 membership 迁移到 canonical（按 §4.6 的去重规则），否则 `(topicId, storyId)` 唯一约束会在 alias ID 上出现重复成员。该扩展进入本切片 storage 范围并补行为测试。

### 5. 人工 command 路径；自动路径后置

Topic 编排是单机本地事务 + 审计、无外部副作用，以“Product API command → Application command → repository 事务 → 审计/领域事件”落地，不新增 durable Workflow/Action 类型。Agent 自动创建/维护（ORG-007 Phase 3）、`TopicMaintenanceBinding`、`TopicRelation`/父子层级（ORG-015）、归档与 Spotlight/Board/Subscription 后置。Web 成员添加入口从 Story 侧发起（Story 面板“加入 Topic/创建 Topic”），规避 UI 不展示 Story ID 的可用性障碍。

## Consequences

### Positive

- Phase 2 的 Topic 浏览第一次有承载对象：用户能把多个 Story 组织进同一 Topic，成员按角色分组并保留纳入理由与 actor 历史。
- 契约改动边界清晰：先动 domain/storage/contracts/API，UI 只做最小 Topic 详情 + 从 Story 侧发起的成员操作。
- 复用 ADR-0006 已验证的 Revision/alias/command 模式，实现与测试形态一致，不引入第二套写入语义。
- Story merge 的 membership 迁移补齐后，`(topicId, storyId)` 唯一约束在 canonical 上成立，不产生 alias 侧重复成员。

### Costs and risks

- v1 只有人工创建与人工成员编排，在 Agent 自动维护上线前没有“系统自动把新 Story 加入 Topic”体验；这是接受的顺序取舍。
- TopicRevision + MembershipRevision 两张不可变表带来额外读写成本；但都与 Story 同构，长期一致。
- 已 merge 的 Topic 不可简单撤销（撤销=补偿操作）；v1 依赖 alias/redirect 查询稳定。

## Alternatives considered

### Topic 字段直接更新 + 审计事件，不建 `TopicRevision`

拒绝。与 Story 修改语义分叉，日后补版本化需二次迁移；信息模型 §5.2 与 NFR-003 已要求 Topic 保留 revision/协作历史，直接同构 Story 成本更低、更一致。

### 成员角色使用自由文本

拒绝。自由文本无法稳定分组/校验，Topic 页无法按角色结构化展示；§5.2 已给出受管角色表。

### Membership 只建 append-only 事件表，不建当前关系表

拒绝。Topic 详情的主路径是查询当前成员，需要 O(1) 当前投影；历史只在追溯时读取，用“当前关系 + revision 链”比全量重放更简单。

### Topic merge 后置

拒绝。Topic 无创建门槛，重复 Topic 会自然出现，需要归并；ORG-012 是 Phase 2，且 StoryAlias 模式可直接复用。

### Web 在 Topic 页搜索 Story 添加成员

拒绝。需要 Story 搜索选择器并先解决 Story ID 展示问题；从 Story 侧发起（Story 面板选择已有 Topic）绕开该障碍，与 Task 10 收尾的 follow-up 一致。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 开始 Agent 自动创建/维护 Topic 切片（ORG-007/018），需要定义自动 Proposal 写入 membership 与移除建议的 actor/接受边界；
- 引入 `TopicRelation`/父子层级、归档或 Spotlight/Board/Subscription，需要扩展 Topic 的语义与关系边界；
- 设计 Story/Topic split（ORG-014/020 split 侧），需要与 merge 统一 canonical/alias/历史壳与 membership 迁移语义；
- 多用户协作需要细粒度权限，改变 actor/revision 边界。
