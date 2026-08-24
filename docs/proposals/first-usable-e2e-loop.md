# Proposal：可用产品 E2E 闭环（配置入口 + 媒体本地化 + 最小看板）

> 状态：accepted
>
> 日期：2026-08-23
>
> 需求真相源：[`../requirements/0001-original-requirements.md`](../requirements/0001-original-requirements.md)（2026-08-23 节）
>
> 关联：Task 02 RSS Ingestion、Task 07 Deferred Workflow Host、Task 09 React 组件实验室

## 问题

现有能力分散在各 Task 中：来源创建、RSS 抓取、Story projection、首页 SSE 列表和预配置开发路径分别可用，但预先配置的来源跑通只能证明管线 smoke，不能证明 Cosmos 应用对用户可用。

本次真正的产品缺口是**配置入口**：用户不能从 Web 创建、保存、校验并启用闭环所需的 Source、Connector/采集策略和运行配置；配置由开发者预先写好，用户只能看到结果。除此之外还有三个体验缺口：

1. 正文没有站内阅读体验，用户仍需跳出 Cosmos 去原文；
2. 媒体（图片/音频/视频）不落本地，断网即不可读；
3. 首页只是来源/Story 管理列表，没有回答“我关注的源有什么新内容、哪些源挂了”这两个日常第一眼问题。

## 目标与非目标

### 目标

1. **配置优先的产品 E2E**：在隔离且没有预配置来源的数据根目录中，用户从 Web 配置入口完成以下能力：选择可用 Connector/SourceDefinition；读取并填写该 Connector 的配置 schema；创建、编辑、服务端校验、测试、保存和启用 Source/采集计划；填写调度字段。Nest API 持久化并返回可观察状态，Worker 使用已启用配置执行抓取。预配置只能作为开发 smoke，不计入产品验收。
2. **最小看板**：默认首页为两块固定版式：
   - 最新内容流：跨来源按时间倒序的 Entry/Story 列表，点击进入站内阅读页；
   - 来源健康区：每个订阅源最近一次抓取时间与成功/失败状态。
3. **离线阅读目标**：条目正文可在 Web 内阅读，Connector 管线按后续冻结的媒体策略处理图片、音频和视频，仓库侧提供 Blob 服务，使成功保存的媒体可在断网时读取。容量超限时的降级行为待设计。
4. **完整验收**：空数据根目录 → 用户在 Web 选择 RSS Connector 并填写实际 RSS URL → 创建、校验、测试、保存并启用配置 → Worker 自动抓取 → 新内容出现在看板 → 站内正文与已保存媒体可读 → 断网后仍可读 → 失败源在看板可见。

### 非目标

- 自定义看板布局、拖拽与小部件系统（完整形态后续另行 Proposal）；
- Agent 深入研究、推送摘要；
- 多用户认证 UI（当前用户是本地单用户，但 Service Endpoint 需保留扩展边界）；
- 历史条目媒体回填（当前没有历史已抓取媒体）；
- 在本 Proposal 阶段直接确定媒体 Blob 写入端口、媒体提取/下载管线或新增公共媒体 DTO；
- 新的存储系统或数据库替换。

## 当前行为与证据

- Worker 已按 `COSMOS_WORKER_POLL_MS` 轮询并经 Connector 抓取 RSS（Task 02 / 07，已并入 master）；
- Story projection 与 SSE 列表已在首页可用（`apps/web` 现首页，Task 09 浏览器回归覆盖）；
- 现有 Web 来源表单只提交 `fixture-rss` 和 `fixturePath`：`apps/web/src/app/page.tsx` 固定创建 `kind: "fixture-rss"`，`components/cosmos/source-form.tsx` 只收集名称与 fixture 路径；这是开发/fixture 路径，不是实际 RSS URL 的产品配置入口；
- 现有 Product API 已有 `GET /source-definitions`、`GET /source-definitions/:id`、`POST /sources`、`POST /sources/:sourceId/test` 和 `POST /sources/:sourceId/runs`，但 `PATCH /sources/:sourceId` 当前只接受 `enabled`；因此缺少面向用户的 Connector/schema 驱动创建、编辑、校验、测试、保存、启用和调度字段管理；
- `scheduleIntervalMs` 已存在于部分 Source config 合同，但调度模式、字段暴露、默认值、保存时机和修改后何时生效尚未形成产品入口合同；
- 现有 Blob/Workflow 边界已经区分：领域 `NormalizedAssetInput.content` 是运行时 `Uint8Array`，Workflow JSON 使用 strict `BlobRef`，`WorkflowBlobStore` 负责 bytes 与 BlobRef 映射，`FileBlobStore` 负责 Blob bytes、hash、key 和 containment；这些是现状基线，不等于本 Proposal 已决定新的媒体字段、下载端口或容量策略；
- 当前 Web 无完整条目阅读路由和断网媒体验收。


## 方案与取舍

### 1. 配置入口先于采集结果

产品主路径先实现：Web 配置入口 → Nest API 校验/保存/启用 → Worker 读取已启用配置 → 看板与健康状态反馈。以下是已接受的产品能力边界；具体 API、数据库和配置模型合同仍需在后续实现设计中明确：

1. **选择 Connector/SourceDefinition**：Web 读取可用 Connector、版本、能力和配置 schema；产品 E2E 选择 `rss`，不得把 `fixture-rss` 当作产品来源入口。
2. **Schema 驱动填写**：根据所选 Connector 的 schema 展示字段。产品 E2E 至少填写实际 RSS URL；`fixturePath` 只能出现在 fixture/集成测试路径。
3. **创建与编辑**：用户创建 Source/采集计划，并修改名称、Connector 配置和调度字段；当前只改 `enabled` 的 PATCH 不足，需要后续设计增量更新合同。
4. **校验**：服务端以 Connector/schema 为权威执行结构校验和语义校验；Web 可以复用 schema 做即时提示，但不能替代服务端校验。
5. **测试**：用户可以对尚未启用的配置发起 dry-run/测试，反馈连接、解析和能力错误；测试不能写入 Observation、Entry、Asset 或推进 checkpoint。现有只能测试已持久 Source 的接口不能直接视为最终配置测试合同。
6. **保存与启用**：本轮采用“测试未保存配置 → 保存为停用 Source → 单独启用”；保存配置与启用配置是可观察的独立动作，启用后 Worker 才能调度。不引入复杂的独立 Draft 状态机；具体 Command 拆分、启用前置条件和状态字段仍需设计。
7. **调度字段建议（待冻结）**：优先建议默认定时抓取 30 分钟，用户可修改或关闭定时，测试是立即动作，已排队 Run 使用创建时配置快照。具体调度字段、时区/间隔校验、修改生效时机和 API 形状仍需设计。

已接受的用户操作顺序是“选择 Connector → 填配置 → 校验 → 测试 → 保存 → 启用”；哪些步骤对应独立 HTTP Command、哪些只是向导内动作，仍属于实现设计。

### 2. 看板与阅读

看板采用两块固定版式，消费既有 Query/SSE 能力；来源健康复用 Worker/Admin 已有状态，不新增采集。阅读页负责展示正文和已保存媒体；没有可读正文或本地媒体时，必须明确显示降级状态和原文外链，而不是伪造离线成功。

### 3. 媒体方案：职责方向已接受，实施边界仍待设计

用户已接受的职责方向是：媒体由 Connector 管线处理，仓库侧提供 Blob 服务；没有历史媒体，因此不做回填。用户对第 4–7 项选择的具体实现方案仅作为后续设计起点，均需在实现设计、行为测试和安全审查后冻结，不是当前实现合同：

1. **Blob 写入建议（待冻结）**：优先由 Application 控制受限的流式媒体 Blob 能力，底层复用现有 `FileBlobStore`，Connector 不直接接触 Data Root。具体端口名称、流协议、幂等、重试、大小限额、媒体类型元数据和失败状态仍需设计。
2. **媒体发现建议（待冻结）**：优先只处理 RSS 条目自身的 enclosure 和正文媒体标签，不抓取 `webUrl` 外部全文；缺少全文或媒体时显示真实降级状态并保留原文链接。具体提取器、协议白名单、重定向、SSRF 防护、超时、Content-Type 校验、音视频大文件和部分失败语义仍需设计。
3. **数据分层建议（待冻结）**：优先保持 domain 使用 `NormalizedAssetInput.content: Uint8Array` 与 Asset 状态，Application 在 Workflow 边界映射 BlobRef，Storage 保存 Asset metadata，Product API 只提供 Asset 状态与受控下载；`local` 作用域作为未来认证的候选替换点。具体映射字段、持久化时机、引用完整性、下载授权和作用域键仍需设计。

当前只把“Connector 负责媒体处理、仓库提供 Blob 服务、无历史媒体回填”作为产品职责方向；不把上述端口、媒体范围、bytes/BlobRef 映射、local principal key 或容量策略写成已接受合同。

### 放弃或暂缓的方案

- “只预配置来源”：只能证明管线 smoke，不能证明应用可用，否决为产品验收方式；
- “先做可配置看板框架”：超出配置优先的最小闭环，推迟；
- “现在直接新增 `NormalizedIngestItem.localMediaRefs`”：边界未定，暂缓，等待上述三项设计；
- “由 Product API 统一代理抓媒体”：不符合 Connector 负责媒体处理的已确认方向，暂不采用。

## 影响

- **产品/API**：需要设计配置 Command/Query、校验错误、保存/启用状态和 Worker 可观察状态；具体 DTO 尚未冻结。
- **数据**：可能涉及 Source/Connector 运行配置、媒体 metadata 与 Blob 引用的持久化变化；是否需要 Prisma migration 取决于三项边界设计。
- **安全**：配置输入和媒体 URL 都是不可信外部输入；必须限制协议、路径、请求目标、大小、重定向、内容类型和资源消耗，不能把远程 URL 当作已保存媒体。
- **迁移**：没有历史媒体回填；旧数据应在新字段为空或未保存时明确走外链/不可离线状态，不得宣称完整离线。
- **发布/回滚**：先以配置入口和状态可见性为垂直切片；媒体下载能力需独立门禁。每个切片都应可关闭新 UI/API 路径，不伪造成功结果。

## 产品 E2E 验收草案（已接受方向，待实现后固化）

使用隔离数据库和 Blob/Data Root，初始没有来源配置：

1. 用户打开 Web 配置入口；
2. 用户选择 RSS Connector，填写一个实际可访问的 RSS URL（`feedUrl`），而不是 `fixturePath` 或预置来源；
3. Web 通过 Nest API 完成 schema/语义校验、测试、保存和启用，并展示明确的配置状态；
4. Worker 读取该配置，对用户填写的实际 RSS URL 发起抓取；
5. 看板显示新内容和来源健康；
6. 用户打开阅读页，看到正文以及 Connector 已成功保存的媒体；
7. 断开外部网络后，已保存内容仍可读；未保存或失败媒体显示真实降级状态；
8. 配置错误、抓取失败、媒体部分失败均在 Web 可见，不能以预配置数据或假成功替代。

本产品 E2E 的通过条件不包含本地受控 HTTP 源、fixture XML、fixture Connector、fake Blob 或直接调用 Worker Admin。它们另列为集成/管线测试，用于确定性覆盖解析、重试、重复轮询和失败分支，不得冒充“应用可用”。

预配置来源路径、fixture、fake Blob 和直接调用 Worker Admin 只能覆盖开发 smoke/组件或管线测试，不满足上述产品 E2E。

## 接受后的推荐实施顺序（仅计划，不创建 Task）

1. **配置入口设计**：冻结 Connector/SourceDefinition 选择、配置 schema 读取、Source/采集计划创建与编辑、校验、测试、保存、启用和调度字段的用户合同；明确哪些动作是独立 Command，哪些只是同一向导步骤。
2. **配置 API 与持久化**：在不改变媒体 BlobRef 边界的前提下，实现配置状态的 API/存储垂直切片；覆盖真实 RSS URL 的创建、编辑、测试和启用前置条件。
3. **配置 Web 入口**：消费 manifest/schema 和配置 API；去除产品路径对 `fixture-rss`/`fixturePath` 的依赖；用隔离数据根目录完成真实 RSS URL 配置。
4. **最小看板与来源健康**：接入已启用 Source 的内容、Run/Job/健康查询和 SSE；不提前引入可配置 Board/Block 编辑器。
5. **正文阅读与媒体边界设计**：在 Blob 写入端口、媒体提取/下载以及 domain bytes/Workflow BlobRef 三项决策完成后，再实现阅读页和媒体路径。
6. **产品 E2E**：使用用户填写的实际 RSS URL 验收；受控 HTTP 源、fixture 和 fake Blob 只运行集成/管线测试。

每一步都应保持可回滚；Proposal 的产品方向与 1–7 项推荐方案已经接受，但具体 API/DTO、持久化字段、Blob 流式端口、错误语义、安全门禁和测试合同仍需在后续实现设计中明确，不把本记录直接当成已落地合同。

## 对稳定文档的后续同步（已接受方向，实施设计完成后执行）

- `docs/requirements/0002-product-requirements.md`：已同步配置入口是产品可用性前置条件、真实 RSS URL 产品 E2E、两块固定最小看板和媒体用户可观察边界；具体 API/DTO 与容量合同仍待实现设计；
- `docs/architecture/0001-cosmos-foundation.md`：已同步配置入口、Connector/Worker/API 职责、`local` 作用域方向和媒体处理分层；具体 Blob 端口、字段映射、安全/错误/预算合同仍待实现设计；
- 已复用 `.agents/tasks/02-rss-ingestion/README.md` 登记配置优先实施切片；不创建新的 Task 编号；
- 行为落地后更新 `docs/spec/` 和 `docs/testing/README.md`。

## 已接受的产品方向与实现建议（待冻结）

用户已接受本 Proposal 的总体产品方向，并对第 4–7 项选择了推荐实现建议作为后续设计起点。选择建议不等于冻结 API、DTO、存储、权限或安全合同：

1. **总体方向**：接受配置优先的产品 E2E；产品验收必须从 Web 配置入口开始，用户填写实际 RSS URL，预配置来源只算开发 smoke。
2. **配置生命周期**：选择 RSS Connector → 填写实际 RSS URL → 服务端校验 → 测试未保存配置 → 保存为停用 Source → 单独启用。是否保留 Draft、各动作对应的具体 Command、启用前置条件仍需设计。
3. **配置入口形态**：提供通用 schema 驱动的配置入口外壳，但首版产品只开放 `rss`；`fixture-rss` 不进入产品配置入口。schema 版本、字段白名单、编辑/保存状态和错误 DTO 仍需设计。
4. **调度建议（待冻结）**：默认定时抓取 30 分钟；测试是立即动作；用户可修改或关闭定时；已排队 Run 使用创建时配置快照。时区、间隔校验、修改生效时机和调度 API 仍需设计与验证。
5. **Blob 写入建议（待冻结）**：采用由 Application 控制的受限流式媒体 Blob 能力，底层复用现有 `FileBlobStore`；Connector 不直接接触 Data Root。具体端口名称、流协议、幂等、限额、重试和失败状态仍需设计与验证。
6. **媒体发现建议（待冻结）**：只处理 RSS 条目自身的 enclosure 和正文媒体标签，不抓取 `webUrl` 外部全文；缺少全文或媒体时显示真实降级状态并保留原文链接。具体提取器、协议/重定向/SSRF/Content-Type 和部分失败语义仍需设计与验证。
7. **数据分层与作用域建议（待冻结）**：优先保持 domain `Uint8Array`/Asset 状态 → Application Workflow BlobRef → Storage Asset metadata → Product API 受控下载；当前不做登录，固定 `local` 作用域作为未来候选。具体映射字段、作用域键和下载授权仍需设计与验证。

仍待实现设计的内容：

- 配置对象是 SourceInstance、CollectionPlan 还是两者的最小组合，以及 Web/API/Worker 各自拥有哪部分状态；
- 创建、编辑、校验、测试、保存、启用和调度动作的 HTTP Command/Query/错误合同；
- 受控流式 Blob 端口如何接收 Connector 输出，如何处理大小预算、超时、取消、重复写入和 orphan bytes；
- RSS enclosure/正文标签的媒体提取、下载安全、MIME 验证、部分成功和离线展示状态；
- domain bytes、持久化 Asset metadata、Workflow `BlobRef` 和 Product API 受控下载之间的字段映射；
- `local` 作用域如何进入持久化键、未来认证替换点和测试隔离根。

## 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-08-23 | 产品 E2E 必须从 Web 配置入口开始；用户填写实际 RSS URL；预配置只算开发 smoke；无历史媒体回填 | 用户 |
| 2026-08-23 | 接受 Proposal 总体产品方向 | 用户 |
| 2026-08-23 | 配置生命周期采用“测试未保存配置 → 保存为停用 Source → 单独启用” | 用户 |
| 2026-08-23 | 配置入口采用通用 schema 驱动外壳，首版只开放 `rss`，不开放 `fixture-rss` | 用户 |
| 2026-08-23 | 选择调度建议：默认 30 分钟、立即测试、可修改/关闭定时、已排队 Run 使用创建时快照；具体实现合同待冻结 | 用户 |
| 2026-08-23 | 选择 Blob 写入建议：受控流式能力、优先复用 `FileBlobStore`、Connector 不直接接触 Data Root；具体端口合同待冻结 | 用户 |
| 2026-08-23 | 选择媒体发现建议：优先 RSS 条目自身 enclosure/正文媒体标签、不抓取外部全文；提取与下载合同待冻结 | 用户 |
| 2026-08-23 | 选择数据分层与作用域建议：优先保持 domain/Workflow/Storage/Product API 分层并预留 `local`；映射字段与作用域键待冻结 | 用户 |
| 2026-08-23 | 第 4–7 项是用户选择的实现建议，不是已接受的公共合同 | 用户 |
