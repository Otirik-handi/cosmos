# Proposal：Story subtype 受管注册表 v1（内置清单 + 写入校验 + 目录查询）

> 状态：accepted
>
> 日期：2026-09-09
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) ORG-001、ORG-005、ORG-013
>
> 关联设计：[信息模型 §Story Subtype Registry](../architecture/0002-information-model.md)；ADR [`0006`](../adr/0006-story-domain-v1.md) 决策 4（kind/subtype 保持受管核心枚举、动态注册表后置）与 Revisit Gate（引入插件 subtype 注册表时重新评估）
>
> 关联既有切片：Task 10（Story 域模型 v1，交付了「未知 subtype 读取降级」）

## 1. 问题

Story 的 `subtype` 目前是一个没有约束的字符串：

- 写入侧不校验：改 Story Revision 和拆分后继时，任何字符串都能落库，包括拼写错误、不属于该 kind 的值、已经废弃的旧值；
- 没有可查询的取值清单：Web 编辑 Story 时根本没有 subtype 控件，拆分表单直接继承原值；
- 没有任何地方声明一个 subtype 属于哪个核心 kind、它的展示名称、它的状态。

ORG-013 要求 subtype 通过受管理注册表扩展，注册项声明所属核心 kind、版本、展示信息和身份规则；内置与插件 subtype 使用同一合同；未知 subtype 仍可按核心 kind 降级展示。Task 10 只落地了「读取降级」那一半，[ADR-0006](../adr/0006-story-domain-v1.md) 决策 4 把动态注册表后置，并把「引入插件 subtype 注册表」写进 Revisit Gate。

本 Proposal 回答：v1 的注册表放在哪里、注册项包含什么、写入侧怎么校验、Web 怎么用上它，以及哪些部分继续后置。

## 2. 目标与非目标

### 目标（对应 ORG-013 的可观察验收）

1. subtype 取值来自一份受管理注册表：每个注册项声明 id、所属核心 kind、注册项版本、用户可读名称与描述、状态（`active`/`deprecated`/`retired`）。
2. 写入 Story 时（改 Revision、拆分后继）只能使用注册表中属于该 kind 且状态为 `active` 的 subtype；未注册、属于其它 kind 或已 `retired` 的值被拒绝并说明原因。既有的未知 subtype 数据不被改写、仍可读取（按核心 kind 降级展示）。
3. 产品接口提供 subtype 目录查询，Web 在编辑 Story 与拆分 Story 时从下拉里选，而不是自由输入。

### 非目标

- 插件运行时注册（当前没有插件生态；注册表按「同一合同」设计，插件接入留到扩展 SDK 切片）；
- subtype 的「身份判定规则」真正执行（自动聚类 ORG-021 / Knowledge Workflow 后置）；v1 只声明规则标识，不实现判定；
- subtype 的重命名、合并、迁移工具；
- 用 subtype 改变核心 kind 的行为（例如 event 的严格成员判定）；
- 为未知 subtype 的历史数据做清洗或回填。

## 3. 当前行为与证据

- 存储层 `subtype` 是 `String?`（`packages/storage-prisma/prisma/schema.prisma:253`）；合同层是 `z.string().trim().max(200).nullish()`（`packages/contracts/src/index.ts:487`、`:508`）。
- 写入不校验：`updateStoryRevision`（`packages/storage-prisma/src/index.ts:1918`）把 subtype 直接写进 fingerprint 与 Story；`splitStory`（`packages/storage-prisma/src/index.ts:2322`）把后继 subtype 原样落库。
- 读取没有清单：`StoryDetail.story.subtype` 只是字符串（`packages/contracts/src/index.ts:451`）；Web 编辑表单提交时回传原 subtype，没有选择控件（`apps/web/src/components/cosmos/story-panel.tsx:395`），拆分表单注释写明「表单暂不提供逐后继编辑」（`apps/web/src/components/cosmos/story-panel.tsx:449`）。
- 领域侧只有核心 kind 枚举 `storyKinds`（`packages/domain/src/index.ts:3`）与 `mapContentKindToStoryKind`（`packages/domain/src/index.ts:386`）；ingest 生成的 Story 一律 `subtype: null`（`projectEntryToStory`，`packages/domain/src/index.ts:406`），因此本切片不改变 ingest 行为。
- 信息模型已经把注册项应声明的字段写成稳定设计（`docs/architecture/0002-information-model.md` §Story Subtype Registry）；ADR-0006 的 Alternatives 记录了「当前无插件生态，核心枚举 + null subtype 已覆盖 Phase 2 组织需求」的判断。

## 4. 方案

### 决策 1：v1 注册表是代码内静态清单，不建数据库表

注册表定义在 `packages/domain`，每个条目包含：

```text
{
  id: "media.comic",                        // 稳定 ID，全表唯一
  kind: "media",                            // 所属核心 kind，必须来自 storyKinds
  version: 1,                               // 注册项版本
  label: "漫画",                            // 用户可读名称
  description: "…",                         // 可选描述
  status: "active" | "deprecated" | "retired",
  identityPolicy: "same-work-v1" | null,    // 身份规则标识，v1 只声明不执行
  owner: "core"                             // 注册来源；内置为 core，插件接入后为插件 id
}
```

理由：当前没有插件生态，[ADR-0006](../adr/0006-story-domain-v1.md) 决策 4 的原始判断仍然成立；数据库表需要额外的管理端点、权限和 seed，属于「为不存在的消费者提前造机制」。代码内清单同样满足 ORG-013 的「内置和插件 subtype 使用同一合同」——未来插件向同一个注册表接口注册即可，写入与读取路径不变。

**备选**：新建 `StorySubtype` 表 + migration + 管理端点。拒绝：v1 没有运行时注册者，表会把一份纯静态清单变成需要备份、迁移和权限的持久对象。

### 决策 2：写入侧严格校验，读取侧继续降级

- `updateStoryRevision` 与 `splitStory` 的后继 subtype，必须是注册表中 `kind` 匹配且 `status = active` 的条目，否则拒绝并说明原因。
- 既有数据里的未知 subtype：不改写、不阻断读取；用户可以原样保留，一旦改成新值就必须是注册项。
- 读取投影保持现状：`subtype` 仍是字符串（可能是未知值），Web 按核心 kind 展示。

理由：ORG-013 的验收同时要求「受管注册表」和「未知 subtype 降级展示」，两者必须共存——注册表管新写入，降级管旧数据。

### 决策 3：新增只读目录接口，Web 改用下拉选择

- contracts 新增 subtype 目录 DTO；
- transport client 与 Product API 新增 `GET /api/v1/story-subtypes`（可选按 `kind` 过滤，返回 `active`/`deprecated` 条目）；
- Web 编辑 Story 与拆分后继时，subtype 从目录下拉选择（含「无 subtype」），`deprecated` 条目标注但可选，`retired` 不出现。

理由：注册表只有被消费才算落地；目录接口同时是未来插件 subtype 的发现入口。

### 决策 4：内置清单保持最小，只注册真实需要的条目

首批只注册信息模型已经举例的三条 `media` subtype：`media.comic`、`media.anime`、`media.video`；其余 kind 先只有「无 subtype」。清单在 ADR 与 spec 中冻结，后续增补走同一注册表。

理由：不凭空发明产品词汇；清单越小，未来调整的兼容成本越低。

### 决策 5：身份规则只声明不执行

注册项的 `identityPolicy` 是字符串标识（例如 `same-event-v1`、`same-work-v1`），v1 没有消费者；自动聚类切片到来时再定义每个 policy 的判定语义。如果评审认为「声明了却没人用」不可接受，可以把这一列整体后置，等 ORG-021 再引入。

理由：ORG-013 明确要求注册项声明身份规则，但 v1 不实现自动判定（ORG-021 后置）。在注册表条目上声明一个待消费的标识，是最小满足方式，且删除成本低。

## 5. 取舍与备选

| 备选 | 结论 |
| --- | --- |
| 代码内静态注册表（推荐） | 采纳 |
| 数据库注册表 + 管理端点 | 拒绝（决策 1）：v1 没有运行时注册者 |
| 不校验写入，只提供目录查询 | 拒绝：注册表就失去「受管理」的意义 |
| 校验写入并强制改写既有未知 subtype | 拒绝：会改写历史数据，违反「未知 subtype 降级展示」 |
| v1 同时做插件运行时注册 | 拒绝：插件 SDK 与加载边界尚未定义 |
| `identityPolicy` 整列后置 | 备选：范围更小，但 ORG-013 的注册项字段少一项 |

## 6. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：无 Prisma schema 变更、无 migration、无回填；注册表是代码常量。
- **接口**：新增只读 `GET /api/v1/story-subtypes`；`updateStoryRevision` 与 `splitStory` 的 subtype 校验变严（对「写入未注册 subtype」是行为变化，错误文案需说明原因）。`StoryDetail.story.subtype` 形状不变。
- **安全与权限**：单机单用户，无变化；目录接口只读且不含敏感数据。
- **迁移与发布**：不涉及 migration、版本号、发布或部署。
- **回滚**：回滚代码即回滚行为；已写入的合法 subtype 无需清理。若未来改为数据库注册表，代码内清单可作为 seed。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- `docs/requirements/0002-product-requirements.md`：新增 Phase 2 第八切片注记。
- `docs/architecture/0002-information-model.md`：§Story Subtype Registry 增加 v1 注记（静态清单、字段范围、校验边界）。
- `docs/adr/0013-story-subtype-registry-v1.md`（新）：冻结决策 1–5；同步 ADR 索引；更新 ADR-0006 决策 4 与 Revisit Gate 的状态。
- `docs/spec/`：domain（注册表合同）、contracts（目录 DTO）、interfaces（HTTP 与 Web）、storage（写入校验）。
- `.agents/tasks/{新编号}-story-subtype-registry/README.md`：由维护者分配编号后创建。

## 8. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-09 | 起草，状态 `reviewing`，等待评审 | Agent |
| 2026-09-09 | **接受**：v1 做 ORG-013；注册表取「代码内静态清单」（不建表、不改 schema）；写入侧「拒绝新值、保留旧值」；授权建 worktree 与任务分支、分配 Task 18 | 用户（评审接受） |
