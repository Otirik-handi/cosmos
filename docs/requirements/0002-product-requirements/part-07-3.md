---
parent: docs/requirements/0002-product-requirements.md
range: §7.7–7.11 Agent、看板、发布、运维与扩展
sealed_at: 2026-09-14
tags: [requirements, prd, functional]
tokens_est: 5500
---

### 7.7 Agent、Artifact 与 Workspace

| ID | 阶段 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| AGT-001 | Phase 3 | Agent 作为普通 Action 运行，使用相同的 Run、能力范围、预算、超时、取消和日志合同。 | Agent 失败可诊断，不绕过信息库 Command 或扩展能力检查；第一版不建设细粒度权限系统。 |
| AGT-002 | Phase 3 | Agent 可以读取 Cosmos 运行时提供范围内的 Entry、Story、Topic、Annotation 和 Saved View，并调用已注册的搜索/抓取 Action；当前单用户阶段知识管理者可通过同一合同创建或扩展来源范围。 | Run 记录实际读取范围、外部调用和使用的模型/工具；未来多人、远端或不可信扩展再增加独立权限策略。 |
| AGT-003 | Phase 3 | Agent 可以对技术博客等内容生成批注、观点和深入阅读结果。 | 每个结论引用具体 Entry/Revision 或明确标记为 Agent 推断。 |
| AGT-004 | Phase 3 | Agent 可以发现竞品或重要主题后继续调研并生成报告。 | 报告保存查询、来源、生成时间、模型、Workflow Run 和完整文件清单。 |
| AGT-005 | Phase 3 | Artifact 可以包含 Markdown、HTML、JSON、图片、图表、附件和可视化页面文件夹。 | 每次发布形成不可变 Revision，入口、媒体类型、hash 和 provenance 可校验。 |
| AGT-006 | Phase 3 | Workspace 保存长期体验配置、Story/Topic 范围、视图模板、刷新规则、关联对象和用户交互状态。 | 刷新 Artifact 或更换维护 Agent 后，看板位置、完成进度、答案和批注不丢失；UI 按 kind 显示栏目、专题、学习计划或工作区。 |
| AGT-007 | Phase 3 | 系统支持 timeline、dossier、brief、learning 和 custom 等 Workspace View。 | 台风时间线、Jeff Dean 专题、每天五个单词和每日竞品分析均能组合现有对象表达；UI 按 kind 显示专题、栏目、学习计划或工作区。 |
| AGT-008 | Phase 3 | Agent 生成的可执行网页在隔离环境显示。 | 页面默认不能访问宿主 DOM、文件系统、Secret、数据库或任意网络。 |
| AGT-009 | 跨阶段 | Agent 不能改写原始 Observation，也不能把自身观点伪装成来源原文。 | 用户能在 UI 中区分来源内容、系统派生结果和 Agent 观点。 |
| AGT-010 | 跨阶段 | Agent 与人类使用同一协作修改合同。 | 第一版记录 actor、revision、理由和关联 Run；复杂权限、冲突 UI、ChangeRequest 和撤销策略后置。 |
| AGT-011 | Phase 3 | Workspace 通过多对多 Input Binding 引用 Topic、Story、Saved View、Collection 或 Query，并可设置一个可选主要锚点。 | 一个 Topic 可驱动多个 Workspace，一个 Workspace 可组合多个 Topic；Learning Workspace 等对象可以没有 Topic。 |
| AGT-012 | Phase 3 | 用户可以看到 Workspace 是否正在被 Agent/Workflow 更新、关联 Run、操作者、当前步骤和最近结果；更新运行态与 Workspace 生命周期、Board 可见性及 Interaction State 分离。 | 看板和 Workspace 页面能区分 `queued`、`running`、`waiting`、`failed` 等更新状态，并显示最近结果。 |
| AGT-013 | Phase 3 | Workspace Update 的候选内容必须在成功时原子发布；失败或取消不能替换最近一次成功发布的 Workspace/Artifact Revision。 | Agent 中途失败、取消或重启后，用户仍能打开上一成功版本；成功发布形成新的可追溯 Revision。 |
| AGT-014 | Phase 3 | 当前单用户阶段知识管理者和 Agent 按最大产品权限运行，可以创建或维护 Topic、Workspace、Artifact、Source 和研究任务；所有操作仍通过 Service/Workflow/Capability/Application Command 合同。 | Agent 不直接访问数据库或绕过持久 Runtime；外部副作用仍有独立 Run/Delivery 账本，未来多人、远端或不可信扩展再增加权限策略。 |
| AGT-015 | Phase 3 | 知识管理者是用户与 Cosmos 交互的高权限窗口，可以通过 Web GUI 聊天或 `cosmos cli` 代替用户执行 GUI/Command 操作；当前单用户阶段按最大产品权限运行。 | Web Chat 和 CLI 使用同一 Service/Workflow/Capability 合同；知识管理者不直接访问数据库或绕过持久运行时；未来权限策略不改变该入口合同。 |
| AGT-016 | Phase 3 | 知识管理者可以有多个聊天、ingest、研究或其它专业分身，并共享 `nb-memory` 维护的长期记忆与知识库。 | 分身不各自复制一套长期记忆；不同入口可以读取同一知识边界，并保留各自 Run/操作上下文。 |
| AGT-017 | Phase 3 | ingest、research 和其它 Workflow 可以调用知识管理者进行知识点细究、补充研究或生成 Proposal。 | 需要外部搜索或后续处理时，通过持久子 Run/Activity/Job 创建任务；知识管理者不能在进程内私自派发不可恢复任务。 |

当前个性化配置草案为：

```text
Agent 记忆 + Cosmos 观察到的用户行为 + 未来可能的其它信号
    -> 程序可读的配置
```

`nb-memory` 是知识管理者的候选共享长期记忆/知识库；Cosmos 保存行为观察并负责将记忆和行为转换为程序可读配置。当前不要求每个配置字段保存独立的 producer/version/evidence 账本，也不把平台自身推荐信号作为独立偏好模型；Story、关系、推荐特征和 Artifact 等一般派生结果仍需按各自合同保留 provenance。

### 7.8 看板与浏览体验

| ID | 阶段 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| BRD-001 | Phase 1 | 系统提供两块固定的最小看板：最新内容 Feed 与来源健康摘要，以 Story 为展示单位。Phase 1 的 Story 先采用保守 projection，不提前实现完整聚类维护。 | 用户无需数据库工具即可从最新内容打开 Story、查看其当前 Revision 和 Entry/来源，并能看到每个已配置来源的最近运行与成功/失败状态；一个 Story 可以暂时只有一个 Entry。跨来源成员聚合与完整 Story 维护在 Phase 2 验证。 |
| BRD-002 | Phase 2 | 看板由可配置 Board、Section 和 Block 构成。 | 用户可以调整顺序、隐藏、复制和配置区块；删除区块不删除内容。 |
| BRD-003 | Phase 2 | 默认看板按热点、精华、普通信息流组织。 | 三个区域可以引用相同 Story、Topic、Workspace 或 Artifact，但使用不同展示策略。 |
| BRD-004 | Phase 4 | Spotlight Block 可由系统或用户设置，展示事件、话题、状态或大会等高关注目标。 | 用户能固定一个 Topic；系统也能根据明确 policy 推荐 Spotlight。 |
| BRD-005 | Phase 3 | Workspace/Artifact Block 支持研究报告、学习任务和交互页面。 | 用户可在看板中打开或完成交互，并在刷新后保留状态。 |
| BRD-006 | Phase 2 | Feed Block 可绑定 Saved View、查询或推荐策略。 | 开发、硬件、娱乐等分区可以拥有不同来源与排序配置。 |
| BRD-007 | Phase 2 | Story/Topic 深入页展示多来源、时间线、差异、相关内容、Agent 产物和用户操作。 | 打开热点后能区分同一事件成员、其它相关事件、背景教程和 Agent 分析。 |
| BRD-008 | Phase 2 | 已保存内容在离线时保持可浏览；未保存媒体明确显示状态。 | UI 不用空白或无限加载掩盖离线缺失。 |
| BRD-009 | Phase 3 | 未来可以支持多个 Board，例如工作、AI 研究、娱乐和晨间摘要。 | Board 配置彼此独立，底层信息和用户真相仍共享。 |
| BRD-010 | Phase 1 | Web 默认使用 NeuroBook 视觉主题，并提供 macOS Light / macOS Night 两种配色；无已保存偏好时跟随系统 `prefers-color-scheme`，手动选择后持久化，可随时回到“跟随系统”。 | 用户在首页与组件实验室能切换三种偏好并立即生效；刷新后手动选择保持；清空偏好后恢复跟随系统；两种配色下页面无错误配色闪烁与 hydration 告警。 |

**Phase 2 第五切片注记（2026-09-09，[`board-section-block-v1` Proposal](../../proposals/board-section-block-v1.md) accepted）**：BRD-002/003/004/006 的 v1 实施顺序按 Proposal 冻结——Board/Section/Block 三层配置实体（Block 是纯展示配置，删除/隐藏/复制/移动不触碰底层内容），v1 Block 类型 = Feed（绑定 Saved View，BRD-006 落地）/ Spotlight / 来源健康 / Topic 与 Collection 列表；默认看板按热点、精华、普通信息流三 Section 预置（热点 = Spotlight Block、精华 = Topic 列表 Block、信息流 = Feed Block + 来源健康 Block；区域差异由 Block 类型承载，Section 不设 kind）；Spotlight v1 只做人工固定（pin Story/Topic 绑定具体 Board，不设 TTL），自动 policy 推荐后置 Phase 4（REC-014）。拖拽排序、Workspace/Artifact Block（BRD-005，Phase 3）、Board/Query snapshot（PUB 系列）后置。上述注记只排定实现顺序，不改变本表最终验收条件。

### 7.9 Publication、摘要与推送

| ID | 阶段 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| PUB-001 | Phase 5 | 系统可以在指定时点冻结 Board/Query 内容为 Publication。 | 同一 Publication 的网页、图片和推送正文引用同一批对象 Revision。 |
| PUB-002 | Phase 5 | 用户可以配置每天 08:00 等定时摘要。 | 调度遗漏或机器休眠后按明确补跑策略处理，不无界重复发送。 |
| PUB-003 | Phase 5 | 摘要可以渲染为网页和图片，并附带进入软件看板或对应快照的链接。 | 图片、网页和链接内容一致；访问权限符合用户配置。 |
| PUB-004 | Phase 5 | Channel Adapter 可支持 QQ、Telegram 和 Email，并允许后续扩展。 | 渠道差异只影响适配和能力降级，不改变 Publication 内容真相。 |
| PUB-005 | Phase 5 | 推送用于紧急状态变化、重大 Story 更新、定时摘要和明确订阅的 Workspace。 | 热度、重要性、紧急性和渠道优先级分别记录并可配置。 |
| PUB-006 | Phase 5 | 每次投递保存 Intent、Attempt、receipt、失败和未知结果。 | Worker 重启后不会因为缺少账本盲目重复发送。 |
| PUB-007 | Phase 5 | LLM 可以建议摘要或紧急性，但用户规则拥有最终投递权。 | 没有获得对应渠道权限时，Agent 不能自行发送消息。 |

### 7.10 管理、数据与可观察性

| ID | 阶段 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| OPS-001 | Phase 1 | 用户可以查看 Source 健康、最近运行、checkpoint、录入数量和错误。 | 能区分“无新内容”“认证失败”“平台限流”“解析失败”和“存储失败”。 |
| OPS-002 | Phase 1 | 用户可以查看 Run、Activity、Job/Attempt 和可选 Step 投影的状态、重试次数、预算和关联产物。 | 失败报告能定位到具体 Source、Action 和输入，不只显示通用错误。 |
| OPS-003 | Phase 2 | 用户可以查看 Blob、Artifact、缓存和数据库占用。 | 原始数据、用户数据、可重建缓存和可清理旧产物分别统计。 |
| OPS-004 | Phase 2 | 系统提供明确的备份、恢复、导出和清理入口。 | 清理前列出影响范围；备份不依赖源码 checkout。 |
| OPS-005 | 跨阶段 | Secret 与普通配置分离，日志默认脱敏。 | 日志不包含令牌、密码、完整私信/邮件正文或未经允许的原始 payload。 |
| OPS-006 | 跨阶段 | 系统记录自动结果的 producer、version、时间、依据和当前选择。 | 算法升级后可以重建派生结果，同时保留用户修正和历史审计。 |
| OPS-007 | Phase 0 | v1 和默认产品合同面向单个本地用户；未来协作能力不得破坏 actor/revision 审计。 | 第一版不引入多人账户、共享租户、云端同步或复杂协作权限。 |
| OPS-008 | Phase 1 | 服务器、客户端和客户端与服务分离模式共用稳定的 Service Endpoint 与 Transport 合同。 | Web UI 可以连接本地 API 或远端 API；Command/Query/Event/流式更新使用版本化 payload；SSE 断线、恢复、健康检查、版本不兼容和服务不可用都有可识别状态；UI 不直接依赖 Prisma/SQLite。 |
| OPS-009 | 跨阶段 | SecretStore、ConnectorStateStore、Blob/Artifact Root 和普通数据库状态必须有清晰的所有权与生命周期边界。 | 备份、删除、撤销连接、重建索引和清理缓存不会误删其它类别的数据；敏感状态不进入普通日志和事件 payload。 |
| OPS-010 | Phase 1C | Product Service API、Worker Admin API 和 Worker Gateway 使用独立路径、版本与责任边界。 | Product API 不返回 lease/Secret 或执行插件；Worker Admin 只提供 health/readiness/status/capability/metrics/drain；Gateway 面向主动连接的远程 Worker，不提供同步反向 execute。 |
| OPS-011 | Phase 1C | API liveness、API readiness、产品健康和 Worker readiness 分开表达。 | Worker 停止时 API 仍可 ready 并读取已保存内容；Product health 显示 Worker unavailable；draining Worker 的进程仍 alive 但 execution readiness 为 false。 |

**Phase 1 收口排除注记（2026-09-18）**：OPS-010 与 RUN-010、RUN-011 被维护者排除在 Phase 1 收口之外，并改标 `Phase 3`（与插件运行时、Agent 执行位置同批）。因此本表 `Phase 1C` 行不再属于 Phase 1；改标理由见勘误台账 [`ERRATA.md`](ERRATA.md)。（本条原插在 OPS-010 与 OPS-011 两行之间，会把 OPS-011 挤出表格；2026-09-20 移到表后，文字未改。）

**OPS-004 导出注记（2026-09-20，[`user-data-export-v1` Proposal](../../proposals/user-data-export-v1.md) accepted）**：OPS-004 记为 **Phase 2 已交付**——备份、恢复、清理入口随 Task 24 交付，「导出」由本片补齐：`GET /exports/user-data` 只读返回 JSON 附件（七类用户真相对象 + 被引用目标摘要），Web 存储面板提供下载入口。导出不落盘、不含内容库与 Secret，整库副本仍走 `POST /backups`。决策见 [ADR-0019](../../adr/0019-ops-storage-v1.md) 决策 5。

### 7.11 扩展与插件

| ID | 阶段 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| EXT-001 | Phase 1 | 公共合同允许新增 Source、Source Operation、Trigger、Action 和 Board Block。 | 新扩展不需要直接修改数据库表或依赖内部 ORM 对象。 |
| EXT-002 | Phase 3 | 插件 manifest 声明 ID、版本、SDK 兼容范围、配置 schema、能力范围、入口和预算。 | 后置实现可以展示插件申请的网络、文件、模型、查询、写入和发送能力。 |
| EXT-003 | Phase 2 | 插件使用版本化 Command、Query 和 Event 合同。 | 合同升级不静默改变旧 payload 含义；不兼容版本会被拒绝并解释原因。 |
| EXT-004 | Phase 3 | 插件信任与隔离等级可分阶段，但第三方代码默认不获得核心进程全部能力。 | 即使先支持受信任扩展，也保持独立进程/RPC 可迁移边界。 |
| EXT-005 | Phase 1 | 第一版只运行用户明确安装的本地可信扩展，不建设细粒度权限 UI 或不可信插件沙箱。 | 自定义代码仍通过 SDK/能力边界访问系统；未来可以提高隔离等级而不改写扩展合同。 |
| EXT-006 | Phase 2 | 插件 manifest 可以声明多个 Source Operation、认证方式、配置/状态 schema、Action、能力、预算和错误/恢复语义。 | Web/API 可以根据声明展示配置和登录状态；增加新 Adapter 不需要修改核心数据库表或 Worker 的专用分支。 |
| EXT-007 | Phase 2 | Adapter manifest 必须声明 Source Operation 的输入/输出、稳定 external key、discovery context、媒体状态、SecretRef、StateStore 命名空间和 Action 能力。 | Adapter 不自行持久化 Secret 或核心领域状态；Cosmos 可以校验能力、版本、预算和恢复语义，并通过同一合同支持多个采集计划。 |
| EXT-008 | Phase 1C | API 只加载 Plugin/Source/Workflow/Action manifest、schema 和 capability；Worker 独占 executable。 | `/source-definitions` 等 Catalog Query 在没有 Connector executable 的 API 构建中仍可工作；Worker 注册精确 manifest evidence；API 不访问外部平台。 |

**Phase 1 收口注记（2026-09-18）**：本行记为 Phase 1 已交付——边界已有实现，第一、二条验收条件已由 `packages/application/src/catalog-manifest-only.test.ts` 覆盖；第三条「独立构建/部署实跑」并入既有 Phase 1 后置债的「manifest-only API、executable-only Worker 与独立 Migrator 完整生产验收」，不在本行单独计。理由见勘误台账 [`ERRATA.md`](ERRATA.md)。
