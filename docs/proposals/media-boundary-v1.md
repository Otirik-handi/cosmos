# Proposal：媒体边界 v1（RSS 媒体提取、受控下载与本地 Blob 保存）

> 状态：accepted
>
> 日期：2026-09-03
>
> 需求真相源：[`../requirements/0001-original-requirements.md`](../requirements/0001-original-requirements.md)（2026-09-03 媒体边界实现设计对齐节）
>
> 关联：Task 02 RSS Ingestion 实施顺序第 5/6 步、已接受 Proposal [`first-usable-e2e-loop`](./first-usable-e2e-loop.md)、架构 [`0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §6.4、PRD [`0002-product-requirements.md`](../requirements/0002-product-requirements.md) ING-007～ING-009、ADR [`0005-media-boundary-v1`](../adr/0005-media-boundary-v1.md)

## 问题

媒体"尽可能保存"（ING-008）目前只有元数据，没有实体。RSS 管线把 enclosure 作为 `metadata_only` Asset 记录（`plugins/rss/src/index.ts` 的 `readAssets`），正文里的图片、音视频标签完全没有提取；仓库侧虽然有完整的内容寻址 Blob 服务和 `GET /assets/:assetId` 受控下载端点，但没有能力产生"已保存"的媒体——用户断网后无法读到图片。

本 Proposal 冻结 Task 02 实施顺序第 5 步的媒体边界实现设计。按已接受方向，媒体由 Connector 管线处理、仓库提供 Blob 服务，且无历史媒体回填。

**公共面边界（评审后批准）**：不改 `assetStatusSchema` 4 态、不改 Prisma 表结构（`Asset.errorMessage` 列已存在，无 migration）；但允许在媒体输入与 Asset 快照上新增一个**可选的公共原因字段 `errorMessage`**（见第 5 节），让界面能真实展示降级原因。除此之外的媒体决策都在既有合同边界内落地。

## 已拍板输入（用户 2026-09-03 对齐，非本设计新增）

| 输入 | 决定 |
| --- | --- |
| v1 媒体类型范围 | 图片下载为实体；音频/视频只记录元数据与原文外链，不下载本体 |
| v1 全局媒体预算默认值 | 单文件 10MB / 单次 Run 50MB |
| 断网产品验收执行方式 | 用户写步骤清单，agent 实测 |
| 媒体验证真实 RSS 源 | 双源：爱范儿 + 阮一峰 |
| 媒体发现范围 | 只处理 RSS 条目自身的 enclosure 与正文媒体标签，不抓取 `webUrl` 外部全文 |
| 降级展示 | 超预算或下载失败的媒体显示真实降级状态并保留原文外链，不用空白或加载中掩盖 |
| per-source 媒体策略 | 后置（PRD ING-009，Phase 2），v1 只用全局默认 |
| 历史媒体 | 无回填 |

## 目标与非目标

### 目标

1. RSS Connector 提取条目自身媒体：enclosure、`media:content`/`media:thumbnail`、正文 HTML 的 `img`/`audio`/`video`/`source` 标签，全部作为 Asset 表达。
2. 图片候选在 Worker 侧被受控下载，通过既有 domain bytes → Workflow BlobRef → Storage Asset metadata 链路保存为本地实体；音视频与未知类型只保存元数据 + 原文外链。
3. 下载受全局预算（10MB/文件、50MB/Run）与安全边界约束；超预算、拦截或失败的媒体以既有 4 态枚举 + 可选原因字段表达真实降级，原文外链保留。
4. 公共面改动最小：`assetStatusSchema` 4 态与 Prisma 表结构不变（无 migration）；仅新增一个可空可选原因字段 `errorMessage`（domain 媒体输入、ingest wire Asset、Asset 快照三处透传），不含任何枚举扩展。

### 非目标

- 抓取 `webUrl` 外部全文或正文外链里非 RSS 条目自身的资源。
- 下载音视频本体、PDF 或其它附件。
- per-source 媒体策略、单条目媒体数量上限、媒体失败重试、历史媒体回填（ING-009 / Phase 2）。
- 图片派生变体（缩略图/转码）、URL 级跨 Run 去重账本。
- 本 Proposal 实现阅读页 UI；阅读页接线属于 Task 02 实施顺序第 6 步，本设计只给出读取路径与状态文案边界。

## 当前行为与证据

- RSS Connector 只把 enclosure 提取为单条 `metadata_only` Asset（kind=`enclosure`、sourceUrl/mimeType/byteSize 提示、content=null），不提取正文媒体标签，从不下载（`plugins/rss/src/index.ts:366-380`）。
- domain `NormalizedAssetInput` 已支持 `status: saved` 携带 `content: Uint8Array`；domain 规范明确 bytes 在 application/storage 边界外置到 Blob，不进入 Workflow JSON。
- Application 在 `source.fetch@1` action 内对每个 item 执行 `toJsonItem`：`saved` 且有 content 的 Asset 经 `WorkflowBlobStore.put` 得到 BlobRef，JSON 状态只存引用；`metadata_only`/`skipped`/`failed` 的 Asset blobRef 恒为 null（`packages/application/src/workflow-ingest.ts:351-380`）。
- `library.ingest@1` 经 `fromJsonItem` 按 BlobRef 读回并校验 bytes，`persistIngestItemInternal` 写入 Asset 行（storageKey/mimeType/byteSize），重复内容由内容寻址 `put` 幂等去重（`packages/storage-prisma/src/index.ts:1020-1058`、`:1248-1258`）。Prisma `Asset.errorMessage` 列已存在但目前无人写入（`:1248-1258` 未映射），本设计将其接通。
- 内容寻址 Blob 服务已支持 put/read/校验；Blob 由内容 SHA-256 派生 key，`sha256/<2>/<62>`（`packages/blob-store`，spec `docs/spec/storage/0005-file-blob-store.md`）。
- API 已有 `GET /assets/:assetId` 受控下载（有 storageKey 的 Asset 才返回 bytes，`apps/api/src/app.controller.ts:577-590`），但当前没有任何 Asset 有 storageKey。
- Worker 网络出口已有统一代理合同 `createProxyFetch`（HTTP(S)_PROXY/NO_PROXY、环路直连、凭据脱敏），RSS 抓取与未来媒体下载可共用同一出口（`apps/worker/src/proxy-fetch.ts`）。
- 生产 ingest 有两条泳道：durable `source.fetch@1` action（Task 07 产品路径）与 legacy `source-ingest` Job（`IngestionService.runExistingRunWithLease`），二者都在 packages/application 内调用 Connector `fetchItems`（`packages/application/src/index.ts:712`）。
- `source-config-probe`/`source-probe` dry-run 承诺无副作用，不应触发任何媒体下载。
- 公共 Asset wire 形状与 Prisma Asset 均已含 saved/图片所需的全部字段；媒体边界唯一的新增是"降级原因"，评审批准作为可空可选 `errorMessage` 进入公共面。

## 方案与取舍

### 1. 媒体获取落点：Application 层共享"媒体获取步骤"（Connector 只提取、不下载）

RSS Connector 增加**纯提取**能力：把条目自身媒体（enclosure、media:content、media:thumbnail、正文 `img`/`audio`/`video`/`source`）投影为 `NormalizedAssetInput` 候选。候选按类型分类：`image`（或 enclosure 且声明 mime 为 `image/*`）标记为可下载意图；`audio`/`video`/其它类型直接以 `metadata_only` 为终态（v1 策略：音视频只存元数据）。

新增一个 Application 拥有的**媒体获取组件**（纯编排 + 注入 fetch/limits/signal/logger），处理一次 fetch 输出的整页 items：对"可下载意图"的候选执行受控下载并改写其 status/content/errorMessage；不改动"metadata_only 终态"候选。

调用点两处、同一函数：
- durable `source.fetch@1` handler：`connector.fetchItems` 之后、`toJsonItem` 之前（`packages/application/src/workflow-ingest.ts:284-294`）；
- legacy `source-ingest` 泳道的 fetch 边界（`packages/application/src/index.ts:712`）。

取舍：媒体安全、预算、超时集中在一个组件里，审查与测试面单一；两泳道行为一致。代价是 RSS connector 增加一段纯提取代码，且获取发生在 fetch action 内（延长单次 fetch 时长、占用页级预算）。选这个方向是因为它与已接受建议一致：Connector 不直接接触 Data Root/网络能力边界清晰；`source-config-probe` 不经过 fetch action，天然保持无副作用。

### 2. bytes/BlobRef 映射：复用既有链路，仅透传可选原因字段

媒体获取只填充 domain `NormalizedAssetInput` 的既有字段（下载成功的图片候选 → `content: Uint8Array`、`status: "saved"`、真实 mimeType/byteSize；失败 → 相应降级 status、content=null），并新增一个可选 `errorMessage` 字段承载降级原因。此后整条链路全部复用现有代码，新增工作只是 errorMessage 的字段透传：

```text
saved asset.content (Uint8Array)
  → source.fetch@1 内 toJsonItem → WorkflowBlobStore.put → BlobRef（JSON 只存引用）
  → library.ingest@1 fromJsonItem → readVerifiedBlob 校验读回
  → persistIngestItemInternal → 内容寻址 put（EEXIST 幂等）→ Asset.storageKey
```

理由与边界：`workflow-ingest.ts:351-380` 的 toJsonItem 已对 `status==="saved" && content` 执行 put 并生成 blobRef，其余状态 blobRef=null 直通；wire `normalizedAssetInputSchema` 是 strict 对象。**媒体实体保存不需要新增任何 Blob/状态字段；唯一的字段新增是错误原因（见第 5 节），且它是可空可选的透传值，不影响 strict 校验的既有键。**

### 3. 受控下载与预算（"受限流式 Blob 能力"的 v1 形态）

媒体获取内的下载器以注入的 fetch（worker 传 `createProxyFetch()`，与 RSS 抓取同一代理出口）发起请求，对 `response.body` **逐块读取并计数**：

- 累计超过单文件上限（10MB）或 Run 剩余预算 → 立即中止并丢弃缓冲，不完整字节永不入库；
- 响应 `Content-Length` 声明超限、或提取期 byteSize 提示超限 → 不读 body 直接判 skipped；
- 通过校验的完整字节作为 `Uint8Array` 交给既有 toJsonItem put 链。

v1 底层采用受控内存暂存（峰值 ≤ 单文件上限），理由是既有 `FileBlobStore.put` 接收完整 `Uint8Array` 并按内容寻址；单文件上限 10MB 使内存暂存可接受。**"边下载边写盘"（增量 hash + 临时文件 + rename）作为后续升级点记录，升级不改下载器端口合同。**

预算与执行语义：
- 默认 10MB/文件、50MB/Run（用户已拍板）；Run=一次 fetch 的一页。下载器以工厂参数注入限额，默认值以常量导出；不引入 env、不进入 Source 配置（per-source 策略归 ING-009）。
- 顺序处理、不并发：预算按文档顺序先到先得、结果确定；内存峰值 = 单文件上限。
- 同一次 Run 内相同 sourceUrl 只下载一次（页内 memo），同一 URL 多处出现时多条 Asset 行复用同一结果（存储内容寻址天然去重字节）。
- 下载器对单媒体失败不抛错：每个媒体的失败都映射为该 Asset 的降级 status + errorMessage；整页 items 照常进入后续持久化，fetch action 的既有重试语义不被媒体失败污染。

取舍：不设单条目媒体数量上限（预算天然封顶，实现最小）。后果：一张图集帖可能耗尽整页 50MB 预算，排在后面的条目图片在本修订周期保持 skipped（见第 6 节生命周期）。**评审决定：v1 接受该"不自愈"后果，不加单条目上限**；per-source/单条策略与失败重试归 ING-009。

### 4. 下载安全边界（v1 只下载图片）

威胁模型：RSS 源内容不可信；恶意条目可构造指向内网/本机/云元数据地址的图片 URL，由 Worker 进程代为请求（SSRF）。v1 边界：

- 协议：仅 `http`/`https`；URL 含 userinfo（`user:pass@`）拒绝。
- 解析后校验：对 hostname 做 DNS 解析，**全部**解析地址必须为公网可达地址；拒绝 loopback、RFC1918、链路本地（169.254、fe80::）、ULA（fc00::/7）、0.0.0.0、组播与保留段。
- 重定向：手动逐跳处理，最多 3 跳，每跳重新执行协议与解析校验。
- 响应校验：Content-Type 必须为 `image/*`；Content-Type 缺失或为 `application/octet-stream` 时以文件头魔数嗅探兜底（PNG/JPEG/GIF/WebP）；两者都验证不过 → failed。拒绝把 HTML 错误页当图片保存。
- 超时：单媒体总时长默认 60s（工厂参数）；全程绑定 fetch action 的 signal（取消/租约恢复可中断）。
- 不转发 Cookie / Authorization；请求头保持最小。
- 残余风险记录：预检解析与实际建连之间存在 DNS rebinding 时间窗。v1 是本地单用户、Worker 进程无云凭证，接受该残余风险并在代码注释中标注；不为此引入 IP-pinned 连接。
- 受控本地 RSS 验收源在私网/loopback：媒体下载默认拦截它们。测试与 E2E 通过显式 allowlist 环境变量（`COSMOS_MEDIA_ALLOWED_HOSTS`，默认空 = 拦截所有私网地址）放开受控源。该变量只服务测试与显式运维场景，不进入产品配置。
- 日志：媒体结果写结构化日志（reason code、host、byteSize、耗时），不记录完整 URL（完整 URL 已持久化在 Asset.sourceUrl）。

### 5. 状态语义与降级展示（4 态不变，新增可选原因字段）

公共 `assetStatusSchema` 保持 4 态不变。v1 对每个媒体候选的映射规则：

| 公共 status | 含义（v1） | 何时出现 |
| --- | --- | --- |
| `saved` | 图片实体已保存，断网可读 | 下载 + 校验 + 入库成功 |
| `metadata_only` | 按策略有意只存元数据 | 音视频、未知类型附件；不下载 |
| `skipped` | 想保存但被边界拦下，未发起或中途拦截 | 超单文件/Run 预算、声明超限、协议/私网不允许、URL 无法定位 |
| `failed` | 发起下载但失败 | 网络错误、超时、HTTP ≥ 400、Content-Type/魔数验证不过 |

所有非 saved 状态都保留 `sourceUrl` 原文外链。

**新增可选原因字段 `errorMessage`（评审批准）**。用户评审决定：降级原因要能进界面展示，不能只进日志。设计为可空可选的短文本（上限 500 字符），仅降级状态（skipped/failed）填写，saved/metadata_only 保持 null。它做一次最小透传链路，结构上不改枚举、不改表结构：

- domain `NormalizedAssetInput` 增加可选 `errorMessage: string | null`；媒体获取组件填写（如"图片超过单文件预算 10MB"、"来源地址位于内网，已拦截"、"下载失败：HTTP 404"）。
- contracts `normalizedAssetInputSchema` 与 `assetSnapshotSchema` 各增加可空可选 `errorMessage`（ingest wire 与读取快照两端同步，`assetSnapshotSchema` 是公开读取 DTO 变更点）。
- `toJsonItem`/`fromJsonItem` 透传该字段；`persistIngestItemInternal` 写入已存在的 Prisma `Asset.errorMessage` 列；`toAssetSnapshot` 读回。
- 结构化日志继续携带机器 reason code（用于诊断聚合），界面文案用 `errorMessage` 文本。

理由：PRD ING-008 把"超预算"列为用户可见的独立状态，4 态粗粒度会把"超预算"与"策略/安全拦截"混在 skipped 里；用户无法区分时会误读为策略不想要这张图。该字段是 additive、可空、无枚举扩展，成本低，且 `Asset.errorMessage` 列已存在无需 migration。

### 6. 生命周期与不重试边界

Asset 附着在 EntryRevision 上。媒体失败/降级只影响该 Asset，不阻止条目文本与元数据入库，也不影响 Run 成败。fingerprint 不变的重复轮询不产生新修订，因此**不重试媒体**；只有条目内容本身修订（fingerprint 变化）生成新修订时，媒体候选才会重新提取与下载。这与"无历史媒体回填"一致，失败重试策略归 ING-009。

**评审决定：v1 接受该"不自愈"语义**——预算耗尽导致的 skipped / 网络失败导致的 failed 在该修订周期内不会自愈，看板始终显示真实降级（status + errorMessage + 原文外链）而非伪造离线成功。不加单条目媒体数量上限，接受图集帖饿死同页后排图片的后果（本修订周期内）。

崩溃与重试：fetch action 成功后的输出（含 blobRef）已 journal，Workflow 恢复重放不重新下载；fetch action 自身失败重试会整页重新下载（预算按每次尝试生效，单次上限 50MB）——记录为已知成本。

### 7. Probe 与 fixture 的确定性

- `source-config-probe`/`source-probe` 只执行 Connector dry-run，不经过 fetch action，因此不运行媒体获取，无副作用边界不变。
- 媒体获取按 Connector 能力门控：真实 rss Connector 声明 `media-download` capability，媒体获取只处理声明该能力的 Connector 输出；fixture Connector 不声明，五类 fixture 案例行为与现有测试确定性保持不变（fixture 里带假 URL 的媒体不会被误触发下载）。
- **评审决定：`media-download` 作为公开 capability 值加入 rss Connector 的 `capabilities`**（与现有公开投影机制一致，媒体能力可被 Catalog/Web 发现）；不引入第二套内部"能力"分类。

## 影响

- **产品/API**：`GET /assets/:assetId` 从"恒无内容"变为"对 saved Asset 返回图片字节"，行为不变、实现不变；Asset 快照多出真实 `saved` 状态并携带可选 `errorMessage`。无新增端点。
- **数据**：无 Prisma migration（`Asset.errorMessage` 列已存在，仅接通读写）。新增 Asset 行带 storageKey（已有列）；Blob Root 出现媒体文件。
- **公开合同**：`assetSnapshotSchema` 与 ingest wire 的 `normalizedAssetInputSchema` 各增加可空可选 `errorMessage`（additive，无枚举扩展）；rss Connector 的 `capabilities` 增加公开值 `media-download`。无其它 DTO 结构变化。
- **安全**：Worker 获得一条受控的外出下载通道（仅图片、公网、预算封顶、类型校验）。SSRF 边界与 allowlist 见第 4 节；残余 rebinding 风险已记录。
- **迁移**：无历史媒体回填。旧数据没有任何 saved Asset，Web 按既有逻辑显示外链/元数据，不宣称完整离线。
- **发布/回滚**：媒体获取组件以独立模块落地；rss Connector 移除 `media-download` 能力声明即可整体关闭下载（回退开关），不影响文本管线。fetch action 执行时长随媒体数量线性增加，属已知行为变化。
- **新增配置面**：测试/运维 allowlist 环境变量 `COSMOS_MEDIA_ALLOWED_HOSTS`（默认空 = 拦截私网），不进入产品 Source 配置。

## 验收草案（设计通过后，归 Task 02 实施顺序第 6 步）

- **focused**：RSS 媒体提取纯函数（enclosure、media:content/thumbnail、正文标签、相对 URL、重复 URL）；媒体获取组件用 fake fetch 覆盖：成功、超单文件预算中途中止、超 Run 预算后续 skipped、Content-Length/byteSize 提示超限、Content-Type 不符、魔数嗅探兜底、私网/loopback 拦截、allowlist 放行、重定向逐跳校验、超时、页内同 URL memo、errorMessage 在各降级分支的取值。
- **合同层**：`assetSnapshotSchema`/ingest wire 新增 `errorMessage` 的 focused 校验与透传用例。
- **集成**：受控本地 RSS（allowlist）返回真实图片字节 → Asset `saved` + storageKey → `GET /assets/:assetId` 返回原字节；注入小预算触发 skipped + errorMessage；fixture 回归五类案例不变。
- **真实源验收**：爱范儿 + 阮一峰双源实测（用户已拍板），图片实体保存、音视频仅元数据、外链保留。
- **断网产品验收**：按用户书写的步骤清单实测（用户已拍板）；Web 阅读页对 saved 显示站内图、对 metadata_only/skipped/failed 显示真实降级文案（含 errorMessage）与原文外链，不空白、不加载中掩盖。
- **明确不运行**：Docker/Compose、发布部署；如需网络授权，真实源验收另行申报。

## 对稳定文档的预期改动（接受后执行）

- `docs/requirements/0002-product-requirements.md` ING-008：v1 媒体范围/预算/状态与原因字段从"实现设计待验证"收敛为已验证边界描述（保留措辞，不反向改写）。
- `docs/architecture/0001-cosmos-foundation.md` §6.4：把"受控流式 Blob 能力、媒体提取/下载范围、domain bytes → BlobRef → Storage → Product API 分层"从待冻结更新为 v1 冻结边界，记录取舍、安全边界与残余风险。
- `docs/adr/`：新增一篇媒体边界 v1 ADR，沉淀稳定决定：媒体获取落点、能力门控（公开 `media-download`）、4 态映射 + `errorMessage`、预算默认值与安全边界、不自愈生命周期。
- `docs/spec/`：实现后同步 `docs/spec/contracts/0001-public-contracts.md`（新字段 owner）、`docs/spec/domain/0001-normalized-content.md`（NormalizedAssetInput.errorMessage）、`docs/spec/storage/0001-prisma-repository.md`（Asset.errorMessage 读写与投影）、接口文档；`docs/testing/README.md` 补充媒体测试数据与 allowlist 说明。
- Task 02 walkthrough：实施顺序第 6 步登记实施切片与验收记录。
- 本 Proposal 状态由 reviewing → accepted。

## 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-03 | v1 图片下载实体、音视频仅元数据；预算 10MB/文件 50MB/Run；双源爱范儿+阮一峰；断网验收用户写清单 agent 实测 | 用户 |
| 2026-09-03 | 媒体发现只处理 RSS 条目自身 enclosure/正文标签，不抓 webUrl 全文；超预算/失败显示真实降级保留外链；per-source 策略后置 ING-009；无历史回填 | 用户 |
| 2026-09-03 | 媒体获取为 Application 共享步骤，Connector 纯提取不下载 | 用户 |
| 2026-09-03 | **降级原因进入界面**：新增可空可选 `errorMessage` 字段并做 domain → ingest wire → 存储 → Asset 快照最小透传；`Asset.errorMessage` 列已存在、无 migration；4 态与表结构不变 | 用户（评审） |
| 2026-09-03 | **接受不自愈生命周期**：修订不变即不重试媒体；不加单条目数量上限，接受图集帖饿死同页后排图片的本周期后果；重试归 ING-009 | 用户（评审） |
| 2026-09-03 | **`media-download` 作为公开 capability 值**加入 rss Connector，不引入第二套内部能力分类 | 用户（评审） |
| 2026-09-03 | 下载 v1 形态为受控内存暂存 + 逐块计数中止；边下载边写盘列为升级点 | 待实现确认 |
| 2026-09-03 | 安全边界：http/https、公网 IP 校验、逐跳重定向 ≤3、Content-Type/魔数校验、60s 超时、`COSMOS_MEDIA_ALLOWED_HOSTS` 测试 allowlist；DNS rebinding 残余风险接受 | 待实现确认 |
