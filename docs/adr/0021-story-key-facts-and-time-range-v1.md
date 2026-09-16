# ADR-0021：Story 表示扩展字段 v1（关键事实 + 时间范围）

> 状态：Accepted design contract
>
> 日期：2026-09-16
>
> 关联：Proposal [`story-key-facts-and-time-range-v1`](../proposals/story-key-facts-and-time-range-v1.md)、ADR [`0006`](0006-story-domain-v1.md)（决定 3 的「后续切片补齐」）、[`0012`](0012-story-split-v1.md)（split 后继的 Revision）、信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §4.3/§4.7、PRD [`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ORG-017、Task [`10-story-domain`](../../.agents/tasks/10-story-domain/README.md)

## Context

ORG-017 把 Story 的当前表示定义为标题、摘要、关键事实和时间范围。ADR-0006 决定 3 先把最小字段集冻结为 title/summary/kind/subtype，并明确写「『关键事实、时间范围、结构化概览』等扩展字段在后续切片补齐」；Phase 2 收口时这两项仍未落地，后果是多来源 Story 只能按各来源的发布时间排列（把「转载时间」当成「事件时间」），也没有可逐条引用、可挂出处的当前认识可供上层与 Phase 3 的 Artifact 消费。

2026-09-16 用户接受 Proposal 的六项默认建议，并裁定两个开放项（时间范围不按 kind 限制、关键事实不做「已确认/推测」标记）。本文沉淀这些稳定决定。

## Decision

### 1. Story 的当前表示是四项

标题、摘要、**时间范围**、**关键事实**（kind/subtype 仍在 Story 本体，前者继续按 ADR-0006/0013 受管）。四项都通过不可变 Story Revision 表达，`currentRevisionId` 指向当前被接受的表示。

### 2. 时间范围复用既有时间语义，不新造时间概念

形状为 `timeRange = { start: TemporalValue; end: TemporalValue | null } | null`，直接复用 domain 已有的 `TemporalValue`（`exact` + `exactPrecision` + `fallback`：`raw`/`lowerBound`/`precision`/`timezone`/`confidence`）：

- 「2026 年」按 `year` 精度保存，不会退化成 `2026-01-01`；
- 只有原文（如「昨天下午」）时保留原文、按 `unknown` 精度与 `uncertain` 置信度处理；
- 只有 `start` 表示「起点已知」；两项都空表示未定；`end` 早于 `start` 拒绝。

**不按 kind 限制**：event/document/media/thread 都可填、都可留空——一次发布动作本身就是一个时间点，按类型硬性禁止会挡住合理用法。

### 3. 关键事实是有序清单，每条挂一条出处

形状为 `keyFacts = { text: string; entryId: string | null }[]`：

- **有序**：数组顺序即展示顺序，不引入 `rank` 字段（避免两套顺序真相）；最多 20 条，单条 `text` 最长 500 字；
- **出处**（`entryId`）指向任何存在的条目，**不要求属于本 Story**：一条条目只有一个主归属（ADR-0006 决定 2），若要求「依据必须是本 Story 成员」，用另一 Story 里的内容作依据就变得不可能（那篇文章搬不进来），且成员移出或引用关系解除时会出现「自动删事实」或「悬空出处」两难；
  （2026-09-16 补记：写入侧**不校验**该条目是否存在，只校验形状（trim、长度上限）；指向已删除条目的悬空出处由读取侧降级为「出处已删除」。补一次存在性查询只能提前发现客户端传错 id，而条目随后被删除时出处照样悬空，故不引入；将来若需要更强保证，按 Revisit Gate 重新评估。）
- 界面上默认优先列出本 Story 的条目，找不到再全文搜索；
- **只人工填写**；自动抽取属 ORG-021；
- **不做**「已确认/推测」标记：当前没有自动生成事实的写入者，等 ORG-021 落地时再评估。

### 4. 两项都参与变化判定，且空值必须与升级前判定一致

两项纳入 Story Revision 的确定性 fingerprint：任一实质变化才追加 Revision，内容相同则 no-op（沿用 ADR-0006 决定 3 的口径）。

**兼容约束（本切片最容易出错的一点）**：两项为空时，fingerprint 必须与升级前**逐字节相同**。否则升级后对既有 Story 做一次「什么都没改」的编辑，会因库里存的是旧算法指纹而被判定为「变了」，凭空追加一个 Revision。因此**不做全库指纹回填**，改为让空扩展字段不进入摘要输入，并用「升级前固定输入所对应的期望指纹」作为回归断言钉死。

### 5. 写入沿用「全量提交当前表示」语义

`POST /api/v1/stories/:storyId/revisions` 扩展两个可选字段，**省略即清空**；不引入部分更新，避免同一件事出现两种提交语义。

接受的代价：将来的入口（含 Phase 3 的 Agent 候选 Revision）必须提交完整的当前表示，否则未带上的字段会被清空。若 Phase 3 证明不可行，按 Revisit Gate 重新评估。

### 6. split 后继同批支持，不迁移原值

`splitStory` 的每个后继定义带同名字段，后继的 Revision 一并落地；**不**把原 Story 的这两项复制给后继（后继各自表达自己的时间范围与事实）。「结构化概览」仍留在后续切片。

## Consequences

### Positive

- 看板与详情第一次有「事件发生时间」，不再把转载时间当事件时间；精度语义与 Entry 侧一致，跨 Story 的时间比较有确定口径。
- 多来源 Story 的当前认识可以逐条引用并挂出处，Phase 3 的 Artifact 与报告有可引用字段。
- 复用既有时间语义与 Revision 机制：无新表、无新概念、无数据回填。

### Costs and risks

- fingerprint 的兼容约束是本切片最脆弱的一环，必须有「空值 = 旧指纹」的断言保护，否则升级会在用户没改任何东西时产生假版本。
- 全量提交语义把「忘记带字段 = 清空」的责任交给调用方；Phase 3 的 Agent 写入路径必须显式遵守。
- 「结构化概览」仍未落地，ORG-017 在需求表上的字段集尚未完全闭合（本 ADR 只覆盖其中两项）。

## Alternatives considered

### 时间范围只存一段自由文本

拒绝。无法排序和比较，看板与时间线用不上，等于把问题推给下一个切片。

### 时间范围只存两个 DateTime

拒绝。丢掉精度（「2026 年」退化成 `2026-01-01`），与 Entry 侧已有语义不一致，也无法表达「只有原文、没有准确时间」。

### 关键事实用结构化键值对

拒绝。当前没有消费方（看板与详情只做展示），属于为不存在的消费者提前造 schema。

### 迁移时重算既有 Revision 的 fingerprint

拒绝。Prisma 的 SQL migration 无法计算 hash，需要额外的一次性脚本；用「空值不进摘要输入」就能保持等价，收益不足。

### 要求出处的条目必须属于本 Story

拒绝。见决定 3：一个条目只有一个主归属，这会挡住「用另一 Story 的内容作依据」，并在成员变动时引入悬空规则。

### 独立 `StoryFact` 表

拒绝。历史不可变语义挂在 Revision 上已经成立，独立表需要自己重建版本关系，读取还要额外 join。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- Phase 3 的 Agent 候选 Revision 落地，需要评估「全量提交」是否可行，以及是否需要字段级保护（PRD ORG-019）；
- 关键事实需要「事实/推断」标记、字段级 producer 或一条事实挂多个出处；
- 引入「结构化概览」或跨 Story 的时间对齐；
- 需要按时间范围做看板排序、过滤或提醒。
