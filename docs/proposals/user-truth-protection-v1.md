# Proposal：用户真相保护 v1（重分析与自动写入不覆盖人工结果）

> 状态：accepted
>
> 日期：2026-09-24
>
> 关联需求：[`§12 Phase 2 验收第 4 条`](../requirements/0002-product-requirements/part-10-12.md)（重分析不覆盖用户批注和人工关系修正）、[`LIB-003`](../requirements/0002-product-requirements/part-07-1.md)（重新分析、重新索引或刷新 Artifact 后用户数据不丢失）、[`ORG-003/004/019/021/022`](../requirements/0002-product-requirements/part-07-2.md)、[`ING-013`](../requirements/0002-product-requirements/part-07-1.md)
>
> 关联文档：[`Phase-2-UNDO.md`](../../Phase-2-UNDO.md) 的 P2-1、[`PROJECT-STATUS.md`](../../PROJECT-STATUS.md) 的「Phase 2 尾巴遗留状态」、架构 [`§5.4/§11`](../architecture/0002-information-model.md)、九条 ADR Revisit Gate（[`0006`](../adr/0006-story-domain-v1.md)/[`0007`](../adr/0007-topic-domain-v1.md)/[`0008`](../adr/0008-entity-relation-v1.md)/[`0009`](../adr/0009-user-organization-v1.md)/[`0010`](../adr/0010-board-section-block-v1.md)/[`0011`](../adr/0011-entry-story-evidence-v1.md)/[`0012`](../adr/0012-story-split-v1.md)/[`0020`](../adr/0020-story-split-user-state-migration-v1.md)/[`0022`](../adr/0022-entry-duplicate-relations-v1.md)）、[`准入决策表`](../standards/repository-workflow.md)
>
> 关联 Task：[`04-workflow-runtime`](../../.agents/tasks/04-workflow-runtime/README.md)（本 Proposal 的实现记录落在此 Task）

## 问题

§12 第 4 条验收「重分析不覆盖用户批注和人工关系修正」与 LIB-003「重新分析、重新索引或刷新 Artifact 后用户数据不丢失」是同一件事的两种说法。`Phase-2-UNDO.md` 的 P2-1 把它记为「无法判定」，理由是「Phase 2 里没有任何自动重分析写入路径，所以这条验收只是结构上成立，从未被真正考验」。

**这个理由的前半句对、后半句不成立。** 复核结论：

1. **Knowledge 重分析路径确实不存在**：`kind: "knowledge"` 只是 `actionKindSchema` 的枚举值（[`catalog.ts`](../../packages/application/src/catalog.ts) 第 56 行），注册表里没有对应实现；`docs/proposals/` 30 份 Proposal 里没有 Knowledge Workflow。
2. **但已经存在一条自动写入 Story 表示的路径**：ingest 的 Entry→Story 投影（[`helpers-4.ts`](../../packages/storage-prisma/src/repository/helpers-4.ts) 第 260-304 行）。它在来源发布内容修订时**无条件**改 `Story.kind`，并用 **Entry 的** title/summary 新建 StoryRevision 顶掉 `currentRevisionId`；新 Revision 的 `timeRangeJson`/`keyFactsJson` 未赋值，落库为 `null`。
3. **这条路径不保护人工编辑，也没有测试**。全仓检索不到任何「人工字段保护」「人工修正优先」的实现或测试；唯一的 ingest 测试只断言「显示字段没变时不追加 StoryRevision」（[`repository-ingest.test.ts`](../../packages/storage-prisma/src/repository-ingest.test.ts) 第 186-192 行）。

所以第 4 条验收的真实状态不是「结构上成立、未被考验」，而是**已经有一条会覆盖用户编辑的自动写入路径在生产路径上运行，且无判据、无测试**。这与台账结论方向相反。

同时，**九条 ADR 的 Revisit Gate 指向同一个未定义的合同**，措辞几乎一致（「需要定义自动写入的 actor/接受边界与『人工修正不被重分析覆盖』的落地语义」）：ADR-0006 第 41 行、0007 第 33 行、0008 第 78 行、0009 第 82 行、0010 第 88 行、0011 第 83 行、0012 第 85 行、0020 第 86 行、0022 第 104 行。合同一天不定义，Phase 3 的每个自动写入方就会各自发明降级方式。

## 目标与非目标

### 目标

1. **把「人工真相」变成可机器判定的数据**：明确判据是写入者身份，而不是自由文本。
2. **冻结「自动结果如何降级」的两类合同**：确定性投影跳过、派生分析产生候选 Revision。这是本 Proposal 的核心，也是 Phase 3 Knowledge Workflow 的入口硬前置。
3. **冻结「人工行不可被自动方删除或改写」的跨对象规则**，给九条 Revisit Gate 一个统一答案。
4. **在 Phase 3 之前真正考验第 4 条验收**：以**唯一已存在的自动写入方**（ingest 投影）作第一个消费者，落地保护 + 回归测试，不需要 Knowledge Workflow。
5. **补上 §12 第 4 条与 LIB-003 的判据**，让它们从「无法判定」变成「有合同、有测试、可回归」。

### 非目标

- **不实现** Knowledge Workflow、任何自动重分析、自动聚类、自动 Entity 抽取、自动标签/批注推荐。
- **不实现** 候选 Revision 的数据模型、接受/拒绝界面与字段级保护掩码——那是 ORG-019（Phase 3）与 PRD 后置决定第 8 条的范围。本 Proposal 只冻结它们必须遵守的规则。
- **不实现** 关系表（Story↔Entity、Entity↔Entity、Entry↔Story、Entry↔Entry、Topic 成员、Label/Collection/Favorite/Spotlight）的人工行写入守卫——今天没有自动写入方会碰它们，先实现等于为空转机制造消费者。规则进合同，实现随各自动写入方落地。
- **不改** merge/split 的语义与既有用户状态迁移（[`story-user-state-migration.ts`](../../packages/storage-prisma/src/repository/story-user-state-migration.ts)）——它是目前唯一已落地的「保用户数据」机制，本 Proposal 不推翻它。
- **不改** 需求文字与验收条件（口径更正记勘误台账）。
- **不做** 任何自动重分析触发、调度或后台任务。

## 当前行为与证据

### 会被自动写入影响的用户真相面

| # | 真相面 | 载体 | 今天的自动写入方 | 保护现状 | 证据 |
| --- | --- | --- | --- | --- | --- |
| 1 | **Story 表示**（title/summary/kind/subtype/timeRange/keyFacts） | `StoryRevision`（[`schema.prisma`](../../packages/storage-prisma/prisma/schema.prisma) 第 384-400 行）、`Story`（第 365-382 行） | **有**：ingest 投影 | ❌ 无。`StoryRevision` 没有 `producer` 列 | [`helpers-4.ts`](../../packages/storage-prisma/src/repository/helpers-4.ts) 第 260-304 行；[`stories.ts`](../../packages/storage-prisma/src/repository/stories.ts) 第 96-98 行只有 baseRevision 乐观锁（重读一次即可绕过） |
| 2 | **批注** | `Annotation`（第 670-683 行） | 无 | 部分：`targetRevisionId` 把批注钉在写入时的 Story Revision 上 | [`annotations.ts`](../../packages/storage-prisma/src/repository/annotations.ts) 第 16-25 行；[`story-merge.ts`](../../packages/storage-prisma/src/repository/story-merge.ts) 第 270-280 行；迁移第 190-199 行 |
| 3 | **人工关系修正**（Story↔Entity、Entity↔Entity、Entry↔Story、Entry↔Entry） | 第 536-552、573-590、554-571、595-613 行 | 无 | ❌ 无。有 `producer`（默认 `human`）+ confidence + evidence，但**没有任何写入或删除路径检查 producer** | 删除路径无条件：[`entity-links.ts`](../../packages/storage-prisma/src/repository/entity-links.ts) 第 338-368 行、[`entry-relations.ts`](../../packages/storage-prisma/src/repository/entry-relations.ts) 第 119-158 行；默认值在 entity-links 第 42/148/306 行、entry-relations 第 35 行 |
| 4 | **Story 归并/拆分** | `StoryAlias`（第 402-409 行）、`StoryReplacement`（第 415-427 行） | 无 | 无保护合同；用户状态迁移已实现（唯一先例） | [`story-merge.ts`](../../packages/storage-prisma/src/repository/story-merge.ts) 第 165-318 行；ADR-0012/0020 |
| 5 | **Topic 成员与角色** | `TopicMembership`（第 457-470 行）、`TopicMembershipRevision`（第 472-484 行） | 无 | ❌ 无。角色/理由/actor/tombstone 有 revision 链，但没有「人工优先」写入规则 | [`topics.ts`](../../packages/storage-prisma/src/repository/topics.ts) 第 417 行（移除成员）；ADR-0007 决定 5 |
| 6 | **收藏与标签** | `Favorite`（第 658-666 行）、`LabelAssignment`（第 625-635 行）、`CollectionItem`（第 646-656 行） | 无 | ❌ 无（只有唯一键与 merge/split 迁移） | [`labels.ts`](../../packages/storage-prisma/src/repository/labels.ts) 第 120 行、[`collections.ts`](../../packages/storage-prisma/src/repository/collections.ts) 第 168 行 |
| 7 | **Spotlight 人工固定** | `SpotlightPlacement`（第 748-765 行） | 无（自动 policy 属 Phase 4） | ❌ 无代码保护；架构只写「人工覆盖优先」 | `PROJECT-STATUS.md` 第 109 行；ADR-0010 决定 3 |
| 8 | **看板配置** | `Board`/`BoardSection`/`BoardBlock`（第 703-743 行） | 无 | 无（没有自动写入方计划） | — |
| 9 | **SavedView 条件** | `SavedView`（第 687-698 行） | 无 | 无（重分析不碰查询条件） | — |

### 为什么「人工真相」今天不可判定

| 事实 | 证据 |
| --- | --- |
| `StoryRevision` 没有写入者字段 | `schema.prisma` 第 384-400 行：只有 `fingerprint`/`actorJson`/`reason` |
| `actorJson` 不能当判据：Web 的人工编辑**根本不传 actor** | [`use-story-workspace.ts`](../../apps/web/src/app/home/use-story-workspace.ts) 第 170 行、[`story-panel.tsx`](../../apps/web/src/components/cosmos/story-panel.tsx) 第 283-291 行都不带 `actor` |
| 于是 ingest 与人工编辑落库的 `actorJson` **都是 null** | ingest 不写 actorJson（helpers-4 第 287-297 行）；人工命令的 `actorJson` 由入参决定，Web 未传 |
| 稳定文档只写了意图，没有合同 | [`part-02-04.md`](../architecture/0002-information-model/part-02-04.md) 第 335 行、[`part-12-14.md`](../architecture/0002-information-model/part-12-14.md) 第 94 行、[`0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) 第 156 行、`PROJECT-STATUS.md` 第 107/110 行、[`0006-scenarios-and-conformance.md`](../api/0006-scenarios-and-conformance.md) 第 114 行（S05 验收条件之一，未实现） |
| 全仓无实现、无测试、无 Proposal | 检索 `protect`/`override`/`humanFirst`/`人工优先`（55 处命中全是无关语义）、`candidate`（244 处全是媒体/Job/lease 候选）、`preserve`/`不覆盖`（8 处全是 merge/split 与迁移）；`docs/proposals/` 30 份无相关条目 |

### 迁移设计可用的回填信号（本次复核新增）

| 事实 | 证据 |
| --- | --- |
| `story.revision_created.v1` 只由**命令路径**发出，ingest 投影不发 | 发出点仅两处：[`stories.ts`](../../packages/storage-prisma/src/repository/stories.ts) 第 150 行（`updateStoryRevision`，人工编辑）与第 372 行（`splitStory` 的后继 Revision）；ingest 投影（helpers-4 第 281-304 行）不调用 `appendDomainEvent` |
| 事件 payload 带 `storyId` 与 `revision`，足以按行匹配 | stories.ts 第 153-159 行、第 377-383 行 |
| ingest 另发的是 `feed.updated.v1`，与 Story Revision 无关 | helpers-4 第 359-370 行 |

结论：**「有 `story.revision_created.v1` 事件 → 该 StoryRevision 由命令写入（人工）；无事件 → 由 ingest 投影写入（自动）」** 是一个可靠的一次性回填判据。依赖：DomainEvent 未被裁剪。

### 不确定处（如实列出）

1. 第 1 行的 ingest 覆盖**未运行验证**，全部为从代码推断。最小证明方式是一条红测试（见「方案与取舍」的回归测试 1）。
2. 真人验收脚本在 [`manual-acceptance.md`](../../.agents/tasks/15-phase2-acceptance/manual-acceptance.md) 第 71 行专门问了「批注会不会让你担心下次 Story 更新它就丢了」，但记录表（第 95-101 行）**没有回答这个问题**（只回答了删除 Block 那条）。这条人工证据缺失。
3. 回填信号依赖 DomainEvent 未裁剪；若某个库的事件被裁剪，对应历史行会回填为「自动」，即**历史人工编辑不被保护**，需要重新编辑一次才获得保护。
4. 未运行 `bun run test`、`bun run typecheck`、浏览器与真实来源验收。

## 方案与取舍

### 决定 1：人工真相的判据是「写入者身份」，落成 `StoryRevision.producer` 数据

`StoryRevision` 新增 `producer String @default("system")`，值域受管 `human` / `system` / `agent`（v1 只写前两个）：

| 写入方 | producer | 说明 |
| --- | --- | --- |
| `updateStoryRevision`（人工编辑命令） | `human` | 由写入方自己声明，**不由调用方传入**，避免伪造 |
| `splitStory` 的后继 Revision | `human` | split 是人工动作 |
| ingest 的 Entry→Story 投影 | `system` | 确定性投影 |

**取舍理由**：判据必须由**写入方身份**决定而不是调用方可选参数。今天 `updateStoryRevisionCommandSchema` 的 `actor` 是可选自由文本（[`story.ts`](../../packages/contracts/src/story.ts) 第 147 行），拿它当判据等于让调用方自证，且 Web 根本不传。把 producer 定为「写入方声明 + 服务端赋值」，调用方无法伪装。

**不采用的替代**：复用 `actorJson != null` 作判据。它今天区分不了人工与自动（两者都是 null），且 `actor` 是显示用自由文本，未来 Agent 写入也会填——判据会被污染。

### 决定 2：保护粒度 v1 = 整条当前 Revision；字段级掩码留给 ORG-019

规则：**若 Story 当前 Revision 的 `producer = "human"`，自动写入方不得为该 Story 创建新 Revision、不得改 `Story.kind`。**

**取舍理由**：字段级保护要求「保留每个字段的 producer」（架构 `part-02-04.md` 第 335 行）与部分合并语义，那是 ORG-019（Phase 3）与 PRD 后置决定第 8 条。v1 取「宁可不更新，不可覆盖」，代价是人工改过标题后该 Story 的自动投影停更——这正是「人工优先」的含义，而且停更比丢数据安全。合同写成可扩展：未来把判据从「整条 Revision」换成「字段掩码」时，**写入方规则不变，只改判据求值**。

**待裁定项 1**：是否接受这个粒度（推荐接受），还是提前把字段级掩码一起做。

### 决定 3：自动结果如何降级——按写入方分两类（核心合同）

| 自动写入方类别 | 今天/将来的例子 | 降级方式 |
| --- | --- | --- |
| **确定性投影** | ingest 的 Entry→Story 投影（今天唯一） | **跳过**：不产生任何自动结果，人工值保持不变，记一条领域事件 |
| **派生分析** | Knowledge Workflow（Phase 3）、Agent 候选 Revision | **产生候选 Revision**：不得改 `currentRevisionId`，必须经人工接受才提升 |

**为什么必须现在就分两类**：如果只写「人工优先」四个字，Phase 3 的每个写入方会各自发明降级方式（有的跳过、有的覆盖、有的写一半），这正是 P2-1 要避免的「以未定义行为落地」。两类规则必须同时冻结，**即使 v1 只实现第一类**——因为第一类的消费者已经在跑，而第二类的消费者一旦开始写就没有第二次定义机会。

跳过时记领域事件 `story.representation_projection_skipped.v1`（payload：`storyId`、`entryId`、`currentRevisionId`、`reason`），理由：可观测，且给回归测试一个干净的断言点。

### 决定 4：人工行不可被自动方删除或改写（合同层，跨全部真相面）

规则：`producer = "human"` 的关系行（Story↔Entity、Entity↔Entity、Entry↔Story、Entry↔Entry、Topic 成员、Label/Collection/Favorite/Spotlight）**只能由人工命令删除或改写**；自动方只能新增自动行，或对人工行提出移除建议。

这条与 `PROJECT-STATUS.md` 第 107 行已写的「Agent 对人类确认的 Topic 成员只能提出移除建议」是同一规则，本 Proposal 把它从 Topic 一条**推广为跨对象的统一合同**，并作为 Phase 3 每个自动写入方的验收判据。

**待裁定项 2**：v1 是否顺带实现关系表的人工行守卫（推荐**不实现**，只进合同）。理由：今天没有任何自动写入方会碰这些行，加了守卫只能被测试调用，属于为空转机制造消费者；而且它会改变公共命令语义（谁有权删除），应当与第一个真实自动写入方一起设计。

### 决定 5：实施切片

| 切片 | 交付 | 闭合什么 |
| --- | --- | --- |
| **1** | 决定 1–3：`StoryRevision.producer` + 回填 + ingest 投影的跳过与事件 + 3 条回归测试 | §12 第 4 条与 LIB-003 在**唯一已存在的自动写入路径**上真正被考验 |
| **2**（可选，待裁定项 3） | Web 在 Story 面板显示「此 Story 的表示已由人工修改，自动更新已暂停」+ `StoryDetail` 暴露 producer | 让停更对用户可见，而不是静默行为变化 |
| 后续（不在本片） | 决定 4 的实现 + ORG-019 的候选 Revision 与接受/拒绝界面 | Phase 3 Knowledge Workflow 的写入侧 |

### 回归测试（切片 1 的验收）

| # | 场景 | 断言 |
| --- | --- | --- |
| 1 | 人工编辑 Story 标题/时间范围/关键事实 → 来源发布该 Entry 的内容修订 → 重跑采集 | 人工 Revision 仍是 `currentRevisionId`；标题、时间范围、关键事实逐项未变；`Story.kind` 未被改写；产生一条 `story.representation_projection_skipped.v1` |
| 2 | 人工**未**编辑的 Story → 来源发布该 Entry 的内容修订 → 重跑采集 | 自动投影照常追加 Revision（保护没有把正常路径弄死） |
| 3 | 人工 merge 出多 Entry Story → 成员 Entry 更新 → 重跑采集 | 人工值不被覆盖；被覆盖的 Story 不因 merge 而失去保护 |
| 4（负向） | 直接调用 `updateStoryRevision` 两次 | 两次都写 `producer = "human"`；ingest 投影写的行是 `producer = "system"` |

测试 1 就是「未运行验证」那条的证明方式：**先让它红，再实现保护让它绿**。

## 数据、接口、安全、迁移、发布与回滚影响

### 数据与迁移

一次 migration，非破坏性：

1. **加列**：`StoryRevision.producer String @default("system")`（`system` 是「不声称人工」的保守默认）。
2. **回填**（一次性 SQL，不引入常驻逻辑）：存在匹配的 `story.revision_created.v1` 事件（payload `storyId` + `revision`）→ `human`；否则保持 `system`。
3. **写入侧**：`updateStoryRevision` 与 `splitStory` 显式写 `human`；ingest 投影显式写 `system`。
4. **无 contract 步**：没有旧字段要移除。

**回滚**：停用判据即可，加的是带默认值的新列，回滚不需要删列，也不丢数据。

### 接口

- **contracts**：`StoryRevision.producer` 若进入公开 DTO（切片 2），`storyDetailSchema.story` 增 `producer`（受管值域，读取侧放宽）；`StoryRevisionContent` 的指纹输入**不变**（producer 不参与 fingerprint，否则会造出假版本）。
- **新增领域事件**：`story.representation_projection_skipped.v1`。
- **不新增路由、不新增命令、不改 `updateStoryRevisionCommandSchema`**（producer 由服务端赋值，调用方无法传）。

### 安全

无凭证、无外部访问、无权限模型变化。producer 是写入者身份标签，不是授权凭据；它约束的是**本仓库自己的写入方**，不承担对抗恶意调用方的职责（单用户本地优先，架构不变量 112-113）。

### 发布与回滚

不发布、不部署。schema 变更合并后按仓库约定 `bun run db:generate` 再跑门禁（ERRATA 2026-09-23 已记这条教训）。

## 被否方案

| 方案 | 内容 | 拒绝理由 |
| --- | --- | --- |
| **B** | 只落合同与判据、零 schema 改动，用 characterization 测试把今天的覆盖行为钉住 | 第 4 条仍不能宣布通过；已知的覆盖路径继续在生产上覆盖用户编辑，等于把数据损坏风险写进文档后放着。合同没有数据支撑时「人工」仍是不可判定的 |
| **C** | 完整保护层：全对象守卫 + 候选 Revision 模型 + 接受/拒绝界面 | 与 ORG-019（Phase 3）和 PRD 后置决定第 8 条正面重叠；Phase 3 的 Knowledge Workflow 设计会重写其中一部分，返工风险高；且今天没有消费者 |
| **D** | 在 ingest 投影里加一句「当前 Revision 是人工写的就 return」 | **用户已明令禁止的反模式**：判据不可机器判定、没说自动结果去哪、不覆盖其它八个真相面。这是绕过设计，不是保护 |
| **E** | 把 ingest 投影整体删掉，Story 表示只允许人工写 | 会让所有未编辑的 Story 表示停在首次录入值，来源更新不再反映到 Story；超出本 Proposal 范围，属产品行为变更 |

## 对 requirements / architecture / ADR / spec 的预期改动

- **requirements**：`ERRATA.md` 追加一条**口径注记**——§12 第 4 条与 LIB-003 的「重分析」在 Phase 2 的读法包含 **ingest 的确定性投影**（它已经是一条自动写入路径），不只是 Phase 3 的 Knowledge Workflow；需求文字与验收条件不改写。`PROJECT-STATUS.md` 第 53 行的「尚无写入路径可考」更正为「已有一条未保护的自动写入路径，切片 1 后受保护并有回归测试」。
- **architecture**：[`0002-information-model.md`](../architecture/0002-information-model.md) 的「分册勘误登记」追加一条（`part-02-04.md` 已封口，正文不改写），把第 335 行的「字段级保护 + 候选 Revision」细化为**两类降级**合同；`0001-cosmos-foundation.md` 与信息模型不变量 19/22 的措辞无需改动（本 Proposal 是其细化，不是推翻）。
- **ADR**：新增 **ADR-0028（用户真相保护 v1）**，沉淀四个稳定决定——判据是写入者身份且落成 `StoryRevision.producer`、保护粒度 v1 为整条当前 Revision、自动结果按写入方分两类降级、人工行不可被自动方删除或改写。同时给九条 Revisit Gate 各加一行标注：「『人工修正不被重分析覆盖』的落地语义已由 ADR-0028 定义，实现随各自动写入方落地」。
- **spec**：`storage/0001-prisma-repository.md`（新列、回填与投影跳过）、`application/0006-ingest-workflow.md`（投影跳过与新事件）、`contracts/0001-public-contracts.md`（若采纳切片 2）、`interfaces/0005-web-client.md`（若采纳切片 2）。
- **testing**：`docs/testing/README.md` 登记新增的回归测试锚点（重分析保护的唯一验收层）。

## 待裁定项（2026-09-24 已全部裁定）

1. **保护粒度** → **裁定：整条当前 Revision**（决定 2 按原样执行）。字段级掩码留给 ORG-019。
2. **关系表人工行守卫是否 v1 实现** → **裁定：不实现，只进合同**（决定 4 按原样执行），实现随第一个真实自动写入方落地。
3. **是否做切片 2** → **裁定：做**。Web 显示「此 Story 的表示已由人工修改，自动更新已暂停」，`StoryDetail` 暴露 `producer`。
4. **回填信号与「事件缺失即不保护」** → **裁定：接受**。有 `story.revision_created.v1` 事件 = `human`，否则 = `system`；事件被裁剪的库对应行需重新编辑一次才受保护。
5. **ADR 编号** → **裁定：0028 可用**（现有序号到 0027）。

## 决策记录

| 日期 | 结论 | 决策者 |
| --- | --- | --- |
| 2026-09-24 | 范围裁定：P2-1 纳入 ingest 投影这条既有自动写入路径，且优先修。方案取 A（合同先行 + 以 ingest 投影作第一个消费者 + 回归测试），不预建 Phase 3 候选 UI。按准入表先出本 Proposal，accepted 后才动代码。实现记录复用 Task 04。 | 用户（本轮裁定） |
| 2026-09-24 | 待裁定项 1–5 全部按建议裁定：保护粒度取整条当前 Revision；关系表人工行守卫只进合同、v1 不实现；切片 2（Web 可见标记 + DTO 暴露 producer）要做；回填信号取 `story.revision_created.v1` 事件且接受「事件缺失即不保护」；ADR 编号用 0028。 | 用户（评审确认） |
| 2026-09-24 | **Proposal 接受**：状态转为 `accepted`，授权更新稳定文档（ERRATA 口径注记、架构分册勘误登记、ADR-0028、spec）并按切片 1／2 实施；实现记录进 Task 04。 | 用户（评审确认） |
