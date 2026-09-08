# Proposal：Topic 域模型 v1（Topic + Topic Membership，Phase 2 下一切片）

> 状态：accepted
>
> 日期：2026-09-08
>
> 需求真相源：[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md)（ORG-002/006/007/008/009/012/015/016/018/020、BRD-007、§8.3、§9.2）与 [`../requirements/0001-original-requirements.md`](../requirements/0001-original-requirements.md)（2026-08-07 条目：Subject → Topic、Topic 只收录 Story）
>
> 关联：信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §5、公共术语 [`../../CONTEXT.md`](../../CONTEXT.md)「话题（Topic）」、ADR [`0006`](../adr/0006-story-domain-v1.md)（Story 域模型 v1，本切片复用其已验证模式）、Task 10 walkthrough [`../../.agents/tasks/10-story-domain/README.md`](../../.agents/tasks/10-story-domain/README.md)（已收口）

## 问题

PRD §9.2 要求“用户能按来源、分类、时间、全文和 Topic 浏览”，示例验收句是“用户可以创建或关注‘Jeff Dean 离职及后续影响’Topic，把两个 Story 与其它背景事件 Story 组织在一起”。当前实现完全没有 Topic：

- Prisma schema 只有 `Story`/`StoryRevision`/`StoryAlias`/`Entry`，没有任何 Topic、成员关系或 alias 表。
- domain、contracts、Product API、Web 均无 Topic 概念；唯一的内容组织单位是 Story。
- Task 10（Story 域模型 v1）已交付多成员 Story、版本化 Revision、merge canonical/alias 与 Product API 编排命令——Topic 的内容单位（ORG-008：上层体验以 Story 为单位）已经就绪，Topic 是下一个被阻塞的切片。

信息模型 §5 与 CONTEXT.md 已把 Topic 语义冻结到可实施粒度（最小语义、成员角色表、单一当前成员角色 + revision history、Agent 移除权限边界），本 Proposal 不引入新的语义分歧，只做最小实现切片并处理实现级取舍。

本 Proposal 把 Phase 2 下一片冻结为“Topic 域模型 v1”：Topic 实体 + Topic Membership（角色 + revision history）+ 人工编排入口。**不包含** Entity/关系、Agent 自动创建、维护绑定、看板与 Spotlight。

## 已拍板输入（用户 2026-09-08 对齐）

| 输入 | 决定 |
| --- | --- |
| Phase 2 下一切片 | Topic/Topic Membership；Entity/关系、标签/批注/集合/Saved View、可配置看板不在本切片 |
| 创建方式 | 显式人工创建；Agent 自动创建是 ORG-007（Phase 3），后置 |

## 目标与非目标

### 目标

1. Topic 成为稳定组织对象：标题（或核心问题）、关注目的、范围说明/排除项；成员只允许 Story，不直接收录 Entry（ORG-002、ORG-008）；不自动过期，v1 不做归档（ORG-009）。
2. Topic Membership：一个 `(Topic, Story)` 组合只有一个当前成员角色（ORG-016）；纳入、移除、角色变更通过不可变 membership revision 保存 actor、理由与角色历史；移除是可恢复的 tombstone revision（ORG-018 的存储基础）；成员保存纳入理由（ORG-006）。
3. Topic merge：canonical ID + 旧 ID alias/redirect，成员按确定性规则迁移，历史 revision 不删除（ORG-012）；同时让 Task 10 已交付的 Story merge 在 Topic 存在后仍保持成员一致性（ORG-020 的 merge 侧语义）。
4. Product API 写命令与读取（创建/更新/成员命令/merge/详情/列表），沿用 Task 10 Story 编排同一路径形态（API command → Application 命令 → repository 事务 → 领域事件），不引入新 Workflow/Job 类型。
5. Web 最小验证面：Topic 详情页（成员与角色、纳入理由、操作入口）+ 从 Story 面板发起“加入 Topic/创建 Topic” + Topics 列表入口，作为浏览器验收面。

### 非目标

- Agent 自动创建 Topic、自动成员维护、`TopicMaintenanceBinding`（ORG-007 是 Phase 3；没有 Agent 维护时维护绑定没有行为可表达）。
- Entity/Relationship、`TopicRelation`、Topic 父子层级、标签（ORG-015；Entity 由用户排除出本切片）。
- Spotlight、Board/Section/Block、Subscription（独立关系，归后续看板/Spotlight 切片）。
- Story/Topic split（与 Story split 对称后置）；`evidence_for`/`mentions` 跨 Story 引用。
- 归档、多用户权限、审批 UI、Workspace/Artifact 联动、embedding 与自动聚类。

## 当前行为与证据

- `packages/storage-prisma/prisma/schema.prisma:249-290`：仅 `Story`（kind/subtype/currentRevisionId/entries/aliases）、`StoryRevision`（revision/fingerprint/actorJson/reason + `(storyId, revision)` 唯一）、`StoryAlias`（canonical 重定向）、`Entry.storyId` 主归属外键；全文件无 Topic 相关模型。
- `packages/domain`：`storyKinds` 受管枚举 + 未知 subtype 降级读取模式已存在；无 Topic 语义或命令。
- `packages/contracts`：Story 编排命令 schema（版本化、幂等键、revision CAS）与多成员 `StoryDetail` 已存在（Task 10 切片 2）；transport-http 提供对应端点；无 Topic DTO。
- `apps/web`：StoryPanel 支持多成员展示、标题编辑与归并；无 Topic 入口。Task 10 收尾已知可用性障碍：UI 不展示 Story ID，需要用户输入 Story ID 的表单（归并）人工不可用。
- 语义设计已冻结：信息模型 §5.2（Topic 最小语义、六个推荐成员角色、单一当前角色 + revision history、按成员来源区分的移除权限）、CONTEXT.md「话题（Topic）」。
- Topic 相关需求为 Phase 2 的部分已由 PRD 冻结：ORG-002/006/008/009/012/015/016/020；ORG-007/018 是 Phase 3（本切片只落地其存储基础，不实现 Agent 行为）。

## 方案与取舍

### 1. 领域层：Topic 语义 + membership revision 规则

- 创建 Topic：人工显式命令，参数为 title（或核心问题）、purpose（关注目的）、scope（范围说明/排除项，可空）、可选 seed Story（成为第一个 `core` 成员）。
- 成员命令：`add-member`（role + reason）、`update-role`（role + reason）、`remove-member`（reason → tombstone revision，可恢复）、`restore-member`。
- Revision 规则：每个 `(topicId, storyId)` 一条当前成员关系，当前指针指向唯一当前 revision；纳入、移除、角色变更都追加不可变 `TopicMembershipRevision`（role、reason、actor、tombstone 标记、可选关联 Run），历史可追溯，v1 不保存并列 assertion（与信息模型 §5.2 一致）。
- Merge Topic：指定 canonical 与 obsolete；obsolete 的成员迁入 canonical——`(canonical, story)` 已有当前成员时保留 canonical 当前角色，obsolete 侧该成员的迁移动作记录进合并审计；obsolete 独有成员原样迁入并保留其角色/理由/actor。obsolete Topic 保留为 alias 重定向，历史 revision 与 membership history 不删除（同 `StoryAlias` 模式）。
- Story merge 扩展（ORG-020）：Task 10 的 `mergeStories` 在 Topic 存在后必须在同一事务内把指向 obsolete Story 的 membership 迁移到 canonical（按上述去重规则），否则 `(topicId, storyId)` 唯一约束会在 alias ID 上出现重复成员；该扩展进入本切片 storage 范围，补行为测试。
- 成员角色：受管枚举 `core`/`update`/`background`/`analysis`/`counterpoint`/`tutorial`（信息模型 §5.2 推荐角色表），读取时允许未知值降级展示，同 Story subtype 模式（决策点 3 已拍板：受管枚举）。
- Topic 自身内容（title/purpose/scope）走不可变 `TopicRevision`（同 `StoryRevision`：确定性 fingerprint、无实质变化 no-op、当前指针），决策点 1 已拍板。

取舍：自动创建、自动维护、Proposal/接受流程全部后置，v1 的 Topic 与成员只由用户显式操作——与 Story 切片同一逻辑，成本最低、不引入不可信派生写入。

### 2. 持久化与迁移

预计改动（以 Task 细化为准）：

- 新表 `Topic`（id、title、purpose、scope；若决策点 1 选 A 则另含 currentRevisionId + `TopicRevision` 表）、`TopicMembership`（`(topicId, storyId)` 唯一 + 当前 revision 指针）、`TopicMembershipRevision`（不可变）、`TopicAlias`（同 `StoryAlias`）。
- `Story` merge 命令扩展：事务内迁移指向 obsolete Story 的 membership（见上）；`Story`/`StoryRevision`/`Entry` 既有结构不改。
- 全新表、无既有数据 backfill；migration forward-only，只增不改；迁移验证 fresh DB + 既有 master 旧库 upgrade 两态（无旧 Topic 数据，upgrade 风险低，但仍按门禁跑）。

取舍：membership 用“当前关系表 + 不可变 revision 链”，而不是 append-only 事件表——查询当前成员是 Topic 页主路径，需要 O(1) 当前投影；历史只在详情追溯时读取。

### 3. 公共边界：Product API command，不引入新 Workflow 类型

Topic 编排是单机本地事务 + 审计，不产生外部副作用，与 Task 10 Story 编排同形态：API command → Application 命令 → repository 事务 → 领域事件；自动路径（未来 Agent 维护）必须走 Workflow，人工路径走 command，二者最终共用同一 Topic domain 语义。

待 Task 细化的命令形态（版本化、幂等键、membership/topic CAS、输入校验先以 `unknown` 收口）：

- `topic.create`、`topic.update`（决策点 1 已拍板：走不可变 revision 化）、`topic.merge`；
- `topic.add-member`、`topic.update-member-role`、`topic.remove-member`、`topic.restore-member`；
- 读取扩展：`TopicDetail`（成员列表：Story 摘要 + role + reason + actor）、`TopicSummary`/列表；Story 详情可选附带“所在 Topic”（最小可不做，待 Task 定）。

### 4. Web 最小验证面

- Topic 详情页：标题/目的/范围 + 成员列表（按角色分组、纳入理由、actor）+ 成员操作（改角色/移除/恢复）。
- 成员变更入口方向（决策点 4 已拍板）：成员添加从 Story 详情/面板发起（“加入 Topic / 创建 Topic”，选择已有 Topic 不需要 Story 选择器），Topic 详情页不做“搜索 Story 添加成员”——规避 Task 10 收尾记录的“UI 不展示 Story ID”可用性障碍，顺带收敛该 follow-up。
- 首页/侧栏提供最小 Topics 列表入口；视觉打磨不属本切片验收。
- 组件实验室登记对应场景；生产行为与 API 合同同步进 `docs/spec/`。

## 影响

- **产品/API**：新增 Topic 写命令与读取；既有 Feed/Story/搜索路径不变；`story merge` 命令行为扩展（membership 同步迁移），对既有调用方透明。
- **数据**：新增 4~5 张表 + 一条 migration；不改既有表结构；`TopicMembership` 外键引用 `Story`/`Topic`。
- **公开合同**：contracts 新增 Topic 命令与详情/列表 schema；`storyKinds`、Story DTO 不变（Story 详情可选扩展字段向后兼容）。
- **安全**：本地单用户最大权限（沿用既有边界），写入口参数白名单化，不引入审批 UI；member/merge 审计记录 actor、理由。
- **迁移/回滚**：migration forward-only；merge 是显式用户动作，alias 保证回滚后旧 ID 仍可解析；不删除历史行。
- **发布**：本切片不涉及发布与部署（后置债）。

## 验收草案（设计通过后归 Task）

- **domain focused**：成员角色枚举校验与未知值降级；membership revision 追加/tombstone/恢复规则；merge 的成员迁移与去重语义（canonical 角色保留、obsolete 独有迁入）。
- **storage/迁移**：fresh + 旧库 upgrade；`(topicId, storyId)` 唯一约束与并发写入；事务内成员变更、alias 落库；**Story merge 现在会迁移 membership 到 canonical** 的行为测试（含去重冲突用例）。
- **contracts/API focused**：命令 Zod 校验、幂等键、CAS 冲突、白名单投影；Topic 详情返回成员列表；Topic alias 重定向读取。
- **浏览器**：从两个 Story 分别发起创建/加入同一 Topic → Topic 详情显示两个成员与角色/理由；改角色、移除、恢复后历史 actor/理由可读；merge 两个 Topic 后旧 ID 仍可打开并指向 canonical，成员无重复。
- **明确不运行**：Docker/Compose、发布部署、真实公网长时定时、非 Windows 平台 smoke、长时间故障恢复（Phase 1 后置债划线不变）。

## 对稳定文档的预期改动（接受后执行）

- `docs/requirements/0002-product-requirements.md`：ORG-002/006/008/009/012/015/016 注记 v1 已实现边界（ORG-007/018 保持 Phase 3 不动）。
- `docs/architecture/0002-information-model.md` §5：注记 v1 实现边界（`TopicMaintenanceBinding`/`TopicRelation`/Spotlight/Subscription 等后置；membership revision/tombstone 已落地）。
- `docs/adr/`：新增 ADR-0007 Topic 域模型 v1，沉淀稳定决定（成员角色受管枚举 + 未知降级、membership 当前关系 + 不可变 revision、Topic merge canonical/alias、Agent 自动创建与维护后置、Story merge 同步迁移 membership）。
- `docs/spec/`：domain/0001（Topic 语义与 revision 规则）、contracts/0001（新 DTO）、storage/0001（迁移与读写）、interfaces/0002 与 0005 同步；`docs/testing/README.md` 补充测试数据边界。
- 新建 Phase 2 Task（编号待维护者分配，建议 11）记录实施切片；本 Proposal 状态 reviewing → accepted 前不修改任何代码或稳定文档。

## 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-08 | Phase 2 下一切片 = Topic/Topic Membership；Entity/关系、标签/批注/看板不进本切片 | 用户 |
| 2026-09-08 | **接受四项默认建议**：Topic 自身走不可变 `TopicRevision`（同 StoryRevision 指纹 no-op）；Topic merge 进 v1（canonical/alias + 成员去重迁移）；成员角色受管枚举 `core`/`update`/`background`/`analysis`/`counterpoint`/`tutorial` + 未知值降级；Web 成员添加入口从 Story 侧发起 | 用户（评审接受） |
