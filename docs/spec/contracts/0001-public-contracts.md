# @cosmos/contracts 公共合同

## 状态

当前实现规格；后续代码变化应同步更新本文。

## 最后更新

2026-08-24。

## 组件定位

`@cosmos/contracts` 是 Cosmos 进程之间和边界层之间共享的运行时合同包。它提供 Zod schema、由 schema 推导的 TypeScript 类型、状态枚举、可公开投影的 DTO，以及版本化 Action、重试、Blob/Value 引用和 SSE 消息的形状。

它不执行 Connector、Action handler、Workflow、领域写入或 Blob 读写。`packages/application` 在 HTTP、Action 和 Workflow 边界把外部 `unknown` 解析为本包合同；`packages/storage-prisma` 和 Product API 使用这些类型生成自己的投影。本文件只定义 ContentKind、Publisher、Temporal、Metrics、BlobRef 和 ValueRef 在 wire/JSON 边界的形状；规范化内容的语义、身份算法以及 Observation/Entry/Revision/Story 语义只由[规范化内容](../domain/0001-normalized-content.md)定义。domain 的语义函数不导入或调用本包 schema，本包也不反向实现 domain 算法。

`contracts` schema 解析是进入 JSON/HTTP/Workflow 边界的前置步骤；通过解析后的值才由 application/connector 交给 domain 语义函数。两边可以使用同一枚举词汇，但这不是第二套运行时校验规则。

### 在系统中的位置与作用
它位于 HTTP、Workflow 和进程间边界的共享合同层，为这些边界提供同一套可运行时解析的 JSON/HTTP 形状。

### 解决的问题
它把外部 `unknown` 变成可验证的 DTO、状态和引用，避免每个调用方各自解释 Action、Blob、Value 或 SSE 消息；领域语义仍由 domain owner 负责。

### 使用方式
边界入口先调用本包的 Zod schema 解析，再把解析结果交给 application、connector 或 domain；需要组合根或客户端类型时从本包导入对应 schema/type，不把它当作执行器或持久层。

### 典型情景
新增或重建 API、SSE、Action 或 Workflow payload 时，先在这里确认 wire shape，再由拥有行为的组件实现解析后的流程。

## 概念与定义

### 协议和内容基础类型

- **协议版本**：`protocolVersion` 固定为 `"v1"`。
- **ContentKind**：wire enum 为 `post`、`article`、`video`、`audio`、`image`、`comment`、`listing`。本包只负责枚举解析；值的领域含义和 Story 映射由[规范化内容](../domain/0001-normalized-content.md)负责。
- **PublisherKind**：wire enum 为 `user`、`channel`、`subreddit`、`official-account`、`org`、`unknown`。它是 Publisher 的传输字段，不由本包生成身份或执行领域归一化。
- **Publisher**：`platformId`、`name`、`handle`、`profileUrl`、`kind`、`metrics`。`platformId`、`handle`、`profileUrl` 接受可空字符串，字符串先 trim，空白转为 `null`；`name` trim 后至少一个字符。缺少平台 ID 不会由本合同生成新的身份。
- **PublisherMetrics**：`followers`、`following`、`statuses`、`voteup` 是可选、可空且必须为有限数值；`reliable` 可为 `high`、`low`、`unknown`。这是 wire shape，不包含 domain 的来源清洗策略。
- **TemporalPrecision**：`second`、`minute`、`hour`、`day`、`week`、`month`、`year`、`unknown`。
- **TemporalFallback**：保留原始 `raw`、带 offset 的 `lowerBound`、`precision`、可空 `timezone` 和 `confidence`（`high`、`inferred`、`uncertain`）。
- **TemporalValue**：`exact` 是带 offset 的 datetime 或 `null`；`exactPrecision` 只能是 `second` 或 `null`；`fallback` 是 `TemporalFallback` 或 `null`。至少必须有 `exact` 或 `fallback` 之一。exact/fallback 的推导和投影算法由 domain 负责。
- **ContentMetrics**：`values` 中的 `likes`、`views`、`reposts`、`comments`、`collects`、`score` 是可选、可空有限数值；`raw` 是 `Record<string, string>`；另有 `reliability`（`high`/`low`/`unknown`）和带 offset 的 `capturedAt`。本包只校验该 wire shape，不负责 Connector 的数值转换。

### Source 与采集命令

- **sourceDefinitionRef**（trim 后的版本化 ref，如 `source.rss@1`）是 SourceInstance 的唯一业务身份；**operationId** 必须出现在该定义 manifest 的 operationIds 中。旧 **SourceKind** 只作为迁移期运行时投影保留，新 Product API 命令不接受 `kind`。
- **SourceConfig** 的通用字段是可选 `feedUrl`、`fixturePath`、`media`（来源级媒体策略）与 `scheduleIntervalMs`（coerce 整数，范围 1,000 至 31 天毫秒）；该 passthrough schema 仅作历史投影。
- **SourceMediaPolicy**（ADR-0014/0015）是来源级媒体策略：可选 `images`（`download`/`metadata_only`，缺省 `download`）、可选 `maxFileBytes`（64KiB–10MB）与 `maxRunBytes`（1MiB–50MB）。上界即全局默认，来源只能收紧；`mediaPolicyCeilings` 是同一组数字的单一来源，媒体获取组件的运行时默认值取自它。另有两个可选字段：`retry.maxAttempts`（0–10，缺省 3，含首次尝试，0 = 关闭重试）与 `retentionDays`（0–3650，缺省或 0 = 永久保留）。
- 各 Source definition 的 canonical 配置校验由 `getSourceConfigurationSchema(ref)` 返回的 strict Zod schema 负责：RSS 要求 http(s) 的 `feedUrl` 并接受可选 `media`；fixture RSS 仅接受调度字段；Bilibili 要求 `mode` 且 `mode=feed` 时必须提供 profile；AI HOT 接受调度字段。manifest 的 JSON Schema 只是发布投影（`source.rss@1` 的描述里同步声明了 `media`）。
- **revisionId** 形如 `<sourceId>:<revision>`；创建默认停用并从 revision 1 开始。**SourceActivationCommand** 为 `{ enabled, baseRevisionId }`，配合唯一 `Idempotency-Key` 使用：同 key 同请求重放返回首次记录的结果快照，同 key 不同请求或过期 baseRevision 返回冲突，无状态变化的 no-op 记录命令但不递增 revision。
- **CreateSourceCommand**：strict 的 `name`（trim 后 1–200 字符）、`sourceDefinitionRef`、`operationId` 和 `config`，不接受 `enabled`。**UpdateSourceCommand**：必填 `baseRevisionId` 加可选 `name` 与完整替换的 `config`。
- **SourceExecutionSnapshot** 冻结 `id`、`name`、`sourceDefinitionRef`、`operationId`、`connectorId`、迁移投影 `kind`、`config`、`enabled`、`revisionId`、`createdAt`、`updatedAt`。**SourceSnapshot** 在同一字段上增加可变诊断 `lastRunAt`、`lastError`、可选 `connectionId`（ADR-0017）与可选 `scheduleIntervalMs`（ADR-0018，来自 TriggerBinding）。
- **TriggerBinding（ADR-0018）**：`id`、`sourceId`、`kind`（`schedule`/`manual`）、`config`（`{ intervalMs? }`）、`enabled`、`revisionId`、`createdAt`/`updatedAt`。`CreateSourceCommand`/`UpdateSourceCommand` 用顶层可选 `scheduleIntervalMs`（update 可 null 移除）。`SourceDefinitionManifest` 新增 `auth`（`none|oauth|cookie|secret_ref|external` + `secretRefRequired`）与 `operations`（operationId、input/output schema、external key、discovery context、media、stateStore 命名空间）。
- **SourceProbeResult**：`sourceId`、`connectorId`、非负整数 `itemCount`、`nextCursorAvailable` 和 `checkedAt`。
- **IngestCommand**：非空 `sourceId`、`triggerKind`（`manual`/`schedule`，默认 `manual`）和可选幂等键；幂等键 trim 后 1 至 300 个字符。

### 状态和查询 DTO

- **RunStatus**：`queued`、`running`、`succeeded`、`failed`、`cancelled`。
- **StepStatus**：`queued`、`running`、`succeeded`、`failed`、`cancelled`。
- **JobStatus**：`queued`、`leased`、`retry_wait`、`succeeded`、`failed_terminal`、`cancelled`。
- **JobKind**：`source-ingest`、`source-probe`、`workflow-activity`。
- **AssetStatus**：`saved`、`metadata_only`、`skipped`、`failed`。
- **JobSnapshot**：`id`、`kind`、可空 `sourceId`/`runId`、`status`、非负整数 `attempts`、正整数 `maxAttempts`、可空 `errorCode`/`error`、`createdAt`、`updatedAt` 和可空的 `result: unknown`。
- **AssetSnapshot**：`id`、`kind`、`status`、可空 `sourceUrl`、可空 `storageKey`、可空 `mimeType` 、可空数值 `byteSize`、可选可空 `errorMessage`（有界 500 字符，降级原因说明；saved 可为空，见 ADR-0005）、可选可空 `errorCode`（机器可读降级原因，读取侧放宽，见 ADR-0015）与可选非负整数 `attemptCount`（已完成的下载尝试次数，含首次）。这是 contracts 的共享/内部资产元数据投影，不是领域层带 `Uint8Array` 的 Asset input，也不是自动脱敏层。当前 `PrismaCosmosRepository.toAssetSnapshot` 会填充 `storageKey`，而 Product API 的 feed、search、entries、story、entry、revision 路由当前直接返回 repository 投影；因此 `storageKey` 非空时会出现在当前这些 HTTP JSON 响应中。本文件不宣称已经剥离该字段；`GET /assets/:assetId` 另行读取 bytes。
- **MediaCleanupCommand**（ADR-0015）：strict 的可选 `sourceId` 与可选布尔 `dryRun`（缺省 true）。**MediaCleanupReport**：`dryRun`、可空 `sourceId`、`candidateCount`、`candidateBytes`、`cleanedCount`、`cleanedBytes`、`sharedKeyCount`、最多 20 条 `samples`（assetId/sourceId/sourceName/title/byteSize/createdAt/expiredAt）与 `startedAt`/`finishedAt`。**MediaCleanupRunSnapshot**：`runId`、`status`、可空 `report` 与可空 `error`。
- **RunSnapshot**：`id`、可空 `sourceId`、`triggerKind`、`status`、`createdAt`、可空 `startedAt`/`finishedAt`、`itemCount`、`createdEntryCount`、`revisedEntryCount` 和可空 `error`。
- **Run 控制（ADR-0016）**：`CancelRunCommand`/`RecoverRunCommand` 为 strict 的可选 `reason`（trim ≤500）；`RerunRunCommand` 为 strict 空对象。**RunControlResult**：`action`（`cancelled`/`recovered`/`rerun`）、复用 `RunSnapshot` 的 `run`、面向用户的 `reuse` 与 `sideEffects` 字符串。公共 `RunStatus` 五态不变。
- **Connection（ADR-0017）**：`ConnectionInstance` 快照含 `id`/`name`/`connectorId`/可空 `account`/可空 `scopeJson`/`status`（`active|revoked|expired|error`）/可空 `secretRef`/可空 `lastError`/`createdAt`/`updatedAt`。`CreateConnectionCommand` 要求非空 `name`+`connectorId`，其余可选；`UpdateConnectionCommand` 全可选（`name`/`status`/`secretRef`/`lastError`）。`SourceSnapshot` 增加可选可空 `connectionId`（无认证来源 null），`UpdateSourceCommand` 增加可选可空 `connectionId`。
- **StorageStats（ADR-0019）**：`databaseBytes`/`blobBytes`/`blobFileCount`/`artifactBytes`/`cacheBytes`/`logBytes`/`secretBytes` 加 `categories`（`raw`/`user`/`rebuildable`/`cleanable`，非负整数）与 `snapshotAt`。**BackupSnapshot**：`id`/`name`/`byteSize`/`createdAt`。
- **HealthResponse**：`status` 固定为 `ok`；包含 `service`、`version`、`protocolVersion`、`timestamp`，以及 `workerStatus`（`unknown`/`starting`/`ready`/`stopped`）、`storageStatus`（`unknown`/`starting`/`ready`/`failed`）和 `migrationStatus`（`unknown`/`pending`/`ready`/`failed`）。
- **ServiceError**：`code` 为 `validation_failed`、`not_found`、`conflict`、`service_unavailable`、`protocol_mismatch` 或 `uncertain`；并有 `message`、可选 `requestId`/`commandId`、可选 `details: Record<string, unknown>` 和 `retryable`。
- **SearchQuery**：可选 trim 后最多 500 个字符的 `text`、`sourceId`、带 offset 的 `publishedAfter`/`publishedBefore`、`cursor`；`limit` coerce 为 1 至 100 的整数，默认 `20`。`EntryListQuery` 的 `sourceId`/`cursor` 可选，`limit` coerce 为 1 至 100 的整数，默认 `50`。

### Feed、Entry、Story 与事件 DTO

- **ConnectorDescriptor**：`id`、`description`、`capabilities` 字符串数组和 `configVersion`。
- **FeedItem**：`storyId`、`storyKind`（`event`/`document`/`media`/`thread`）、`title`、可空 `summary`、`entryId`、`sourceId`、`sourceName`、`sourceKind`、`revisionId`、可空 `publishedAt` 和 `assets: AssetSnapshot[]`。`FeedPage` 为 `items` 与可空 `nextCursor`。`SearchResult` 是 FeedItem 加可空数值 `rank`，`SearchPage` 是其分页。
- **EntryRevisionSnapshot**：`id`、整数 `revision`、`title`、可空 `summary`、`contentText`、可空 `webUrl`、`contentKind`、可空 `publisher`、可空 `publishedAt: TemporalValue`、可空 `updatedAt: TemporalValue`、可空 `sourcePublishedAt`、`createdAt` 和资产快照数组。
- **ObservationSnapshot**：`id`、可空 `externalId`、`externalKey`、`eventKind`（`create`/`update`/`delete`/`snapshot`）、可空 `webUrl`、`capturedAt` 和可空 `sourcePublishedAt`。这些字段的领域含义见[规范化内容](../domain/0001-normalized-content.md)。
- **EntryDetail**：`id`、`sourceId`、`sourceName`、`sourceKind`、`currentRevisionId`、可空 `metrics`、修订数组、观察数组与 `relatedStories: EntryRelatedStory[]`（本条目作为证据/提及关联到的其它 Story：`storyId`、读取侧宽松 `relationType`、`title`、可空 `reason`；ADR-0011）。
- **EntryListItem**：`id`、`sourceId`、`sourceName`、`sourceKind`、可空 `storyId`、`currentRevisionId`、`title`、可空 `summary`/`webUrl`、`contentKind`、可空 `publisher`/`metrics`/`publishedAt`、`updatedAt`、非负整数 `revisionCount`/`observationCount` 和资产数组；`EntryPage` 为 items 与可空 nextCursor。
- **StoryDetail**：`story`（`id`、`kind`、可空 `subtype`、`revisionId`、`title`、可空 `summary`、`status`（`active`/`split`）、`replacedBy: StorySuccessor[]`——`storyId`/`title`/`kind`，历史壳的全部后继）、可空 `entry: EntryDetail`（最近更新成员，兼容位；历史壳可以没有成员）以及 `entries: EntryDetail[]`（Story 全部成员，按 Entry `updatedAt` 倒序；历史壳可以为空），并新增 `entities: StoryEntitySummary[]`——每个已关联 Entity 的当前快照（`entityId`、`name`、`type`、producer、可空 `producerVersion`、`confidence`、可空 `evidence`/`actor`/`reason`），用于 Story 侧渲染“涉及哪些实体”而不二次查询。用户组织 v1 追加 `labels: LabelRef[]`（已附加到本 Story 的标签 `id`/`name`）与 `favorited: boolean`（本 Story 的轻量收藏标记，ADR-0009）。Entry↔Story 证据关系 v1 追加 `evidence: StoryEvidence[]`（把本 Story 当作证据/提及目标的其它条目：`entryId`、`sourceId`、`sourceName`、读取侧宽松 `relationType`、可空 `title`、producer、可空 `producerVersion`、`confidence`、可空 `evidence`/`actor`/`reason`，按 createdAt 倒序）。Story split v1 追加 `topics: StoryTopic[]`（本 Story 的当前 Topic 成员：`topicId`/`title`/`role`，ADR-0012）。**RevisionDetail** 是 EntryRevisionSnapshot 加上 `entryId`、`sourceId`、`sourceName`、`sourceKind`。
- **Story 编排命令**：`MoveEntryToStoryCommand`（`entryId` + 目标 `storyId`）、`UpdateStoryRevisionCommand`（`baseRevisionId`、`title`、可空 `summary`、核心 `kind` 枚举、可空 `subtype`）、`MergeStoriesCommand`（`canonicalStoryId` + 1–50 个 `obsoleteStoryIds`）、`SplitStoryCommand`（2–20 个 `successors`，每个含 `title`/可空 `summary`/核心 `kind`/可空 `subtype`、1–500 个 `entryIds` 与非空默认的 `evidenceEntryIds`/`entityIds`/`topicIds`）。四个命令都接受可选 `actor`（1–100 字符）与可选 `reason`（1–1000 字符）；更新与归并的幂等/CAS 语义、split 的显式映射校验由 application/storage 拥有（ADR-0012）。
- **Story subtype 目录（ADR-0013）**：`StorySubtypeStatus` 为受管枚举 `active`/`deprecated`/`retired`。`StorySubtype` 为注册项读取投影：`id`、核心 `kind`、正整数 `version`、`label`、可空 `description`、`status`、可空 `identityPolicy`、`owner`。`StorySubtypePage` 为 `items` + 可空 `nextCursor` + `snapshotAt`；`StorySubtypeQuery` 只接受可选核心 `kind`。目录是只读投影，写入侧校验由 domain/storage 拥有。
- **Topic DTO**：`TopicMemberRole` 为受管枚举 `core`/`update`/`background`/`analysis`/`counterpoint`/`tutorial`。`TopicMember` 是成员读取投影（`storyId`、`role`（读取侧放宽为任意字符串以支持未知值降级）、可空 `reason`/`actor`、正整数 `revision`、`removed`）。`TopicDetail` 为 `topic`（`id`、`revisionId`、`title`、`purpose`、可空 `scope`）+ `members: TopicMember[]`；`TopicSummary`（列表投影）额外含非负 `memberCount` 与 `updatedAt`，`TopicPage` 为 `items` 与可空 `nextCursor`。
- **Topic 编排命令**：`CreateTopicCommand`（`title`、`purpose`、可空 `scope`、可空 `seedStoryId`）、`UpdateTopicCommand`（`baseRevisionId`、`title`、`purpose`、可空 `scope`）、`MergeTopicsCommand`（`canonicalTopicId` + 1–50 个 `obsoleteTopicIds`）；成员命令 `AddTopicMemberCommand`/`UpdateTopicMemberRoleCommand`/`RestoreTopicMemberCommand`（`storyId` + `role`）、`RemoveTopicMemberCommand`（`storyId`）。所有命令都接受可选 `actor` 与可选 `reason`；role 在写入侧用受管枚举校验。
- **Entity DTO**：`EntityType` 为受管枚举 `person`/`organization`/`product`/`project`/`model`/`location`，`EntityRelationType` 为受管枚举 `founded`/`works_at`/`located_in`/`produced`/`part_of`/`related_to`（ADR-0008）。`EntityDetail` 为 `entity`（`id`、`revisionId`、读取侧放宽的 `type`、`name`）+ `aliases: string[]` + `stories: EntityStoryLink[]`（关联 Story 与 producer/version/confidence/evidence/actor/reason）+ `relations: EntityRelation[]`（`fromEntityId`、读取侧放宽的 `relationType`、`toEntityId` 与同一套 provenance 字段）。`EntitySummary`（列表投影）额外含非负 `storyCount`/`relationCount` 与 `updatedAt`，`EntityPage` 为 `items` 与可空 `nextCursor`。
- **Entity 编排命令**：`CreateEntityCommand`（`name` + 写入侧 `type` + 可选 `alias`）、`UpdateEntityCommand`（`baseRevisionId`、`name`、写入侧 `type`）、`AddEntityAliasCommand`/`RemoveEntityAliasCommand`（`name`）；关联命令 `LinkStoryEntityCommand`/`UnlinkStoryEntityCommand`（`storyId` + `entityId`）、关系命令 `CreateEntityRelationCommand`（`fromEntityId` + `toEntityId` + 写入侧 `relationType`）/`RemoveEntityRelationCommand`（`fromEntityId`/`toEntityId`/读取侧宽松 `relationType`）。所有命令都接受可选 `actor` 与可选 `reason`；provenance（producer/producerVersion/confidence/evidence）在写入侧全部可选、缺省由 storage 兜底为 `human`/1，读取侧给出实际值。
- **Entry↔Story 证据关系命令（ADR-0011）**：`EntryStoryRelationType` 为受管枚举 `evidence_for`/`mentions`（写入侧校验、读取侧放宽）。`LinkEntryStoryCommand`（`entryId` + `storyId` + 写入侧 `relationType` + 可选 provenance/`actor`/`reason`）与 `UnlinkEntryStoryCommand`（`entryId` + `storyId` + 可选 `actor`/`reason`）。`(entryId, storyId)` 唯一：重复写入同一对是覆盖（一关系一语义），指向 Entry 自己主 Story 的写入由 storage 拒绝为 conflict。
- **用户组织 DTO（ADR-0009）**：`TargetType` 为受管枚举 `story`/`entry`/`topic`（Label 附加与后续 Annotation 目标共用），`FavoriteTargetType` 为其子集 `story`/`entry`。`LabelRef` 为 `id`/`name`；`LabelItem`（列表投影）含非负 `assignedCount` 与 `createdAt`/`updatedAt`，`LabelList` 为 `items`；`LabelDetail` 在 LabelItem 字段外给出按类型分组的 `assignedStories`/`assignedEntries`/`assignedTopics`（每项 `id` + 解析后的 `title`）。`CollectionSummary` 含 `id`/`name`/可空 `description`/非负 `itemCount`，可选 `containsStory`（仅 `listCollections` 带 `storyId` 时出现）；`CollectionDetail` 含 `stories: { storyId, title, addedAt }[]`。`FavoriteList` 为 `{ targetType, targetId, createdAt }[]`。`UserOrganizationAck` 为 `{ ok: true, id, action }`，用于删除/附加/成员/收藏这类无单一读模型的写命令回执。
- **用户组织编排命令**：`CreateLabelCommand`（`name`）、`LabelAssignmentCommand`（`labelId` + 写入侧 `targetType` + `targetId`）；`CreateCollectionCommand`/`UpdateCollectionCommand`（`name` + 可空 `description`）、`CollectionItemCommand`（`storyId`）；`FavoriteCommand`（写入侧 `FavoriteTargetType` + `targetId`）。这些命令是用户显式操作，不带 `actor`/`reason`（单用户本地真相，区别于 Story/Topic/Entity 的协作者审计命令）。
- **Annotation DTO 与命令**：`Annotation` 含 `id`、读取侧放宽的 `targetType`、`targetId`、可空 `targetRevisionId`（写入时目标为 Story 则固定指向其当前 `StoryRevision`）、可空 `quote`/`evidence`/`actor`、`body` 与 `createdAt`/`updatedAt`；`AnnotationList` 为 `items`。`CreateAnnotationCommand`（写入侧 `targetType` + `targetId` + `body` + 可空 `quote`/`evidence`/`actor`）、`UpdateAnnotationCommand`（`body` + 可空 `quote`/`evidence`/`actor`）、`AnnotationTargetQuery`（`targetType` + `targetId`）。批注是**可编辑笔记**而非不可变 revision 链（ADR-0009 决策 4）；更新覆盖正文并刷新 `updatedAt`。
- **Saved View DTO 与命令**：`SavedView` 含 `id`/`name`、可空 `text`/`sourceId`/`publishedAfter`/`publishedBefore`、`labelIds: string[]`/`topicIds: string[]` 与 `createdAt`/`updatedAt`；`SavedViewList` 为 `items`。`CreateSavedViewCommand`/`UpdateSavedViewCommand`（`name` + `conditions`），`conditions` 为白名单对象（可空 `text`/`sourceId`/带 offset 的 `publishedAfter`/`publishedBefore`、最多 50 个 id 的 `labelIds`/`topicIds`）。Saved View 只持久化查询条件、不存结果快照（ADR-0009 决策 5）。`SearchQuery` 相应新增可选 `labelIds`/`topicIds`（逗号分隔 id 串）。
- **看板 DTO 与命令（ADR-0010）**：`BlockType` 为写入侧受管枚举 `feed`/`spotlight`/`source-health`/`topic-list`/`collection`；`BoardBlock.type` 读取侧为普通字符串，未知类型由客户端降级为占位。`blockConfigSchemas` 是按类型判别的白名单 strict 对象（`feed` 可选 `savedViewId` + 可选 `limit`；`collection` 可选 `collectionId` + 可选 `limit`；`spotlight`/`source-health`/`topic-list` 仅可选 `limit`）——`feed`/`collection` 的绑定都可省略：区块先创建为未绑定态，之后在编辑器中配置，未绑定或悬空引用渲染占位（ADR-0010 决定 5）。`blockConfigSchemaFor(type)` 返回对应 schema 或 null（未知类型）。`BoardSummary`（`id`/`name`/可空 `description`/非负 `sectionCount`/时间戳）与 `BoardList`；`BoardBlock`（`id`/`sectionId`/读取侧 `type`/`config: Record<string, unknown>`/非负 `position`/`visible`/时间戳）；`BoardSection`（`id`/`boardId`/`title`/`position`/按 position 排序的 `blocks`/时间戳）；`BoardDetail`（`id`/`name`/可空 `description`/按 position 排序的 `sections`/时间戳）。命令：`CreateBoardCommand`/`UpdateBoardCommand`（`name` + 可空 `description`）、`CreateSectionCommand`（`boardId` + `title` + 可选 `position`）、`UpdateSectionCommand`（`title`）、`CreateBlockCommand`（`sectionId` + 写入侧 `type` + `config` record + 可选 `position`）、`UpdateBlockConfigCommand`（`config`）、`MoveBlockCommand`（可选 `sectionId` + `position`）、`SetBlockVisibilityCommand`（`visible`）；`BoardCommandAck` 为 `{ ok: true, id, action }` 用于无单一读模型的写回执。区块 config 的按类型白名单校验发生在 storage 边界，失败以 ZodError 冒泡并由 API 映射为 400。`UpdateSectionCommand` 的 `position` 可选：提供时把分区移动到该位置并顺延其它分区。
- **Spotlight DTO 与命令（ADR-0010 决策 3）**：`SpotlightTargetType` 为写入侧受管枚举 `story`/`topic`；`SpotlightPlacement` 含 `id`/`boardId`、读取侧放宽的 `targetType`、`targetId`、`source`（v1 恒为 `manual`）、可空 `reason`/`actor`/`expiresAt`、解析后的 `targetTitle` 与时间戳；`SpotlightPlacementList` 为 `items`。`PinSpotlightCommand`（`boardId` + 写入侧 `targetType` + `targetId` + 可空 `reason`/`actor`）。解除固定按 placement id 走 removals 端点（物理解除，返回 `BoardCommandAck`）。
- **IngestResult**：`run`、`createdEntryCount`、`revisedEntryCount`、`duplicateObservationCount`，以及可选可空 `errorCode` 和可选 `retryable`。- **EventEnvelope** 是 TypeScript 接口，字段为 `id`、`type`、`version`、`occurredAt` 和泛型 `payload`。`EventSnapshot` 和 `SseEvent` 使用同样的五个字段，但 `payload` 为 `unknown`。`SnapshotRequiredPayload` 是 `reason` 和 `latestEventId`。

`unknown` 字段是有意保留的边界：`JobSnapshot.result`、事件 payload 和 SSE payload 的 schema 不猜测业务内容，也不把 unknown 证明为 JSON-safe。调用方把它们送入 JSON/HTTP/SSE 时必须提供可序列化值；本包不从 unknown 中执行代码或推断领域状态。

### Action、重试与可序列化引用

- **ActionKind**：`connector`、`transform`、`library`、`query`、`control`、`script`、`agent`、`artifact`、`render`、`delivery`。
- **ExecutionPlacement**：`host`、`trusted_worker`、`remote_worker`。
- **ActionRef**：匹配小写段组成的点分名称，并以 `@` 加正整数版本结束；版本不能是 `0`、前导零、非安全整数，ref 不能含大写、空格或裸名称。`parseActionRef` 返回 `{ baseRef, version }`，其中 version 为 number。
- **ActionErrorCode**：`dependency_unavailable`、`authentication_required`、`timeout`、`rate_limited`、`malformed_payload`、`unsupported_version`、`invalid_configuration`、`invalid_action_ref`、`invalid_input`、`unknown_action`、`internal_error`。
- **RetryPolicy**：正整数 `maxAttempts`、非负整数 `backoffMs`，以及可选的 ActionErrorCode `retryableErrors` allow-list。**ActionExecution** 还有 `idempotent`、`supportsCancellation`、可空正整数 `timeoutMs` 和可空 RetryPolicy。
- **ActionDefinition** 是受信进程内的 executable 定义，含 `ref`、可选 `manifestHash`、`kind`、`description`、`capabilities`、`executionPlacement`、运行时 Zod `inputSchema`/`outputSchema` 和 `execution`。**ActionDescriptor/ActionManifest** 是 manifest-safe 投影，只含 ref/version/manifestHash?/kind/description/capabilities/executionPlacement/idempotent/supportsCancellation/timeoutMs/retryPolicy；不含 executable schema，且 ref 中的版本必须与 `version` 相同。
- **JsonValue** 只允许 `null`、布尔、有限数值、字符串、递归数组和原型为 `Object.prototype` 或 `null` 的普通对象；`undefined`、NaN、Infinity、函数、Date、Uint8Array 等不可进入该合同。
- **BlobRef** 是本包唯一拥有的 strict JSON wire shape，恰有 `key`、`hash`、非负整数 `byteSize` 和非空 `mediaType`。本 schema 不读取 Blob bytes，也不证明 hash、key、byteSize 或 containment；这些验证由[FileBlobStore](../storage/0005-file-blob-store.md)负责。**BlobRefLike** 不是本包的共享 wire DTO，而是 Blob Store 读取校验所需的本地输入接口。
- **NormalizedAssetInputContract** 是 Workflow JSON 中的 strict 对象，含 `kind`、可空 `sourceUrl`、`status`、可空 `mimeType`、可空非负整数 `byteSize` 和可选可空 `blobRef`；只有 `saved` 状态可以带非空 BlobRef。
- **NormalizedIngestItemContract** 是 Workflow JSON 中的 strict 规范化内容边界，字段为可选可空 `externalId`、`title`、可空 `summary`、`contentText`、可空 `webUrl`、`kind`、可空 `publisher`/`metrics`/`publishedAt`、可选可空 `updatedAt`、JSON-safe `sourceLocator`、`rawPayload`、可选 `rawPayloadMimeType` 和资产数组。`externalId`、`webUrl`、非空 `sourceLocator` 至少要有一个身份证据。领域侧的完整语义与 bytes 类型见[规范化内容](../domain/0001-normalized-content.md)。
- **ValueRef** 是本包记录并拥有的 Workflow JSON wire shape：`key: string`、`hash: string`、`byteSize: number`、`mediaType: "application/json"`。运行时 `ValueRef`/`ValueStore` 接口由 `@notnotype/nb-workflow` 提供；canonical JSON 编码、读取时的 key/hash/byteSize/mediaType 四重校验和 JSON parse/assert 由[Workflow Value Store](../storage/0006-workflow-value-store.md)拥有。本包不把 ValueRef 当作字节数组，也不执行 ValueStore 读写。

## 外部行为

边界调用者向 schema 传入 `unknown`，或先以 `Record<string, unknown>` 接收 HTTP/query，再调用对应的 `.parse`。成功时得到 schema 推导的 DTO；默认 `z.object` 会剔除未声明字段，显式 `passthrough` 的 `sourceConfigSchema` 会保留未知配置，内置 Source config 的 strict schema 会拒绝未知字段。带默认值的字段在 parse 后才出现默认值。

Action 的 executable 定义可以携带运行时 Zod schema，但公共 Descriptor/Manifest 只投影元数据。Workflow JSON 的 normalized asset 只能携带 BlobRef 等 JSON 值，不能携带 `Uint8Array`。SSE/事件 DTO 保留未知 payload，由使用方决定具体事件语义；当前 Product API 将投影 JSON 字符串化后发送。

## 输入

输入入口包括 Source 创建/更新、Source probe、ingest 命令、查询参数、Job/Run/Entry/Story/事件投影，以及 Action/Workflow 的 schema 输入。所有字段、空值和默认值以“概念与定义”中的对应 schema 为准：

1. 外部未知值必须在边界解析；不能把未经 parse 的对象当作公共 DTO。
2. `sourceConfigSchema` 是唯一会保留未声明配置字段的基础 Source config；内置 config 必须使用其各自 strict schema。
3. ActionRef、RetryPolicy、BlobRef、normalized asset/item 和 Source snapshot 的相互约束必须在 parse 时检查。
4. `unknown` payload/result 不做结构假设；需要业务含义的消费者另行校验。

## 输出

- 输出是 Zod parse 后的结构化 DTO 或 manifest-safe 投影。状态数组和 enum 只返回列出的值；分页 DTO 的 nextCursor 可空。`AssetSnapshot` 输出明确包含可空 `storageKey`；当前 API 直返 repository 结果时也会透传该字段，不应把 contracts schema 误读成已经安全剥离的 Product API DTO。Action Descriptor/Manifest 可被 `JSON.stringify` 后再次解析为同值，且不包含 executable Zod schema。BlobRef/ValueRef 只代表受控内容或 Workflow JSON 的引用，不代表内联 bytes。

并非所有 DTO 字段都由本包深度验证：`JobSnapshot.result`、`EventSnapshot.payload` 和 `SseEvent.payload` 明确为 `unknown`。因此“schema parse 成功”不等于这些字段的业务内容或 JSON 编码已经通过校验。

## 状态与持久化

本组件无持久状态。schema、enum、parseActionRef 和类型定义在进程内由源码重新生成；重启不会恢复 Source、Run、Job、Entry、Blob、Workflow 或 SSE 游标。Source/Run/Job/Entry/Observation/Revision/Story 的 durable truth 由相应 application/storage 组件持有，本文件只定义公共投影形状。

## 状态转换

本组件没有业务状态机。可观察的转换只有：

- `unknown` 输入经 schema parse 成功后成为合同 DTO；失败则抛出 ZodError，不产生部分 DTO 或持久写入。
- 带默认值的输入字段在 parse 中从缺失变为默认值，例如 CreateSource `enabled=true`、ingest `triggerKind=manual`、Bilibili `schemaVersion=1`/`limit=20`、AI HOT `schemaVersion=1` 和查询 limit。
- Source execution snapshot 与 Source snapshot 是两个不同投影；后者增加可变诊断字段，前者不因当前诊断变化。
- ActionDefinition 经 application 的 descriptor 投影后丢弃 executable schema；若 ref/version 不一致，descriptor parse 不成功。

## 副作用

`@cosmos/contracts` 的 schema parse、类型投影和 `parseActionRef` 不访问数据库、Blob Root、网络、文件、日志或领域事件，也不触发 Action、Connector、重试、SSE 推送或业务写入。应用层将 bytes 写 Blob、将 ValueRef 解引用、将 DTO 映射为数据库记录的副作用不属于本组件。

## 错误与降级

- schema 约束不满足时抛出 ZodError；本包不把失败转换为 HTTP 状态码、不自动重试、不写错误记录。
- ActionRef 不合法时 `parseActionRef` 的 schema parse 失败；ActionErrorCode 的分类只描述公共错误代码集合，具体异常由 application ActionRegistry 产生。
- RetryPolicy 仅声明 allow-list、最大次数和退避值，不自行执行重试。
- `unknown` result/payload 不会被本包降级为 `{}` 或 `null`。
- 严格 Source config 的未知字段、非 JSON-safe sourceLocator/asset、非 saved 状态的 BlobRef 和不满足身份证据的 normalized item 都 fail closed。

## 依赖

- 运行时依赖 `zod`。
- `packages/contracts/src/base.ts`、`action.ts`、`index.ts` 是实现锚点；`index.ts` re-export base/action。
- domain 规范引用[规范化内容](../domain/0001-normalized-content.md)。ContentKind、Publisher、Temporal、Metrics 的领域算法由 domain 拥有；本包只拥有其 wire schema。
- `ValueRef` 的运行时类型和 Store 接口来自 `@notnotype/nb-workflow`；本包记录其跨边界 JSON shape，[Workflow Value Store](../storage/0006-workflow-value-store.md)拥有 canonical 编码和四重读取校验。[FileBlobStore](../storage/0005-file-blob-store.md)拥有 BlobRefLike 的 bytes/hash/key/containment 校验。
- application ActionRegistry、Workflow ingest、API Controller 和 storage repository 是消费者，不是本组件的持久化实现。

## 配置

本组件没有环境变量、文件根目录、端口或运行时可变配置。schema 中的范围和默认值是源码常量：调度间隔 1,000 至 31 天毫秒、Bilibili limit 1 至 100 默认 20、查询 limit 1 至 100 默认 20 或 50、Source name 1 至 200、幂等键 1 至 300。Source 的未知 config 仅因 `sourceConfigSchema.passthrough()` 保留；这不改变内置 strict config 的边界。

## 重建验收

1. **协议与基础枚举**：给定 `protocolVersion`，观察其值为 `v1`；给定不在列举集合内的 ContentKind、PublisherKind、Run/Step/Job/Asset status 或 JobKind，观察 schema parse 失败，且没有文件、数据库或网络副作用。
2. **Source config 边界**：给定带额外键的基础 `sourceConfigSchema`，观察额外键保留；给定同样额外键给内置 strict config，观察 parse 失败；给定 Bilibili `feed` 且无 profile，观察失败；给定缺省 Bilibili limit/schemaVersion 和 AI HOT schemaVersion，观察 parse 后分别为 20、1、1。
3. **输入默认值**：给定缺少 CreateSource `enabled` 或 IngestCommand `triggerKind` 的有效对象，观察 parse 后分别为 `true` 和 `manual`；给定超长名称、空 sourceId 或超过 300 个字符的幂等键，观察失败，且不创建 Source/Run。
4. **Temporal 证据**：给定 exact、fallback 都为 null 的 TemporalValue，观察 parse 失败；给定合法 exact 或 fallback，观察 parse 成功；不允许以空对象替代时间证据。
5. **ActionRef**：逐一给定 `source.fetch`、`source.fetch@0`、`source.fetch@01`、`Source.fetch@1`、带空格 ref 和超过安全整数的版本，观察 parse 失败；给定 `connector.imap.poll@7`，观察 `parseActionRef` 返回 `{baseRef:"connector.imap.poll",version:7}`。
6. **Descriptor 安全边界**：给定包含 Zod input/output schema 的 ActionDefinition，构造并 parse Descriptor，观察 JSON 序列化结果不含 `inputSchema`/`outputSchema`；给定 ref 版本与 Descriptor version 不同，观察失败。
7. **JSON 与 BlobRef**：给定包含 `Uint8Array`、函数、NaN 或额外 key 的 Blob/asset/sourceLocator，观察相应 JSON-safe/strict schema 失败；给定非 saved asset 携带非空 BlobRef，观察失败；不允许把 raw bytes 写入 Workflow JSON DTO。
8. **Normalized item 边界**：给定无 externalId、无 webUrl 且 sourceLocator 为空的 item，观察失败；给定其中任一身份依据，观察 parse 成功；不允许 contracts 包写入领域或 Blob。
9. **事件 unknown 边界**：给定任意值作为 Event/SSE payload，观察 schema 只按 `unknown` 字段接受而不推断业务结构；调用方若不能 JSON.stringify，失败应发生在调用方，不由本包伪造 payload。
10. **无持久状态**：重启或重新导入 contracts 模块后，观察无 Source/Run/Job/SSE 游标等状态被恢复；唯一可重复结果来自源码中的 schema、枚举和默认值。
11. **用户组织枚举与回执**：给定 `targetType: "workspace"` 的 Label 附加命令或 `targetType: "topic"` 的收藏命令，观察 parse 失败；给定缺 `title` 的 `LabelDetail` 分组项或 `ok: false` 的回执，观察失败；不允许把未知 targetType 当作已支持能力。
12. **看板区块类型与 config 白名单**：给定 `type: "gadget"` 的创建命令，观察 parse 失败；给定 `feed`/`collection` config 含白名单外键或 `collectionId: ""`，观察对应 schema parse 失败；给定 `feed`/`collection` 空 config，观察 parse 成功（未绑定态）；给定未知 type，观察 `blockConfigSchemaFor` 返回 null；给定 `BoardBlock.type` 为未知字符串，观察读取侧 DTO 仍 parse 成功（降级由客户端处理）。
13. **Spotlight 目标枚举与读取降级**：给定 `targetType: "workspace"` 的 pin 命令，观察 parse 失败；给定 `targetType` 为未知字符串的 placement DTO，观察读取侧仍 parse 成功。

## 实现与测试锚点

- `packages/contracts/src/base.ts`：`protocolVersion`、内容/Publisher/Temporal/metrics schema、Source config/command、`sourceExecutionSnapshotSchema` 与 `sourceSnapshotSchema`。
- `packages/contracts/src/index.ts`：ConnectorDescriptor、Run/Step/Job/Asset/Health/Error DTO、Feed/Search、Entry/Observation/Story/Revision、Topic/Entity、用户组织（Label/Collection/Favorite）DTO 与命令、看板（Board/Section/Block）DTO 与命令、Ingest 与 Event/SSE schema。
- `packages/contracts/src/action.ts`：`actionRefSchema`、`parseActionRef`、ActionKind/placement/error、`retryPolicySchema`、`actionDefinitionSchema`、`actionDescriptorSchema`/`actionManifestSchema`、JsonValue/BlobRef/normalized asset/item 与三个 ingest Action DTO。
- `packages/contracts/src/index.test.ts`：Bilibili mode/profile 和 strict unknown、AI HOT 默认值和 strict unknown、可扩展 CreateSource、probe/job snapshot、Publisher 空白归一化、TemporalValue 证据约束、topic/entity/用户组织三类 DTO 与命令的枚举校验与读取侧降级。
- `packages/contracts/src/action.test.ts`：ActionRef bare/zero/leading-zero/uppercase/space/unsafe 拒绝、版本解析、固定枚举、Descriptor 去 executable schema、版本一致性、Retry/Execution 约束、错误代码与 `workflow-activity`、Source snapshot 分离、JSON-safe asset/manifest、Uint8Array 与额外 BlobRef 拒绝。
- 消费边界：`packages/application/src/action.ts` 对 unknown input/output parse；`packages/application/src/workflow-ingest.ts` 使用 normalized item 合同；`apps/api/src/app.controller.ts` 对 HTTP body/query parse 并 JSON.stringify SSE。

## 非目标/边界

- 不把 ActionDefinition 当作可传输 manifest；executable Zod schema 不能进入 Descriptor、Workflow JSON、Catalog 或 SSE。
- 不定义 Action handler 的 dispatch、Host fence、lease、retry 执行、Connector 网络访问或 Workflow 状态机；这些由 application/runtime spec 拥有。
- 不定义 NormalizedIngestItem 的内容生成、Publisher 归一化、时间解析、external key、fingerprint 或 Story 投影算法；唯一规范见[规范化内容](../domain/0001-normalized-content.md)。
- 不把 `unknown` payload/result 宣称为已校验的 JSON 业务对象。`AssetSnapshot` 的 `storageKey` 是当前 schema 和 repository/API 直返事实，本组件不宣称已剥离或提供授权/脱敏；具体 Product API 行为由消费者实现。
- 不声称 contracts 包自身提供 ValueStore、Blob Store、Database、SSE 连接或持久恢复；BlobRef/ValueRef 只是本包拥有的 wire shape，真实 bytes、canonical JSON 和引用完整性由对应 storage owner 负责。
