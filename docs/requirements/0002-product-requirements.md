# Cosmos 产品需求文档

> 状态：Draft v0.18
>
> 最后更新：2026-08-23
>
> 原始需求真相源：[`0001-original-requirements.md`](0001-original-requirements.md)
>
> 当前技术方案：[`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md)
>
> 信息领域模型：[`../architecture/0002-information-model.md`](../architecture/0002-information-model.md)
>
> Workflow Runtime Task：[`.agents/tasks/04-workflow-runtime/README.md`](../../.agents/tasks/04-workflow-runtime/README.md)
>
> Kernel Convergence Task：[`.agents/tasks/06-nb-workflow-kernel-convergence/README.md`](../../.agents/tasks/06-nb-workflow-kernel-convergence/README.md)
>
> API 与 DTO 草案：[`../api/README.md`](../api/README.md)

## 分册索引

本文件按领域拆分为分册(每册 ≤30 KB,封口后只读);主文档保留产品概述、原则、待决定事项与下方索引,功能与验收细节按 §号查阅分册。

| 分册 | 范围 | 大小 |
|---|---|---|
| [part-06.md](0002-product-requirements/part-06.md) | §6 端到端用户体验 | 4.4 KB |
| [part-07-1.md](0002-product-requirements/part-07-1.md) | §7.1–7.4 采集、运行时与检索 | 18.4 KB |
| [part-07-2.md](0002-product-requirements/part-07-2.md) | §7.5 Story、Topic、Entity 与关系 | 21.4 KB |
| [part-07-3.md](0002-product-requirements/part-07-3.md) | §7.7–7.11 Agent、看板、发布、运维与扩展 | 15.1 KB |
| [part-08-09.md](0002-product-requirements/part-08-09.md) | §8 主要产品界面、§9 关键用户场景与验收 | 5.9 KB |
| [part-10-12.md](0002-product-requirements/part-10-12.md) | §10 非功能需求、§11 数据保留与所有权、§12 实施范围与阶段验收 | 9.6 KB |
| [part-14-15.md](0002-product-requirements/part-14-15.md) | §14 原始需求追踪、§15 当前解释与勘误候选 | 12.8 KB |

## 0. 文档职责

本文把用户原始描述整理成可讨论、可排期、可验收的产品需求。它回答“Cosmos 要解决什么问题、用户能做什么、什么算完成”，不锁定具体数据库表、类名或框架实现。

文档按以下规则演进：

1. 用户的新原话先追加到 `0001-original-requirements.md`，保留原始措辞、数字、示例和不确定性。
2. 本文同步更新当前产品解释、需求编号、优先级、验收条件和待决策项。
3. 架构文档说明“如何实现”；两份文档发生冲突时，先根据原始需求澄清产品行为，再调整架构。
4. 尚未由用户确认的内容标为“当前假设”或“待决定”，不能伪装成最终需求。

## 1. 产品概述

### 1.1 一句话定义

Cosmos 是一个本地优先、可编排的信息聚合与个人情报平台：它代替用户持续浏览多个信息渠道，把关注领域的内容尽可能录入本地信息库，再通过可配置看板、Agent 深入研究、持续 Workspace 和后续推送帮助用户理解与行动。

### 1.2 要解决的问题

用户目前需要分别打开 BiliBili、X、Telegram、群聊、公众号、邮箱、公告网站和搜索页面才能获得信息。这种方式存在四个问题：

- 覆盖不足：人的浏览时间有限，无法持续检查更多来源和更深的关联信息。
- 信息碎片化：同一事件分散在官方公告、社交帖子、评测、教程和讨论中。
- 内容易失：推荐流、群聊和网页内容可能被更新、删除或在断网时无法访问。
- 消化成本高：用户仍要自行去重、判断重要性、阅读长文、做批注和持续跟踪。

### 1.3 产品愿景

Cosmos 最终应成为用户可控制的“信息采集与理解层”：

- 外部平台负责产生信息和提供发现入口。
- Cosmos 负责更广地采集、可靠地保存、建立关系、排序和追踪。
- Agent 负责在授权范围内深读、补充调研并生成可追溯产物。
- 看板和推送负责在合适的时间呈现合适的信息。
- 用户保留对来源、关注范围、数据、排序、Agent 数据范围和外部发送的最终控制。

## 2. 产品目标与成功定义

### 2.1 核心目标

1. 在用户授权和资源预算内，尽可能广地覆盖用户关注领域。
2. 让成功录入的信息在本地离线时仍可查询和阅读。
3. 保留来源身份和原始证据，让摘要、聚类、推荐和 Agent 结论可追溯。
4. 把多个来源组织成事件、长期关注对象和相关内容网络。
5. 通过看板降低用户浏览成本，并允许用户高度自定义内容和布局。
6. 让 Agent 生成报告、批注、课程和可视化页面，同时保存版本和用户交互状态。
7. 在看板闭环稳定后，支持定时摘要与紧急消息推送。
8. 允许用户通过 Source、Trigger、Workflow、Action、Agent 和 Board Block 扩展系统。

### 2.2 产品成功信号

第一条可运行链路完成后建立基线，再为以下指标设置目标值：

- 覆盖度：关注 Topic 在给定时间段内发现的独立来源和有效信息数量。
- 新鲜度：来源发生变化到内容成功录入、可查询和可展示之间的延迟。
- 离线可用率：已录入条目中，本地可阅读正文与已承诺媒体的比例。
- 重复控制：同一来源重复轮询产生的重复 Entry、重复 Job 和重复推送比例。
- 可追溯率：自动摘要、Story、关系、推荐和 Artifact 能定位到依据的比例。
- 展示价值：用户的打开、保存、隐藏、不感兴趣、追踪和完成交互反馈。
- 自动化可靠性：Run 成功率、可恢复失败、终态失败和结果未知的分布。
- 用户节省时间：用户获得同等信息覆盖所需的主动浏览时间变化。

在没有真实使用数据前，不人为编造数值门槛。每个实施阶段必须同时交付测量方法和当期基线。

## 3. 目标用户与使用假设

### 3.1 首要用户

第一阶段面向愿意在个人电脑或私有环境中运行 Cosmos 的重度信息用户，例如开发者、研究者、产品经理、创作者和需要持续跟踪行业动态的人。

这类用户通常：

- 同时关注多个平台、账号、网站、关键词和长期主题。
- 希望拥有本地数据和离线访问能力。
- 愿意配置来源、规则、Agent 和看板。
- 既需要低成本普通信息流，也需要少量高价值深入分析。
- 对私信、群聊和邮件等敏感来源有明确权限与隐私要求。

### 3.2 当前产品假设

- 第一阶段和默认产品合同面向单个本地用户；未来可以在不改变领域 actor/revision 合同的前提下增加协作能力，但本项目当前不建设多人同步和多租户。
- 用户明确授权每个 SourceInstance，并负责其第三方账号和平台使用权限。
- 运行环境可以持续或定时启动 Worker；睡眠或关机后应在恢复时安全补跑。
- LLM 和外部 Agent 能力可能不可用、昂贵或失败；普通录入、搜索和 Feed 不能依赖它们在线工作。
- 本地磁盘不是无限的；媒体、历史版本、缓存和 Agent 成本需要可配置预算。
- 未认证单用户阶段的作用域键、配置/来源/Blob/运行记录归属和未来认证替换点是待设计建议，不是当前已冻结的持久化合同。

## 4. 产品原则与边界

### 4.1 产品原则

- 广采集、窄展示：进入信息库和出现在当前看板是两个独立决定。
- 本地优先：已成功保存的内容不依赖原平台在线才能阅读。
- 证据优先：原始来源与派生理解分开保存。
- 无 URL 假设：消息、邮件和群聊内容没有网页链接时仍是完整的一等信息。
- 多来源优先：同一事件保留不同来源，而不是只保留一篇代表文章。
- 非 LLM 基线：常规 Feed、过滤、全文检索和基础去重在 LLM 不可用时工作。
- 用户可控：来源、数据保留、Agent 的数据范围、排序偏好和外部发送均有明确设置；复杂权限系统后置。
- 记忆与配置分层：知识管理者的长期记忆、Cosmos 观察到的行为和未来其它信号可以共同生成程序可读配置；当前不把平台推荐信号单独建模成偏好层。
- 可扩展但有边界：自定义代码和插件通过公开能力合同访问系统。

### 4.2 当前非目标

- 第一阶段不建设互联网级、多租户 SaaS。
- 第一阶段不引入 Kafka、RabbitMQ 或微服务集群。
- 不承诺绕过平台认证、反爬、付费墙、数字版权保护或服务条款。
- 不承诺所有视频、图片、附件和受保护正文都能完整离线保存。
- 不让 LLM 充当原始事实、权限、删除数据或外部发送的唯一裁决者。
- 第一版不建设细粒度 ACL、多人协作权限 UI 或不可信插件沙箱；只保留简单的本地信任边界和未来可迁移的能力合同。
- 不把平台首页推荐直接等同于 Cosmos 的最终推荐结果。
- 本 PRD 不把通用 Workflow Runtime、全部 Connector、完整看板或推送误报为当前已交付能力；当前实现状态以 `PROJECT-STATUS.md` 和对应 Task 为准。

## 5. 产品概念

| 用户表达 | 产品概念 | 用户可感知的含义 |
| --- | --- | --- |
| 信息来源 | Source | 一类外部渠道及用户配置好的具体账号、列表、网站或查询 |
| 手动/定时/自定义触发 | Trigger | 决定何时启动一次自动化 |
| 触发后执行的逻辑 | Workflow + Action | 编排抓取、清洗、入库、Agent、渲染或发送 |
| 原始信息/信息条目 | Observation + Entry | 每次采集证据与稳定可查询的信息条目 |
| 上层规范内容单元 | Story | 每个 Entry 的上层单位，以 kind 区分 event、document、media、thread 等形态 |
| 话题 | Topic | 围绕问题或目标持续组织 Story，不直接收录 Entry |
| 便签 | Annotation | 用户或 Agent 对内容、片段或主题的批注与观点 |
| 分类 | Label / Saved View | 标签和可重复使用的查询视图 |
| 精华 | Workspace + Artifact | 长期精选体验及其报告、网页、图表或附件产物 |
| 热点 | Spotlight | 看板中的高关注展示决定，可指向 Story、Topic、Workspace 或 Artifact |
| 知识管理者 | Knowledge Manager | 用户与系统交互的高权限窗口，可通过 Web/CLI 代替用户执行已授权操作 |
| 时间线 | Timeline View | 按时间展示 Story 或 Topic 更新的视图 |
| 消息流 | Feed | 由查询、候选生成、去重和排序得到的普通内容流 |
| 看板 | Board | 可配置的 Section 与 Block 集合 |
| 摘要 | Publication | 某个时点冻结、可渲染和投递的内容版本 |

内部命名不是最终中文 UI 文案。产品设计阶段可以继续优化用户可见名称，但不能重新混淆事件、长期主题、产物和展示位置。

→ §6 端到端用户体验 已归档:[part-06.md](0002-product-requirements/part-06.md)

## 7. 功能需求

阶段含义：

- `Phase 1`：第一条信息录入、离线查询和最小 Feed 垂直链路。
- `Phase 2`：信息组织与可配置看板。
- `Phase 3`：Agent Artifact 与长期 Workspace。
- `Phase 4`：推荐能力与更多渠道覆盖。
- `Phase 5`：Publication、定时摘要和紧急推送。
- `跨阶段`：从首次实现起持续成立的产品合同。

→ §7.1–7.4 采集、运行时与检索 已归档:[part-07-1.md](0002-product-requirements/part-07-1.md)
→ §7.5 Story、Topic、Entity 与关系 已归档:[part-07-2.md](0002-product-requirements/part-07-2.md)
→ §7.7–7.11 Agent、看板、发布、运维与扩展 已归档:[part-07-3.md](0002-product-requirements/part-07-3.md)

→ §8 主要产品界面、§9 关键用户场景与验收 已归档:[part-08-09.md](0002-product-requirements/part-08-09.md)

→ §10 非功能需求、§11 数据保留与所有权、§12 实施范围与阶段验收 已归档:[part-10-12.md](0002-product-requirements/part-10-12.md)

## 13. 待决定事项

以下问题不会阻塞 Phase 0，但会影响后续范围或顺序：

1. 文本、图片、视频、私信和历史修订的默认保留预算及清理策略。
2. BiliBili、X、Telegram、公众号、QQ群和 AIHOT 的合法、稳定接入方式。
3. Board 是否在 Phase 2 就支持多个实例，还是先只提供一个默认 Board。（2026-09-09 注记：按 [`board-section-block-v1` Proposal](../proposals/board-section-block-v1.md) 决策为多 Board 实体 + 产品预置一个默认 Board，见 ADR-0010。）
4. 摘要链接只在本机/局域网访问，还是提供受鉴权的公网发布。
5. 首批推送渠道的优先级，以及 QQ 采用的具体适配方式。
6. 远端 Git 托管、发布方式和跨平台目标。
7. 同一 Workspace 的并发更新、重复触发合并和取消/接管语义。
8. Agent 候选 Revision 的接受/拒绝界面，以及字段保护的最小实现。
9. `updated_since_last_seen` 在不同 surface、Story split 和 Story merge 后的投影规则。
10. 显式 state migration command 的批量操作、撤销和用户确认边界。（2026-09-15 注记：split 的用户状态迁移按 [`story-split-user-state-migration-v1` Proposal](../proposals/story-split-user-state-migration-v1.md) 与 ADR [`0020`](../adr/0020-story-split-user-state-migration-v1.md) 收窄——批量以「一次命令显式声明多类对象、每类上限 500」表达，撤销是同一命令的反向调用而不是账本回放，确认边界是「API 不做二次确认、Web 提交前显示迁移摘要并在超过 20 项时提示批量」。其它 state migration 场景——merge 之外的跨对象批量、一键撤销、通用撤销账本——仍待决定。）
11. Bun 开发与 Node 生产在 Next、Nest、Prisma、Worker 和 Harness Adapter 上的完整兼容矩阵及发布检查。
12. Prisma/SQLite 的 FTS5 migration、触发器、Raw SQL Repository 和未来存储替换边界。
13. 三种部署模式的认证、公网暴露、SSE 恢复和 Blob/Artifact transfer
    capability；Product/Worker/Admin 三面、HTTPS long-poll Gateway 和 Action
    execution placement 已有独立草案。
14. Desktop Shell 的具体实现、Node sidecar 生命周期以及安装、升级和卸载行为。
15. `pi-ai` 直接接入到 Harness `ModelRuntime` 的迁移门槛，以及 NeuroBook Harness 与独立 Harness 的行为差异。
16. SecretStore 的第一版后端是操作系统凭据库、加密文件还是其它本地实现；无论实现如何，公共合同均只暴露 SecretRef/能力受限租约。
17. Adapter 的 Source 操作是由多个 SourceDefinition、一个带 operation 的 SourceDefinition，还是用户可见的“采集计划”聚合表达。
18. `nb-workflow` Kernel/Backend Port 与 Cosmos Durable Host 如何映射 Activity、Job/Attempt、fan-out/fan-in、等待、子 Workflow、取消/接管和可恢复 journal；Graph/IR 转换为脚本语义的具体 API。
19. Entry → Story 的 Proposal 在什么置信度、来源类型和用户设置下可以自动接受，哪些字段必须人工确认。
20. 推荐系统的第一版 Feed surface、用户反馈权重、LLM 异步特征和 Top-N rerank 的预算边界。
21. `nb-memory` Adapter/Port 的具体 API、存储根目录、Node 生产兼容性以及 Cosmos Observation/Behavior 到 memory 的映射。
22. 知识管理者 Web Chat、`cosmos cli`、ingest 参与方式和高权限操作的最小 Capability/运行合同；当前不建设审批 UI。
23. Agent 记忆与行为观察生成程序可读个性化配置的 schema、更新频率和人工覆盖边界。
24. Workflow Context、Action 调用、Child Workflow、Research Request、Workflow kind/tags 和用户/Agent 配置绑定的公共 API。

→ §14 原始需求追踪、§15 当前解释与勘误候选 已归档:[part-14-15.md](0002-product-requirements/part-14-15.md)

## 分册勘误登记

分册封口后只读；对已封口分册的更正登记在此，不改写分册正文。

| 日期 | 位置 | 更正 | 理由与决策 |
| --- | --- | --- | --- |
| 2026-09-15 | [`part-07-2.md`](0002-product-requirements/part-07-2.md) §7.5 ORG-021 的「阶段」列 | 由 `Phase 2` 更正为 `Phase 3` | ORG-021 要求 Entry → Story 的组织允许确定性算法、传统模型与 LLM 协同，并提出分类、聚类、实体、关系、重要性和紧急性建议；其落地依赖 Agent 调用边界、Agent 候选 Revision 与确认策略、第一版预算模型，而这三者都是 Phase 3 的交付物，§12「Phase 3：Agent Artifact 与 Workspace」的范围也已含 Knowledge Workflow。原表将 ORG-021 标为 `Phase 2`，与 §7.5 各切片注记一致记的「自动聚类与 Knowledge Workflow（ORG-021）后置」自相矛盾，并使 Phase 2 按需求表字面无法完成；该矛盾此前未暴露，是因为 Phase 2 的四条验收标准（§12）不要求自动聚类。维护者 2026-09-15 裁定改标 Phase 3；ORG-021 的需求文字、验收条件与既有切片注记均不改写。 |
| 2026-09-15 | [`part-07-2.md`](0002-product-requirements/part-07-2.md) §7.5 ORG-014/020 的切片注记（2026-09-09）中「用户状态的显式迁移与撤销后置」 | 该项已实现，不再是后置项：见 ADR [`0020`](../adr/0020-story-split-user-state-migration-v1.md) 与下文 §13 待决定事项 10 的注记 | ADR-0012 的 Revisit Gate 首项被触发并已处理。ADR-0020 固定：只迁移以 Story 为 target 的用户状态、迁移是独立命令、撤销 = 同命令反向调用、作用域限定同一 split 家族、冲突按唯一键让目标侧优先；迁移是历史壳上唯一允许的写操作。分册正文与既有注记不改写。 |
| 2026-09-16 | §7.4 的行 AUT-005、ING-013、LIB-005（[`part-07-1.md`](0002-product-requirements/part-07-1.md)）、§7.5 的行 REC-008（[`part-07-2.md`](0002-product-requirements/part-07-2.md)）、§7.6 的行 BRD-004（[`part-07-3.md`](0002-product-requirements/part-07-3.md)）的「阶段」列 | AUT-005、ING-013 由 `Phase 2` 更正为 `Phase 3`；LIB-005、REC-008、BRD-004 由 `Phase 2` 更正为 `Phase 4` | 与 ORG-021 同类问题：这五条的**验收条件本身**依赖后续阶段的交付物，把它们留在 `Phase 2` 会让 Phase 2 按需求表字面无法完成。AUT-005 的自定义 Trigger/Action 插件运行时需要扩展 SDK 与插件运行时（Task 23 已记为 Phase 3）；ING-013 的可配置 Entry → Story 知识处理依赖 Knowledge Workflow（Phase 3）；LIB-005 的「未读」条件依赖 Read State（REC-015，Phase 4）；REC-008 的相关内容推荐属推荐体系（Phase 4）；BRD-004 的「系统按 policy 推荐 Spotlight」由 REC-014（Phase 4）承载（v1 已交付的人工固定部分不受影响）。需求文字、验收条件与既有的切片排序注记均不改写。改标后 §7 中仍标 `Phase 2` 而未交付的是**真正属于 Phase 2 的尾巴**：AUT-004（webhook/内部事件等触发形态）、AUT-010（一个连接下的多采集计划）、BRD-006（Feed Block 的查询条件绑定）、BRD-007（多来源差异与用户操作）、LIB-004（正文片段字符级锚点）、LIB-008（导出）、ING-009（余项按 ADR-0015 Revisit Gate）；Phase 2 因此不再自相矛盾，而是明确留有开放项。维护者 2026-09-16 指令「改标」。 |
| 2026-09-18 | 本表 2026-09-16 行里「BRD-006（Feed Block 的查询条件绑定）」属于未交付尾巴的表述 | BRD-006 由「未交付」改为「部分交付」：Feed Block 绑定 Saved View 已实现，缺的是验收条件里的「排序配置」 | 2026-09-18 复核发现该表述与实现证据冲突：ADR-0010 与架构 §5/§7 的看板 v1 注记都写「Feed Block 绑定 Saved View（BRD-006）在本片落地」；Task 14 的追加切片 `14ce892` 让阅读流区块按 `savedViewId` 独立取数并有浏览器 E2E；`apps/web/src/components/cosmos/board-view.tsx` 消费该绑定。BRD-006 的验收条件还要求「开发、硬件、娱乐等分区可以拥有不同来源与排序配置」，而 `SavedViewConditions`（`packages/contracts/src/user-organization.ts`）只有关键词/来源/时间/分类/Topic 条件、没有排序字段，所以按完整验收条件只能记为部分交付。维护者 2026-09-18 裁定改口径；需求文字、验收条件与既有切片注记均不改写。 |
| 2026-09-18 | [`part-07-2.md`](0002-product-requirements/part-07-2.md) §7.5 ORG-003、ORG-004、ORG-022 的「阶段」列 | 三条的**自动半边**（自动识别、自动归并、成员候选/接受/拒绝）随 ORG-021 归 `Phase 3`；**人工半边**（手动 Entity 与关系、人工 merge/split/成员修正、证据关系）记为 Phase 2 已交付 | 与 ORG-021 同一理由（该行已于 2026-09-15 改标）：自动路径依赖 Knowledge Workflow、Agent 候选 Revision 与确认策略、第一版预算，三者都是 Phase 3 交付物；三条的需求文字与验收条件不改写。维护者 2026-09-18 采纳。 |
| 2026-09-18 | [`part-07-3.md`](0002-product-requirements/part-07-3.md) §7.8 BRD-006 的「阶段」列 | 绑定 Saved View 记为 Phase 2 已交付；验收条件里的「排序配置」归 `Phase 4` | 绑定已随看板切片落地（ADR-0010、Task 14 的 `14ce892`，Web 按 `savedViewId` 独立取数并有浏览器 E2E）；`SavedViewConditions` 只有关键词/来源/时间/分类/Topic 条件、没有排序字段，而排序属 Phase 4 推荐体系（与 REC-008/REC-014 同批）。维护者 2026-09-18 裁定。 |
| 2026-09-18 | [`part-07-3.md`](0002-product-requirements/part-07-3.md) §7.8 BRD-007 的「阶段」列 | 多来源、时间线、相关内容记为 Phase 2 已交付；「差异」对比与 Agent 产物归 `Phase 3` | 前两项已由 Task 15 交付并有浏览器 E2E；「差异」对比与 Agent 产物都落在深入页重做范围（[`ui-surface-ownership-v1`](../proposals/ui-surface-ownership-v1.md) 已 accepted、实现待重做），且 Agent 产物本身是 Phase 3 对象。维护者 2026-09-18 裁定。 |
| 2026-09-18 | [`part-07-1.md`](0002-product-requirements/part-07-1.md) §7.3 ING-009 的「阶段」列 | 按来源的媒体策略（图片开关、单文件/单次预算、保留期、失败重试）记为 Phase 2 已交付；剩余五项逐项定归属：历史媒体回填**冻结（不做）**、音频/视频下载实体→`Phase 4`、单条目媒体数量上限→`Phase 3`、全局默认值 env 化→`Phase 3`、媒体类型配置维持 v1 的图片范围 | 前四项已由 ADR-0014/0015 与 Task 19/20 交付；历史回填与 ADR-0005「无历史回填」一致，冻结不改变既有合同；音视频实体属渠道广度（Phase 4）；数量上限与 env 化属媒体策略精细化（Phase 3）。维护者 2026-09-18 裁定。 |
| 2026-09-18 | [`part-07-2.md`](0002-product-requirements/part-07-2.md) §7.5 ORG-015 的「阶段」列 | 判为 Phase 2 已满足；并注明 v1 由标签与看板承担 Topic 组织角色，Topic↔Topic 类型化关系后置 | 需求文字是「用带类型的 Relation、标签**或** Workspace/Board 组织」——三支取其一即可；验收条件只要求「不把展示层级误当成父子关系」，v1 不建层级已满足。维护者 2026-09-18 裁定按宽松读法。 |
