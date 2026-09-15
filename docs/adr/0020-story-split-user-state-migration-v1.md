# ADR-0020：Story split 用户状态迁移 v1（独立命令 / 反向即撤销 / 家族内作用域）

> 状态：Accepted design contract
>
> 日期：2026-09-15
>
> 关联：[`story-split-user-state-migration-v1` Proposal](../proposals/story-split-user-state-migration-v1.md)（accepted 2026-09-15）、ADR [`0012`](0012-story-split-v1.md)（本 ADR 处理其 Revisit Gate 首项）、[`0006`](0006-story-domain-v1.md)（Story merge 的迁移与冲突处理先例）、[`0009`](0009-user-organization-v1.md)、[`0010`](0010-board-section-block-v1.md)、信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §4.6/§5.4、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ORG-014/020 与待决定事项 10

## Context

ADR-0012 的 split v1 只迁移四类**内容身份关系**（主成员、证据链接、Story↔Entity、Topic 成员），收藏、标签、收藏夹、批注与 Spotlight 固定全部留在历史壳，且没有迁移或撤销入口。结果是拆开一个 Story 后，用户此前打的整理成果停在那个「已拆分」的壳上，后继 Story 上什么都没有，用户也退不回来。ORG-020 要求的是「显式迁移、记录 actor/理由/依据且可撤销」，不是「不迁移」；架构 §5.4 也要求修改记录保留「可逆操作或补偿记录」。

ADR-0012 的 Revisit Gate 首项正是本条。同方向的反向操作 `mergeStories` 已经有一整套先例：迁移九类对象、按唯一键碰撞去重、目标侧优先。缺的是方向相反、且带撤销定义的同一件事。

## Decision

### 1. 只迁移「以 Story 为 target」的用户状态

范围内：`Favorite`、`LabelAssignment`、`Annotation`、`SpotlightPlacement` 中 `targetType="story"` 且指向来源 Story 的行，以及 `CollectionItem` 中 `storyId` 指向来源 Story 的行。

范围外：target 是 Entry 或 Topic 的同类对象。它们的 target 是 Entry/Topic 本身，随 split 的成员映射或 Topic 归属自然跟随，不存在「故事级错位」需要迁移；命令若被要求迁移这类行，按所有权校验直接拒绝，而不是悄悄搬错东西。

### 2. 迁移是独立命令，split 合同不变

新增 `POST /api/v1/stories/:storyId/user-state-migrations`，split 的请求与响应一个字都不改。理由是 split 已经是「最多 20 个后继 × 4 类关系清单」的重命令，再叠五类用户状态会让 schema、表单与错误语义过载；而且「这些标记该归谁」本质上是成员定下来之后的事后判断。独立命令还天然给出了撤销路径。

### 3. 撤销 = 同一个命令反向调用，不建账本

不新增迁移记录表。撤销就是把状态从后继迁回壳——同一命令、同一套校验、同一套冲突处理，由用户显式声明要搬回什么。这符合架构 §5.4「撤销通过补偿操作完成，不删除历史」，也避开了账本回放语义的歧义（迁移后用户又改过该对象时，回放是覆盖还是拒绝？）。代价是撤销不是一键操作，Web 用「全选本成员的标记」降低操作成本。

### 4. 作用域限定在同一个 split 家族内

源与目标必须是同一条 split 关系的成员：历史壳，或它的某个 `replaced_by` 后继；允许任意方向（壳→后继、后继→壳、后继→后继），不允许迁到与该壳无关的 Story。无关 Story 之间搬标记用「取消标记 + 重新标记」表达即可，不需要新命令。这条限制让命令的语义保持在「处理 split 造成的错位」，不膨胀成通用的对象搬运能力。

### 5. 冲突处理沿用 merge 先例，目标侧优先

`Favorite(targetType, targetId)`、`LabelAssignment(labelId, targetType, targetId)`、`CollectionItem(collectionId, storyId)`、`SpotlightPlacement(boardId, targetType, targetId)` 都有唯一约束，碰撞时保留目标侧、丢弃来源侧，命令成功而不是报错，并返回每类的 `moved`/`deduped` 计数让调用方如实告知。`Annotation` 没有 per-target 唯一约束，全部迁移。

### 6. 行按对象自身的 id 命名，不暴露内部分配行 id

命令用 `labelIds` / `collectionIds` 而不是 `LabelAssignment.id` / `CollectionItem.id`：`(label, story)` 与 `(collection, story)` 已经唯一，行的定位没有歧义，读模型因此不必新增字段暴露内部 id。`StoryDetail` 与其它公共读合同的形状不变。

### 7. 迁移是历史壳上唯一允许的写操作

ADR-0012 决定 6 规定历史壳拒绝改 Revision、拒绝 merge、拒绝再次 split。本条明确补上例外：用户状态迁移属于 ORG-020 要求的补偿操作，不是对壳内容的改写，因此允许；除它之外壳继续只读。

## Consequences

### Positive

- 拆分不再丢用户的整理成果；迁错可以退回，两个方向都是同一套语义。
- 无 Prisma schema 变更、无 migration、无新表；实现是既有行在一个事务内的 `updateMany` 与去重删除。
- 公共读合同零变化，`StoryDetail` 不新增字段。
- 冲突行为与 Story merge 一致，维护者只需理解一套规则。

### Costs and risks

- 拆完到迁移之间有一个窗口，壳上仍挂着状态；缓解是 Web 在壳上长期保留入口，并引导一次。
- 撤销要重新勾选，不是一键回滚；对本地单用户的批量操作可接受。
- 判断「是否同一家族」每次要查 `StoryReplacement`；命令频率很低，可接受。
- 迁移不写可查询的迁移历史，只有 append-only 领域事件 `story.user_state_migrated.v1`；需要可查询历史时按 ADR-0012 Revisit Gate 第 5 项另行评估。

## Alternatives considered

### 把用户状态并入 split 命令

拒绝。会把重命令继续加重，且迁移是事后判断；合并后也无法回退到「先拆、再决定标记去向」的自然顺序。

### 撤销用账本回放

拒绝。需要新表，且「迁移后该对象又被改过」时回放语义有歧义：覆盖会丢掉用户的新操作，拒绝又要求账本记录版本。反向命令把选择权交回用户。

### 允许迁到任意 Story

拒绝。与「取消标记 + 重新标记」重复，却多出一个能大批量搬运对象的能力面，审计与语义都变模糊。

### 自动按成员跟随

拒绝。违反 ORG-020 的「不自动复制到全部后继」「显式迁移」。某个后继认领了主成员，不代表用户想把 Story 级标记也给它。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- Story Read State 上线，需要定义 split/迁移后 `updated_since_last_seen` 的投影（待决定事项 9）；
- 自动拆分建议或自动聚类（ORG-021，Phase 3）开始设计，需要定义自动迁移的 actor 与人工保护边界；
- 需要可查询的「用户状态迁移历史」而不是事件流，需要评估映射表；
- Entry 与 Topic 级用户状态也出现「错位」场景（例如 Entry 从一个 Story 移到另一个 Story 时的标记去向），需要统一迁移语义；
- Web 需要「一键撤销最近一次迁移」，需要评估记录最近一次迁移的可逆操作或撤销账本。
