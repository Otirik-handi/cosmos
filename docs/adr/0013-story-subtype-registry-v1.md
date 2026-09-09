# ADR-0013：Story subtype 受管注册表 v1（静态清单 / 写入校验 / 目录查询）

> 状态：Accepted design contract
>
> 日期：2026-09-09
>
> 关联：[`story-subtype-registry-v1` Proposal](../proposals/story-subtype-registry-v1.md)、信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §Story Subtype Registry、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ORG-001/005/013、ADR [`0006`](0006-story-domain-v1.md)（决策 4 与 Revisit Gate）

## Context

Story 的 `subtype` 一直是任意字符串：写入不校验、没有取值清单、没有声明它属于哪个核心 kind 或是否还在用。Task 10 只交付了「未知 subtype 读取降级」这一半（ADR-0006 决策 4）；ORG-013 要求的另一半——受管理注册表、内置与插件共用同一合同、注册项声明所属 kind/版本/展示信息/身份规则——一直没有落点。ADR-0006 的 Alternatives 当时以「没有插件生态」为由拒绝了动态注册表，并把「引入插件 subtype 注册表」写进 Revisit Gate。

2026-09-09 用户评审接受 [`story-subtype-registry-v1`](../proposals/story-subtype-registry-v1.md)：注册表取代码内静态清单、写入侧拒绝未注册的新值并保留旧值。本文沉淀这些稳定决定。

## Decision

### 1. v1 注册表是代码内静态清单，不建数据库表

注册表定义在 `packages/domain`（`storySubtypeRegistry`），每个注册项声明：id、所属核心 kind、注册项版本、用户可读名称与描述、状态（`active`/`deprecated`/`retired`）、身份规则标识（`identityPolicy`）、owner。id 必须按核心 kind 命名空间化（`<kind>.<name>`），使 subtype 不会因为改 kind 而悄悄换语义。

理由：当前没有运行时注册者，数据库表会带来管理端点、权限、seed 与迁移负担，属于为不存在的消费者提前造机制。静态清单同样满足 ORG-013 的「内置和插件 subtype 使用同一合同」——未来插件向同一个注册表接口注册，写入与读取路径不变。

### 2. 写入侧严格校验，读取侧继续降级

`updateStoryRevision` 与 `splitStory` 的每个后继，其 subtype 必须是该 kind 下 `status = active` 的注册项；未注册、属于其它 kind 或已 `retired` 的值被拒绝（400 `validation_failed`）并说明原因。既有数据里的未知 subtype 不改写、不阻断读取，仍按核心 kind 降级展示。`StoryDetail.story.subtype` 保持字符串形状（可能是未知值）。

理由：ORG-013 的验收同时要求「受管理注册表」与「未知 subtype 降级展示」，两者必须共存——注册表管新写入，降级管旧数据。用户只改标题时不需要被迫修改与本次操作无关的 subtype 字段。

### 3. 新增只读目录接口，Web 改用下拉选择

contracts 新增 subtype 目录 DTO，Product API 新增 `GET /api/v1/story-subtypes`（可选按 `kind` 过滤，返回 `active` 与 `deprecated` 条目）；Web 在编辑 Story 与拆分后继时从目录下拉选择（含「无 subtype」），`deprecated` 标注但可选，`retired` 不出现。

理由：注册表只有被消费才算落地；目录接口同时是未来插件 subtype 的发现入口。

### 4. 首批注册项保持最小

首批只注册信息模型已经举例的三条 `media` subtype：`media.comic`、`media.anime`、`media.video`；其余 kind 先只有「无 subtype」。清单在 ADR 与 spec 中冻结，后续增补走同一注册表，不凭空发明产品词汇。

### 5. 身份规则只声明不执行

注册项的 `identityPolicy` 是字符串标识（v1 为 `same-work-v1`），v1 没有消费者；自动聚类（ORG-021）切片到来时再定义每个 policy 的判定语义。这是对 ORG-013「注册项声明身份规则」的最小满足方式，且标识挂在注册项上，删除或改写的成本低。

## Consequences

### Positive

- ORG-013 有了可观察落点：subtype 取值可查、写入受约束、Web 有明确选项，而不是靠记忆输入字符串。
- 没有 Prisma schema、migration、回填与新的持久对象；回滚代码即回滚行为。
- 未知 subtype 的历史数据继续可读，旧客户端与新客户端的读取形状不变。

### Costs and risks

- 写入校验是行为收紧：此前能写入的任意字符串现在会被拒。使用旧接口写入未注册 subtype 的调用方需要改用注册项或留空。
- 静态清单意味着新增 subtype 必须改代码并发版；这是当前「无插件生态」下的接受取舍。
- `identityPolicy` 在 v1 没有消费者，存在「声明了却没人用」的观感；ORG-021 落地时必须把它接上，否则应删除。

## Alternatives considered

### 数据库注册表 + 管理端点

拒绝。v1 没有运行时注册者；表会把纯静态清单变成需要备份、迁移和权限的持久对象。

### 不校验写入，只提供目录查询

拒绝。注册表就失去「受管理」的意义，ORG-013 的约束面只剩展示。

### 校验写入并强制改写既有未知 subtype

拒绝。会改写历史数据，违反「未知 subtype 按核心 kind 降级展示」。

### v1 同时做插件运行时注册

拒绝。插件 SDK 与加载边界尚未定义，会提前创建未消费的机制。

### `identityPolicy` 整列后置

备选，未采用。范围更小，但 ORG-013 明列的注册项字段会少一项。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 自动聚类 / Knowledge Workflow（ORG-021）开始设计，需要把 `identityPolicy` 接上真实判定，或证明它无用而删除；
- 插件生态与扩展 SDK 切片到来，需要运行时注册 subtype，评估静态清单是否改为持久化注册表；
- 需要 subtype 的重命名、合并或迁移工具，需要定义注册项版本与兼容语义；
- 写入校验被证明阻碍了合法场景（例如外部导入需要先落库后分类），需要重新评估拒绝策略。
