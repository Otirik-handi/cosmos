# ADR-0011：Entry↔Story 证据关系 v1（evidence_for / mentions）

> 状态：Accepted design contract
>
> 日期：2026-09-09
>
> 关联：[`evidence-for-mentions-v1 Proposal`](../proposals/evidence-for-mentions-v1.md)、信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §4.4/§4.5/§9/§11、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ORG-005/011/022、ADR [`0006`](0006-story-domain-v1.md)（主归属单外键、跨 Story 引用后置）与 [`0008`](0008-entity-relation-v1.md)（当前关系 + provenance 模式、Revisit Gate 触发项）

## Context

ORG-011 要求一个 Entry 只有一个主 Story，但可以通过 `evidence_for`/`mentions` 关联多个其它 Story；信息模型 §4.4 给出目标形态（长文属于 document Story，同时作为多个 event Story 的证据），§9 把这条边画成虚线相关关系，与实线主归属分开。ADR-0006 决定 5 明确主归属用单外键表达、跨 Story 引用“真正需要时再引入独立关联”。

当前实现只有 `Entry.storyId` 主归属：一篇同时讨论两个事件的长文只能属于它的 document Story，两个 event Story 的详情看不到它作为证据；ORG-005（背景材料不得误入 event Story 成员）与 ORG-022（证据关系）因此没有落点。

2026-09-09 用户评审接受 [`evidence-for-mentions-v1`](../proposals/evidence-for-mentions-v1.md) 的六项默认建议。本文沉淀这些稳定决定。

## Decision

### 1. `(entryId, storyId)` 唯一，一关系一语义

一条当前关系表达“该 Entry 与目标 Story 的辅助关系”，关系类型受管枚举 `evidence_for`/`mentions`，同一对 Entry/Story 只保留一个语义；改类型是覆盖写（命令幂等），不并存两条冲突语义的关系。`Entry.storyId` 仍是唯一主归属真相，不新建并行 membership 表。

### 2. 关系挂 Entry 稳定身份，不锁 Revision

证据关系指向 Entry 的内容身份，不固定某次 `EntryRevision`。需要“固定当时版本”时后续加可空 `targetRevisionId`（与 Annotation 同形），v1 不做。辅助关系字段先只保留 `evidence` 文本依据，文本片段字符级锚点后置。

### 3. 禁止指向自己的主 Story

`storyId === entry.storyId` 的写入返回 409 conflict：同一 Story 的主归属已经表达该语义，重复关联会让“成员”与“证据”两套语义互相污染。

### 4. merge 重定向、move 删除冗余

`mergeStories` 在同一事务内把指向 obsolete Story 的关系重定向到 canonical，`(entryId, storyId)` 冲突时丢弃 obsolete 侧（与 `SpotlightPlacement`/`StoryEntity` 同规则）；`moveEntryToStory` 改变主归属后删除指向新主 Story 的关系，保持决定 3 的不变量。两者都写领域事件。

### 5. 手动优先，自动抽取后置

v1 只由人工命令写入（`producer` 固定 `human` 语义，记录 actor/reason）。ORG-021 的自动抽取/提议流后置；provenance 字段（producer/producerVersion/confidence/evidence）已就位，自动路径落地时无需迁移即可复用同一表与同一 domain 语义。编排走“Product API command → Application 命令 → repository 事务 → 领域事件”，不新增 durable Workflow/Action 类型。

### 6. 读取投影

`StoryDetail` 返回「证据来源」列表（条目 id、来源、标题、关系类型、provenance），`EntryDetail` 返回「关联 Story」列表（Story id、标题、关系类型）。两者由同一张表投影，均为向后兼容新增字段。

## Consequences

### Positive

- 一篇长文可以同时是多个 event Story 的证据，ORG-005 与 ORG-022 有了数据落点；event Story 详情能区分“本 Story 的成员”与“外部证据条目”。
- 复用 ADR-0008 的「当前关系 + provenance」形态，实现与测试形态一致，不引入第二套写入语义。
- provenance 字段前瞻兼容自动抽取，无需二次迁移。

### Costs and risks

- 一次 merge 需要在同一事务里多处理一张表；冲突丢弃规则必须与既有关系表一致，否则会留下悬空或重复关系。
- v1 没有自动抽取，用户需要手工建立证据关系；这是接受的顺序取舍。
- Web 反向视图只在 Story 面板的成员列表内展示（来自 `EntryDetail.relatedStories`），没有独立的 Entry 详情页。

## Alternatives considered

### 用 `(entryId, storyId, relationType)` 唯一，允许同一对并存两种关系

拒绝。同一对 Entry/Story 同时是“证据”和“提及”没有可解释的产品语义，且会让读取投影出现并列的当前关系断言；改类型用覆盖写更简单。

### 关系锁 Entry Revision

拒绝。证据指向内容身份；锁 Revision 会在每次来源修订后让关系失效或需要迁移，收益不足。需要时再按 Annotation 的可空 `targetRevisionId` 形态追加。

### 允许 Entry 关联自己的主 Story

拒绝。主归属已表达该语义，重复关联会让“成员”和“证据”两套语义混淆，并让 merge/move 的一致性规则复杂化。

### 用 Story↔Story 关系表达“同一篇文章是某事件的证据”

拒绝。语义不同：证据的主体是 Entry（信息条目），Story↔Story 的 `followed_by`/`background_for` 表达事件之间的关系（信息模型 §4.5），两者是独立切片。

### 自动抽取进 v1

拒绝。依赖 Knowledge Workflow（ORG-021）与 LLM/Agent，超出本切片范围；provenance 字段已预留。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 开始 Knowledge Workflow/自动抽取（ORG-021），需要定义自动关系写入的 actor/接受边界与“人工修正不被重分析覆盖”的落地语义；
- 实现 Story split（ORG-014/020），需要定义证据关系在 split 时是否随成员迁移、以及历史壳上的关系如何处理；
- 需要“证据固定当时 Revision”或正文片段字符级锚点，需要为关系追加 `targetRevisionId`/锚点字段；
- Story↔Story 类型化关系（信息模型 §4.5）开始设计，需要与 Entry↔Story 证据关系的边界统一。
