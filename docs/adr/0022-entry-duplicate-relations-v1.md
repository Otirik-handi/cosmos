# ADR-0022：Entry 跨来源重复/转载关系 v1（duplicate_of / syndicated_from / near_duplicate_of）

> 状态：Accepted design contract
>
> 日期：2026-09-16
>
> 关联：Proposal [`entry-duplicate-relations-v1`](../proposals/entry-duplicate-relations-v1.md)、信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §4.1/§4.2/§9、总体架构 [`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §5、ADR [`0008`](0008-entity-relation-v1.md)（类型化关系 + provenance 形态）、[`0011`](0011-entry-story-evidence-v1.md)（当前关系一语义、自关联拒绝）、[`0006`](0006-story-domain-v1.md)（主归属单外键）、PRD [`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ING-006

## Context

ING-006 把跨来源关系拆成两件事：**建立关系**，以及**不粗暴合并来源身份**。当前只有后半句有落点（保留各自 Entry）：

- 「归入同一 Story」已由人工编排覆盖（ADR-0006/0011）；
- 「标记重复/转载」**完全没有实现**——仓库里没有任何 Entry↔Entry 关系；既有的 `duplicateObservation` 是同一来源重复轮询的去重标记（ING-005），`reposts` 是内容指标里的数字，都不是跨来源关系；
- 后果：同一篇稿件在不同平台的转载在信息库里互不相关，用户看不到传播路径与同源关系，Phase 3 的自动判定也无处写入、只能重新定义一遍。

信息模型 §4.2 已经冻结关系词与候选信号（规范化标题、正文指纹/SimHash/MinHash、大段文本重合、canonical 引用链），并明确「转载关系不应把来源折叠掉」。2026-09-16 用户接受 Proposal 的六项默认建议与四项开放项裁定。本文沉淀这些稳定决定。

## Decision

### 1. 关系族只有三个词，取自信息模型 §4.2

| 关系 | 语义 | 方向 |
| --- | --- | --- |
| `duplicate_of` | 同一外部对象 / 同一篇稿件的完全重复 | 对称 |
| `syndicated_from` | 后发平台转载自原发 | 有向：`from` = 转载方，`to` = 原发方 |
| `near_duplicate_of` | 摘编、改写、翻译等近重复 | 对称 |

不发明新词（翻译暂用近重复表达）；受管枚举 + 未知值降级读取，沿用既有枚举模式。

### 2. 一张关系表，一对条目一个当前语义

`EntryRelation`：`fromEntryId`、`toEntryId`、`relationType` + provenance（`producer`/`producerVersion`/`confidence`/`evidence`/`actorJson`/`reason`）+ 时间戳，唯一键为 `(fromEntryId, toEntryId)`。

同一对条目只保留一个语义，改类型是覆盖写、命令幂等——与 ADR-0011「一关系一语义」一致，避免详情页出现并列的当前断言。

### 3. 方向归一化

- 对称类型按两个 id 的字典序存放，保证同一对只有一行；读取时两侧都可见，展示为「与 X 重复」。
- 有向类型按语义方向存放；反向重复提交被识别为同一对，返回 409。
- 自关联（`fromEntryId === toEntryId`）返回 409。

### 4. 关系挂条目内容身份，与 Story 归属解耦

`mergeStories`/`splitStory` **不迁移、不修改**这些关系；同一 Story 内出现两条「重复」条目是合法且常见的（官方公告与转载都在同一个 event Story 里）。条目被删除时级联删除关系。

### 5. 只人工写入

v1 只由人工命令写入（`producer` 固定 `human`，记录 actor/reason）。provenance 字段与 ADR-0008/0011 同形，自动路径落地时无需迁移即可复用同一张表与同一 domain 语义；自动判定（标题规范化/指纹/相似度）属 ORG-021。

### 6. v1 只标记与展示，不参与排序、搜索与去重

不改变 Feed 排序、不改变搜索结果、不做「已隐藏重复」的折叠，也不折叠来源身份。Feed 去重与排序属 Phase 4 推荐体系（REC-003/007），现在耦合会同时冻结两侧合同。

### 7. 读取投影

- `EntryDetail` 返回关系列表（关系类型、方向说明、对端条目的标题与来源、provenance）；
- Story 详情的成员行标注「转载自 / 重复于」，**只显示对端条目与来源，不带对端 Story 链接**（避免详情页为标注额外取数）。

### 8. 不做跨 Story 的「同一事件提示」

人工归并已表达「同一 Story」，引用关系（ADR-0011）已表达「佐证/提及」；再加一层提示会与 Phase 3 的自动聚类重复。关系数量不设硬上限，界面折叠显示。

## Consequences

### Positive

- 转载/重复第一次有数据落点，用户能看到同源关系与传播路径的单跳信息，不再重复阅读同一篇稿件。
- 「同一件事」与「同一篇稿子」两个概念分开：Story 管前者，本表管后者，互不阻塞。
- 复用 ADR-0008/0011 的「当前关系 + provenance」形态，实现与测试形态一致，provenance 前瞻兼容自动判定。

### Costs and risks

- 归一化方向是一致性关键点：对称关系必须双边查询命中同一行，否则会出现「A 看到、B 看不到」；必须有行为测试覆盖两个方向。
- v1 没有自动判定，用户需要手工标记重复；这是接受的顺序取舍。
- 不参与 Feed 去重意味着重复内容仍会各占一个位置；这是刻意的（不与 Phase 4 耦合），但用户实际体验上会看到近似重复条目。

## Alternatives considered

### 照抄 `EntityRelation` 的 `(from, to, relationType)` 唯一

拒绝。允许同一对条目并存「重复」与「近重复」，详情页会出现并列的当前断言，与 ADR-0011 的一关系一语义冲突。

### 对称与有向关系分两张表

拒绝。同一对可能在两张表各有一行，需要跨表去重与额外一致性规则，收益不足。

### 在 v1 引入自动相似度判定

拒绝。依赖 ORG-021 的 Knowledge Workflow 与计算依赖，超出本切片范围；provenance 字段已预留。

### 直接合并重复的 Entry

拒绝。违反 ING-006「不粗暴合并来源身份」：来源、链接、发布时间与评论上下文都是内容身份的一部分，合并会破坏「任意条目可回到原始来源」。

### 把「同事件报道」也做成本表的一种关系

拒绝。同一事件已由 Story 归并与证据关系表达；新增 `same_event` 会与 Phase 3 自动聚类重复。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 开始 ORG-021 自动判定，需要定义自动关系的 actor/接受边界与「人工修正不被重分析覆盖」的落地语义；
- Feed 去重或 Phase 4 推荐需要消费重复关系（REC-003/007）；
- 需要传播路径可视化（多跳链条）或新增关系类型（如「翻译」）；
- Story↔Story 类型化关系（信息模型 §4.5）开始设计，需要统一两者边界；
- Annotation 或证据关系引入正文片段字符级锚点，需要本表也支持锚点。
