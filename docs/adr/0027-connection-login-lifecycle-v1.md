# ADR-0027：连接登录生命周期与多 operation 声明 v1

> 状态：Accepted design contract
>
> 日期：2026-09-23
>
> 部分取代：ADR [`0017`](0017-connection-secret-state-v1.md) 决策 1 的「Bilibili 的 OpenCLI profile 继续作为外部登录态例外留在 `config.profile`」；ADR-0017 的正文决定与租约形状不变。
>
> 关联：[`connection-login-lifecycle-v1` Proposal](../proposals/connection-login-lifecycle-v1.md)（accepted）、[`../architecture/0001-cosmos-foundation/part-04.md`](../architecture/0001-cosmos-foundation/part-04.md) §4.2、[`../requirements/0002-product-requirements/part-07-3.md`](../requirements/0002-product-requirements/part-07-3.md) EXT-006/007、ADR [`0018`](0018-trigger-sdk-v1.md)、ADR [`0023`](0023-collection-plan-v1.md)

## Context

EXT-006 的验收条件要求「Web/API 可以根据声明展示配置**和登录状态**」，2026-09-20 的复核把它记为部分交付：manifest 的声明面早已交付，但四个内置 manifest 都只声明一个 `fetch` operation，且登录状态**没有真相源**——连接面板展示的状态与失效原因只能靠用户手填。

深一层的原因是**连接在运行时不存在**：连接器拿到的执行快照里没有连接身份（`SourceExecutionSnapshot` 没有 `connectionId`，入队时还会被静默剥掉），所以既用不上连接上的东西，也没法把登录态写到连接上。同时 Bilibili 的 profile 还留在来源配置里，与 ADR-0017 决策 1 的「外部登录态例外」一致，但也因此没有任何一处知道「这条连接对应哪个浏览器登录态」。

2026-09-23 用户接受 Proposal [`connection-login-lifecycle-v1`](../proposals/connection-login-lifecycle-v1.md)：口径取「连接作为外部登录态的所有者」，**不**把 profile 伪装成 Secret（Bilibili 这条链上没有秘密——凭证留在 Chrome，架构决策 51 也不允许 Cosmos 保存 Cookie/Token/密码）。本文沉淀该片的稳定决定。

## Decision

### 1. 连接承载适配器的**非秘密**配置

`ConnectionInstance` 新增 `configJson`（JSON 文本，可空）：装适配器自己的非秘密配置，Bilibili 的 OpenCLI profile 就在这里。三个字段的所有权边界固定，互不混写：

| 字段 | 装什么 |
| --- | --- |
| `configJson` | 适配器非秘密配置（profile 名、将来的 region/endpoint 之类） |
| `scopeJson` | 用户可见的授权范围描述 |
| `secretRef` | 指向 SecretStore 里凭证字节的不透明引用 |

迁移把来源 `config.profile` 搬进连接（同一 profile 的多个来源合并到一条连接，确定性 id `connection:bilibili:<profile>`），计划补上绑定，再从来源配置移除 profile。SOP 与墓碑语义：只处理 live 来源，墓碑记录是历史不改写。

### 2. 连接的非秘密配置**随执行快照冻结**

`SourceExecutionSnapshot` 新增可选的 `connection`（`{id, connectorId, configJson}`）。AUT-016 明确写「排队后修改 Source、**Connection** 或 Workflow 配置不会改变已创建 Run 的输入」，所以宿主在**入队时**冻结它，而不是抓取时现查库。只冻身份与非秘密配置：`status`/`lastError` 这类活诊断不进——冻下来只会让后来读它的人以为那是当轮状态。该字段可选，因为未保存配置的探测与 legacy 路径**真的没有连接**。

### 3. 登录态校验归连接器，不归 API

`feed` 需要登录态这件事由**连接器**判断：它读连接投影里的 profile，缺失或形状非法时以不可重试的 `invalid_configuration` 失败；`hot` 匿名可用，没有连接也照常抓。API 不写 Bilibili 专用判断——那正是 EXT-006 要消灭的「核心表/Worker 专用分支」。

代价（已记录）：校验时机从**建目标时**（配置 schema 要求 `config.profile`）推迟到**测试配置/抓取时**。未保存配置的探测因此需要可选 `connectionId`，API 对不存在的连接当场 404。

### 4. 凭证路径只冻结合同，不实现

本片在 Proposal 里冻结「能力受限租约」与「连接凭证命令」的形状，但**不实现**：本片范围内没有真实凭证（profile 不是秘密），而第一个真凭证来源（IMAP／带凭证的 HTTP）不在 Phase 2 的账上。**不提供** `secret?: string` 参数——给 `fetchItems` 递明文是把 ADR-0017 决策 4 从「能力受限」退化成「凭证随手可拿」。ADR-0017 的 Revisit Gate 被「登录生命周期」这一半触发，但它的决策 2/4 与租约形状**不在本片修订**。

### 5. 多 operation 的真实消费者是 Bilibili `search`

EXT-006 缺的另一半是「manifest 多 operation 有真实消费者」。取 `search`（需要用户名配置的第二类真实取数），并补齐 **per-operation 配置 schema**——缺后者前者做不出来，而这正是 EXT-006 原文要求的「按 operation 声明配置 schema」。该切片（Task 23 的切片 2）随后实施。

## Consequences

### Positive

- 「按声明展示登录状态」第一次有了可写的真相源方向：连接是登录态的载体，不再依赖用户手填。
- 连接器拿到的是**冻结**的连接投影，AUT-016 对 Connection 的要求第一次真正落地。
- profile 没有被伪装成 Secret：SecretStore 的所有权语义保持干净，ADR-0017 决策 2 的「不加密明文文件」边界不受影响。
- 迁移是 expand/backfill/read switch + 可重跑的确定式回填，没有破坏性删列。

### Costs and risks

- **用户可见的行为变化**：`feed` 的登录态错误从建目标时推迟到探测/抓取时；已按新合同重写了 `apps/api` 的旧用例并加了连接器侧正反两向断言。
- 连接配置的形状不做校验（只要求合法 JSON），profile 的格式由连接器读时裁决；填错要去连接面板改，而面板今天只在建连接时能写 `configJson`（编辑入口记入 Follow-ups）。
- 面板对「连接变更后作废探测结果」没有实现（既有代码对配置也没有真正作废），记入 Follow-ups。
- 本片新增了 `connection` 字段到执行快照；虽然可选，但它是**新的公开合同面**，第三方读取者需要按「可选 + 只读身份与非秘密配置」理解。

## Alternatives considered

### profile 存进 SecretStore（Proposal 的被否方案 B）

拒绝。Bilibili 这条链上没有秘密：profile 名出现在 `opencli doctor` 输出与文档里，把它当 Secret 会让所有权语义变脏，还要推翻 ADR-0017 决策 1；收益只是伪造一个没有真实价值的 SecretRef 消费者。

### Cosmos 自持 cookie/token（被否方案 C）

拒绝。与架构决策 51（Cosmos 不保存 Cookie、Token 或密码）正面冲突，且 OpenCLI 侧今天不导出凭证，等于自研浏览器凭证提取。

### 把登录探测做成第二个 Source Operation

拒绝。ingest 管线对所有 operation 一视同仁（抓到的 items 全部入库），一个不返回内容的操作要么造垃圾条目、要么得新造「operation 种类」概念。探测是**连接的事实**，不是来源的取数操作；它随切片 4b 以连接级能力落地。

### hot/feed 拆成两个 operation

拒绝（本片）。两者配置相同、拆开不验证 per-operation 配置，且与 `docs/spec/connectors/0002-managed-collectors.md` 的「同一 manifest 下的两种发现方式由连接器按 mode 声明」冲突。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- **出现真实凭证来源**（IMAP、带凭证的 HTTP/RSS）：实现凭证写入/轮换/撤销与能力受限租约，并同批修订 ADR-0017 决策 2/4 与租约形状；
- 第二个 Adapter 需要自己的连接配置形状：引入 per-connector 的连接配置 schema（与 `sourceConfigurationSchemas` 同构），并把 `configJson` 的校验从「合法 JSON」升级为按连接器校验；
- 登录探测（切片 4b）落地后出现「探测结果自动驱动产品面动作」（如自动停用计划）的需求：那时裁定状态回写的权限与审计边界；
- 多用户、远程 Worker 或云端同步：连接的登录态与 profile 引用需要重新界定信任边界。
