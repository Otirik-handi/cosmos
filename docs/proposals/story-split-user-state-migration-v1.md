# Proposal：Story split 用户状态迁移与撤销 v1

> 状态：accepted
>
> 日期：2026-09-15
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) ORG-014、ORG-020、待决定事项 10（显式 state migration command 的批量操作、撤销和用户确认边界）
>
> 关联设计：[信息模型](../architecture/0002-information-model.md) §4.6、§5.4（可逆操作或补偿记录）；ADR [`0012`](../adr/0012-story-split-v1.md)（Revisit Gate 首项即本条）、[`0006`](../adr/0006-story-domain-v1.md)、[`0009`](../adr/0009-user-organization-v1.md)、[`0010`](../adr/0010-board-section-block-v1.md)
>
> 关联既有切片：Task 17（Story split v1，`splitStory`）、Task 13（用户组织 v1）、Task 14（可配置看板 v1，Spotlight 固定）
>
> 触发来源：维护者 2026-09-15 选定 Phase 2 收口项「Story split 用户状态迁移」；本条是 ADR-0012 Revisit Gate 的第一个触发条件。

## 1. 问题

Story split v1（ADR-0012）已能拆分 Story 并显式指定四类**关系**的去向：主成员（`Entry.storyId`）、证据关系（`EntryStoryLink`）、`StoryEntity`、`TopicMembership`。但**用户状态**——收藏、标签、收藏夹、批注、Spotlight 固定——全部留在历史壳上，且：

1. **没有迁移入口。** 全仓没有任何 state migration、undo、revert 命令或表（仅有 append-only 的 `DomainEvent` 日志，且没有消费方）。拆开一个 Story 后，用户此前打的标签、写的批注、收藏、加进收藏夹、固定到看板的动作全部停在那个"已拆分"的壳上，后继 Story 上什么都没有。
2. **没有撤销路径。** 用户把标签/批注迁错了对象，没有办法退回；架构 §5.4 要求"可逆操作或补偿记录"，而 split 侧目前连补偿操作的定义都没有。
3. **语义与用户直觉冲突。** 用户看到的是一句"这个 Story 被拆成了两个"，但他的个人整理成果没跟着走；这与 ORG-020「split 不自动复制到全部后继，显式迁移记录 actor、理由、依据且可撤销」的意图不符——ORG-020 要求的是"显式迁移"，不是"不迁移"。

ADR-0012 在 v1 明确把本条列为非目标，并在 Revisit Gate 首项写明「需要用户状态（收藏/标签/收藏夹/批注/Spotlight）的显式迁移、批量与撤销（待决定事项 10）」时重新评估。现在满足该条件。

## 2. 当前行为与证据

从代码读到的事实（2026-09-15，`master` = `e176312`）：

- `splitStory` 的事务只迁移四类关系：`Entry.storyId`、`EntryStoryLink`、`StoryEntity`、`TopicMembership`（`packages/storage-prisma/src/repository/stories.ts:314-346`）。
- `splitStory` 函数体内**没有**对 `Favorite`、`LabelAssignment`、`CollectionItem`、`Annotation`、`SpotlightPlacement` 的任何引用（`stories.ts:159-388`），因此它们全部留在历史壳。
- 历史壳状态是读时派生投影，不存列：由 `StoryReplacement` 行推出 `status = "split"` 与 `replacedBy[]`（`packages/storage-prisma/src/repository/helpers-2.ts:243-249`）。
- 反向的 `mergeStories` **已经**迁移九类对象并做唯一键碰撞去重（`packages/storage-prisma/src/repository/story-merge.ts`）：主成员、证据链接、`TopicMembership`、`StoryEntity`、`CollectionItem`、`Favorite`、`LabelAssignment`、`Annotation`（只改 `targetId`，不碰 `targetRevisionId`）、`SpotlightPlacement`（同 Board 冲突则丢弃）。
- 相关唯一约束：`Favorite(targetType, targetId)`、`LabelAssignment(labelId, targetType, targetId)`、`CollectionItem(collectionId, storyId)`、`SpotlightPlacement(boardId, targetType, targetId)` 均为唯一；`Annotation` 只有索引、无唯一约束（`packages/storage-prisma/prisma/schema.prisma:533-680`）。

**结论**：merge 已有"把用户状态搬到 canonical"的完整先例与冲突处理模式；split 侧缺的是方向相反的同一件事，加上它的撤销定义。

## 3. 目标与非目标

### 目标

1. 用户能把**以历史壳 Story 为 target 的用户状态**显式迁移到指定后继 Story，一次声明可含多类对象，带 actor、理由与依据。
2. 迁移可撤销：撤销是**反向的同一迁移命令**（把状态迁回壳），不删除历史、不引入撤销账本。
3. 迁移是历史壳上**唯一允许的写操作**；ADR-0012 现有边界（壳拒绝改 Revision、拒绝 merge、拒绝再次 split）不变。
4. 冲突处理沿用 merge 先例：目标侧已有等价对象时保留目标侧、丢弃壳侧，命令成功而不报错。
5. 迁移结果可审计：记录 actor、理由、依据与每类对象的迁移数量。

### 非目标

- 自动迁移或"按成员跟随"的隐式迁移（ORG-020 要求显式）。
- 撤销 split 本身（架构规定撤销通过补偿操作完成；拆回去等于重新 merge，不在本切片）。
- Story Read State 上线后 `updated_since_last_seen` 在 split 后的投影（待决定事项 9，且 Story Read State 尚未实现）。
- 自动拆分建议与聚类（ORG-021，已于 2026-09-15 改标 Phase 3）。
- Story↔Story 类型化关系、批注的正文片段字符级锚点、Artifact 作为批注目标。
- Web 的拖拽排序与看板 UI 缺口（并行的 Phase 2 收口项）。

## 4. 方案与取舍

### 4.1 迁移范围：只含「以 Story 为 target」的用户状态

| 对象 | 是否在范围内 | 理由 |
| --- | --- | --- |
| `Favorite(targetType="story")` | 是 | target 是被拆的 Story 本身 |
| `LabelAssignment(targetType="story")` | 是 | 同上 |
| `CollectionItem` | 是 | `storyId` 指向被拆的 Story |
| `Annotation(targetType="story")` | 是 | `targetId` 指向被拆的 Story（`targetRevisionId` 保持，不动） |
| `SpotlightPlacement(targetType="story")` | 是 | target 是被拆的 Story |
| `Favorite`/`LabelAssignment`/`Annotation` 的 `targetType="entry"` | 否 | target 是 Entry；Entry 已随 split 的 `entryIds` 决定归属，其上的标记自然跟随，无需故事级迁移 |
| `*_targetType="topic"` | 否 | 同上，Topic 不属于任何后继 Story |

这条边界的价值：它把"哪些状态会跟着走"讲清楚了——**Entry 上的标记跟着 Entry 走，Story 上的标记才需要显式迁移**。

### 4.2 命令形态：独立迁移命令，不并入 split 命令（取舍点 1，建议采用）

- **方案 A（并入 split）**：在 `storySplitSuccessorSchema` 上再加一组用户状态声明，拆分时一次原子完成。
  优点：一次到位，不会有"拆完忘了迁"的窗口。
  缺点：split 命令已经是「最多 20 个后继 × 4 类关系清单」的重命令；再叠五类用户状态会让 schema、表单和错误语义都过载。而且迁移本质上是事后判断——成员定下来了，才有"这些标记该归谁"的问题。
- **方案 B（独立命令，建议采用）**：split 合同**完全不变**，新增一个迁移命令，任何时候可在壳与后继之间调用。
  优点：split 零回归风险；天然给出撤销路径（反向调用）；可以分批、可以改主意。
  缺点：拆完到迁移之间有一个窗口，壳上还挂着状态。缓解：Web 在拆分成功后立即引导"是否迁移这些标记"，并在历史壳上长期保留迁移入口。

**建议采用 B。**

### 4.3 撤销：反向迁移即撤销（取舍点 2，建议采用）

- **方案 A（撤销账本）**：迁移时写一条可查询的迁移记录，撤销按记录回放。
  缺点：需要新表；且"迁移后用户又改了这个对象"时回放语义有歧义（覆盖用户的新操作还是拒绝？）。
- **方案 B（反向迁移即撤销，建议采用）**：不建表。"撤销"就是把状态从后继迁回壳——与正向完全同一个命令、同一套校验、同一套冲突处理。用户在新的迁移里显式声明要搬回什么。
  优点：无新表、无新概念、无歧义；符合架构 §5.4「撤销通过补偿操作完成，不删除历史」；用户对自己最近改了什么最清楚，显式声明比自动回放更安全。
  缺点：不是"一键撤销"，要重新勾选要搬回的对象。对本地单用户的批量操作可接受，Web 可用"全选本 Story 的标记"降低操作成本。

**建议采用 B。**

### 4.4 作用域：限定在同一个 split 家族内

命令的源与目标必须是同一条 split 关系的成员：历史壳，或它的某个 `replaced_by` 后继。允许任意方向（壳→后继、后继→壳、后继→后继），但**不允许**把用户状态迁到与该壳无关的 Story——那种需求用"取消标记 + 重新标记"表达即可，不需要新命令。

这条限制让命令的语义保持在"处理 split 造成的错位"，不膨胀成一个通用的"搬运任意 Story 标记"能力。

### 4.5 冲突处理：沿用 merge 先例

| 对象 | 碰撞条件 | 处理 |
| --- | --- | --- |
| `Favorite` | 目标 Story 已收藏 | 保留目标侧，丢弃壳侧 |
| `LabelAssignment` | 目标 Story 已有同名标签 | 保留目标侧，丢弃壳侧 |
| `CollectionItem` | 目标 Story 已在同一收藏夹 | 保留目标侧，丢弃壳侧 |
| `SpotlightPlacement` | 目标 Board 上目标 Story 已固定 | 保留目标侧，丢弃壳侧（同 merge 的"同 Board 冲突丢弃 obsolete 侧"） |
| `Annotation` | 无唯一约束 | 全部迁移（`targetId` 改指，`targetRevisionId` 保持不变） |

命令返回每类的迁移数与丢弃数，前端据此告知用户"2 条标签与目标已有标签重复，已跳过"，而不是静默吞掉。

### 4.6 用户确认边界

- **API 不做二次确认**：命令本身就是显式声明（列明对象 ID），没有"自动推断"路径，因此不需要额外的 confirm 参数。
- **Web 必须给确认**：提交前显示"即将迁移：收藏 1、标签 2、收藏夹 1、批注 3、固定 1"的摘要；单次迁移对象数超过阈值（建议 20）时提示这是批量操作。
- **批量上限**：每类列表沿用仓库既有上限模式（`max(500)`）。

### 4.7 历史壳的写边界（对 ADR-0012 的补充）

ADR-0012 规定历史壳拒绝 `updateStoryRevision`、`mergeStories`、再次 `splitStory`。本 Proposal 需要显式补一条：**用户状态迁移是历史壳上唯一允许的写操作**，理由是它属于 ORG-020 要求的补偿操作，而不是对壳内容的改写。这条必须写进 ADR，否则实现时无法判断壳能不能接受写入。

## 5. 数据、接口、安全、迁移、发布与回滚影响

### 数据

- **无 Prisma schema 变更、无新表、无新列、无 migration。** 迁移是对既有行的一组 `updateMany` / 去重删除，全部在一个事务内完成。
- 审计复用既有 append-only `DomainEvent`（新增 `story.user-state-migrated.v1`），记录 actor、理由、依据、源/目标 Story 与每类迁移数量。不新建迁移账本表；是否需要可查询的迁移历史按 ADR-0012 Revisit Gate 第 5 项另行评估。

### 接口

- **contracts**：新增 `migrateStoryUserStateCommandSchema`（源 Story、目标 Story、五类对象 ID/布尔声明、actor、reason、basis），以及迁移结果 DTO（每类的 moved/deduped 计数）。
- **Product API**：新增一个命令端点，形态对齐既有 `POST /api/v1/stories/:storyId/splits`，即 `POST /api/v1/stories/:storyId/user-state-migrations`（源在路径，目标在正文）。
- **transport-http**：在 `client-content` 分册新增对应客户端方法（入口门面不变）。
- **Web**：历史壳与后继 Story 面板各加一个迁移入口（同一个组件）；拆分成功后引导一次。
- 无公共读合同形状变化（`StoryDetail` 不新增字段）。

### 安全

无新增权限面：仍是本地单用户、actor 记录复用既有模式。迁移不接触 Secret、不产生外部副作用、不写日志正文（只记计数与 ID）。

### 迁移与回滚

无 schema 迁移，因此无"数据迁移回滚"问题。行为回滚 = 反向迁移命令；代码回滚 = 该端点与 Web 入口可独立撤销（split 合同未变，回滚不影响已拆分的 Story）。

## 6. 对 requirements / architecture / ADR / spec 的预期改动

- **requirements**：收窄待决定事项 10（批量、撤销与确认边界由本 Proposal 定义）；在 §7.5 ORG-014/020 追加切片注记指向本实现与 ADR。
- **ADR**：新增 ADR（拟定编号 `0020-story-split-user-state-migration-v1`）冻结「独立命令 + 反向即撤销 + 家族内作用域 + 冲突沿用 merge」四项决定，并明确"迁移是历史壳上唯一允许的写操作"；在 ADR-0012 的 Revisit Gate 处以注记指向该 ADR，标明首项触发条件已处理。
- **architecture**：信息模型 §4.6 补 split 的用户状态迁移与补偿语义；§5.4 的"可逆操作或补偿记录"指向本实现。
- **spec**：行为落地后更新 `docs/spec/domain/`（Story 域）与 `docs/spec/interfaces/0002-product-api-http.md`、`0005-web-client.md`。
- **testing**：在 `docs/testing/README.md` 登记迁移与撤销的行为测试锚点。

## 7. 决策记录

| 日期 | 决策者 | 决定 |
| --- | --- | --- |
| 2026-09-15 | 维护者 | 选定「Story split 用户状态迁移与撤销」为 Phase 2 收口项，要求先出 Proposal 再实施（依据 PROJECT-STATUS「当前下一步」）。 |
| 2026-09-15 | Agent | 提出本 Proposal 的问题、范围与四个取舍点建议（§4.2 独立命令、§4.3 反向即撤销、§4.4 家族内作用域、§4.5 沿用 merge 冲突处理），状态置 `reviewing`，等待维护者裁决。 |
| 2026-09-15 | 维护者 | **接受**本 Proposal，四项取舍建议（§4.2 独立迁移命令、§4.3 反向迁移即撤销、§4.4 限定在同一 split 家族内、§4.5 冲突处理沿用 merge 先例）全部按建议采用，状态置 `accepted`；授权创建 worktree 与任务分支实施，复用 Task 17。实现时需按 §6 更新 ADR（`0020`）、信息模型 §4.6/§5.4 与 PRD 切片注记。 |
