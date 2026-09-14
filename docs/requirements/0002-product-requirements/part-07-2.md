---
parent: docs/requirements/0002-product-requirements.md
range: §7.5 Story、Topic、Entity 与关系
sealed_at: 2026-09-14
tags: [requirements, prd, functional]
tokens_est: 7017
---

### 7.5 Story、Topic、Entity 与关系

| ID | 阶段 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| ORG-001 | Phase 2 | 每个 Entry 默认拥有一个主 Story；Story 使用稳定核心 kind 和受管理、可扩展 subtype 区分 event、document、media、thread 等规范内容形态。 | 单 Entry Story 合法；event Story 聚合同一现实事件，`media.comic`、`media.anime` 等 subtype 不产生新的核心 kind。 |
| ORG-002 | Phase 2 | Topic 表示长期、目的驱动且允许主观判断的关注范围，只收录 Story，并可绑定来源、查询、告警、Workflow 和 Workspace。 | “为什么 Jeff Dean 离职引起轰动？”可以包含离职、创业和其它背景事件 Story，但不能直接加入 Entry。 |
| ORG-003 | Phase 2 | 系统识别人、组织、产品、项目、模型和地点等 Entity，并保存带依据的关系。 | 自动关系记录 producer、version、confidence 和 evidence；人工修正不会被重分析覆盖。 |
| ORG-004 | Phase 2 | Story 自动归并必须允许人工 merge、split 和成员修正。 | 模糊候选可以暂时分开；修改后保留审计记录并更新相关展示。 |
| ORG-005 | Phase 2 | 相关教程、项目和背景材料使用 document/media 等 Story 表示，不得成为错误的 event Story 成员。 | 热点详情能区分同 event Story 的来源和其它相关 kind Story。 |
| ORG-006 | Phase 2 | Topic 成员保存纳入理由和角色，例如 core、update、background、analysis、counterpoint 或 tutorial。 | 用户能理解内容为何进入 Topic，并能修正、移除或改变角色。 |
| ORG-007 | Phase 3 | Agent 只有在至少两个不同 Story 构成持续问题，或命中用户明确跟踪规则时，才自动创建 Topic。 | Topic 创建后默认启用维护；保存创建理由、seed、范围、actor/revision，并允许用户基于任意 Story 手动创建。 |
| ORG-008 | Phase 2 | Topic、Workspace、Spotlight 和 Feed 等上层体验以 Story 为内容单位，不直接消费 Entry。 | 用户从 Story 展开后仍能查看精确 Entry/Revision 证据。 |
| ORG-009 | 跨阶段 | Topic 不自动过期；人工归档能力后置。 | 长期 Topic 不因静默期被隐藏或删除；未来归档是显式、可审计的人类操作。 |
| ORG-010 | 跨阶段 | 人类、Agent 和系统均作为协作者，每次修改记录 actor、base revision、结果 revision、时间、理由和关联 Run。 | 用户能看到操作者和修改者；历史修改可追溯。 |
| ORG-011 | Phase 2 | 一个 Entry 只有一个主 Story，但可以通过 evidence_for、mentions 或文本片段关联多个其它 Story。 | 一篇讨论多个事件的文章仍属于 document Story，同时可以作为多个 event Story 的证据。 |
| ORG-012 | Phase 2 | Story/Topic merge 使用 canonical ID，并永久保留旧 ID alias/redirect、历史 revision 和引用。 | 旧链接、Artifact provenance 和批注在 merge 后继续有效；merge 本身可审计。 |
| ORG-013 | Phase 2 | Story subtype 必须通过受管理注册表扩展，注册项声明所属核心 kind、版本、展示信息和身份规则。 | 内置和插件 subtype 使用同一合同；未知 subtype 可按核心 kind 降级展示，不会破坏旧客户端的通用 Story 读取。 |
| ORG-014 | Phase 2 | Story split 必须保留旧 Story 的历史壳，并用 `replaced_by[]` 指向全部后继 Story；旧 ID 不得被静默重定向到单一后继。 | 旧 Story 的 revision、成员历史、批注、Artifact provenance 和审计仍可查看；当前成员转移有显式 split mapping。 |
| ORG-015 | Phase 2 | v1 不建立 Topic 父子层级；Topic 之间的联系使用带类型的 Relation、标签或 Workspace/Board 组织。 | 查询和导航不会把 Topic 的展示层级误当成 Topic 语义上的父子关系。 |
| ORG-016 | Phase 2 | 一个 `(Topic, Story)` 组合只有一个当前成员角色，纳入、移除和角色变更通过 revision history 保存。 | 用户能看到当前角色和历史操作者/理由；v1 不产生并列的当前 membership assertions。 |
| ORG-017 | Phase 2 | Story 身份保持稳定；标题、摘要、关键事实和时间范围通过不可变 Story Revision 表达，并由 `current_revision_id` 选择当前表示。 | 新证据只有造成实质变化时才产生 Revision；历史 Artifact、Publication 和批注固定引用原 Revision。 |
| ORG-018 | Phase 3 | Agent 可以直接移除由系统/Agent 自动加入且未被人类确认的 Topic 成员；人类明确加入或确认的成员只能被 Agent 提议移除。 | 所有移除形成可恢复的 membership revision，保留 actor、理由、evidence 和关联 Run。 |
| ORG-019 | Phase 3 | 人类接受的 Story/Workspace 内容字段可以被保护；Agent 自动更新必须先生成候选 Revision，不能静默覆盖受保护字段。 | 用户能区分候选、当前和历史 Revision；未受保护字段可按策略自动提升，受保护字段保留人类版本。 |
| ORG-020 | Phase 2 | Story merge/split 必须定义用户状态和 Topic membership 的迁移语义。 | merge 的当前状态解析到 canonical；split 不自动复制到全部后继，显式迁移记录 actor、理由、依据且可撤销。 |
| ORG-021 | Phase 2 | Entry → Story 的组织允许确定性算法、传统模型和 LLM 协同；同步入库不依赖 LLM，异步分析可以提出分类、聚类、实体、关系、重要性和紧急性建议。 | 每个自动结果保存输入 Revision、producer、版本、置信度、evidence 和关联 Run；LLM 不能直接改写 Observation 或绕过确认策略。 |
| ORG-022 | Phase 2 | Story 支持多 Entry 成员和可审计的成员候选、接受、拒绝、merge、split 与证据关系。 | 多个平台描述同一事件时仍保留各自 Entry/Observation，同时可以在一个 event Story 中展示；相关但不同事件不会被强制合并。 |

**Phase 2 首切片注记（2026-09-07，[`story-domain-v1` Proposal](../../proposals/story-domain-v1.md) accepted）**：ORG-001/004/011/012/013/017/020/022 的 v1 实施顺序按 Proposal 冻结——先交付用户显式编排（Entry 主归属移动、Story Revision 更新、Story merge canonical/alias），保持 ingest 自动创建单 Entry Story 不回退；自动聚类与 Knowledge Workflow（ORG-021）、Story split 完整生命周期（ORG-014/020）与 `evidence_for`/`mentions` 跨 Story 引用（ORG-011）后置；`Entry.storyId` 保持主归属唯一真相，不新建并行 membership 表。上述注记只排定实现顺序，不改变本表最终验收条件。

**Phase 2 第二切片注记（2026-09-08，[`topic-domain-v1` Proposal](../../proposals/topic-domain-v1.md) accepted）**：ORG-002/006/008/009/012/015/016/020 的 v1 实施顺序按 Proposal 冻结——先交付 Topic 实体（title/purpose/scope 走不可变 `TopicRevision`）+ Topic Membership（受管枚举角色 `core`/`update`/`background`/`analysis`/`counterpoint`/`tutorial` + 纳入理由 + 单一当前角色 + 不可变 membership revision/tombstone）+ Topic merge（canonical/alias + 成员去重迁移），Web 成员添加入口从 Story 侧发起；Agent 自动创建与自动维护（ORG-007）、`TopicMaintenanceBinding`/`TopicRelation`/父子层级（ORG-015）、归档与 Spotlight/Board/Subscription 后置；`Story merge` 同步迁移 membership 到 canonical（ORG-020 merge 侧语义）。上述注记只排定实现顺序，不改变本表最终验收条件。

**Phase 2 第三切片注记（2026-09-08，[`entity-relation-v1` Proposal](../../proposals/entity-relation-v1.md) accepted）**：ORG-003 的 v1 实施顺序按 Proposal 冻结——先交付 Entity 实体（受管类型枚举 `person`/`organization`/`product`/`project`/`model`/`location` + 规范名走不可变 `EntityRevision` + `EntityAlias` 名称别名）+ Story↔Entity 关联 + Entity↔Entity 类型化关系（受管关系类型枚举 + provenance：producer/version/confidence/evidence），全部手动优先；自动 Entity 识别/Knowledge Workflow（ORG-021）、Entity merge/dedup、`evidence_for`/`mentions` 跨 Story 引用（ORG-011）后置。上述注记只排定实现顺序，不改变本表最终验收条件。

**Phase 2 第六切片注记（2026-09-09，[`evidence-for-mentions-v1` Proposal](../../proposals/evidence-for-mentions-v1.md) accepted）**：ORG-011 的 v1 实施顺序按 Proposal 冻结——先交付 Entry↔Story 证据关系（`(entryId, storyId)` 唯一当前关系 + 受管关系类型 `evidence_for`/`mentions` + provenance），`Entry.storyId` 保持主归属唯一真相且禁止指向自己的主 Story；`StoryDetail` 返回证据来源列表、`EntryDetail` 返回关联 Story 列表；`mergeStories` 同事务重定向、`moveEntryToStory` 删除指向新主 Story 的冗余关系；全部手动优先。正文片段字符级锚点、自动抽取/提议（ORG-021）、Story↔Story 类型化关系（§4.5 的 `followed_by`/`background_for`，服务 REC-008 完整形态）与 Story split 的关系迁移后置。上述注记只排定实现顺序，不改变本表最终验收条件。

**Phase 2 第七切片注记（2026-09-09，[`story-split-v1` Proposal](../../proposals/story-split-v1.md) accepted）**：ORG-004/014/020/022 的 split 侧 v1 实施顺序按 Proposal 冻结——先交付「历史壳 + 全部后继」的 Story split（`StoryReplacement` 关系表、状态派生、旧 ID 不写 alias、不静默重定向；`StoryDetail` 新增 `status`/`replacedBy[]`，`entry` 放宽为可空）与单命令显式映射（每个后继至少 1 个主成员，可显式迁移主成员/证据链接/Story↔Entity/Topic 成员，未列出的关系留在历史壳）；用户状态（收藏/标签/收藏夹/批注/Spotlight）留在历史壳、v1 不迁移；历史壳拒绝 merge、改 Revision 与再次 split。用户状态的显式迁移与撤销（待决定事项 10）、Read State 上线后 `updated_since_last_seen` 的 split 投影（待决定事项 9）、自动拆分建议（ORG-021）与 Story↔Story 类型化关系后置。上述注记只排定实现顺序，不改变本表最终验收条件。

**Phase 2 第八切片注记（2026-09-09，[`story-subtype-registry-v1` Proposal](../../proposals/story-subtype-registry-v1.md) accepted）**：ORG-013 的 v1 实施顺序按 Proposal 冻结——subtype 从任意字符串变为受管理注册项（id 按核心 kind 命名空间化、所属 kind、注册项版本、用户可读名称/描述、状态 `active`/`deprecated`/`retired`、声明式身份规则标识、owner），v1 注册表是**代码内静态清单**（不建表、不改 Prisma schema、不写 migration）；写入侧（改 Story Revision、拆分后继）只接受该 kind 下 `active` 的注册项，既有未知 subtype 数据不改写、仍按核心 kind 降级展示；新增只读 `GET /api/v1/story-subtypes` 目录接口，Web 编辑与拆分改用下拉选择。首批只注册 `media.comic`/`media.anime`/`media.video`；身份规则的判定执行（ORG-021）、插件运行时注册、subtype 重命名/合并/迁移工具后置。上述注记只排定实现顺序，不改变本表最终验收条件。

**Phase 2 第九切片注记（2026-09-09，[`per-source-media-policy-v1` Proposal](../../proposals/per-source-media-policy-v1.md) accepted）**：ING-009 的 v1 实施顺序按 Proposal 冻结——先交付「按来源的图片下载开关 + 单文件/单次预算」，策略写在 `Source.config.media`（`images`/`maxFileBytes`/`maxRunBytes`，全部可选，缺省跟随全局默认 10MB/50MB），v1 只对声明 `media-download` 的 `source.rss@1` 开放；来源只能收紧全局默认、不能放宽（schema 上界即全局默认）；有效策略在 fetch 时从 Run 的 `SourceExecutionSnapshot` 解析，因此改动只影响之后入队的采集，已存 Asset 不改写、不删除；Web 在来源行提供媒体策略编辑（`PATCH /sources/:id` + `baseRevisionId` CAS）。保留期与清理任务、失败重试与历史回填、音频/视频下载实体、单条目媒体数量上限、全局默认值的 env 化后置。上述注记只排定实现顺序，不改变本表最终验收条件。

**Phase 2 第十切片注记（2026-09-09，[`media-retry-retention-v1` Proposal](../../proposals/media-retry-retention-v1.md) accepted）**：ING-009 的剩余两项（失败重试、保留期）按 Proposal 冻结——失败重试在来源的常规采集 Run 内自动发生（`cosmos.ingest@1` 在 fetch 之后、持久化之前增加 `media.retry.fetch@1`/`media.retry.apply@1`，只处理**早先 Run 已存**的降级 Asset，定时采集与既有「手动采集」走同一路径，不新增端点/Run 类型）；可重试性由机器可读 `Asset.errorCode` 决定，只重试 `timeout`/`network`/`http_error`/`budget_run`，不解析展示文案；每来源 `Source.config.media.retry.maxAttempts`（含首次尝试，缺省 3，0 = 关闭，上界 10）+ `Asset.attemptCount` 构成上限，重试只原地改写 Asset 行、不产生新 EntryRevision、与本次 Run 的新内容共享单次预算。保留期按来源 `Source.config.media.retentionDays`（1–3650，缺省永久保留）配置，清理是显式命令（`POST /api/v1/media-cleanups`，先 `dryRun` 预览再确认执行，不随采集自动删除），只删 Blob 字节并把 Asset 回退为 `metadata_only` + 「已按保留期清理」原因，保留原文外链，公共 4 态枚举不变；删除前做 Blob 引用检查（内容寻址去重，最后一个引用者才删字节）；清理由 durable 维护 Workflow `cosmos.media-cleanup@1` 承载。历史媒体回填、清理后自动重新下载、音频/视频下载实体、单条目媒体数量上限、全局默认值的 env 化后置。上述注记只排定实现顺序，不改变本表最终验收条件。

**Phase 2 第十一切片注记（2026-09-10，[`run-control-v1` Proposal](../../proposals/run-control-v1.md) accepted）**：RUN-004 的 v1 实施顺序按 Proposal 冻结——先交付 durable `WorkflowRun` 的三个控制动作：取消（`POST /runs/:id/cancellations`，用户覆盖式终态化为 `cancelled` 并 fence 掉 Worker 后续写入，不要求持有当前 lease，已入库内容不回滚）、重新运行（`POST /runs/:id/re-runs`，复用采集入队产生全新 Run，新幂等键 + `manual`，复用已入库结果、从来源当前 checkpoint 重新 fetch+ingest，只对终态 Run 开放）、恢复（`POST /runs/:id/recoveries`，把失去活动 lease 的非终态 Run 置 `resumeRequired` 送回恢复队列，由 Kernel `rerun()` 从最后安全步骤续跑）；三个响应都携带面向用户的 `reuse`/`sideEffects` 说明，公共 Run 五态与 Run 投影不变、零数据迁移。Step 级选择性重放、legacy Run 控制后置。上述注记只排定实现顺序，不改变本表最终验收条件。

**Phase 2 第十二切片注记（2026-09-10，[`connection-state-store-v1` Proposal](../../proposals/connection-state-store-v1.md) accepted）**：AUT-009/ING-012/OPS-009 的平台面基础设施 v1 按 Proposal 冻结——先交付 `ConnectionInstance` 实体（可复用连接身份，`SourceInstance.connectionId` 可空外键，无认证来源为 null，Bilibili OpenCLI profile 继续作为外部登录态例外）+ `SecretStore` 第一版（受限权限明文文件，不加密，公开合同只暴露不透明 `SecretRef`）+ `ConnectorStateStore`（命名空间化版本化 KV，version CAS，覆盖 ETag/分页 token/速率等非秘密状态，不迁移 `Checkpoint`）；Secret 不进 config/Job/Event/日志，Secret/State/Blob 所有权互不混写。CollectionPlan/多采集计划（AUT-010）、Checkpoint 迁移、加密-at-rest、真实认证 Adapter 后置。上述注记只排定实现顺序，不改变本表最终验收条件。

**Phase 2 第十三切片注记（2026-09-10，[`trigger-sdk-v1` Proposal](../../proposals/trigger-sdk-v1.md) accepted）**：AUT-004/EXT-006/007 的平台面 v1 按 Proposal 冻结——先交付 `TriggerBinding` 实体（单绑定 schedule/manual，从 `SourceInstance.config.scheduleIntervalMs` 迁出，调度循环改读 `listScheduleTriggers`）+ `SourceDefinitionManifest` 扩展 `auth`（none/oauth/cookie/secret_ref/external + secretRefRequired）与 `operations`（input/output schema、稳定 external key、discovery context、media、stateStore 命名空间）；EXT-003 版本化合同保持现状。webhook/内部事件/上游结果触发（AUT-004 完整形态）、自定义 Trigger/Action 插件运行时（AUT-005）、多计划 overlap policy 后置。上述注记只排定实现顺序，不改变本表最终验收条件。

**Phase 2 第十四切片注记（2026-09-10，[`ops-storage-v1` Proposal](../../proposals/ops-storage-v1.md) accepted）**：OPS-003/004 的 v1 按 Proposal 冻结——先交付 `GET /storage-stats`（数据库/Blob/Artifact/Cache/Log/Secret 字节 + 分层 raw/user/rebuildable/cleanable，只读）+ `POST /backups`/`GET /backups`（`VACUUM INTO` 复制 SQLite 到数据根 `backups/`，不依赖源码 checkout）+ `POST /backups/:id/restores`（覆盖 SQLite + 恢复前保护备份，需重启生效）；清理沿用 media-cleanup「预览 → 确认」。导出、Artifact/Cache 清理（LIB-008 完整形态）、Blob 备份、增量/云端备份后置。上述注记只排定实现顺序，不改变本表最终验收条件。

| ID | 阶段 | 需求 | 验收条件 |
| --- | --- | --- | --- |
| REC-001 | Phase 1 | Admission 决定是否录入，Ranking 决定当前是否展示。 | 一条未进入今日 Feed 的已录入信息仍可在信息库搜索。 |
| REC-002 | Phase 4 | Story 候选可来自关注账号、平台推荐、搜索查询、相关链接、Story 更新和 Agent 建议。 | 每个候选保存发现来源，不把平台推荐分数当作 Cosmos 最终分数，也暂不把平台推荐信号建模为独立的用户偏好输入；Feed 以 Story 排序并可展开 Entry。 |
| REC-003 | Phase 4 | 普通 Feed 默认不需要 LLM 在线参与。 | 模型不可用时，分类 Feed、全文检索、基础去重和排序仍能工作。 |
| REC-004 | Phase 4 | 排序可组合关注强度、来源质量、时效、新颖性、Story 更新量、用户反馈和多样性。 | 每次排序保存 policy/version，并能解释主要信号。 |
| REC-005 | Phase 4 | 系统记录 impression、open、save、hide、not interested、follow topic、annotate 和完成交互。 | 未点击但已展示的内容不会被误判为“用户没见过”。 |
| REC-006 | Phase 4 | Feed 支持按娱乐、硬件、开发等用户分类和分区。 | 用户可以创建、调整和复用分类视图，不依赖固定内置目录。 |
| REC-007 | Phase 4 | 推荐结果需要控制同源重复、同事件挤占和主题单一。 | 一个来源或 Story 不能在没有明确配置时占满整个 Feed。 |
| REC-008 | Phase 2 | Story 详情页可以推荐相关但不同事件的背景、后续、教程和观点。 | “Jeff Dean 创立 Discovery Loop”能关联“Jeff Dean 离开 Google”，同时明确二者不是同一 Story。 |
| REC-009 | Phase 4 | 第一版相关推荐使用 BM25、Entity/关系、时间、引用和用户关注等混合信号，不使用 embedding，并输出主要原因。 | UI 能展示共享实体、前后关系、引用或 Topic 等可验证解释，不由 LLM 临场编造唯一理由。 |
| REC-010 | Phase 4 | 热度、趋势、重要性和紧急性分别计算，再由 Spotlight Policy 决定展示。 | 很热但不重要的内容与低热度但紧急的服务故障不会被同一分数掩盖。 |
| REC-011 | Phase 4 | 第一版维护预算使用全局日预算、单次 Run 上限和紧急保留预算。 | 超过运行次数、时间、token 或工具调用上限时降级为确定性规则；复杂对象级继承、公平调度和预算借用后置。 |
| REC-012 | Phase 4 | 系统记录无 embedding 第一版的召回缺口。 | 零结果、人工补关系、Entity alias 漏命中和 Agent 后续发现的遗漏可统计，并用于决定何时重新评估 embedding。 |
| REC-013 | Phase 4 | Feed 的 impression、open、read、hide 和 not interested 默认以 `(用户, Story, surface)` 为粒度；展开具体信源后再记录 Entry 交互。 | 一个多来源 Story 不会因展开多个 Entry 被误算成多次 Feed 曝光；收藏和批注可明确绑定 Story 或 Entry。 |
| REC-014 | Phase 4 | Spotlight 使用分离的趋势、重要性、紧急性和用户兴趣信号，由版本化 policy、迟滞阈值和可续期 TTL 决定进入与保持。 | Placement 保存评分明细、policy/version 和到期时间；人工固定或排除在解除前覆盖自动策略。 |
| REC-015 | Phase 4 | Read State 保存用户在 Story/surface 上最后看过的 `last_seen_revision_id`，新 Revision 派生 `updated_since_last_seen`。 | 新内容能被标记为“有更新”，但不会删除用户过去已读记录或伪造从未阅读。 |
| REC-016 | Phase 4 | Spotlight 人工固定/排除绑定具体 target placement，直到用户解除；不同目标 kind 共用 policy 合同，只配置权重和阈值差异。 | 同一 Story 可以在不同 Board/Section 有不同人工展示决定；自动策略不能绕过未解除的覆盖。 |
| REC-017 | Phase 4 | 推荐采用代码规则、结构化特征和可选 LLM 特征的混合方案；普通 Feed 在 LLM 不可用时仍可工作。 | Admission、Ranking、LLM rerank 和用户反馈分开记录；排序保存 policy/version、主要原因和多样性约束，不把外部平台推荐分数当作 Cosmos 最终分数。 |
