# Proposal: Agent Provider Connection 与凭证使用 v1

> 状态：accepted
>
> 目标设计局部取代（部分实现）：已接受的 [Provider/model 产品配置](connection-credential-entry-v1.md) 取代本文单 Worker profile、无 Product API/UI、由 Connection.secretRef 提供模型凭证的范围；目标为 Provider-owned SecretStore 凭证、模型连接选择与 `agent.invoke@2`，详见 [Draft 合同](../api/0009-provider-model-configuration.md)。Provider/模型创建与编辑、Provider 删除、凭证写入、模型连接选择与 `agent.invoke@2` 已落地并有隔离测试；编辑 Provider 前的受影响连接查询端点决定不做（界面自行聚合）。切换前本文记录的旧实现仍在，历史验收不转作新路径证据；普通非模型连接、按次校验、无环境凭证回退与 SecretStore 明文限制保留。
>
> 日期：2026-10-12
>
> 关联：Task 39 [`../../.agents/tasks/39-pi-ai-adapter/README.md`](../../.agents/tasks/39-pi-ai-adapter/README.md)；ADR-0017 [`../adr/0017-connection-secret-state-v1.md`](../adr/0017-connection-secret-state-v1.md)；ADR-0030 [`../adr/0030-agent-invocation-v1.md`](../adr/0030-agent-invocation-v1.md)

## 1. 问题

Task 39 已证明 Worker 可通过 `agent.invoke@1` 调用真实 pi-ai Provider，但当前真实接线使用 `COSMOS_TEST_API_KEY`，不是可复用的生产凭证合同。仓库已有 `ConnectionInstance`、不透明 `secretRef` 和 Cosmos SecretStore；尚无 Agent profile、Agent 专属凭证绑定或稳定的 Worker 配置合同。若继续把模型配置、连接引用或密钥塞入 Agent Action payload，会违反 Secret/Job 边界并形成第二个配置所有者。

ADR-0017 明确要求真实认证 Adapter 出现时重评 `Connection.secretRef` 的读取、撤销和登录生命周期。本 Proposal 处理此 revisit gate，不改变 SecretStore 存储格式。

## 2. 目标与非目标

### 目标

1. 允许每个 Worker 部署通过本机非秘密配置启用一个 Agent provider/model profile。
2. 使用现有 ConnectionInstance 绑定 Provider 凭证，不在 Action payload、Job、Event、日志或普通 DTO 中携带 Secret。
3. 每次调用均校验连接状态、Provider 绑定和 SecretRef；缺少、撤销或不匹配时 fail closed。
4. 限制 Secret 明文在 Worker 调用边界内按次读取，并在一次 SDK 调用结束后不再保留引用。
5. 保留默认关闭、`agent.invoke@1` 与既有 durable Workflow/Job truth。

### 非目标

- 不新增 Agent profile 数据库表、Product API、Web profile UI 或多模型动态路由。
- 不改变 SecretStore 文件格式、加密策略、轮换产品流程或多用户威胁模型。
- 不把 Provider API key 存入 Connection `configJson`、环境变量、payload、日志或测试输出。
- 不实现 OAuth、自动登录/续期、工具执行、流式生成、Session/Memory 或远程 Worker。
- 本提案不授权真实外部 Provider 调用或部署。

## 3. 当前行为与证据

- `ConnectionInstance` 已有 `connectorId`、`status`、非秘密 `configJson` 和不透明 `secretRef`；共享 DTO 不含凭证字节。
- `SecretStorePort` 只有 `put/read/delete(ref)`；FileSecretStore 位于本机 SecretRoot、POSIX 尽力设 `0600`、不加密，Windows 权限保护为 best effort。
- Worker 可通过仓储读取 Connection，Repository 内部持有 SecretStore，但 Worker 尚未将 Agent Action 与 Connection 绑定。
- pi-ai Adapter 当前每次调用以 `resolve()` 取回完整凭证字符串，再将其传给 SDK；这不是接口约束的租约。
- Connection 创建/更新入口目前不能由本 Proposal 推断为 Agent 专属管理入口；本方案只消费已存在的连接和 SecretRef。

## 4. 候选方案与取舍

### 决策 1：单 Worker profile，Connection 提供凭证

Worker 每个进程只解析一份静态非秘密 Agent profile（provider、model、API、base URL、context/output 上限）；通过 `COSMOS_AGENT_CONNECTION_ID` 指向现有 Connection。未显式启用仍不注册 Agent Action。Profile 不持久化进数据库，运行配置由部署者管理。

Adapter 的 input provider/model 必须与 profile 一致；Connection 必须存在、active、`secretRef` 非空。`connectorId` 不承担模型 Provider 绑定语义。Connection 被撤销、过期、错误、删除、无引用均拒绝该次调用，且不得调用 SDK；Provider 与 Secret 的错配由外部 Provider 认证结果暴露。

### 决策 2：Worker 显式绑定 Connection 与 Provider

`Connection.connectorId` 是认证连接器标识，不视为模型 Provider id。Worker 配置的 `COSMOS_AGENT_CONNECTION_ID` 显式选择凭证来源；Worker 部署 profile 同时声明 Provider。系统不解析 Secret 内容，也不改 Connection `configJson`/DTO 来记录模型 Provider。管理员需保证所选 Connection 的 Secret 适用于该 Provider；错配由 Provider 认证响应暴露。此取舍避免把 Agent 路由字段混入通用 Connection 合同，但不能本地预先检测错配。

### 决策 3：回调式凭证使用，不称为 SecretStore lease

将 SDK adapter credential seam 从返回 string 改为 `withCredential(provider, secretRef, context, callback)`。Worker resolver 在 callback 内向受信任 SDK 传入单次 SecretStore 读取值；callback 完成后清除其局部引用。取消信号已触发时不读 Secret；读取返回 null 或异常 fail closed。此形态缩小凭证可见范围，但 JavaScript 无法保证内存物理清零，也不代表 SecretStore 本身提供撤销 fencing、审计或真正的租约句柄，因此接口称为“短时回调使用”，不宣称安全擦除或强租约。

### 决策 4：撤销只阻止下一次读取

每次 Agent invocation 都重新读取 Connection 和 SecretStore，不做 credential cache。已开始的外部请求不能因连接撤销保证被 Provider 取消；撤销保证仅适用于尚未开始的后续调用。Worker 使用既有 invocation cancellation signal 尝试中止当前请求。

### 决策 5：缺失、失效或状态非 active 时 fail closed

Connection 不存在、status 非 `active`、`secretRef` 缺失、SecretStore 未找到值或读取失败时，调用失败且 SDK 不得被调用。Worker 不回退到环境变量或 Fake Adapter。

### 拒绝备选

- Secret 在环境变量中按部署绑定：不能使用已有 Connection/SecretRef，也难以区分连接撤销状态。
- Agent profile/secretRef 新增数据库实体：首版仅单 profile、无 UI/动态路由需求，新增 owner 和 migration 不必要。
- 将 `read()` 直接称为 credential lease：接口没有生命周期/权限句柄语义，术语会夸大保护。

## 5. 数据、接口与安全影响

- 不新增持久表或 migration；只新增 Worker 配置项与 Adapter 内部 callback credential seam。
- 不修改 `AgentInvocationInput`、`agent.invoke@1` payload 或公开 Connection DTO。
- SecretStore 仍是本机受限权限明文文件，不加密；用户须保护 Cosmos Data Root 与配置文件。
- Worker 在调用边界读取 Connection/Secret，日志只记录 connection id、provider id、结果类别，不记录 Secret、SecretRef 文件内容、SDK options 或完整 Provider payload。
- `COSMOS_AGENT_ENABLED` 缺省 false；启用但配置缺项、连接无效或 Secret 缺失时 fail closed，不回退到 Fake、不重试认证错误。

## 6. 验收

1. 未显式启用 Agent 时 Worker 不注册 `agent.invoke@1`，且不读取 Connection/Secret。
2. 配置完整且 Connection active/provider-bound/有 Secret 时，一次调用只读取一次 Secret，并只在 SDK callback 执行期间可见；Secret 不出现在输入、输出、日志和持久 payload。
3. Connection 不存在、非 active、Provider 不匹配、SecretRef 为空或 Secret 缺失时，SDK 调用次数为零且失败可分类。
4. 调用前取消时，Connection/SecretStore/SDK 均不被访问；调用中取消向 SDK 传播 AbortSignal。
5. Worker 与 Adapter 在 Node-compatible build 下运行；不更改其它 Worker 行为。

## 7. 对稳定文档和实现的预期改动

Proposal 接受后的落地项（2026-10-12 已完成）：

- Task 39 walkthrough 记录合同、实现与验证；旧测试环境变量接线标明为历史并已被当前组合取代。
- 架构记录单 Worker profile、Connection credential owner 和 Worker-only trusted boundary。
- ADR-0017 与 ADR-0030 明确真实 Agent consumer、callback-scoped 读取的限制和明文存储风险；不声称安全擦除或强 lease。
- 未增加 `agentProvider` 字段或修改公开 Connection DTO/API。
- Agent Adapter、Worker config/assembly 与当前实现规格已更新。

## 8. 决策记录

- 2026-10-12，维护者：选择单 Worker profile + 现有 Connection 绑定，不新增独立 Profile 表。
- 2026-10-12，维护者：选择 callback-scoped credential use，而非让 Resolver 返回长期可持有的字符串。
- 2026-10-12，维护者：Provider 绑定由 Worker 显式配置 Connection ID 和 Provider；不要求 `connectorId` 同名，不向通用 Connection `configJson` 添加 Agent 字段。
- 2026-10-12，维护者接受 Proposal：Connection 不存在/非 active/SecretRef 缺失或读取失败一律拒绝；撤销不保证中止已经发出的 Provider 请求；接受本机受限权限明文 SecretStore 风险并遵守本机 Data Root 权限。
