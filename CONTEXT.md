# Cosmos Context

> 最后更新：2026-08-07。
>
> 本文件维护 Cosmos 经常使用、跨模块出现或容易歧义的产品共同语言。它不是数据库实体清单，也不提前记录尚未在产品讨论中出现的实现对象。

## 文档边界

- 用户原话保存在 [`docs/requirements/0001-original-requirements.md`](docs/requirements/0001-original-requirements.md)。
- 已整理的产品行为保存在 [`docs/requirements/0002-product-requirements.md`](docs/requirements/0002-product-requirements.md)。
- 总体技术设计保存在 [`docs/architecture/0001-cosmos-foundation.md`](docs/architecture/0001-cosmos-foundation.md)。
- 信息分层、聚类、相关推荐和持续工作区的详细模型保存在 [`docs/architecture/0002-information-model.md`](docs/architecture/0002-information-model.md)。
- 下列定义是当前讨论基线；仍在讨论的名称会明确标注，不当作冻结合同。

## 核心语言

### 信息库

Cosmos 在用户授权和资源预算内持续积累、可查询并尽量可离线访问的内容集合。它保存来源证据、信息条目、关系、用户数据和 Agent 产物。

“已录入后可离线访问”不等于完整复制所有外部资源；正文、图片和附件按来源能力、权限与存储策略尽可能保存。

### 信息条目（Entry）

用户可以单独阅读、收藏、标注和引用的一条来源内容，例如文章、帖子、视频、邮件、群聊消息或公告。它必须保留来源身份，但不要求存在 URL。

“原始报道”不适合作为上位词，因为邮件、娱乐视频和群聊消息未必是报道；“信息”又过于宽泛。当前统一称为“信息条目”，代码概念为 `Entry`。

采集实现中还会保留不可变的 `Observation`，表示 Cosmos 某次实际看到的外部证据；这是为了处理重复轮询和来源编辑，不需要在普通产品对话中与 `Entry` 混用。

### Story（规范内容单元）

`Story` 是上层组织和展示使用的规范内容单元。每个 Entry 都属于一个主 Story，Story 使用稳定的 `kind` 区分 `event`、`document`、`media`、`thread` 等形态，并可用受管理、可扩展的 `subtype` 细分，例如 `media.comic`、`media.anime`。核心 kind 的合同保持稳定；新增 subtype 通过注册表声明所属 kind、展示信息、版本和身份规则，不把每个细分都升级成新的顶层 kind。

`event` Story 把描述同一现实事件的多个 Entry 归到一起，例如 BiliBili、AIHot 和 X 的三条“Qwen 3.8 Max 发布”。技术博客、教程、娱乐视频和讨论串也拥有 Story，但通常是单 Entry Story。

不同 kind 使用不同的归并标准。`event` 要求同一现实事件；共享人物或主题只说明“相关”。允许一个 Story 只有一个 Entry。

一个 Entry 只能属于一个主 Story，主 Story 表达该 Entry 自身的规范内容身份。Entry 可以通过 `evidence_for`、`mentions` 或具体文本片段关联多个其它 Story；一篇讨论多个事件的文章仍以 document Story 为主。

### 话题（Topic）

`Topic` 是用户或 Agent 为了持续理解某个问题而建立的关注范围。它回答的是：“为了理解这个问题，哪些 Story 值得持续放在一起？”

Topic 是主观且有目的的，可以带标题、问题、范围和纳入规则，例如“为什么 Jeff Dean 从 Google 离职引起轰动？”或“DeepSeek 定价与生态影响”。

Topic 与 Story 的区别不在持续时间，而在成员关系：Story 按“同一事件”归并，Topic 按“对同一问题有帮助”组织。Topic 只收录 Story，不直接收录 Entry。

Agent 只有在至少两个不同 Story 构成持续问题，或命中用户明确配置的跟踪规则时，才默认自动创建 Topic。单个紧急 Story 通常进入 Spotlight，而不是自动创建 Topic。

Topic 不自动过期。人工归档能力后置。Topic、维护、看板放置、Spotlight 和订阅分别由独立 Binding/Placement/Subscription 表达。

v1 不建立 Topic 的父子层级。需要表达 Topic 之间的联系时，使用带类型的 Topic Relation、标签或 Workspace/Board 的组织结构。

一个 `(Topic, Story)` 组合只有一个当前成员角色；角色变更、纳入和移除通过 revision history 保存，不在 v1 同时维护多方并列 assertion。

### 相关内容

“相关”不是 Story 成员关系。Topic、Workspace、Spotlight 和 Feed 等上层体验以 Story 为组织单位；Entry 仍作为 Story 内的来源证据。第一版使用实体、时间、引用、因果、BM25 和用户兴趣等信号，暂不使用 embedding。

例如“Jeff Dean 创立 Discovery Loop”和“Jeff Dean 离开 Google/Gemini”共享人物并可能构成前后发展，因此适合作为相关 Story，或共同进入一个 Topic；它们不是同一个 Story。

### 分类

分类说明“这类内容放在哪里浏览”，例如开发、硬件、娱乐。它通常由标签和持久查询组合实现，不承担事件聚类或话题跟踪职责。

### 持续工作区（Workspace）

`Workspace` 是一个长期存在、可更新、可交互的用户体验单元，已经替代此前的 `Feature`。`Feature` 在软件开发中通常表示“功能”，同时又被拿来表示话题、页面和精华，歧义过大。

Workspace 可以引用多个 Story、Topic、查询或集合，绑定视图模板和可选的 Flow/Agent，并保存产物引用与用户交互状态；可以有一个可选的主要锚点，但不要求只能围绕一个 Topic。它不直接拥有或复制信息条目；更换 Agent、模板或报告版本后，身份、看板位置和进度仍然存在。

“每天五个单词”“Jeff Dean 离职专题”“每日 AI 写作竞品分析”都可以是 Workspace。

内部统一使用 `Workspace`；界面按 kind 显示“栏目”“专题”“学习计划”或“工作区”，不强制一个中文总称。

Workspace 的“正在更新”不是 Workspace 身份、生命周期或看板可见性的字段。它由独立的 Workspace Update/Run 状态投影表达，状态为 `queued`、`running`、`waiting`、`succeeded`、`failed` 或 `cancelled`。更新期间仍能查看最近一次成功发布的内容，失败或取消不会替换它。

### 产物（Artifact）

`Artifact` 是用户、系统或 Agent 生成的一次可保存结果，例如研究报告、批注版文章、图片、数据集、附件包或可视化网页。

Artifact 是版本化输出，不负责长期身份、自动刷新或用户进度。Workspace 可以连续产生多个 Artifact Revision。

### 热点（Spotlight）

热点不是新的内容类型，而是某个 Story、Topic 或 Workspace 在一段时间内获得高关注展示的结果。

系统可以根据消息量增速、来源多样性、重要性、紧急性和用户关注计算信号；自动 Spotlight 使用可续期 TTL，人工固定可以不设 TTL。

### 时间线（Timeline）

Timeline 是按时间展示 Story 或 Topic 更新的视图，不是与 Story、Topic 并列的聚合实体。台风登陆适合 Timeline 视图，不意味着它必须成为一种 `Timeline` 类型。

### 精华

“精华”是看板中的策展角色，不是单一底层实体。需要周期更新、Agent 维护或交互状态时使用 Workspace；只是一份固定报告或网页时使用 Artifact。

### 信息流与看板

信息流（Feed）是按分类、查询或推荐策略排列出的连续浏览结果，不是另一份内容副本。

看板（Board）把 Spotlight、精华、Workspace、Artifact 和 Feed 组合、分区和排序，但不拥有底层内容。

## 关系速记

```text
Observation -> Entry -> Story -> Story Revision
                     \-> source evidence

Story + Entity -> Topic
Topic / Story / Query --input binding--> Workspace -> Artifact Revision

Story / Topic / Workspace --Spotlight--> Board
Story --Ranking--> Feed --> Board
```

- `Entry -> Story` 是按 Story kind 判定的主归属；event kind 才要求“同一事件”的严格归并。
- `Story -> Topic` 是“对这个问题有帮助”的主观纳入；Topic 不直接收录 Entry。
- `related_to` 是比 Topic 更轻量、可由算法动态计算的关系。
- Story/Topic merge 选择 canonical ID；旧 ID 永久作为 alias/redirect，历史 revision 和引用不删除。
- Story split 保留旧 Story 作为历史壳，并以 `replaced_by[]` 明确列出后继 Story；旧 ID 不会被静默解析到某一个后继。
- Topic 不建立父子层级；Topic 间关系、标签以及 Workspace/Board 组织承担跨 Topic 的导航。
- `(Topic, Story)` 只有一个当前成员角色，角色变化通过 revision history 记录。
- Topic、Workspace、Spotlight 和 Feed 等上层体验使用 Story，不直接使用 Entry；需要查看证据时再展开 Story 成员。
- Workspace 负责持续体验，Artifact 负责某一次输出，Board 负责摆放。
- Workspace 输入关系可以是多对多，并可标记一个主要锚点；Workspace 不因绑定或解绑 Topic 而改变身份。
- Workspace Update/Run 是维护执行状态；它与 Workspace 生命周期、Board Placement 和 Interaction State 分开。
- Workspace Update 的候选内容只有成功时才原子发布；失败或取消保留上一成功版本。
- 人类接受的字段可以保护，Agent 先生成候选 Revision，不能静默覆盖受保护字段。
- Read State 保存 `last_seen_revision_id`，新 Revision 派生“有更新”，不删除历史已读事实。
- merge 当前用户状态解析到 canonical；split 不自动把状态或 Topic membership 复制到全部后继。
- Spotlight 人工固定/排除绑定具体 Placement，直到用户解除；不同 kind 共用 policy 合同。

## 自动化语言

- `Source`：从哪里获取什么信息。
- `Trigger`：何时或因何开始。
- `Flow`：要完成的过程。
- `Action`：Flow 调用的一项可复用能力。
- `Agent`：受用户配置范围和预算约束的一种 Action；它可以像协作者一样维护 Topic 或 Workspace，但不能改写来源原文。
- 人类、Agent 和系统的每次修改都记录 actor、时间、操作、基础 revision、理由和关联 Run。第一版是个人本地优先，不建设细粒度权限系统。
- Agent 可以维护已配置范围内的内部对象；创建外部 Source、扩大数据范围和外部发送需要用户显式配置或批准。
- 第一版只运行用户明确安装的本地可信扩展，复杂权限 UI 和不可信插件沙箱后置。

## 当前命名结论

1. 用户可读的最小内容单元使用“信息条目 / Entry”，不使用“原始报道”作为总称。
2. 上层规范内容单元使用 `Story`，并通过 kind 区分 event、document、media、thread；event Story 才表示同一事件聚类。
3. 长期、主观、目的驱动的聚合使用“话题 / Topic”，正式替代 `Subject`。
4. `Timeline` 是视图模板，`Spotlight` 是展示角色，二者都不是内容聚合类型。
5. `Workspace` 正式替代 `Feature`；界面根据 kind 使用“栏目”“专题”“学习计划”或“工作区”。
6. `Artifact` 保留，专门表示可追溯、版本化的生成结果。
7. 每个 Entry 默认拥有一个主 Story，单 Entry Story 是合法状态；Topic 只收录 Story。
8. Agent 自动创建 Topic 需要至少两个不同 Story，或命中用户明确跟踪规则。
9. 第一版相关推荐不使用 embedding。
10. Topic 不自动过期；人工归档后置。
11. 第一版预算保持简单：全局日预算、单次 Run 上限和紧急保留预算；复杂继承、公平调度和借用后置。
12. Story kind 保持少量核心集合，细分使用受管理、可扩展的 subtype。
13. 一个 Entry 只有一个主 Story，但可以作为证据关联多个其它 Story。
14. Story/Topic merge 保留旧 ID alias、历史 revision 和可审计 merge 记录。
15. Story subtype 通过受管理注册表扩展，核心 kind 合同保持稳定。
16. Story split 保留旧 Story 历史壳，并用 `replaced_by[]` 指向后继 Story；旧 ID 不会被模糊重定向。
17. v1 不建立 Topic 父子层级；Topic 间联系使用 Relation、标签或 Workspace/Board 组织。
18. Topic 成员关系只有一个当前角色，历史角色和修改过程保存在 revision history。
19. Story 使用不可变 Revision 和当前 Revision 指针；历史报告固定引用当时的 Revision。
20. Feed 的曝光与主要反馈以 `(用户, Story, surface)` 为粒度，展开信源后再记录 Entry 交互；收藏和批注可明确指向 Story 或 Entry。
21. Agent 可直接移除未被人类确认的自动 Topic 成员；人类明确加入或确认的成员需要提出移除建议，所有移除保留可恢复历史。
22. Workspace 可以绑定多个 Topic、Story、查询或集合，并可有一个主要锚点。
23. Spotlight 使用分离信号、版本化 policy、迟滞阈值和 TTL；人工固定或排除覆盖自动策略。
24. Workspace Update/Run 表达 Agent 的更新执行状态，不与 Workspace 身份、生命周期、Board Placement 或 Interaction State 混为一个字段。
25. Workspace Update 失败/取消保留上一成功版本，成功时原子发布候选内容。
26. 人类接受的字段保护优先于 Agent 自动更新。
27. `last_seen_revision_id` 只增加“有更新”投影，不抹掉已读历史。
28. merge 解析当前状态到 canonical；split 通过显式 migration，不自动扇出状态。
29. Spotlight 人工覆盖绑定具体 Placement，直到用户解除。
30. v1 和默认产品合同面向单个本地用户；未来协作保留 actor/revision 扩展位。
31. Agent 可自主维护已配置范围内的内部对象，新外部范围和外部副作用需要显式配置/批准。
32. 第一版不建设细粒度权限 UI 或不可信插件沙箱，只运行本地可信扩展。
33. Phase 1 首条真实 Connector 使用 RSS/RSSHub，并配套 fixture Connector。

## 技术与运行形态（初步）

> 2026-08-07。本节记录已经确认、但明确允许在真实实现后调整的技术方向。

- Web 使用 React + Next.js App Router；API 使用 NestJS；Scheduler、Flow 和 Job 由独立 Worker 运行。开发使用 Bun，生产使用 Node，面向生产的共享代码保持 Node-compatible，不把 Bun-only API 变成领域或公共合同。
- 初始数据层使用 Prisma + SQLite；FTS5/BM25、虚拟表、触发器和其它 SQLite 专用查询可以通过受控 SQL Adapter 实现。Prisma、SQLite 和搜索实现都不是不可替换的领域合同。
- 服务器部署是第一优先级；产品同时保留客户端模式和客户端与服务分离模式。三种模式共用 versioned Command、Query、Event 和 Service Endpoint 合同，客户端不直接访问 Prisma、SQLite 或 Data Root。
- Desktop Shell 只负责承载 UI、连接本地或远程服务并管理必要的本地生命周期；具体选择 Tauri、Electron 或其它壳后置，不让壳概念进入领域模型。
- 当前 Agent 使用量较少，Phase 1 可以直接使用 `pi-ai`。`neuro-agent-harness` 作为独立项目持续演进；稳定后再通过 `ModelRuntime`、`SessionStore`、Profile 和 Capability Adapter 接入 Cosmos。
- Harness 的 TSX Profile、领域无关常用工具（例如 `read`）和 SSE Transport 可以逐步吸收，但 NeuroBook 专属 Profile、Workspace、路径、配置和 watcher 不进入 Core；sidecar 不属于 Harness 核心职责，旁路执行由 Workflow 组合。
- shadcn/ui 使用官方 skill 和 CLI，组件代码归项目源码所有；skill 只约束组件查询、文档、组合、样式和更新流程，不是 Cosmos 的领域依赖。

## 后置事项

1. 同一 Workspace 的并发更新、重复触发合并和取消/接管语义。
2. Agent 候选 Revision 的接受/拒绝界面，以及字段保护的最小实现。
3. `updated_since_last_seen` 在不同 surface、Story split 和 Story merge 后的投影规则。
4. 显式 state migration command 的批量操作、撤销和用户确认边界。
5. Bun 开发与 Node 生产在 Next、Nest、Prisma、Worker 和 Harness Adapter 上的兼容矩阵。
6. Prisma/SQLite 的 FTS5 Migration、触发器、Raw SQL Repository 和未来存储替换边界。
7. 服务器、客户端和客户端与服务分离模式的认证、Service Endpoint、SSE 恢复和 Blob/Artifact 访问合同。
8. Desktop Shell 的具体实现、Node sidecar 生命周期和安装/升级/卸载行为。
9. `pi-ai` 直接接入到 Harness `ModelRuntime` 的迁移门槛，以及 NeuroBook Harness 与独立 Harness 的行为差异。

这些事项不阻塞 Phase 0，且本次 grilling 不继续展开。
