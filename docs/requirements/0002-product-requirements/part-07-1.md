---
parent: docs/requirements/0002-product-requirements.md
range: §7.1–7.4 采集、运行时与检索
sealed_at: 2026-09-14
tags: [requirements, prd, functional]
tokens_est: 6095
---

### 7.1 Source、Trigger、Workflow 与 Action

| ID | 阶段 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| AUT-001 | Phase 1 | 用户可以从 Web 选择可用 SourceDefinition/Connector，按配置 schema 创建、编辑、校验、测试、保存、停用/启用和删除 SourceInstance，并配置来源参数、凭据引用、抓取范围、频率和预算。首版产品入口只开放 `rss`，不开放 `fixture-rss`。 | 同一种 SourceDefinition 可创建多个互不混淆的实例；产品 E2E 从用户填写实际 RSS URL 开始；删除凭据、停用来源和删除历史数据是三个独立动作。 |
| AUT-002 | Phase 1 | 同一 Workflow 至少支持用户手动触发和定时触发；首版可采用默认定时抓取 30 分钟的实现建议，用户可以修改或关闭定时，测试动作立即执行。 | 两种入口执行同一版本 Workflow，并生成可查询的独立 Run；已排队 Run 使用创建时配置快照；30 分钟默认值及其调度字段合同需实现设计验证。 |
| AUT-003 | Phase 1 | 系统支持轮询来源并用持久 checkpoint 判断是否有新内容或变化。 | 重启后沿用 checkpoint；没有变化时不执行完整抓取和下游分析；配置修改不改变已经创建 Run 的输入快照。 |
| AUT-004 | Phase 2 | Trigger 可由 Webhook、内部事件、条件变化或上游 Workflow 结果触发。 | 每次触发保存触发原因、输入、时间和对应定义版本。 |
| AUT-005 | Phase 2 | 用户或插件可定义自定义 Trigger 和 Action。 | 扩展通过版本化 SDK 注册配置 schema、能力范围、输入、输出和失败语义，不直接访问核心数据库。 |
| AUT-006 | Phase 1 | Workflow 可以按顺序、条件和批量 fan-out 编排 Action。 | 同一个采集流程能够表达“拉取 → 标准化 → 去重 → 入库”，失败步骤和已完成步骤可区分。 |
| AUT-007 | Phase 3 | Action 可以运行受控自定义代码或 Agent。 | Run 明确记录代码/Agent 版本、配置能力范围、预算、输入、输出、超时和产物。 |
| AUT-008 | 跨阶段 | WorkflowDefinition 和 ActionDefinition 版本化。 | 已执行 Run 始终能定位到当时的定义；修改配置不会改变历史 Run 含义。 |
| AUT-009 | Phase 2 | 用户可以创建可复用的 ConnectionInstance，并让多个 SourceInstance/采集计划引用同一个连接。 | 用户能看到连接状态、授权范围和失效原因；撤销凭证不删除已录入历史；普通配置、Job payload 和日志不包含凭证明文。 |
| AUT-010 | Phase 2 | 一个连接下可以配置多个独立采集计划，每个计划拥有自己的来源操作、范围、频率、预算、checkpoint、发现上下文和失败状态。 | 同一 Bilibili 账号可以独立配置“动态每 30 分钟”和“推荐流每 2 小时”，两者的 Run、错误、重试和游标互不混淆。 |
| AUT-011 | Phase 3 | Agent 或 Action 可以通过持久 Runtime 请求子 Workflow/子 Job，而不是直接创建进程内任务。 | 子任务有父 Run/Activity、因果 Event、能力/来源引用、预算和递归深度；重启后可以查询、接管或收口；未来权限策略可以在同一合同上扩展。 |
| AUT-012 | 跨阶段 | Workflow 以脚本式执行语义为底层核心；Graph/IR/Comfy 类表达可以转换为脚本式 Workflow，不形成第二套执行引擎。 | 脚本、Graph 和 Agent 生成的流程都使用同一套 Run、Activity、Job/Attempt、重试、取消、恢复和 Event 合同；Step 只是可选逻辑/UI 投影；任意 Graph 不能绕过 Action/Capability 边界。 |
| AUT-013 | 跨阶段 | Workflow 支持轻量主分类和 tags，例如 `ingest`、`knowledge`、`research`、`maintenance`、`delivery`、`interaction` 和 `custom`。 | 分类用于展示、默认预算/优先级和运维统计，不改变 Runtime，也不为不同分类复制执行引擎。 |
| AUT-014 | 跨阶段 | 脚本式 Workflow 通过稳定 `WorkflowContext` 调用 Action、Query、Child Workflow、等待、Event、checkpoint、取消和预算能力。 | Workflow 不直接访问 Prisma、SQLite、Blob Root、任意 HTTP 或进程 API；新增 Adapter/LLM/来源只需注册 Action/Query，不修改 Runtime 核心。 |
| AUT-015 | 跨阶段 | WorkflowDefinition、ActionDefinition 和 TriggerBinding 必须版本化。 | 已启动的 WorkflowRun 始终引用不可变的定义版本；修改注册项不会改变历史执行含义。 |
| AUT-016 | 跨阶段 | WorkflowRun 必须保存触发原因、定义版本、输入快照、预算快照和父子关系。 | 排队后修改 Source、Connection 或 Workflow 配置不会改变已创建 Run 的输入和解释。 |
| AUT-017 | 跨阶段 | Workflow/Run/Job 的终态收口必须在同一持久一致性边界内完成。 | 旧 Worker 或失效 lease 不能在中途写入事实、推进 checkpoint、覆盖 FTS 或提交新的终态。 |
| AUT-018 | 跨阶段 | ActionDefinition 必须声明 `host`、`trusted_worker` 或 `remote_worker` execution placement。 | `library.ingest`、checkpoint 等领域写入不发送给远程 Worker；需要 Browser Bridge/本机 profile 的 Action 不发送给普通远程 Worker；远程可执行 Action 仍需 manifest hash、schema 和 capability 精确匹配。 |

`ActionDefinition` 是可复用能力的版本化合同，不是某一次执行任务。它声明输入/输出、能力范围、幂等、超时、取消和恢复语义；具体调用记录为 Workflow Activity，需要外部执行时由 Host 创建 Job，每次 Worker 执行形成带 lease 的 Attempt。Step 只在需要命名逻辑分组或 UI 投影时出现。

当前产品把以下对象都视为同一 Runtime 下的 Workflow：

- `Ingest Workflow`：把外部来源事实编排进入 Cosmos。
- `Knowledge Workflow`：对 Entry 做规则、模型或 Agent 分析，生成 Story/Topic/关系 Proposal。
- `Research Workflow`：查询 Cosmos 信息库并主动访问已配置的外部渠道。
- `Maintenance Workflow`：重建索引、清理、对账和修复。
- `Delivery Workflow`：生成、渲染和发送用户可见结果。

这些是产品用途分类，不是互相独立的技术引擎。

### 7.2 持久运行与恢复

| ID | 阶段 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| RUN-001 | Phase 1 | 每次 WorkflowRun 和 Activity 都有可恢复状态、时间、输入 fingerprint、输出引用和错误；命名 Step 投影可选。 | 应用重启后可以查看历史，并判断哪些工作需恢复、重试或人工处理；未创建 Step 不影响 replay。 |
| RUN-002 | Phase 1 | 内部任务按至少一次执行设计，并使用业务幂等键阻止无界重复。 | 同一来源游标被重复处理时不产生重复 Entry；旧 Worker 不能覆盖接管者结果。 |
| RUN-003 | Phase 1 | Worker 使用有期限租约、心跳、有界重试和终态失败。 | Worker 中断后任务可接管；超过预算后进入可查询终态，不无限重试。 |
| RUN-004 | Phase 2 | 用户可以取消、重新运行或从安全步骤恢复 Run。 | UI/API 明确说明会重用哪些结果、产生哪些新副作用。 |
| RUN-005 | Phase 5 | 外部发送结果未知时保存 `uncertain`，不能自动伪装为成功或普通失败。 | 渠道支持查询时可对账收敛；不支持时按明确策略或用户确认处理。 |
| RUN-006 | 跨阶段 | 交互、紧急、录入、分析、Artifact 和维护任务使用不同优先级与预算。 | 大批量采集不能长期阻塞用户操作或紧急状态检查。 |
| RUN-007 | Phase 3 | Run、Activity、Job 和 Attempt 可以表达 Action 版本、父子关系、fan-out/fan-in、等待输入和可恢复的子任务；Step 可作为命名进度投影。 | 一个 LLM 研究计划拆出的多个平台搜索任务可以独立重试、合并结果，并在父 Run 中显示进度和最终收口原因。 |
| RUN-008 | 跨阶段 | lease fencing 必须覆盖 Job 的所有受保护写入和 checkpoint 收口。 | 旧 Worker lease 失效后，写 Observation/Entry/Revision/Asset/FTS、DomainEvent、checkpoint 或 terminal result 均被拒绝；新 Worker 可以安全接管。 |
| RUN-009 | 跨阶段 | Job 必须保存 priority、lane、budget、waiting reason、lease token、heartbeat 和 retry 状态。 | urgent、interactive、ingestion、analysis 和 maintenance 任务有可观察的调度与恢复边界，不因普通采集长期阻塞紧急研究或用户交互。 |
| RUN-010 | Phase 1C | 远程 Worker 通过独立 Worker Gateway Session、HTTPS long-poll claim、Attempt heartbeat、Receipt 和幂等 Result API 执行任务。 | Gateway 先在 SQL TaskStore 原子 claim 再返回 Job；Session heartbeat 不代替 Attempt lease；旧 token、过期 Session 和迟到结果不能覆盖当前 owner；Gateway 不保存第二份 Job 终态。 |
| RUN-011 | Phase 1C | Direct Worker 和 Gateway Worker 必须通过同一 TaskStore/Attempt/Receipt conformance 行为套件。 | 两种 Transport 使用同一 Job 状态机、retry policy、manifest/schema 校验、lease fencing、取消和 external-result-unknown 语义；Transport 差异不会产生两套 canonical logic。 |

### 7.3 信息采集与本地保存

| ID | 阶段 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| ING-001 | Phase 1 | 外部信息没有 URL 时仍能完整录入。 | Telegram、邮件或群聊 fixture 可通过结构化来源定位入库、查询和打开；`webUrl` 为空不报错。 |
| ING-002 | Phase 1 | 每次采集到的原始 Observation 不可原地修改。 | 来源编辑、删除或重抓会追加 Observation/Revision，旧证据仍可追溯。 |
| ING-003 | Phase 1 | 系统保存来源时间、采集时间、外部稳定 ID、来源定位、原始 payload 引用和产生它的 Run。 | 任意 Entry 可回到至少一个原始 Observation 和 SourceInstance。 |
| ING-004 | Phase 1 | 系统记录内容为什么被发现。 | 能区分关注账号、首页推荐、搜索词、公告监控、邮箱、手动导入、相关链接和 Agent 调研。 |
| ING-005 | Phase 1 | 同一来源的重复轮询需去重，来源更新需形成修订。 | 重复运行不产生新的稳定 Entry；真实编辑产生新 Revision。 |
| ING-006 | Phase 2 | 跨来源重复、转载和同事件报道要建立关系，不粗暴合并来源身份。 | 官方公告与转载仍是两个 Entry，可以标记重复或归入同一 Story。 |
| ING-007 | Phase 1 | 成功录入的核心文本和元数据可离线访问。 | 断网后能检索、打开正文、查看来源和已保存关系。 |
| ING-008 | Phase 1 | 图片、音频、视频、附件、HTML 快照和其它媒体按策略“尽可能保存”。v1 媒体边界已按 [media-boundary-v1 Proposal](../../proposals/media-boundary-v1.md) 与 [ADR-0005](../../adr/0005-media-boundary-v1.md) 冻结：媒体发现范围为 RSS 条目自身的 enclosure 与正文媒体标签，不抓取 `webUrl` 外部全文；图片下载为本地实体，音频/视频与其它类型只保存元数据与原文外链；无历史媒体回填。 | 每个 Asset 明确显示已保存、仅元数据、超预算、策略/安全跳过或失败等状态并保留原文链接；降级状态显示原因（`errorMessage`），不用空白或加载中掩盖。v1 全局默认预算为单文件 10MB、单次 Run 50MB；per-source 媒体类型/预算/保留期/失败重试策略后置到 ING-009。 |
| ING-009 | Phase 2 | 用户可以按 SourceInstance 配置媒体类型、单文件/单次预算、保留期和失败重试。 | 修改策略只影响后续采集或明确的清理任务，不静默删除已有数据；具体媒体容量默认值和下载合同在实现设计中确定。 |
| ING-010 | Phase 4 | Source 可覆盖平台首页推荐、关注用户、搜索结果、公告、AIHOT 类聚合站和邮件。 | 每种接入分别记录认证、速率、游标、平台限制和真实验收结果。 |
| ING-011 | Phase 1 | 第一条管线集成切片使用 RSS/RSSHub 和本地 fixture，验证采集、信息库、最小 Story projection、搜索/Feed 和离线访问闭环。 | fixture 能覆盖有 URL、无 URL、重复轮询、来源修订和媒体状态；每个已录入 Entry 至少能投影为一个可打开的 Story；该 fixture 链路不等同于产品可用验收，产品 E2E 必须另行从 Web 填写实际 RSS URL 开始。跨来源聚类、merge、split 和 Topic 维护后置。 |
| ING-012 | Phase 2 | Connector 可以通过 Cosmos 提供的命名空间化、版本化 StateStore 保存 cursor、ETag、分页 token 和速率状态等非秘密运行状态。 | Adapter 不直接写核心数据库；状态可备份、恢复、迁移并按 Connection/Source/Workflow 范围隔离；Secret 不混入普通状态。 |
| ING-013 | Phase 2 | Entry → Story 的知识处理可以配置为 Workflow；用户和 Agent 可以选择“批量全量 Agent”或“脚本优先、困难/强相关/重要内容升级 Agent”等策略。 | 事实入库不依赖 LLM；处理 Workflow 有版本、输入批次、输出 Proposal、失败状态和可重跑边界；更换策略不覆盖 Observation。 |
| ING-014 | Phase 3 | Research 不与 Ingest 强耦合；知识分析可以产生紧急、需要研究或来源冲突信号，再由 Trigger 启动独立 Research Workflow。 | Research Request/触发原因可追溯；研究结果重新经过 Observation → Entry，不直接写入 Story；研究失败不丢失原始 Entry。 |
| ING-015 | 跨阶段 | 每个 Connector 必须返回外部稳定 external key；没有外部 ID 时必须由完整 `sourceLocator` 和规范化内容生成 fallback key。 | 同标题、同时间但不同来源位置的无 URL 内容不会被错误合并；key 规则版本化且可回放。 |
| ING-016 | 跨阶段 | 每个 Observation 必须保存结构化 `originLocator`、`discoveryContext`、原始 payload 引用、媒体保存状态和产生它的 WorkflowRun。 | 能区分关注账号、推荐流、搜索、公告监控、手动导入、Agent 调研和 Research 发现；旧 Observation 不被覆盖。 |
| ING-017 | Phase 1B | Connector 标准化输出必须携带内容形态、发布者、互动指标和证据优先的时间值。 | `NormalizedIngestItem.kind` 区分 `listing`/`video` 等内容形态；`publisher.platformId` 可为 `null`，作者名仍可保存；`metrics` 是当前快照且不创建 Revision；精准时间统一为 UTC，展示文本只作 fallback。 |

### 7.3.1 KnowledgeSignal 与 ResearchRequest

| ID | 阶段 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| KNO-001 | Phase 3 | Knowledge Workflow 可以产生不可覆盖的 `KnowledgeSignal`，表示 `urgent`、`needs_research`、`source_conflict` 或 `high_importance` 等判断。 | Signal 保存 target、target revision、reason、evidence、producer/version、confidence、Run 和时间；新判断追加，不覆盖旧判断。 |
| KNO-002 | Phase 3 | `KnowledgeSignal` 不直接代表执行任务，也不直接写入 Story 真相。 | 系统可以独立记录判断、接受/忽略/转化状态，并保留原始 Entry/Revision 和 Proposal provenance。 |
| RES-001 | Phase 3 | `ResearchRequest` 表示一次独立研究行动，保存 signalIds、goal、scope、priority、idempotencyKey、父 Run/Step、Workflow 引用/版本、状态和结果引用。 | 状态至少支持 `queued`、`running`、`succeeded`、`failed`、`cancelled`、`expired`；重复请求按幂等键合并或返回既有请求。 |
| RES-002 | Phase 3 | Research Request 必须由 Trigger 启动 Research Workflow，且与 Ingest Workflow 解耦。 | 触发原因、输入快照、预算、循环深度、外部 Action 调用和失败恢复可查询；Research 失败不会回滚已保存的 Entry。 |
| RES-003 | Phase 3 | Research Workflow 的外部发现必须通过统一 Ingest Command 重新进入 Observation → Entry。 | 研究结果携带 ResearchRequest、查询目标、发现来源和 Run provenance；不能绕过 Observation 直接把外部结果写入 Story。 |

### 7.4 信息库、分类与检索

| ID | 阶段 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| LIB-001 | Phase 1 | 用户可以按关键词、时间、来源、作者、媒体类型和录入状态查询 Entry。 | 组合过滤行为稳定，查询结果可分页且可定位到原始内容。 |
| LIB-002 | Phase 1 | 本地全文检索使用词法相关性排序；当前将原始需求中的“BM5”按 BM25 理解。 | 精确名称、代码和短语无需 LLM 或外网即可搜索。 |
| LIB-003 | Phase 2 | 用户可以创建 Label、Annotation、Collection 和 Saved View。 | 重新分析、重新索引或刷新 Artifact 后，用户数据不丢失。 |
| LIB-004 | Phase 2 | Annotation 可绑定 Entry、Story、Topic、Artifact 或正文片段。 | 批注能显示作者、时间、目标版本和可选依据。 |
| LIB-005 | Phase 2 | Saved View 可保存分类、时间、来源、状态、未读和 Topic 等查询条件。 | 看板 Feed Block 与搜索页可复用同一 Saved View。 |
| LIB-006 | Phase 4 | 第一版查询组合结构化、BM25、Entity、时间、引用和关系检索；embedding 后置。 | 每类索引可独立重建；结果能说明主要匹配信号，模型不可用时仍工作。 |
| LIB-007 | 跨阶段 | 每个 Entry、Story、Topic、Artifact 和 Workspace 都有稳定内部地址。 | 无外部 URL 的内容也能从看板、搜索或 Artifact 中跳转。 |
| LIB-008 | Phase 2 | 用户可以查看、导出和删除自己拥有的持久数据。 | 删除范围、被引用对象和无法恢复的内容在执行前明确展示。 |

**Phase 2 第四切片注记（2026-09-08，[`label-annotation-collection-saved-view-v1` Proposal](../../proposals/label-annotation-collection-saved-view-v1.md) accepted）**：LIB-003/004/005/008 的 v1 实施顺序按 Proposal 冻结——先交付用户组织四类（Label 分类标签 + Collection 命名收藏夹 + Story/Entry 轻量收藏标记、Annotation 批注、Saved View 持久查询视图），分三个子切片逐片合入（Label+Collection → Annotation → Saved View）；Annotation 目标 = Story/Entry/Topic，Artifact 与正文片段字符级锚点后置（片段暂用可选 quote 文本表达）；Saved View 只存查询条件不存快照，`search` 扩展 `labelIds`/`topicIds` 过滤。LIB-004 的 Artifact 目标、LIB-005 的「未读/状态」条件（依赖 Read State）与 Feed Block 绑定（BRD-006，依赖可配置看板）、LIB-008 的批量导出/删除后置。上述注记只排定实现顺序，不改变本表最终验收条件。

**Phase 2 尾巴第二切片注记（2026-09-16，[`entry-duplicate-relations-v1` Proposal](../../proposals/entry-duplicate-relations-v1.md) accepted）**：ING-006 的 v1 实施顺序按 Proposal 与 [ADR-0022](../../adr/0022-entry-duplicate-relations-v1.md) 冻结——关系族直接用信息模型 §4.2 已冻结的三个词：`duplicate_of`（完全重复，对称）、`syndicated_from`（转载，有向：转载方 → 原发方）、`near_duplicate_of`（近重复，对称）；新建 `EntryRelation` 表（`(fromEntryId, toEntryId)` 唯一 + relationType + provenance），对称类型按 id 字典序归一化存储并双向读取，反向与自关联返回 409；关系挂**条目内容身份**，`mergeStories`/`splitStory` 不迁移不修改、条目删除级联；**只人工写入**（自动判定属 ORG-021）；v1 **只做标记与展示，不参与 Feed 排序、搜索与去重，也不折叠来源身份**；`EntryDetail` 返回关系列表，Story 成员行标注「转载自/重复于」但不带对端 Story 链接；跨 Story 的「同一事件提示」不做（已由人工归并与引用关系覆盖）。「归入同一 Story」这半边继续由既有归并/引用关系承担。上述注记只排定实现顺序，不改变本表最终验收条件。
