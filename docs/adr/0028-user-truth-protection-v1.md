# ADR-0028：用户真相保护 v1（写入者身份、整条 Revision 保护与两类降级）

> 状态：Accepted design contract
>
> 日期：2026-09-24
>
> 关联：Proposal [`user-truth-protection-v1`](../proposals/user-truth-protection-v1.md)（accepted）、PRD [`§12` Phase 2 验收第 4 条](../requirements/0002-product-requirements/part-10-12.md)与 [`LIB-003`](../requirements/0002-product-requirements/part-07-1.md)、需求 [`ORG-003/004/019/021/022`](../requirements/0002-product-requirements/part-07-2.md)、信息模型 [`part-02-04.md`](../architecture/0002-information-model/part-02-04.md) §5.4 与不变量 19/22、[`Phase-2-UNDO.md`](../../Phase-2-UNDO.md) 的 P2-1、Task [`04-workflow-runtime`](../../.agents/tasks/04-workflow-runtime/README.md)

## Context

§12 第 4 条要求「重分析不覆盖用户批注和人工关系修正」，LIB-003 要求「重新分析、重新索引或刷新 Artifact 后用户数据不丢失」。`Phase-2-UNDO.md` 把这条记为「无法判定」，理由是 Phase 2 没有自动重分析写入路径。

复核发现这个理由不完整。Knowledge Workflow 确实不存在（`kind: "knowledge"` 只是枚举值），但**已经存在一条自动写入 Story 表示的路径**：ingest 的 Entry→Story 投影。它在来源发布内容修订时无条件改写 `Story.kind`，并用 Entry 的标题/摘要新建 StoryRevision 顶掉 `currentRevisionId`，新 Revision 的时间范围与关键事实落库为 `null`。这条路径不保护人工编辑，也没有任何测试。

同时，九条 ADR 的 Revisit Gate 指向同一个未定义的合同（ADR-0006/0007/0008/0009/0010/0011/0012/0020/0022），措辞都是「需要定义自动写入的 actor/接受边界与『人工修正不被重分析覆盖』的落地语义」。稳定文档里只有意图（信息模型 `part-02-04.md`「人类接受的内容修改可以形成字段级保护」、`PROJECT-STATUS.md`「人类保护字段优先于 Agent 候选 Revision」），没有判据、没有数据、没有测试。

本文冻结「人工真相」的判据与自动写入方的降级规则。字段级保护掩码与候选 Revision 的接受/拒绝界面仍属 ORG-019（Phase 3）。

## Decision

### 1. 判据是写入者身份，落成 `StoryRevision.producer`

`StoryRevision` 新增 `producer String @default("system")`，受管值域 `human` / `system` / `agent`（v1 只写前两个）：

| 写入方 | producer |
| --- | --- |
| `updateStoryRevision`（人工编辑命令） | `human` |
| `splitStory` 的后继 Revision | `human` |
| ingest 的 Entry→Story 投影 | `system` |

**由写入方自己声明，不由调用方传入**。`updateStoryRevisionCommandSchema` 的 `actor` 是可选自由文本显示字段，不能当判据：Web 的人工编辑根本不传它，所以 ingest 与人工编辑落库的 `actorJson` 都是 `null`，两者在数据上不可区分。把 producer 定为服务端按写入方赋值，调用方无法伪装。

默认值是 `system` 而不是 `human`：默认值只应「声称最少」。任何未来忘记声明的写入方默认**不受保护**（即自动方可覆盖），这是有意方向——把自动写入方当人工会让所有既有 Story 停止跟随来源，代价比漏保护一次大。

### 2. 保护粒度 v1 = 整条当前 Revision

规则：**若 Story 当前 Revision 的 `producer = "human"`，自动写入方不得为该 Story 创建新 Revision、不得改 `Story.kind`。**

`kind`/`subtype` 是 Story 本体的显示字段（ADR-0006 决定 3），与人可编辑的表示字段同等对待，因此与 Revision 一起冻结。

字段级保护要求「保留每个字段的 producer」与部分合并语义（信息模型 `part-02-04.md`），那是 ORG-019 的范围。v1 取「宁可不更新，不可覆盖」：代价是人工改过标题后该 Story 的自动投影停更，比丢数据安全。**合同按可扩展写**：未来把判据从「整条 Revision」换成「字段掩码」时，写入方规则不变，只改判据的求值。

### 3. 自动结果按写入方分两类降级

| 类别 | 例子 | 降级方式 |
| --- | --- | --- |
| **确定性投影** | ingest 的 Entry→Story 投影（今天唯一） | **跳过**：不产生自动结果，人工值保持不变，记领域事件 `story.representation_projection_skipped.v1` |
| **派生分析** | Knowledge Workflow（Phase 3）、Agent 候选 Revision | **产生候选 Revision**：不得改 `currentRevisionId`，必须经人工接受才提升 |

两类必须同时冻结，**即使 v1 只实现第一类**。只写「人工优先」四个字，Phase 3 的每个写入方会各自发明降级方式（有的跳过、有的覆盖、有的写一半），这正是 P2-1 要避免的「以未定义行为落地」。

跳过事件只在**投影本来会写入**时记录（指纹不同，或 `kind` 不同）。否则「跳过」是空话，事件会把「什么都没发生」报成一次保护。

### 4. 人工行不可被自动方删除或改写

`producer = "human"` 的关系行（Story↔Entity、Entity↔Entity、Entry↔Story、Entry↔Entry、Topic 成员、Label/Collection/Favorite/Spotlight）**只能由人工命令删除或改写**；自动方只能新增自动行，或对人工行提出移除建议。

这是把 `PROJECT-STATUS.md` 已写的「Agent 对人类确认的 Topic 成员只能提出移除建议」从 Topic 一条**推广为跨对象的统一合同**，并作为 Phase 3 每个自动写入方的验收判据。

**v1 不实现这些守卫**：今天没有任何自动写入方会碰这些行，实现只能被测试调用，属于为空转机制造消费者；且它会改变公共命令语义（谁有权删除），应与第一个真实自动写入方一起设计。

## Consequences

- §12 第 4 条与 LIB-003 第一次有判据、有数据、有回归测试，考验的是**已存在**的自动写入路径，不必等 Knowledge Workflow。
- 人工编辑过的 Story 不再跟随来源更新。这是「人工优先」的定义，但**必须对用户可见**，否则表现为 Story 莫名其妙地陈旧——因此 `StoryDetail.story.producer` 进公开读合同，Story 面板显示「人工已修改 · 自动更新已暂停」。
- 回填是一次性 SQL：存在匹配的 `story.revision_created.v1` 领域事件（payload `storyId` + `revision`）→ `human`，否则保持 `system`。该事件只由命令路径发出（`updateStoryRevision` 与 `splitStory` 的后继），ingest 投影不发，因此判据可靠。**事件被裁剪过的库**对应行回填为 `system`，即历史人工编辑要重新编辑一次才受保护——这是接受的取舍。
- `producer` **不参与** `fingerprintStoryRevision` 的摘要输入：否则升级会在用户没改任何东西时造出假版本。
- 九条 Revisit Gate 的「人工修正不被重分析覆盖」得到统一答案；各自的实现仍随各自自动写入方落地。

## Alternatives rejected

| 方案 | 拒绝理由 |
| --- | --- |
| 复用 `actorJson != null` 作判据 | 今天区分不了人工与自动（两者都是 `null`），且 `actor` 是显示用自由文本，未来 Agent 写入也会填，判据会被污染 |
| 只落合同与测试、不改数据 | 第 4 条仍不能宣布通过；已知的覆盖路径继续在生产上覆盖用户编辑；「人工」仍是不可判定 |
| 完整保护层（全对象守卫 + 候选 Revision + 接受/拒绝界面） | 与 ORG-019（Phase 3）和 PRD 后置决定第 8 条正面重叠，返工风险高，且今天没有消费者 |
| 在 ingest 投影里加「当前 Revision 是人工写的就 return」 | 判据不可机器判定、没说自动结果去哪、不覆盖其它八个真相面——绕过设计，不是保护 |
| 删掉 ingest 投影，Story 表示只允许人工写 | 所有未编辑的 Story 表示会停在首次录入值，来源更新不再反映到 Story；属产品行为变更，超出本决定 |

## Revisit Gate

- 启动 ORG-019 的字段级保护与候选 Revision 接受/拒绝界面时，需要把本决定的判据从「整条 Revision」细化为字段掩码，并评估「全量提交当前表示」（ADR-0021 决定 5）是否仍可行；
- 第一个真实的**派生分析**写入方（Knowledge Workflow）落地时，必须实现决定 3 的第二类降级并补回归测试；
- 第一个会触碰关系行的自动写入方落地时，实现决定 4 的守卫；
- 需要「人工可解除保护」（让某个 Story 重新跟随来源）时，需要新的写命令与界面，本决定不提供。
