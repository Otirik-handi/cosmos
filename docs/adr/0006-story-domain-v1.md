# ADR-0006：Story 域模型 v1（多 Entry 主归属、版本化 Revision 与人工 merge）

> 状态：Accepted design contract
>
> 日期：2026-09-07
>
> 关联：[`story-domain-v1 Proposal`](../proposals/story-domain-v1.md)、信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md)（Draft v0.12）、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ORG-001/004/011/012/013/017/020/022、Phase 1 Task [`../../.agents/tasks/02-rss-ingestion/README.md`](../../.agents/tasks/02-rss-ingestion/README.md)（已 close）

## Context

Phase 1 交付的 Story 是 ingest 事务内的最小投影：每个 Entry 自动获得专属 Story（id=`story:${entryId}`），`StoryRevision` 无版本号，公共面没有写入口，也没有跨来源归并能力。PRD Phase 2 的完成标准要求“用户能打开一个多来源 Story”；Topic、Board Block、Saved View、Feed 等上层体验都以 Story 为内容单位（ORG-008），因此 Story 必须先成为稳定、可版本化、可人工编排的域对象，后续切片才不会被错误地承担归并语义。

2026-09-07 用户对齐：Phase 1 剩余验收项划线为 Phase 2 后置债；Phase 2 首切片为 Story 域模型；v1 只做显式人工归并，不引入自动聚类/Knowledge Workflow。评审接受三项默认建议（见 Decision）。本文沉淀这些稳定决定。

## Decision

### 1. Story 先成为“可编排内容单元”，自动归并后置

Story 从 ingest 私有的最小投影升级为独立域对象。v1 的实现顺序是：用户显式把 Entry 移入/移出 Story、更新 Story Revision、把两个 Story merge 到 canonical；自动“尝试加入已有 Story”、LLM/确定性 Proposal 与 Knowledge Workflow 一律后置。ingest 保持 Phase 1 行为：新 Entry 自动获得单 Entry Story，不回退。

### 2. 主归属由 `Entry.storyId` 单外键表达，不建并行 membership 真相

一个 Entry 只有一个主 Story（ORG-011 的前半）。主归属继续由 `Entry.storyId` 外键唯一表达，不新建并行 membership 表，避免“两套归属真相”对账。move-entry、merge 等编排动作在单事务内完成并落审计/领域事件。`evidence_for`/`mentions` 跨 Story 引用后置，本切片不表达。

### 3. Story Revision 版本化，展示字段实质变化才递增

`StoryRevision` 增加 revision 编号（`(storyId, revision)` 唯一）与确定性 fingerprint；既有数据的当前 Revision 回填为 revision 1。v1 最小字段集为 title、summary、kind、subtype；title/summary/kind/subtype 任一实质变化才追加 revision，无实质变化的更新命令 no-op。历史 Revision 只追加、可读，`currentRevisionId` 指向当前表示。“关键事实、时间范围、结构化概览”等扩展字段在后续切片补齐。

### 4. kind/subtype 保持受管核心枚举；动态注册表后置

核心 kind 继续使用稳定枚举（event/document/media/thread），subtype 允许 null；未知 subtype 读取时按核心 kind 降级展示（ORG-013 的读取兼容部分）。动态插件 subtype 注册表后置，不建立第二套注册机制。

### 5. Story merge 进 v1，split 后置

merge 是 v1 最小编排的一部分：选择 canonical ID，obsolete Story 的 Entry 主归属全部移到 canonical；旧 Story id 永久保留 alias/redirect，旧 Story 及其历史 Revision 不删除。Story split 的完整生命周期（历史壳 + `replaced_by[]` 多后继 + 状态/Topic membership 迁移）后置为独立切片；v1 不产生需要 split 才能纠正的数据形状。

### 6. 人工编排走 Application command；自动路径未来复用同一 domain 语义

Story 编排是单机本地事务 + 审计、无外部副作用，首版以“Product API command → Application command → repository 事务 → 审计/领域事件”落地，不新增 durable Workflow/Action 类型。未来自动归并/Knowledge Workflow 必须走 Workflow/Proposal，但通过同一 Story domain 语义写入，不复制第二条写入规则。

## Consequences

### Positive

- Phase 2 验收主句（多来源 Story）第一次有承载对象：跨来源 Entry 可归入同一 Story 且各自保留 Entry/Revision/来源证据。
- 契约改动边界清晰：先动 domain/storage/contracts/API 与 Story 详情读取，UI 只做最小多成员展示与操作入口。
- 既有 ingest、Feed、搜索与详情投影保持兼容；旧数据只回填 revision 1，不重写 Entry.storyId。
- 自动聚类与 LLM 写入被明确挡在 v1 外，派生判断不会在人工编辑前进入稳定域对象。

### Costs and risks

- 用户必须手动执行跨来源归并，在自动聚类上线前没有“同一事件自动聚合”体验；这是接受的顺序取舍。
- 已 merge 数据不可简单撤销（撤销=补偿操作）；v1 需要 alias/redirect 查询稳定，避免旧链接失效。
- Story Revision 若 actor/理由缺失，未来升级到多协作者模型时需补迁移；v1 保留可空字段或事件引用作为扩展位。

## Alternatives considered

### 并行 Story membership 表承载主归属与证据引用

拒绝。一个 Entry 一个主 Story 用单外键即可表达；并行表会制造主归属与 evidence_for 两类语义共存的复杂对账。跨 Story 证据引用真正需要时再引入独立关联，不影响本切片。

### 自动聚类/Knowledge Workflow 先行

拒绝。自动判断需要 Proposal、接受/拒绝、actor/证据和预算边界，等于把 Phase 3 的 Knowledge Workflow 提前，且没有稳定 Story 域对象可供写入。先交付人工编排，既满足 Phase 2 验收主句，又为自动路径提供同一写入语义。

### Story split 与 merge 同时进 v1

拒绝。split 需要历史壳、`replaced_by[]`、成员与用户状态迁移，改动面远大于 merge；v1 先保证 merge（日常归并）可用，split 作为独立切片设计，避免一次引入两个高复杂度身份操作。

### 建立动态插件 subtype 注册表

拒绝。当前无插件生态，核心枚举 + null subtype 已覆盖 Phase 2 组织需求；动态注册表在插件切片到来时再设计，不提前创建未消费的注册机制。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 开始自动聚类/Knowledge Workflow 切片，需要定义自动 Proposal 写入 Story 的接受/拒绝与 actor 边界；
- 需要支持一个 Entry 作为证据关联多个其它 Story（`evidence_for`/`mentions`），要重新评估主归属与关联的存储边界；
- 设计 Story split，需要与 merge 统一 canonical/alias/历史壳语义；
- 引入插件 subtype 注册表或多用户协作，需要改变 kind/subtype 或 actor/revision 边界。
