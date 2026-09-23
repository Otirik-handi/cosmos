# Proposal：连接登录生命周期与 manifest 多 operation 消费者 v1

> 状态：accepted
>
> 日期：2026-09-23
>
> 关联需求：[`EXT-006`](../requirements/0002-product-requirements/part-07-3.md)（Phase 2）、[`EXT-007`](../requirements/0002-product-requirements/part-07-3.md)（Phase 2）、[`AUT-009`](../requirements/0002-product-requirements/part-07-1.md)（Phase 2）、[`EXT-008`](../requirements/0002-product-requirements/part-07-3.md)、[`OPS-005/009`](../requirements/0002-product-requirements/part-07-3.md)（跨阶段）、[`ING-004/016`](../requirements/0002-product-requirements/part-07-1.md)（跨阶段）
>
> 关联文档：[`Phase-2-UNDO.md`](../../Phase-2-UNDO.md) 的 P1-2、[`ERRATA.md`](../requirements/0002-product-requirements/ERRATA.md) 2026-09-20 的 EXT-006 行、ADR [`0017`](../adr/0017-connection-secret-state-v1.md)/[`0018`](../adr/0018-trigger-sdk-v1.md)/[`0023`](../adr/0023-collection-plan-v1.md)/[`0024`](../adr/0024-trigger-forms-v1.md)/[`0026`](../adr/0026-connector-state-export-v1.md)、架构 [`§4.1/§4.2`](../architecture/0001-cosmos-foundation/part-04.md)

## 问题

[`Phase-2-UNDO.md`](../../Phase-2-UNDO.md) 的 P1-2 把 EXT-006 记为「部分交付」，缺两件事：

1. **manifest 多 operation 没有真实消费者**：`operationIds` 是数组、校验按 `includes`，但 `createBuiltinManifestCatalog` 的四个内置定义**都只声明 `["fetch"]`**，没有任何一个 Adapter 真的用过第二个 operation，也没有对应用例。合同先行、无人消费。
2. **「按声明展示登录状态」没有数据可展示**：`auth.kind` 只有 `none` 与 `external` 两个真实值，而 `external` 那一个（Bilibili）的登录态**没有任何真相源**——没有任何路径会去探测登录态并写回连接。连接面板的「状态／授权范围／失效原因」是用户手填的（2026-09-23 的 AUT-009 收口注记自述「这两个字段今天没有自动写入方」）。

把这两件事串起来看，真正的缺口是：**连接在运行时不存在**。连接器看不到自己在替哪条连接工作，所以既没法用连接上的东西，也没法把登录态写到连接上。

## 目标与非目标

### 目标

1. **EXT-006 的验收条件在本片闭合**：至少一个内置 manifest 声明 ≥2 个 operation 且**两个都有真实消费者**；Web/API 按声明展示配置**和登录状态**，且登录状态有自动写入方。
2. **连接成为登录态的所有者**：Bilibili 的 OpenCLI profile 从来源配置搬到连接，连接器从连接读取它。
3. **登录状态可探测**：系统能对一条连接探测出「已登录／未登录」，并把结果写回连接状态、账号与失效原因。
4. **验证「加新 Adapter 只写声明」**：新增一个 operation 不需要改核心表、不需要给 Worker 加专用分支。
5. **冻结凭证路径的合同**（不实现），让后续第一个真凭证来源不必返工。

### 非目标

- **不实现** SecretStore 的凭证写入／轮换／撤销与「能力受限租约」的读取实现。没有真实消费者（见决定 4）。
- **不推翻**架构决策 51（Cosmos 不保存 Cookie、Token 或密码）。
- **不把 OpenCLI profile 放进 SecretStore**：它不是秘密（见决定 1 与被否方案 B）。
- **不改** `auth.kind` 的取值集合，不改 §12 的 Phase 2 范围与验收正文（口径注记记勘误台账，见「待裁定项」的结论）。
- 不引入 IMAP 或任何新的第三方平台 Adapter、不做出站渠道凭证（PUB-004 属 Phase 5）、不做加密-at-rest。
- 不改 ingest 管线的持久化语义，不为 operation 引入新的执行种类。

## 当前行为与证据

| 事实 | 证据 |
| --- | --- |
| 四个内置 manifest 都只声明一个 operation，`auth.kind` 只有 `none`/`external` | 【代码核实】[`catalog.ts`](../../packages/application/src/catalog.ts) 的 `createBuiltinManifestCatalog`：`operationIds: ["fetch"]`、`noAuth`/`externalAuth` |
| **连接器看不到连接**：执行快照没有连接身份 | 【代码核实】`sourceExecutionSnapshotSchema` 无 `connectionId`（[`base.ts`](../../packages/contracts/src/base.ts)），只有产品读投影 `SourceSnapshot` 有；入队时 `sourceExecutionSnapshotSchema.parse` 非 strict，**多余字段被静默剥掉**（[`workflow-control.ts`](../../packages/application/src/workflow-control.ts)） |
| **连接器没有非秘密连接配置或凭证的入口** | 【代码核实】`IngestConnector.fetchItems` 入参只有 `source/cursor/idempotencyKey/signal/state`（[`connector-ports.ts`](../../packages/application/src/connector-ports.ts)） |
| Bilibili 拿 profile 的唯一通道是来源配置 | 【代码核实】`config.profile` → 子进程环境 `OPENCLI_PROFILE`（[`plugins/collectors/src/index.ts`](../../plugins/collectors/src/index.ts)）；`feed` 模式强制要求 profile（canonical config schema） |
| 连接**没有**放「适配器非秘密配置」的字段 | 【代码核实】`ConnectionInstance` 只有 `name/connectorId/account/scopeJson/status/secretRef/lastError`（[`schema.prisma`](../../packages/storage-prisma/prisma/schema.prisma)、[`base.ts`](../../packages/contracts/src/base.ts)）；`docs/api/` 的 Draft 早就预留了 `safeConfiguration`/`safeMetadata`（[`part-02-04.md`](../api/0003-product-dtos/part-02-04.md)） |
| 登录状态没有自动写入方 | 【文档核实】[`0005-web-client.md`](../spec/interfaces/0005-web-client.md) 第 23 条与 ERRATA 2026-09-23 的 AUT-009 行都自述「这两个字段今天没有自动写入方」 |
| Bilibili 的凭证不在 Cosmos，且不该在 | 【文档核实】调研记录「凭证全程留在 Chrome，CLI/daemon 不接触账号密码或 Cookie 明文」（[`2026-08-06-opencli-bilibili-research.md`](../research/2026-08-06-opencli-bilibili-research.md)）；架构决策 51「OpenCLI 的浏览器登录态由 OpenCLI/Browser Bridge 管理，Cosmos 只保存 profile 引用」 |
| 未登录已经是可分类错误 | 【代码核实】OpenCLI exit 77 → `authentication_required`（不重试）（[`0002-managed-collectors.md`](../spec/connectors/0002-managed-collectors.md)） |
| 登录门控命令可探测登录态 | 【文档核实】`opencli bilibili me` 在已登录环境下返回真实账号（同一调研记录）；`doctor` 报告扩展与 profile 连接状态 |
| **用户可填配置 schema 每个定义只有一份** | 【代码核实】`sourceDefinitionManifestSchema.configurationSchema` 一份（[`source.ts`](../../packages/contracts/src/source.ts)）；canonical 校验按 `sourceDefinitionRef` 单键检索（[`base.ts`](../../packages/contracts/src/base.ts) 的 `getSourceConfigurationSchema`）；Web 按定义渲染、**永远提交首个 `operationId`**（[`0005-web-client.md`](../spec/interfaces/0005-web-client.md) §1/§2） |
| ingest 管线对所有 operation 一视同仁 | 【代码核实】`cosmos.ingest@1` 只调用 `source.fetch@1`，抓到的 items 全部进 `library.ingest`（[`workflow-ingest.ts`](../../packages/application/src/workflow-ingest.ts)）；没有「按 operation 选 action」的路由 |
| 已有 `search` 这个发现上下文 | 【代码核实】`discoveryChannelSchema` 含 `"search"`（[`base.ts`](../../packages/contracts/src/base.ts)） |
| 搜索命令实测可用且免登录 | 【文档核实】`opencli bilibili search "<词>" --limit N -f json`，字段含 rank/title/author/score/url，**`url` 可为空、必须容忍**（同一调研记录） |
| SecretStore 的 ref 今天只有 webhook 一个真实用户 | 【代码核实】全仓 `secrets.put` 仅 webhook 一处（[`sources.ts`](../../packages/storage-prisma/src/repository/sources.ts)）；`createConnection` 收的是调用方自带的 `secretRef`，可指向不存在的密钥 |
| API 不执行外部平台调用，Worker 独占 executable | 【文档核实】EXT-008/架构：Catalog Query 在没有 Connector executable 的 API 构建中也必须可用 |

## 方案与取舍

### 决定 1：连接新增「非秘密适配器配置」字段，OpenCLI profile 搬到这里

`ConnectionInstance` 新增两个字段（一次 migration，都是可空列，无破坏性）：

- `configJson String?`：**适配器的非秘密配置**（Bilibili 的 OpenCLI profile 名、将来的 region/endpoint 之类），与来源的 `config` 对称，公开 DTO 里是 JSON 文本、可为 null，创建／更新命令可选。
- `lastCheckedAt DateTime?`：最近一次成功／失败探测的时间，供产品面显示「上次检查」。

三个字段的边界写死，互不混写（OPS-009）：

| 字段 | 装什么 | 不装什么 |
| --- | --- | --- |
| `configJson` | 适配器非秘密配置（profile 名） | 凭证、授权范围 |
| `scopeJson` | 用户可见的授权范围描述 | 凭证、适配器配置 |
| `secretRef` | 指向凭证字节的不透明引用 | 任何明文 |

**取舍理由**：profile 名是**标识**而不是秘密——它出现在 `opencli doctor` 的输出里，出现在文档和验收脚本里。把它放进 SecretStore（被否的方案 B）会让「Secret = 凭证字节」的所有权语义变脏，而且伪造出一个没有真实价值的 SecretRef 消费者。

### 决定 2：登录探测是**连接级能力**，不是 Source Operation

新增能力，宿主侧三步：

1. **manifest 声明**：`auth` 增加一个布尔声明位（`probeSupported`），由声明决定「这条连接的登录态能不能被探测」，宿主不按 `connectorId` 硬编码。
2. **连接器端口**增加一个可选方法：按连接（而非按来源）解析连接器，接收**非秘密连接投影**（`account`/`scopeJson`/`configJson`），返回 `outcome: "active" | "expired" | "error"`、可选的 `account` 与可读 `reason`。
3. **探测走 Worker，不走 API**：新增 Job 类型 `connection-probe`，`POST /connections/{id}/probes` 返回 `202` Job 快照，读端点返回结果；完成时把 `outcome` 写回连接的 `status`/`account`/`lastError` 与 `lastCheckedAt`。理由：EXT-008 与架构要求 API 不访问外部平台，且 OpenCLI 调用有分钟级超时，不能同步阻塞 HTTP 请求。这与既有 `source-probe`/`source-config-probe` 同族。

状态映射（写死，可验收）：`active` → `status=active` 且清空 `lastError`；`expired` → `status=expired` + 原因（例如「需要重新登录」）；`error` → `status=error` + 原因。探测**不产生 Run、不产生条目、不触碰已录入历史**。

**为什么不把探测做成第二个 operation**：ingest 管线对 operation 一视同仁——`source.fetch@1` 抓到的 items 全部入库（见证据表）。一个「不返回内容」的操作若做成 operation，要么造出垃圾 Entry，要么得为它新造「operation 种类」概念。探测是**连接的事实**，不是来源的取数操作。

### 决定 3：多 operation 的真实消费者 = Bilibili `search`，并补齐 per-operation 配置 schema

两条一起做，因为缺后者前者做不出来（EXT-006 原文要求的就包含「按 operation 声明配置 schema」）：

1. **合同补齐**：`sourceOperationManifestSchema` 增加可选的 `configurationSchema`（null = 沿用定义级的那份）。canonical 校验与 Web 渲染改用 `(sourceDefinitionRef, operationId)` 检索，未登记时回退定义级——旧调用与旧数据行为不变。
2. **Bilibili 声明第二个 operation**：`operationIds: ["fetch", "search"]`，两条 operation 各自声明 schema、`discoveryContext`（`fetch` 沿用现状、`search` 为 `"search"`）、`media`（均 `metadata_only`）与 `externalKey`。`auth` 保持 `external` 并打开探测声明。
3. **连接器按 `source.operationId` 分派**（`operationId` 已在执行快照里），搜索路径把结果归一化为 `kind: "video"` + `discoveryChannel: "search"`，并**容忍空 `url`**（调研实测存在）。
4. **Web 增加 operation 选择器**：先选 operation，再按该 operation 的配置 schema 渲染字段；创建与「测试配置」提交所选 operation，不再硬编码首个。

**取舍理由**：`search` 是需要用户名配置的第二类真实取数（`query` + `limit`），因此它同时验证了「按 operation 声明配置」和「加 Adapter 不改核心表／Worker 分支」。它免登录可用（真实验收不受登录态前置卡住），且 `search` 已是既有的发现上下文取值。

**被否的替代**（hot/feed 拆成两个 operation，见被否方案 A2）：两者配置完全相同、拆开不验证 per-operation 配置，且与现有连接器规格的一条注记冲突。

### 决定 4：凭证路径**只冻结合同**，本片不实现

本片在 Proposal 里冻结以下形状（作为后续切片的合同输入），并**明确不做**：

- **能力受限租约**：凭证读取只在 Worker／连接器边界、只在**一次运行的生命周期内**发生；租约由宿主按「来源 → 计划 → 连接 → `secretRef`」解析，公开面只有不透明引用；读取到的明文不进日志、Job payload、DomainEvent、执行快照或任何 HTTP DTO；连接被撤销或删除后，已发出的租约不得再读到内容。
- **连接凭证命令**：设置／轮换（明文只在响应里出现一次，与 webhook 入口凭证同构）与撤销（不删已录入历史）。
- **反模式写死**：**不提供** `secret?: string` 参数。给 `fetchItems` 递明文是把决策 4 从「能力受限」退化成「凭证随手可拿」。

**为什么本片不实现**：本片范围内**没有任何真实凭证**——Bilibili 的 profile 不是秘密（决定 1），而**第一个真凭证来源不在 Phase 2 的账上**（IMAP 真实连接器「排期待决定」；带凭证的 HTTP/RSS 来源没有需求行）。ADR-0017 的 Revisit Gate 第一条已被本片触发，但修订应与第一个真凭证消费者一起做，而不是先做一个空转的机制。

### 决定 5：拆成两个实施切片（第三片留给后续）

| 切片 | 交付 | 闭合的验收 |
| --- | --- | --- |
| **1** | 决定的 1 与 2：连接非秘密配置 + profile 迁移 + 连接探测（Job）+ 状态回写 + Web 显示 | EXT-006 的「按声明展示**登录状态**」；AUT-009 那两个字段第一次有自动写入方 |
| **2** | 决定的 3：per-operation 配置 schema + Bilibili `search` + Web operation 选择器 | EXT-006 的「多 operation 有真实消费者」+「加 Adapter 不改核心表／Worker 分支」 |
| （后续，不在本片） | 决定的 4 的实现 + ADR-0017 修订 | 第一个真凭证来源（IMAP 或带凭证 HTTP） |

## 数据、接口、安全、迁移、发布与回滚影响

### 数据与迁移

三段式，contract 步单独排期与授权：

1. **expand**：`ConnectionInstance` 加 `configJson`、`lastCheckedAt` 两列（可空，无回填）。
2. **backfill**：把来源 `config.profile` 搬到连接——按 `(connectorId=bilibili, profile)` **分组合并成一条连接**（多个来源共用一个 profile 时只建一条，与 P1-1 用「归属登记」解决同类问题的思路一致）；若用户已经手工建过同 profile 的连接则**复用而不新建**；随后把该来源所属计划的 `connectionId` 指向它，并从来源配置里移除 `profile` 键。迁移必须幂等、可重复执行。
3. **read switch**：连接器从连接的非秘密配置读 profile，不再读 `config.profile`；`feed` 的「必须有 profile」校验从配置校验改为「计划必须绑定连接」。
4. **contract**（本片不做）：移除对旧 `config.profile` 的兼容。**若迁移后仍存在带 `profile` 的来源配置，说明 backfill 漏了，此时不得进入 contract 步。**

**回滚**：backfill 的反向操作是把连接的 `configJson.profile` 写回来源配置并解绑计划；read switch 之前旧读取路径一直可用。两列是可空新增列，回滚不需要删列。

### 接口

- **Connection DTO 与命令**：`connectionInstanceSchema` 增 `configJson`、`lastCheckedAt`；创建／更新命令增可选的 `configJson`（合法 JSON 文本、长度上界与 `scopeJson` 同量级）。`secretRef` 的客户端自带通道**本片不动**（它属于决定 4 的凭证命令，届时一并收口）。
- **新增**：`POST /api/v1/connections/{connectionId}/probes`（`202` Job 快照）与 `GET /api/v1/connection-probes/{jobId}`；新增 Job 类型 `connection-probe`。
- **Catalog**：Source Definition 的 operation 项增加 `configurationSchema`（可空）。
- **Web**：新建计划表单增加 operation 选择器；连接面板每行增加「检查登录状态」与「上次检查」；计划列表按连接分组时显示连接状态。

### 安全

- profile 是**非秘密**配置，进 `configJson`，**不进 SecretStore**；本片不读取任何凭证，OPS-005/009 的边界不改变。
- 探测只回传低基数结果（outcome、账号标签、可读原因），不回传 OpenCLI 原始输出；日志沿用既有脱敏口径（状态、字节数、时长、错误码）。
- 既有约束不变：公开响应、Job payload、DomainEvent、执行快照里不出现凭证明文；连接 DTO 只出不透明 `secretRef`。

### 发布与回滚

本片不发布、不部署。schema 变更合并后需按仓库约定生成迁移（`bun run db:generate`）；真实来源验收需要本机 OpenCLI 环境（`BUN_BINARY` 指向 bun.exe 的 e2e 前置不变）。

## 对被否方案的取舍记录

| 方案 | 内容 | 拒绝理由 |
| --- | --- | --- |
| **A2** | 把 hot/feed 从 `config.mode` 拆成两个 operation | 两者配置相同（都是 `{limit}`，profile 已搬到连接），拆开**不验证** per-operation 配置；且与现有规格的一条注记冲突——[`0002-managed-collectors.md`](../spec/connectors/0002-managed-collectors.md) 写着「同一个 manifest 下的两种发现方式由连接器按 mode 声明」 |
| **A3** | 把登录探测做成第二个 operation | 与 ingest 管线语义冲突（见决定 2） |
| **B** | OpenCLI profile 存进 SecretStore，连接器通过租约读取 | 非秘密进 SecretStore，OPS-009 的所有权语义变脏；要推翻 ADR-0017 决策 1（「Bilibili profile 继续留在 `config.profile`」）与决策 4（租约形状）；收益只是伪造一个 SecretRef 消费者 |
| **C** | Cosmos 自己持有 Bilibili cookie/token，做完整登录会话状态机 | 与架构决策 51 正面冲突（不保存 Cookie/Token/密码）；OpenCLI 侧今天**不导出**凭证，等于自研浏览器凭证提取；成本与安全风险远超本片 |
| **不同步** | 连连接身份都不进执行快照，只在 Web 层做「连接 + 手工状态」 | 登录状态仍然没有真相源，EXT-006 的验收条件不满足（这正是 2026-09-23 AUT-009 收口的形态） |

## 对 requirements / architecture / ADR / spec 的预期改动

- **requirements**：EXT-006 收口后追加勘误记录，并**如实写明剩余项**——`auth.kind` 仍只有 `none`/`external` 两个真实值，`secret_ref`/`oauth`/`cookie` 仍无真实使用（声明枚举本身早已交付）；AUT-009 的「这两个字段没有自动写入方」注记补上「已由连接探测补齐」。另按待裁定项 1 的结论追加一条口径注记：§12 的 Phase 2 范围列举不含平台面（Connection/Secret/State、Trigger、连接与认证），实际按 §7 逐行阶段计入 Phase 2；需求文字与验收条件不改写。
- **architecture**：§4.2 的「OpenCLI 外部登录态例外」段补一句稳定边界——profile 引用归**连接的非秘密配置**，凭证仍由 OpenCLI/浏览器持有；连接的登录状态由探测写入。
- **ADR**：新增 **ADR-0027**（连接登录生命周期与多 operation 声明 v1），沉淀本片四个稳定决定——连接非秘密适配器配置字段的所有权边界、探测是连接级能力且由声明驱动、per-operation 配置 schema、凭证路径的分期。ADR-0017 只加一行状态注记「部分取代：决策 1 的『Bilibili profile 继续留在 `config.profile`』」，**正文决定与租约形状不改**（本片不实现凭证读取，其 Revisit Gate 里「`Connection.secretRef` 被实际写入/读取」那一半未被触发）；ADR-0018 的 Revisit Gate 标注「引入真实认证 Adapter，manifest 的 `auth` 声明需要实际驱动登录生命周期」由本片命中。
- **api（Draft）**：本片只同步**必需的三处**——Connection DTO 的 `configJson`/`lastCheckedAt`、新探测端点、manifest operation 的 `configurationSchema`（改公共 API 前更新 Draft 及 conformance 场景是仓库硬要求）。其余不一致按待裁定项 3 的结论逐项标注陈旧，收敛动作另开一个小 Task，不并入本片。
- **spec**：`contracts/0001`（Connection DTO、manifest operation 项）、`application/0001-connector-runtime`（连接探测方法与非秘密连接投影的注入）、`application/0004-manifest-catalog`（内置定义的操作序列与配置 schema）、`connectors/0002-managed-collectors`（search 路径与 profile 来源变化）、`interfaces/0002-product-api-http`（新端点与 DTO）、`interfaces/0005-web-client`（operation 选择器、连接探测入口）、`storage/0001-prisma-repository`（两列与迁移）。

## 待裁定项（2026-09-23 已给出建议，待决策者确认）

1. **§12 的 Phase 2 范围列举要不要补「连接与认证」？**
   **建议：不改 §12 正文**，改用勘误台账记一条口径注记——§12 的范围列举本就不含平台面（Connection/Secret/State、Trigger、连接与认证），实际按 §7 逐行阶段计入 Phase 2，需求文字与验收条件不改写。
   理由：分册封口后只读、更正记 [`ERRATA.md`](../requirements/0002-product-requirements/ERRATA.md) 是该台账的既定规则；[`Phase-2-UNDO.md`](../../Phase-2-UNDO.md)、`PROJECT-STATUS.md` 与 2026-09-23 的 AUT-009 勘误都已按 §7 逐行阶段执行，这条注记是记录落后于既成事实，不是新增需求。反面选项（写进 §12 范围正文）要动已封口分册，且给「Phase 2 范围」留第二次改动空间。
2. **稳定决定新增 ADR，还是并入 ADR-0017 的修订？**
   **建议：新增 ADR-0027**，并在 ADR-0017 顶部标注「部分取代」、在 ADR-0018 的 Revisit Gate 标注本片命中（见「预期改动」的 ADR 一条）。
   理由：本片直接推翻 ADR-0017 决策 1，所以 0017 必须被标注；ADR-0018 顶部已有「部分取代」的机制可抄。把「登录生命周期 + 多 operation 声明」塞进一条讲「三块基础设施 v1」的 ADR 会让主题混乱。
3. **`docs/api/` Draft 与实现的连接形状如何收敛？**
   **建议：本片只同步必需的三处，其余逐项标注陈旧，收敛另开小 Task。**
   - `POST /connections/{id}/revocations` → 记 **Superseded**。它与实现的 `/removals` 是**语义不同而非命名冲突**：Draft 是「先撤凭证、再删连接」两步，实现是一步删连接（连带删密钥字节、来源解绑、不删历史），AUT-001 于 2026-09-18 如此裁定；改成两步是**新增行为**，不是文档校准。
   - `AuthorizationSessionSnapshot` → 保留，标 **Planned（随凭证路径，未排期）**。未来 X/IMAP 的 OAuth/device-code 真的需要它，但现在为它写状态机是本片非目标。
   - `scopes: string[]` → 收敛到实现的 `scopeJson`（`scopeJson` 已落地并被 AUT-009 的验收与浏览器用例覆盖）。
   - `revisionId`/`referencedBy` → 标 **Planned**，不阻塞本片。

## 决策记录

| 日期 | 结论 | 决策者 |
| --- | --- | --- |
| 2026-09-23 | 口径 **A1** 通过：连接作为外部登录态的所有者（profile 进连接的非秘密配置，不进 SecretStore）；登录探测为连接级能力；多 operation 的真实消费者取 Bilibili `search` 并补齐 per-operation 配置 schema；凭证路径本片只冻结合同、不实现；实施拆两个切片。撤回「登录探测当作第二个 operation」的早期建议。 | 用户（评审确认） |
| 2026-09-23 | 待裁定项 1–3 的建议经决策者同意：§12 正文不改、口径注记记勘误台账；新增 ADR-0027 并标注 ADR-0017 与 ADR-0018；`docs/api/` Draft 只同步本片必需三处、其余逐项标注陈旧并另开小 Task。 | 用户（评审确认） |
| 2026-09-23 | **Proposal 接受**：状态转为 `accepted`，授权更新稳定文档并创建或复用 Task；实现按准入表在两个切片内落地。 | 用户（评审确认） |
