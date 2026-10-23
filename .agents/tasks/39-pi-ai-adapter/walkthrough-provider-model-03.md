# Task 39 续篇：模型调用的产品入口（设计待确认）

> 本文件接续 `walkthrough-provider-model-02.md`（385 行、82 KB，已超出健康预算，只做历史记录）。本文件只写「产品级调用入口」这一段的设计与计划，不写代码。
> 状态：**设计候选，等开发者确认触发动作**。未确认前不写实现、不改合同、不发真实外呼。

## 1. 为什么还需要这一段

Task 39 的四段能力（配置服务商 → 发现模型 → 配置模型 → 连接选模型）已经连成一条链，`agent.invoke@2` 也已实现并通过隔离端到端验收。但**产品上没有第二个消费者**：

| 入口 | 现状 |
| --- | --- |
| 模型页 `/models` | 能配服务商、凭证、发现与添加模型；不调用模型 |
| 连接面板 | 能为 `cosmos.agent` 连接挑一个模型；只写关联，不调用 |
| Story 详情「生成」 | 走 Task 40 自己的 `propose` 路径，未配置时直接 409，不经 `agent.invoke@2` |

所以用户挑好的模型目前只被存下来，没有任何产品行为消费它。`docs/api/0009` 第 8 行那句「API 的保存成功不是认证通过」也一直没有对应的产品表达——用户填完 key、选完模型，无从知道这套配置到底能不能用。

这一段要补的就是这个缺口：**让一个真实的用户动作触发一次真实的模型调用，并把结果如实反馈。**

## 2. 触发动作的三个候选

这是唯一需要开发者拍板的地方，因为它决定产品范围。

**A. 连接面板的「试运行」**（推荐）
在 `cosmos.agent` 连接的卡片上加一个按钮，点一次用该连接当前的模型配置派发一次最小调用（固定一句提示语，不发用户内容），展示运行状态与模型返回的文本。
- 属于 Task 39：它验证的正是 Task 39 建立的那条配置链，且直接兑现「保存成功 ≠ 认证通过」。
- 不侵占 Task 40：不碰 Story、不碰候选生成。
- 范围最小：一个按钮、一个端点、一个只做一步调用的 Workflow。

**B. 改造 Story 的「生成」按钮**
把 Task 40 的 `propose` 改造成 Workflow + `agent.invoke@2`。这是真正的产品能力，但会改变 Task 40 已有的 profile/resolver 设计，需要 Task 40 让路，不属于 Task 39。

**C. 先 A 后 B**
先用 A 打通并验收真实链路，B 另开切片。A 的实现不会白做——两者共用同一个 Workflow 定义与同一次真实调用。

我的推荐是 **C（本轮先做 A）**：A 的风险与范围都在 Task 39 内，而且它跑通之后，B 只剩「把 Story 的输入塞进同一条链路」。

## 3. 推荐方案的产品语义

「试运行」不是调试工具，它有明确的产品含义：**验证这条连接现在能不能用**。

- 一次试运行只读：不写 Story、不产生条目、不改连接状态、不消耗除自身以外的预算。
- 试运行成功证明「凭证有效、模型可达、协议匹配」；失败给出固定错误码，不回显上游正文、认证头或 key。
- 试运行结果**不写回连接状态**。连接上的 `lastError` / `lastCheckedAt` 属于登录探测（`ConnectionProbeService`），两者混写会让「探测通过但试运行失败」无法解释。是否要在未来把模型可用性写回连接，另议。
- 每次点击产生一条 Run，有 Run ID，可查、可取消；不做隐式重试。

## 4. API 面

新增一个入队端点，返回 Run 身份，状态复用既有的 Run 读取：

| 端点 | 作用 |
| --- | --- |
| `POST /connections/:connectionId/agent-trials` | 为 `cosmos.agent` 连接派发一次试运行，返回 Run 投影（含 `id`、`status`） |
| `GET /runs/:runId` | 既有端点，UI 轮询运行状态与结果 |

输入约束：

- 只接受 `cosmos.agent` 连接；其它连接返回 `400`，因为外部平台连接没有模型可试。
- 连接必须 `active` 且已选模型；否则 `409 invalid_model_selection`，与连接写入用同一个错误码，不新增第二套说法。
- 请求体为空；若带 `Idempotency-Key` 则按它去重，不带则每次都是新的 Run（试运行本来就是「再试一次」的语义）。
- 归入模型配置的受信来源门（`readModelConfigurationBody` 那套 Origin/authority 检查）：它读的是凭证并产生外部副作用，不能比写配置更宽松。

输出沿用既有 Run 投影，不新增第二套状态词。失败原因只来自固定错误码集合（`authentication_required` / `timeout` / `dependency_unavailable` / `outcome_unknown` / `invalid_model_selection`），沿用 `agent-action-v2` 已有的分类。

## 5. UI 状态反馈

连接卡片上的按钮有三态，对应 Run 的生命周期：

| 状态 | 界面 |
| --- | --- |
| 点击后 | 按钮进入「运行中」，禁用重复点击；同时展示 Run ID |
| 成功 | 显示模型返回的文本 + 本次用量（输入/输出 token） |
| 失败 | 显示固定错误码对应的中文说明，并给「再试一次」按钮 |

不做的东西：进度条（单次调用没有可分的阶段）、取消按钮（首版一次调用很短，取消窗口极小，纳入但仅在有 Run ID 时提供的话属于额外面，先不做）、自动重试（合同禁止）。

失败文案只讲用户能做的事（「凭证被拒绝，请到模型页更新 key」），不暴露上游状态码之外的细节。

## 6. 需要的 Workflow 定义

目前 Worker 只注册了 `cosmos.ingest@1` 与 `cosmos.media-cleanup@1` 两个定义，`agent.invoke@2` 只有测试里的临时 Workflow 调用它。所以这一段需要一个正式定义：

- `cosmos.agent.trial@1`：输入 `{connectionId, messages}`，正文做一次 `agent.invoke@2`，输出原样透传。
- 目录登记 `requiredActionRefs: ["agent.invoke@2"]`，`kind`/`provider` 按现有 Workflow 定义惯例填。
- API 只负责建信封（`createWorkflowEnvelope`，已有能力），**不加载 SDK、不发外部请求**；执行由 Worker 完成，与 `docs/api/0009` 第 8 行的分工一致。

## 7. 不在这一段范围内

- 改造 Story 的候选生成（方案 B / Task 40）。
- 真实 Provider 外呼与真实服务验收（需单独授权）。
- 迁移 deploy、正式服务启动。
- 把模型可用性写回连接状态、自动探测、定时健康检查。
- 生成路径的受控网络边界（`docs/api/0009` 第 105、107 行标注的未证明项，仍按原状挂着）。

## 8. 怎么验收

1. 隔离行为测试：派发 → 跑完 → 断言调用用的是连接解析出的模型、失败码固定、撤销连接后失败关闭。补一条「非 `cosmos.agent` 连接被拒绝」。
2. 路由与信任门测试：无 Origin/错误 authority 时被拒，与既有模型写入口径一致。
3. 组件测试：三态渲染与「再试一次」的禁用条件。
4. 浏览器验收：真机上点一次按钮，看到 Run 身份与终态（用假 `complete()`，不发真实外呼）。
5. `bun run typecheck`、`bun run docs:check`、`git diff --check`。

真实外呼那一次，等这一段合并后单独申请。

## 9. 预计可写文件

- `packages/application/src/agent-trial.ts`（新）+ 测试：试运行的入队规则与输入校验。
- `packages/application/src/workflow-agent-trial.ts`（新）+ 测试：`cosmos.agent.trial@1` 定义。
- `packages/application/src/catalog.ts`：登记新 Workflow 定义。
- `apps/api/src/app.controller/…` 或 `ModelConfigurationModule` 下的新控制器：入队端点。
- `apps/worker/src/main.ts`：注册新定义。
- `apps/web/src/components/cosmos/connection-panel.tsx`：按钮与三态。
- `packages/transport-http/src/client-sources.ts`（或同族文件）：新增客户端方法。
- `apps/web/src/copy/…`：文案。
- `docs/api/0009-provider-model-configuration.md`：新增试运行小节。

不碰：Prisma schema 与迁移（这一段不需要新表，Run 用既有表）、`agent.invoke@2` 合同、Task 40 的 Story 路径。

## 10. 等开发者确认的三点

1. **触发动作**选 A（连接面板试运行）/ B（改造 Story 生成）/ C（先 A 后 B）。推荐 C。
2. **状态反馈粒度**：按第 5 节的三态（运行中 / 成功显示文本与用量 / 失败给固定码与「再试一次」）是否够用，要不要「取消」。
3. **试运行是否写回连接状态**。我建议不写（第 3 节的理由），若要写，需要先定义它与登录探测的优先关系。

确认后我把它写进 `docs/api/0009` 并出实现计划；在此之前不动代码。

## 11. 已确认决策与当前切片（2026-10-21）

- 触发动作选 **A：Connection 面板试运行**；本切片不改 Story 候选生成，不侵入 Task 40。
- UI 采用三态：运行中（禁重复启动）、成功（返回文本 + token 用量）、失败（固定安全错误码 + 用户显式「再试一次」）。不加进度条、取消、自动重试。
- 试运行结果不回写 Connection 的 `lastError` / `lastCheckedAt`；它们仍只表达连接登录探测结论。
- 每次显式点击创建新 Run；客户端每次点击生成新的幂等键，网络重传沿用同一键。API 仅创建 Workflow envelope，不加载 SDK、不访问 Provider。
- **本轮授权只覆盖实现、隔离验证与假 `complete()` 的浏览器/测试准备；不包含真实 Provider 请求、迁移 deploy、正式服务启动或真实服务验收。**真实外呼与正式服务验收必须另行逐次授权。

### 当前实施卡

- 生命周期阶段：实现 / 离线聚焦验证；尚未实现。
- 一个连贯目标：为已选择有效模型的 `cosmos.agent` Connection 增加可观察的试运行 Run，完整复用 `agent.invoke@2` 与现有 Workflow Host；安全结果可在 UI 展示且不修改 Connection 状态。
- 可观察验收（最多三条）：
  1. `POST /connections/:connectionId/agent-trials` 只接受空 body、受信 Origin/authority 与 `cosmos.agent` active 且选定模型的连接；创建一个新的 `cosmos.agent.trial@1` Run。错误输入、其它连接类型、撤销/未选模型均在创建 envelope 前失败；API 不触发网络或读取凭证。
  2. 隔离 Worker 真实 Host 执行该 Run 时，唯一 Action 为 `agent.invoke@2`，其输入只含服务端固定消息/预算与连接 ID；成功可读取严格校验的模型文本/用量，失败只暴露固定错误码；撤销连接失败关闭，且 Provider/Connection 状态不被试运行写回。
  3. Connection 面板以 Run 为唯一流程状态呈现运行中、成功和失败；成功文本/用量及固定错误提示可见，显式重试创建新 Run；浏览器与隔离测试使用注入的假 `complete()`，证明无真实外呼。
- 依赖：现有 `agent.invoke@2`、`PrismaAgentModelConnectionResolver`、Workflow Host/Run/Job/Attempt/Lease/Completion、`GET /runs/:id`、`GET /runs/:id/jobs` 和 Connection/Provider 配置合同；不加 Prisma 表/字段或第二状态机。
- 受影响合同：新建 `cosmos.agent.trial@1` Workflow manifest 与严格结果 DTO；新增受信 POST 入队路由。保持 `agent.invoke@2`、既有 Run 状态词和 Connection DTO 不变。Workflow 返回值经 Activity Job 的 `result` 投影读取（Run Snapshot 本身不承载 Workflow 输出）；客户端须按新结果 schema 解析，不能将任意 `unknown` 直接渲染。
- 预计核心文件：`packages/contracts/src/agent.ts`、`packages/contracts/src/index.ts` 及相邻测试；`packages/application/src/workflow-agent-trial.ts`（新）、`agent-trial.ts`（新）、`catalog.ts`、`index.ts` 及测试；`apps/api/src/agent-trial.controller.ts`（新）、`model-configuration.module.ts`、`app.module.ts` 及测试；`apps/worker/src/agent-trial-action.ts` 或既有 Agent Action 装配、`main.ts` 及测试；`packages/transport-http/src/client-agent-trials.ts`（新）、`index.ts` 及测试；`apps/web/src/components/cosmos/connection-panel.tsx` 与纯状态 helper/test；必要时 `apps/web/src/copy/messages.ts`；`docs/api/0009-provider-model-configuration.md`；本 Task walkthrough。
- 验证层级：contracts/application/API/Worker/transport 单测与严格类型检查；已有 `product-flow-acceptance.test.ts` 扩展为试运行产品链隔离验收；文档检查与 diff check。浏览器验收仅在获准后启动本地隔离栈且注入假模型完成器；任何真实 Provider、正式服务和 migration deploy 均不运行。
- 停止条件：若 Workflow 完成输出不能经现有 Run Job 读端安全投影、受信配置无法复用、需要 schema/migration、或只能用全局 transport patch 才能执行，则停下回到设计，不增加平行状态、扩大安全承诺或改动 Task 40。

## 12. 实施计划（按切片顺序执行）

### 切片 1：结果合同与正式 Workflow 定义

1. **先 RED**：在 `packages/contracts/src/agent.test.ts` 增加 `agentTrialResultSchema` 用例，验证严格对象只含 `content`、`usage`、`provider`、`model`、`finishReason`；拒绝未知字段、缺字段、非法用量及任意错误正文。结果结构复用 `agentInvocationOutputSchema` 的可展示字段，排除 toolCalls/metadata，避免首版将无用或不安全内容带入 UI。
2. 运行 `bun run vitest run packages/contracts/src/agent.test.ts`，确认新增 schema 缺失导致 RED；再在 `packages/contracts/src/agent.ts` 定义并在 `packages/contracts/src/index.ts` 导出 schema/type，补充 barrel contract 与负向测试，复跑该测试及 contracts 入口检查。
3. 在新文件 `packages/application/src/workflow-agent-trial.ts` 定义输入 `{ connectionId }`、固定单条用户消息、固定无工具/有限时长/有限输出 token 的预算；Workflow 正文只调用一次 `agent.invoke@2`，校验并裁剪成上面的结果合同。新增测试覆盖定义引用/manifestHash/action ref、空白/超长 connectionId 拒绝、固定输入、输出裁剪和 Action 失败透传；先跑 RED 再实现。
4. 在 `packages/application/src/catalog.ts` 登记 Workflow manifest（`cosmos.agent.trial@1`，required action 仅 `agent.invoke@2`，外部副作用 / trusted worker 能力与真实执行一致），在 `packages/application/src/index.ts` 导出新 public API。验证 Catalog 的唯一 ref/hash 与 Workflow 定义一致，并确认不改变 `agent.invoke@1/@2` manifest。

### 切片 2：入队用例、API 信任门与错误映射

1. **先 RED**：在 `packages/application/src/agent-trial.test.ts` 覆盖：只接受 active 且有 modelId 的 `cosmos.agent`；不存在返回 not_found；其他 connector、撤销或无选择返回固定 `invalid_model_selection`；成功创建 envelope 使用 `cosmos.agent.trial@1`、只保存 `{connectionId}`、不保存 key/messages；相同幂等键且同输入返回同 Run，不同 connection 复用键冲突；不带键的两次显式调用产生两个 Run。
2. 在 `packages/application/src/agent-trial.ts` 实现窄端口：读 Connection 只取 id/connectorId/status/modelId/version，检查后调用既有 `WorkflowHostStore.createWorkflowEnvelope`；不依赖 Prisma、Provider secrets、SDK 或网络。更新 `packages/application/src/index.ts` 导出并通过 application 聚焦测试。
3. **API RED**：为新 `apps/api/src/agent-trial.controller.test.ts` 建独立 Nest HTTP 测试；断言空 JSON body + 合法 Origin/authority 可返回 202 Run 快照；缺失/错误 Origin、body 非空/未知字段、缺幂等键格式、连接不合格与 Host 未启用都按固定 HTTP code 拒绝；注入调用桩确认 controller 只调用入队端口、不调用 discovery/secret/HTTP。
4. 新增 `apps/api/src/agent-trial.controller.ts`，由 `ModelConfigurationModule` 注册并复用既有 trust 配置及原始请求读取策略；API 路由为 `POST /connections/:connectionId/agent-trials`，只接受空对象，body 通过 `readModelConfigurationBody` 的 Origin/authority 检查，`Idempotency-Key` 缺省时由服务端产生新键、显式键严格校验；返回既有 `toPublicWorkflowRun` 投影。`apps/api/src/app.module.ts` 仅组合已有 `cosmosWorkflowStore` 与 Connection repository，不另建存储 owner。
5. 固定错误映射：not_found→404；无效 connector/model/状态→409 `invalid_model_selection`（如仓库合同确定应为 400，则先核对既有错误表再统一，而不新增自由文案）；Host 不可用→409；幂等冲突→409。API body/message 不包括 key、SDK 原始异常、上游响应体或 prompt。运行新增 controller/module/trust 聚焦测试和严格 tsc。

### 切片 3：Worker 注册与端到端隔离执行

1. **先 RED**：新增 `apps/worker/src/agent-trial-action.test.ts` 或扩展 Worker Workflow Host 测试，构造真实隔离 Host + 假 `PiAiClientV2`：一个正式 `cosmos.agent.trial@1` envelope 完成一次 @2 调用并从 Job result 得到严格结果；撤销连接或缺凭证时失败关闭；断言 fake complete 调用次数为 1、连接/Provider状态不被更新、Job 不重试、持久化内容不含 secret。
2. 在 `apps/worker/src/main.ts` 的正式 workflow definitions 中注册 trial Workflow（只注册 definition，不增加另一份 agent Action）；既有 `createWorkerAgentInvocationV2Action` 是唯一调用 Action。扩展 `apps/worker/src/agent-action-v2.test.ts` 或对应 Worker 装配测试，确认同一 resolver/SecretStore/pi-ai client 被复用。
3. 扩展 `.agents/tasks/39-pi-ai-adapter/product-flow-acceptance.test.ts`：接真实隔离 storage、真实 SecretStore、真实 Workflow Host 与 Worker Action，API入队产生的定义/快照可由 Worker 消费；完成后经现有 `listRunJobs`/`JobSnapshot.result` 投影读取，并用 `agentTrialResultSchema` 解析，不从未公开的 Kernel 状态直接取值。另断言无 Connection 状态写回、调用撤销后失败封闭、没有真实 socket/fetch。
4. 注意 Job `result` 当前公共 schema 是 `unknown`：只在 Agent Trial 客户端边界依新 schema 解析；不得更改通用 Job 任意结果合同或把试运行字段加到所有 Run Snapshot。若现有 API Job 读取不返回 completion result，则先证明该值在既有持久化结构中可安全读取；若需新的持久化字段/迁移，按停止条件暂停。

### 切片 4：Transport 与 Connection 面板三态

1. **先 RED**：在 `packages/transport-http/src/client-agent-trials.test.ts` 覆盖 POST URL、空 body、幂等 Header、Run Snapshot 校验；Run/Job 轮询从已有 API client 方法取值，Agent Trial result 通过严格 schema 验证，非法 Job result 显示为安全失败而不是原样展示。
2. 新增 `packages/transport-http/src/client-agent-trials.ts` 并聚合到 `packages/transport-http/src/index.ts`；仅新增 `createAgentTrial(connectionId,{idempotencyKey})` 小方法，复用 `HttpCosmosClientBase.request` 和既有 `getRun/listRunJobs`，不增加通用 arbitrary Workflow API。
3. 将 UI 流程状态提到纯 helper（若复杂度允许，新增 `apps/web/src/components/cosmos/connection-trial.ts` 与测试）：idle/running/succeeded/failed；每次用户显式再试生成新幂等键，轮询最多 30 秒、间隔 1 秒，Run 仍非终态则给出可再次显式触发的超时提示；不能在 React render 中触发请求。只允许在 `connectorId === "cosmos.agent"`、`status === "active"` 且 `modelId !== null` 的卡片显示按钮。
4. 更新 `apps/web/src/components/cosmos/connection-panel.tsx` 展示运行中、成功内容与输入/输出 token、固定错误码中文说明和「再试一次」；结果按 connectionId 归属展示、组件卸载或选择变化时忽略陈旧轮询，不调用 `updateConnection`。在 `apps/web/src/copy/messages.ts` 加可执行的用户提示，不暴露错误原文；补连接面板组件/纯逻辑测试。
5. **浏览器门禁**：先运行聚焦 Web 测试、API/Worker 类型检查；浏览器只有在用户另行授权后执行。经批准的浏览器栈必须使用隔离目录、fake `complete()` 和随机端口，覆盖 active 已选模型按钮可用、键盘触发、运行态禁重入、成功文本/用量、失败固定错误与再次触发、刷新不写回 Connection；断言没有真实 Provider 地址请求、console/page error、失败网络请求。

### 切片 5：合同文档与最终验证

1. 在 `docs/api/0009-provider-model-configuration.md` 增补试运行的 owner、API 输入/信任门、Workflow/Worker职责、固定 prompt/预算、安全错误、Job result 读取方式、幂等/显式重试、Connection 状态不写回，以及生成网络边界仍未证明的警告；更新文档开头状态，不把离线验收写成真实 Provider 验收。
2. 在本 Task walkthrough 追加每个切片的 RED/GREEN、完整实际命令、结果、未运行项、范围偏差和后续授权边界；不覆盖既有历史。
3. 验证顺序：聚焦 contracts/application/API/Worker/transport/Web 测试 → `bun run typecheck` → `bun run docs:check` → `git diff --check`。文档检查须在当前 worktree 内运行。全仓 `bun run test`、构建、浏览器、真实 Provider、正式服务、migration deploy 分别记录是否执行，不用局部通过代替全仓/外呼验收。
4. 结束条件是代码、隔离 Worker 链路和 UI 反馈通过，不代表真实 Provider 成功、生成网络受控或 @1 可退出。之后另行申请并逐次确认真实 Provider 请求与正式服务验收；未批准前维持现有版本并存与警告。
