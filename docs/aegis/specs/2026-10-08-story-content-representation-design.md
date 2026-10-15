# Story 内容表示与多模态阅读设计

状态：`accepted`（目标设计已获用户确认，尚未实现）
日期：`2026-10-08`

决策者：维护者；完整提案获确认。本文件记录批准的目标，不作为当前实现事实；正式 Task、稳定架构/ADR 和实施验证仍待推进。

## 1. 目标

让同一份来源内容同时支持：

- 人类对纯文本、结构化文章、图文文章、图片、视频、音频和混合内容的连续阅读；
- Agent 对 Story、来源条目、媒体和证据的结构化读取；
- Story 摘要、关键事实、实体、关系和后续研究结果的可追溯引用；
- HTML 清洗、媒体失败和旧数据的可解释降级。

核心原则：阅读页是内容表示的一个消费方，不是来源事实的拥有者；Agent 也是内容表示的消费方，不得把派生判断伪装成来源事实。

## 2. 当前状态与问题

当前项目已经有 `ContentKind`、`StoryKind`、`EntryRevision`、`Asset`、`StoryRevision` 和媒体状态边界，但 `EntryRevision` 主要只有单一 `contentText`。Web 阅读页直接以 `whitespace-pre-wrap` 展示正文，并在正文之后统一展示媒体，因此原文的图文顺序已经丢失；HTML 标签也可能直接进入阅读内容。

现有 Story 设计负责规范身份、Story Revision、来源成员、时间线、关键事实和证据关系，但没有定义有序正文内容块、解析版本、表示版本或 Agent 对内容块的稳定引用。

## 3. 已确认的目标状态

### 3.1 三层数据职责

```text
EntryRevision
├─ 来源内容修订，不可变
├─ 指向 Observation 原始来源证据的引用，不复制原文
└─ ContentRepresentation[]
   └─ 可替换的阅读/Agent 内容投影

StoryRevision
├─ title / summary / kind / subtype
├─ timeRange / keyFacts
└─ 对 EntryRevision / ContentRepresentation / block 的证据引用

Agent Candidate
├─ 分析或编排建议
├─ 输入版本与证据引用
└─ 等待用户确认，不直接覆盖 Story 当前表示
```

`EntryRevision` 拥有来源修订；`ContentRepresentation` 承载该修订的可重建阅读投影；Story 只拥有规范语义表示，不复制来源正文。

### 3.2 原始内容与规范化投影

原始内容作为不可变证据保留，但不在 Cosmos 阅读页直接渲染。内容块是带解析器版本的可重建投影。解析器升级不创建新的 `EntryRevision`，而是在同一 `EntryRevision` 下创建新的 `ContentRepresentation`。

Observation 唯一持有原始来源输入，EntryRevision 和 ContentRepresentation 不复制完整原文或 rawPayload。记录格式、编码、大小和截断标记；超限保存受允许的片段并明确降级。规范化表示可以在原始证据清理后继续阅读，但必须显示 `evidence-unavailable`，不能声称原文仍可核验。

原始 payload 按来源能力、敏感等级和预算选择性保存：

- 来源定位、标题/正文输入、采集时间、解析版本和已保存媒体引用属于必需证据；
- RSS/XML/JSON/HTML 等原始 payload 可通过 Blob 引用保存，但不默认进入普通 DTO 或 Agent 输入；
- Cookie、Authorization、token、脚本和追踪数据永不保存为内容；
- 私信、邮件、群聊及敏感附件遵循来源权限和保留策略；
- 普通阅读页读取规范化内容，事实核验才按权限申请原始证据。

### 3.3 内容块合同

第一版使用严格的可区分联合类型，块数组保持原文语义顺序。共同字段为：

```text
id
 type
sourceLocator?
parseWarnings?
```

各块由 `type` 决定专属 `data`，共同溯源字段为可选 `source` 和 `warnings`；下列字段清单描述语义，不是可直接复制的 wire schema。块数组是唯一的正文顺序，不新增平行媒体顺序索引。列表最多嵌套 3 层，块文本超限时截断并记录警告。

第一版块类型：

```text
heading   -> level, inlines
paragraph -> inlines
quote     -> inlines / blocks
list      -> ordered, items
code      -> text, language?
image     -> assetId, sourceUrl, alt, caption
video     -> assetId, sourceUrl, posterAssetId?, title, duration?
audio     -> assetId, sourceUrl, posterAssetId?, title, duration?
embed     -> provider, url, title?
table     -> columns, rows
divider   -> 无正文
unknown   -> text?, sourceUrl?, reason
```

行内标记仅允许：`text`、`link`、`strong`、`emphasis`、`code`。不保存任意 HTML、CSS、脚本或事件属性。复杂嵌套只在引用、列表和表格等语义范围内允许。未知类型在读取侧安全降级为 `unknown`，不能导致整篇内容失败。文本长度、列表深度、表格规模和 URL 数量需要由合同设定上限。

块 ID 在单个 `EntryRevision` 的单个表示版本内稳定，跨来源修订不承诺延续。证据引用至少绑定：

```text
entryId
entryRevisionId
representationVersion
blockId?  # 可选：省略时表示整个表示版本；提供时绑定具体块
```

### 3.4 表示版本与当前指针

同一 `EntryRevision` 可以拥有多个 `ContentRepresentation`。`EntryRevision` 保留明确的 `currentRepresentationId`，而不是每次读取动态选择。

表示至少包含：

```text
representationVersion
parserVersion
status: complete | partial | failed
qualitySignals
createdAt
supersedesRepresentationId?
```

新表示先经过结构校验才可成为候选；系统按 `complete > partial > failed` 和质量信号推进当前指针。人工锁定的表示不被自动替换；质量异常时可以回退到上一个可用表示。Agent 结果绑定实际读取的表示版本。

### 3.5 解析责任与生命周期

Connector 负责来源字段映射、媒体候选、来源定位、原始 payload 和来源特有扩展，并提供 `contentSource`：`plain-text` 使用 `text`；`safe-html-input` 使用 `html` 与可选 `baseUrl`；`structured-source-content` 使用受控 `StructuredSourceBlock[]`。HTML 名称不代表可信；baseUrl 仅解析相对链接，不触发请求。Normalizer 统一生成新表示的 contentText；旧 Connector 的 contentText 保留兼容入口，不作为第二份新正文真相。共享内容块规范化器负责纯文本/安全 HTML/结构化来源内容的通用清洗和块生成，不抓取 `webUrl` 外部全文，也不拥有 Story 阅读合同。

采集时由确定性解析器生成初始表示，不依赖 Agent；解析失败不阻塞文本和元数据入库：

```text
complete -> 使用完整块序列
partial  -> 使用已生成块 + unknown，并显示警告
failed   -> 使用 contentText 纯文本 + 原文入口
```

解析目标是语义顺序和可读性，不承诺像素级还原原站。脚本、样式、导航、广告、页脚、评论区和其它非正文结构删除；不确定结构保留可读文本或媒体链接，并记录警告。

### 3.6 媒体块

内容块只保存可选 `assetId`、`sourceUrl`、`caption`、`alt` 等引用和阅读说明，不复制媒体字节、Blob key、MIME 类型、媒体状态或完整元数据。`Asset` 是这些元数据的唯一 owner；Query 将当前 Asset 状态投影为读取能力。

- `saved` 图片使用站内 Asset，支持离线阅读；
- `metadata_only` 音频/视频显示媒体信息、封面或占位和来源链接，不宣称离线播放；
- `saved` 音频/视频只有在后续下载策略明确后才提供站内播放；
- `skipped`/`failed` 显示真实原因和原文媒体链接，不显示空白播放器；
- 找不到 Asset 时保留来源 URL，标记 `asset-missing`，不阻塞整篇内容。

### 3.7 Story 阅读投影

阅读页采用统一内容块阅读器，`ContentKind`/Story subtype 只负责类型化首屏和辅助信息，不复制整套页面：

```text
Story 当前表示
  -> 标题、摘要、时间范围、关键事实
主内容
  -> 一个明确的读取投影主来源的内容块
来源证据
  -> 其它 Entry 按来源、时间和关系展示
Agent/系统产物
  -> 独立、可折叠、带证据的建议区
```

单 Entry Story 默认展示该 Entry 的完整内容块。多来源 Story 不默认无提示拼接正文：

- `event` 默认展示 Story 表示、关键事实和时间线，用户选择来源后查看完整正文；
- `document` 可以按来源切换原文，默认使用确定性主来源；
- `media` 默认展示主媒体，其它来源作为证据；
- `thread` 按 Entry 时间顺序展示，每条保留来源和修订边界。

第一版不新增 `Story.primaryEntryId`。主来源是读取投影，按稳定、可解释的规则选择，并在界面明确标注：未来若有用户指定主来源，优先使用；当前没有时依次考虑首个主成员、内容完整度/来源可信度、按 Story kind 的时间规则，最后用稳定 ID 兜底。

### 3.8 Agent 读取与写入

Agent 读取分三层：

1. `Story representation`：当前 Story 标题、摘要、类型、时间范围和关键事实；
2. `Source entries`：成员 Entry、来源、修订、内容块和媒体元数据；
3. `Evidence and derived relations`：证据关系、Entity、Topic、Annotation 和 provenance。

读取范围按任务显式申请：`summary-only`、`structured-content`、`full-source-evidence`、`media-metadata`、`media-bytes`。默认从 Story 表示开始；结构化来源正文由任务显式选择，事实核验申请原始证据，图片理解另行申请媒体字节。第一阶段音视频仅提供元数据，字幕/转录与自动理解后置。入口复用 `agent.invoke@1`，初始 action 为 `story.summarize`、`story.extract-relations`、`story.review-content-quality`；这些是待实现能力，不能视为当前已有自动工作流。

Agent 默认只读。分析结果先形成候选：标题/摘要、关键事实、实体/关系、证据关系、Story merge/split、Topic 成员/角色和 Research 请求。涉及 Story 表示、Story 身份、关系、Topic 或 Artifact/发布的写入必须用户确认。Agent 不得直接修改 Observation、EntryRevision、用户标签/收藏/批注/集合、用户接受的 Story 表示、Asset/Blob、权限、Secret、Source 配置或外部发布。

Agent 结果必须记录 producer、producerVersion、输入 Story Revision、输入 Entry Revision、representationVersion、证据引用和置信度。候选接受后才成为正式 Story 表示或关系。

### 3.9 证据失效

证据引用保留，但状态明确表达：

```text
available
representation-unavailable
source-revision-superseded
media-unavailable
access-restricted
deleted
```

Entry 新 Revision 不会自动迁移旧结论。表示被淘汰时仍保留旧结论并提示“基于旧版内容表示”；媒体被清理时只降低媒体证据状态；权限收紧时不泄露原文；全部证据失效时结论降为“待重新验证”。Agent 产物和审计记录不自动删除。

### 3.10 旧数据兼容

读取优先级：

```text
有当前 ContentRepresentation -> 按内容块渲染
无内容块但有 contentText -> 单个 paragraph，representationStatus=legacy-text
无正文但有媒体 -> 媒体块和降级说明
都没有 -> 无可阅读正文 + 原文入口
```

`legacy-text` 是读取侧投影，不写回、不伪造 parserVersion。旧正文若含 HTML，同样经确定性的安全文本清洗再展示，不能直接把泄漏的标签包进段落，也不能猜测来源丢失的图片位置。旧 `contentText` API 继续可用。不做一次性历史内容块回填。

## 4. 第一阶段范围与验收

### 4.1 必须验证

- 纯文本、HTML、图文交错内容生成稳定有序块；
- HTML 清洗掉脚本、样式、导航和不安全属性；
- 标题、段落、引用、列表、代码和安全链接可读；
- 媒体顺序保留，媒体状态和失败原因可见；
- `complete/partial/failed` 和 `parseWarnings` 正确产生；
- 同输入/同解析器版本结果稳定；解析器升级不改写旧 EntryRevision 或旧证据；
- Story 多来源不默认拼接正文，来源可区分；
- Agent 能分层读取 Story、Entry、内容块、媒体和关系；
- Agent 证据绑定输入版本和 block ID；
- 证据不可用时结果降级；
- 旧数据通过 `legacy-text` 继续可读；
- 无媒体或解析失败不导致 Story 详情失败。

### 4.2 第一阶段非目标

- Cosmos 内直接渲染原始 HTML；
- 像素级还原原站样式；
- 自动 Story 聚类、merge、split；
- Agent 自动写入 Story 或用户数据；
- 字符级证据迁移；
- 独立 `ContentBlock` 表；
- 视频/音频转录、转码、OCR 或自动多模态理解；
- 历史数据一次性重解析回填；
- 完整 Artifact/Workspace/Publication 产品。

## 5. 影响与后续文档

这是一个跨模块、持久化和公开读取合同变更，不能只作为前端改造实施。后续实现前需要同步：

- requirements：补充多模态内容阅读、来源事实与 Agent 派生结果分离的验收；
- architecture：补充 `EntryRevision -> ContentRepresentation -> Story/Agent` 数据流和所有权；
- ADR：记录不可变来源修订、可版本化内容表示、原始证据边界、Agent 权限和证据降级；
- contracts：定义内容块 discriminated union、表示投影、读取范围和证据引用；
- storage：决定 ContentRepresentation 的具体持久化方式、当前指针、原始 payload Blob 引用和清理边界；
- Web：增加统一块阅读器、主来源投影、来源切换、媒体降级和 Agent 候选区；
- tests：覆盖 parser、contracts、storage、Agent read projection、浏览器混合内容和旧数据 fallback。

当前未决定的实现细节不应被代码自行升级为长期公共合同，尤其是质量信号算法、原始 payload 保留天数、ContentRepresentation 的数据库表形状、读取范围权限模型和具体 Agent tool 名称。

## 6. 设计草案审查

- 所有权：来源事实归 Entry/EntryRevision；阅读投影归 ContentRepresentation；Story 只归属规范表示；Agent 候选归 Agent/Workflow 产物边界。
- 兼容：保留 `contentText`，读取侧支持 `legacy-text`，未知块安全降级。
- 数据完整性：原始 Observation/EntryRevision 不被解析器或 Agent 改写；用户接受的 Story 表示不被派生结果覆盖。
- 证据：所有 Agent 结果绑定具体输入版本；表示、媒体、权限或来源修订变化时显式降级。
- 安全：原始 HTML 不执行；凭据和脚本不保存；外部内容按不可信数据处理。
- 复杂度：第一版不建立独立 ContentBlock 表，不做字符级锚点和完整多模态理解；`ContentRepresentation` 仅用于保护不可变来源修订与解析器升级能力。
- ADR 信号：持久化 owner、公开内容块合同、Agent 读取权限和证据生命周期需要在实现 Task 前形成稳定 ADR。

## 7. 讨论决策记录

| 序号 | 已确认决定 |
| --- | --- |
| 1 | `EntryRevision` 拥有规范化内容块，Story 只引用 |
| 2 | 原始内容不可变保留，内容块是可重建投影 |
| 3 | 第一版使用语义块和受控媒体，不保留任意 HTML |
| 4 | 内容块第一版作为有序 JSON 投影，不建独立 ContentBlock 表 |
| 5 | Agent 读取分 Story 表示、来源条目、证据/派生关系三层，并按任务申请媒体/原始证据 |
| 6 | 采集阶段确定性生成内容块，解析失败不阻塞入库，Agent 不参与首轮解析 |
| 7 | 统一内容块阅读器为主框架，ContentKind/subtype 只负责首屏和辅助展示 |
| 8 | Story 当前表示为主内容，多 Entry 原文作为有来源证据，不默认拼接 |
| 9 | block ID 只在单个 EntryRevision/表示内稳定，证据绑定 revision + block |
| 10 | 原始 HTML 不在 Cosmos 阅读页直接渲染 |
| 11 | 旧数据读取侧降级为 `legacy-text`，不做一次性回填 |
| 12 | 内容块只引用 Asset，媒体状态决定能力和降级 |
| 13 | 行内格式采用 `text/link/strong/emphasis/code` 受控标记 |
| 14 | 解析器保留语义顺序，删除非正文结构，不承诺像素级还原 |
| 15 | 来源内容、Story 当前表示、Agent 候选产物严格分区 |
| 16 | 第一版不新增 `primaryEntryId`，主来源是稳定读取投影 |
| 17 | 共享规范化器负责通用结构，Connector 负责来源特有字段 |
| 18 | 引入 `ContentRepresentation` 承载同一 EntryRevision 的可版本化投影 |
| 19 | `currentRepresentationId` 明确选择当前表示，系统按质量推进并支持回退 |
| 20 | 内容块使用严格联合类型、有限嵌套和未知类型降级 |
| 21 | 来源证据必保留，原始 payload 选择性保存，凭据/脚本永不保存，Agent 默认不读原始 payload |
| 22 | 证据失效时保留 Agent 产物但显式降级，全部失效则待重新验证 |
| 23 | Agent 默认只读，候选写入需用户确认，不得修改原始数据和用户真相 |
| 24 | 第一阶段验收聚焦内容结构、阅读、Agent 读取、证据和兼容；不做自动聚类与完整多模态理解 |
