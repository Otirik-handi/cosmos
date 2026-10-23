# Task 39 Provider/model 配置续篇（七）

> 2026-10-20，本册从「Provider 发现合同与 application enqueue port 切片」到篇末。
> 同系列：`walkthrough-provider-model-02.md`、`walkthrough-provider-model-04.md`、`walkthrough-provider-model-06.md`、`walkthrough-provider-model-07.md`。

## Provider 发现合同与 application enqueue port 切片

Change Necessity: code-change。设计已批准，且用户授权首个发现代码切片仅使用离线测试；本切片只冻结 Discovery WorkflowRun 的输入、快照、固定错误，以及 application 侧的幂等排队端口。它不实现 Host dispatch fence、Prisma 持久化、网络 transport、Worker consumer、API controller 或真实 Provider 请求，避免在 Host 恢复合同尚未实现时制造可运行的外呼路径。

Slice Card：Goal=让 API/application 后续可以用无秘密输入创建或读取发现 Run 合同；Files=`packages/contracts/src/provider-model.ts`、`packages/contracts/src/index.ts`、`packages/contracts/entry-surface.txt`、`packages/application/src/provider-discovery.ts` 及离线测试；Boundary=只做校验、Provider version 快照、Provider 范围幂等与非终态并发端口，不自动创建 ConfiguredModel；Verification=contracts/application 聚焦行为测试、严格 NodeNext tsc、docs:check、diff check；Stop=若必须修改 Prisma schema 或现有 Host recovery 才能表达该端口，则暂停在本切片，不越过授权边界。

TDD Route: strict（共享合同、幂等和生产者/消费者边界是仓库规则明确要求的严格信号）。

实施结果（2026-10-18）：`packages/contracts/src/provider-model.ts` 增加无凭证发现命令、候选、固定错误码和状态一致性快照；`packages/application/src/provider-discovery.ts` 增加 enqueue/query service 和 repository port。相同幂等键仅在 Provider 与版本相同时回放；跨输入冲突；旧 Provider 版本及已占用 Provider 拒绝；原子唯一性由 repository `create` 合同承担，重复竞争只能回放幂等赢家或返回 Provider slot 冲突。该 port 尚无 Prisma/Host 实现，因此不能用于运行时真实排队。

验证：`bunx vitest run packages/contracts/src/provider-model.test.ts packages/application/src/provider-discovery.test.ts` 通过 14/14；`bun run typecheck:contracts && bun run typecheck:application` 通过；`bun run docs:check` 检查 1101 文件且 `failures=[]`；`git diff --check` 通过。一次误用 `bun run --cwd packages/contracts test` 因该 package 没有 `test` script 失败，改用仓库 Vitest 入口通过。未运行全量测试、API/Worker、Prisma、网络、浏览器或真实 Provider 验收。

下一步：Host dispatch fence 的 schema、Prisma migration、Host store 和 Activity Worker 调用点已在后续获单独授权并实现基础切片；仍未实现发现专用 WorkflowRun 的创建/投影、outcome_unknown recovery convergence、受控 transport、API route 或 Worker discovery consumer。不得因合同与 fence 基础测试通过而跳过这些门禁。

## Provider 发现端口 Host 真相源校正（2026-10-18）

- 代码审阅发现上一版 `ProviderDiscoveryRepository.create` 名称可能暗示独立 Discovery row，与批准的 WorkflowRun 唯一执行真相冲突。将其重命名为 `createWorkflowRun`；实际 adapter 必须通过现有 Host 创建专用 WorkflowRun，并由 Run/Activity 投影安全 DiscoverySnapshot，不得增加第二状态表。
- 本切片目前只有 contracts 与 application fake repository；它尚未实现 Host `createWorkflowEnvelope` adapter，所以仍不能真实排队。真实 adapter 必须保证幂等键和 Provider 非终态占用跨进程原子化。
- 验证：`bunx vitest run packages/contracts/src/provider-model.test.ts packages/application/src/provider-discovery.test.ts packages/application/src/entry-contract.test.ts` 通过 15/15；`bun run typecheck:contracts` 与 `bun run typecheck:application` 通过；`bun run docs:check` 检查 1103 文件且 `failures=[]`；`git diff --check` 通过。之前该测试曾因断言仍引用旧 `create` 方法失败，改正后重跑通过。
- 之后的 Host recovery 审查发现初始实现只 terminalize Activity Job 并排入 completion，没有终止 WorkflowRun，Run recovery 仍可能接管并重放。已在 `failFencedActivity` 的同一事务中将非终态 Run 标为 failed、清除 Run lease/resume 标记并追加 run.failed event；测试同时断言 Job 为 outcome_unknown、completion queued、Run failed 且 lease 清空、旧成功结果被拒绝。
- 最新验证：`bunx vitest run packages/storage-prisma/src/store-dispatch-fence.test.ts` 2/2；`bunx vitest run packages/application/src/workflow-host-runtime.test.ts` 22/22；contracts/application tests 15/15；`bun run typecheck:application` 通过；`bun run db:validate` 通过；`bun run docs:check` 检查 1103 文件且 `failures=[]`；`git diff --check` 通过。
- 未运行 migration deploy、全量测试、API/Worker discovery、网络、浏览器或真实 Provider 请求。`bun run typecheck:storage` 仍有 workspace application 源文件越过 storage `rootDir` 的 TS6059，须独立处理或标注为现有包测试边界，不得将其算作本切片通过。

## Provider discovery 执行链路阻塞审查（2026-10-18）

- 当前获批代码仍未形成可执行 discovery：`ProviderDiscoveryRepository` 已使用 `createWorkflowRun` 命名，但没有 Prisma/Host adapter；`apps/worker/src/main.ts` 尚未注册专用 discovery Workflow definition/Action；API 与 `packages/transport-http` 尚无 discovery route/client；没有受控 HTTPS transport。
- 既有 Host 只有 `WorkflowRun.idempotencyKey @unique`，无法以现有合同原子约束“每个 Provider 一个非终态 Run”；单独查询后创建存在跨进程竞争。必须由既有 Host/Workflow 持久化 owner 提供 Provider-scoped 原子占用，而不是增加第二 discovery 状态表或内存锁。
- 当前专用 recovery 收敛逻辑把 Activity Job 标成 `outcome_unknown` 并把关联 WorkflowRun 直接标成 failed；通用 completion dispatcher 的后续行为及 Kernel 对该 Run 的观察尚需端到端测试，避免把 workflow completion 事件与已终态 Run 产生不一致。
- `docs/spec/application/0007-workflow-host-contract.md` 仍记载“过期 leased Activity Job 可重新领取”且没有 fence 规则；用户批准的持久 dispatch fence 已改变 Host 合同，应在下一实现前更新架构/目标合同，再由代码行为测试保持一致。当前 API Draft 与 Task walkthrough 是唯一写过设计，不足以替代 Host spec。
- 因跨进程 Provider slot、Run/Activity Snapshot 投影、Workflow definition/Action 与 completion/recovery 协调均需 Host/API/Worker 联合合同，当前停止在已验证的 contracts/application port + Host fence基础切片；不得先实现网络/API来绕开这些 owner 缺口。下一步应复审 Host spec/ADR 与 Provider slot 的持久化合同，随后按 storage/application/worker 的严格行为测试实现；全程使用合成网络。
- 本轮未部署 migration，未执行外部网络或真实 Provider 请求，未运行完整 discovery/API/Worker/E2E。
## Provider 模型发现改为同步只读请求（2026-10-20）

用户批准（原话："同意简化"）后的边界修订：发现不再走 WorkflowRun Activity。上一节列的六项阻塞（无 Host adapter、Provider slot 无法跨进程原子占用、无 discovery Workflow definition、无 API/transport、无受控 HTTPS、Host spec 未更新）不是逐个实现，而是整体退出——发现是幂等只读的 `GET <baseUrl>/models`，重复发送只多一次请求，没有"可能重复创建资源"的副作用，因此不需要 Job/Attempt/Lease 队列、幂等键或 `outcome_unknown` 恢复。那套机制是为有副作用外呼准备的，用在这里会强迫 UI 出现并不存在的中间态和重试警告。Host 的 dispatch fence 作为通用能力保留（服务于未来 `agent.invoke@2`），不参与发现。原 `ProviderModelDiscoveryService` enqueue/get、`ProviderDiscoveryDuplicateError` 与 `queued`/`running`/`outcome_unknown` 状态随简化删除，不留死代码。

切片 1（contracts + application runner）：

- `packages/contracts/src/provider-model.ts:118-164`：命令只含 `{providerId, expectedProviderVersion}`（无 key、无 URL、无幂等键）；候选 `{modelId,name}`；固定错误码枚举；快照只有 `succeeded`/`failed` 两态并强制一致性（成功无错误码、失败无候选、失败必带错误码）。
- `packages/application/src/provider-discovery.ts:103-160`：`ProviderModelDiscoveryRunner.discover` 依次做 Provider 读取、`expectedProviderVersion` 校验（不符即 conflict 且零外呼）、SecretStore 读凭证（无凭证即 unavailable 且零外呼）、一次 `directory.requestModels`，把 HTTP 状态与解析失败映射为固定码；凭证不进入快照或错误信息。
- `packages/application/src/provider-model-catalog.ts`：只接受 `{modelId,name}`，去重、缺名回退到 id、拒绝畸形/空/超限列表。

切片 2（受控 HTTPS transport）：`packages/application/src/provider-model-directory-https.ts`。解析一次 DNS 并审核**全部**答案（任一是私网即整体拒绝），把连接绑定到已审核 IP，同时保留原主机名做 TLS/SNI 与证书校验；拒绝非 https、带用户名/密码、带查询或片段、非公网字面量地址的 URL；整次请求 10 秒总预算（解析+连接+TLS+读取），响应上限 1 MiB，无重定向、无代理、无二次解析，只有 2xx 才解析 JSON。DNS 与 egress 是构造参数接缝，测试用合成地址，不触公网。

切片 3（API 路由 + transport 客户端）：`apps/api/src/provider-model-discovery.controller.ts` 提供 `POST /model-providers/:id/discoveries`，只接受 body 里的 `expectedProviderVersion`（路径 ID 才是权威来源，body 带 providerId 直接 400），复用既有 origin/host 信任与 32 KiB 请求体限制，同步返回 200 快照；错误映射为固定码（not_found 404、version_conflict 409、credential_missing 409、invalid_input 400、forbidden_origin 403、payload_too_large 413、其余 503），响应不含 key、URL、上游正文。`packages/transport-http/src/client-provider-models.ts` 增加 `discoverProviderModels(providerId, expectedProviderVersion)`，只发一次 POST 并按快照 schema 校验。

装配与类型边界修正：

- `apps/api/src/model-configuration.module.ts` 注册 `ProviderModelDiscoveryController` 与 `COSMOS_PROVIDER_MODEL_DISCOVERY`；`apps/api/src/app.module.ts` 用 `PrismaProviderDiscoveryReader`、`FileSecretStore`、`createHttpsProviderModelDirectory()` 组装 runner。
- `apps/api/package.json` 的 typecheck 追加 `--rootDir ../..`，与 `apps/worker` 既有做法一致：测试文件按仓库习惯相对导入包源码，`rootDir: src` 会把它们判成越界（TS6059）。build 走 `tsconfig.build.json`（排除测试）未改，dist 布局与 `node main` 启动路径不变。
- `packages/storage-prisma/src/model-provider-credential-errors.test.ts` 的跨包相对导入改为 `@cosmos/application` 包导入，消除 `typecheck:storage` 的 4 条 TS6059。
- `apps/api/src/model-provider-storage-integration.test.ts` 的迁移计数与末位断言更新为 42 / `20261018160000_workflow_activity_dispatch_fence`（Host fence 迁移已入库）。

验证（2026-10-20）：`bunx vitest run packages/contracts/src/provider-model.test.ts packages/application/src/provider-discovery.test.ts packages/application/src/provider-model-catalog.test.ts packages/application/src/provider-model-directory-https.test.ts packages/transport-http/src/client-provider-models.test.ts` 通过 33/33（其中 https transport 7/7、transport 客户端 9/9，新增 2 条先 RED 后 GREEN）；`bunx vitest run apps/api/src` 通过 28 文件 136/136（含隔离 Prisma 的凭证写入集成测试）；`bunx vitest run packages/storage-prisma/src/store-dispatch-fence.test.ts` 2/2；`bun run --cwd apps/api typecheck`、`bun run --cwd packages/storage-prisma typecheck`、`bun run --cwd packages/transport-http typecheck` 均 0 错误；`bun run docs:check` 检查 1109 文件 `failures=[]`；`git diff --check` 通过。

未运行：真实 Provider 目录请求、migration deploy、正式服务启动、浏览器验收、全量 `bun run typecheck`/全量测试。上述全部仍需单独批准；发现路由目前只有合成 transport 与控制器测试证据，没有任何真实上游证据。

## 模型页 UI（2026-10-20）

目标来自已接受的 Proposal [`docs/proposals/connection-credential-entry-v1.md`](../../../docs/proposals/connection-credential-entry-v1.md)：用户可以不先建连接就配置服务商与模型。本轮只做 UI 前半段——服务商凭证与模型目录——连接记录里“挑模型”那半段依赖还不存在的合同，见下文“未纳入”。

入口与路由：新增 `/models` 页（[`apps/web/src/app/(shell)/models/page.tsx`](../../../apps/web/src/app/(shell)/models/page.tsx)，28 行），侧栏“管理”组新增“模型”项（[`apps/web/src/components/shell/side-nav.tsx`](../../../apps/web/src/components/shell/side-nav.tsx)）。做成独立页而不是塞进自动化页：一个只想填 key 的人不该先看到采集计划、运行记录和连接。

两个组件，逻辑都抽到纯 `.ts` 供测试固定：

- [`apps/web/src/components/cosmos/model-provider-panel.tsx`](../../../apps/web/src/components/cosmos/model-provider-panel.tsx)（411 行）：服务商列表、新增/编辑对话框、行内展开模型区。同一时刻只展开一个服务商，避免十个模型列表同时发请求。
- [`apps/web/src/components/cosmos/provider-models-section.tsx`](../../../apps/web/src/components/cosmos/provider-models-section.tsx)（385 行）：某服务商下的模型列表、手动录入、以及一次同步“从服务商拉取模型”；拉回的候选里已配置的显示为已添加，不重复添加。
- [`apps/web/src/components/cosmos/provider-model-draft.ts`](../../../apps/web/src/components/cosmos/provider-model-draft.ts)（254 行）：表单→命令翻译、表单校验、以及写失败的统一分类；组件本身不判断错误码。

界面上三个刻意的约束（都有测试守着，不靠注释约定）：

1. **保存不调用模型**。填完 key 就能保存是通过设计的：保存成功只表示配置与凭证落盘，不表示认证通过。因此按钮旁与服务商对话框里都写明“保存不调用模型”，发现按钮才是唯一会外呼的动作。
2. **已保存的 key 读不出来**。编辑时留空的 key 一律解释为“保留原值”（[`provider-model-draft.ts`](../../../apps/web/src/components/cosmos/provider-model-draft.ts) 的 `toUpdateProviderCommand`）；用户看不到旧值，任何“空 = 清空”的解释都会静默删掉凭证。
3. **202 不等于已保存**。服务端可能返回“凭证仍在写”的操作快照，界面必须显示成“仍在处理”，不能显示成“已保存”，且此时列表要重读。

失败反馈按状态码与响应体码分类（[`provider-model-draft.ts`](../../../apps/web/src/components/cosmos/provider-model-draft.ts) 的 `writeFailureNotice`）：版本冲突与“已不存在”会关闭编辑框并重读列表，避免用户对着过期数据反复重试；写重放/进行中、清理未完成、凭证写失败分别给不同提示，都不含上游正文或 key。

文案与导航：所有新文案进新区域 [`apps/web/src/copy/areas/models.ts`](../../../apps/web/src/copy/areas/models.ts)（103 行），在 [`apps/web/src/copy/messages.ts`](../../../apps/web/src/copy/messages.ts) 注册并同步 [`apps/web/src/copy/messages.test.ts`](../../../apps/web/src/copy/messages.test.ts) 的键清单断言。新组件按仓库约定登记进组件实验室：[`apps/web/src/component-lab/product-fixtures.tsx`](../../../apps/web/src/component-lab/product-fixtures.tsx)（夹具 client，不发 Product API 请求）与 [`apps/web/src/component-lab/registry/definitions-cosmos.tsx`](../../../apps/web/src/component-lab/registry/definitions-cosmos.tsx)，`registry.test.ts` 的公开组件清单同步。

验证（2026-10-20）：`bunx vitest run apps/web/src` 通过 20 文件 132/132（含组件实验室登记表 12/12、文案治理 5/5、表单草稿 8/8）；`bun run --cwd apps/web tsc --noEmit` 0 错误；`bun run docs:check` 检查 1116 文件 `failures=[]`；`git diff --check` 通过。

未纳入本轮（不是遗漏，是范围）：

- 连接记录里“选择服务商与模型”需要 Connection 合同新增 `cosmos.agent` 与 `modelId`/`version`，并连带 Prisma、API、Worker 的 `agent.invoke@2`；那是独立的契约变更，未在本轮改动。
- 浏览器验收未运行：本仓库没有 DOM 测试环境，UI 行为目前由纯逻辑测试与类型检查固定，页面在真实浏览器里的渲染未验证。
- 真实服务启动、真实 Provider 外呼、migration deploy 仍未运行。


## `agent.invoke@2` 执行链路（2026-10-20）

目标：让「模型页里给连接选好的模型」真的能被调用。合同见 [API 0009](../../../docs/api/0009-provider-model-configuration.md)，Proposal 为 [`connection-credential-entry-v1`](../../../docs/proposals/connection-credential-entry-v1.md)。

### 合同

`agentInvocationV2InputSchema` 只收 `connectionId`/`messages`/`tools`/`budget`/`metadata`，`provider`、`model`、`baseUrl`、`secretRef`、`apiKey` 一律 strict 拒绝。理由不是洁癖：静默忽略调用方传的 model 会让它以为自己的选择生效了，而实际用的是连接上的模型。输出 schema 与 @1 共用 `agentInvocationOutputSchema`，其中 `provider`/`model` 由适配器回填实际使用的配置。

### 分层实现

| 层 | 文件 | 职责 |
| --- | --- | --- |
| 应用 Action | `packages/application/src/agent-invocation-v2.ts` | 定义 `agent.invoke@2`（kind/能力/retry policy 与 @1 一致）+ `AgentInvocationV2Port` + `AgentModelConnectionResolver` 端口 |
| 连接解析 | `packages/storage-prisma/src/agent-model-resolver.ts` | `PrismaAgentModelConnectionResolver`：一次 `findUnique` 带出连接、模型、Provider |
| SDK 适配 | `packages/agent-pi-ai/src/invocation-v2.ts` | 按快照 `api` 构造模型、按 `secretRef` 读凭证、调用一次 `complete()` |
| Worker 装配 | `apps/worker/src/agent-action-v2.ts` | 无条件注册 Action；凭证读取失败统一映射为 `authentication_required` |

三个刻意的选择：

1. **连接解析一次读齐**。分三次查会读到三个时刻的状态——用户刚把连接换到别的模型时，可能出现「新模型的预算 + 旧服务商的地址」，请求就发到了错误的地方。
2. **@2 无条件注册**。@1 依赖启动期 profile，没配就没有这个 Action；@2 没有启动期配置，能不能用取决于调用时那条连接，所以始终注册，失败以连接不可用的形式出现。
3. **预算取 `min(调用方, 模型上限)`**。调用方不能通过 `budget.maxOutputTokens` 突破模型配置的上限，但可以比它小。

### 两处工程问题

- **ESM 循环**：`invocation-v2.ts` 一开始从 `./index.js` 导入模型构造器，而 `index.ts` 又要再导出 @2 适配器，vitest 下表现为 `TypeError: PiAiAgentInvocationV2Adapter is not a constructor`。把模型构造与协议错误映射抽到 `packages/agent-pi-ai/src/pi-models.ts`，`index.ts` 只做再导出，依赖变成单向。
- **`@cosmos/agent-pi-ai` 缺 vitest 别名**：其它 workspace 包都在 `vitest.config.ts` 里指向源码，唯独这个包没有，测试于是落到 2026-10-13 的旧 `dist/index.js` 上，源码里的新导出在测试里是 `undefined`（`bun` 条件取 src，node 条件取 dist）。补别名而不是重建 dist——测试应该读源码，重建产物只是把问题推迟到下次改源码。

### 验证

- `bunx vitest run` → 1100 passed / 1 failed；唯一失败是 `.agents/tasks/39-pi-ai-adapter/connection-smoke.test.ts`，原因是它把迁移固定为已评审提交里的 37 个，而当前有 42 个（新增的两个迁移仍未提交）。这是此前记录的既有阻塞项，不是本轮引入。
- 新增用例：`packages/application/src/agent-invocation-v2.test.ts` 3/3、`packages/storage-prisma/src/agent-model-resolver.test.ts` 3/3、`packages/agent-pi-ai/src/invocation-v2.test.ts` 5/5、`apps/worker/src/agent-action-v2.test.ts` 3/3。
- `packages/application/src/catalog.ts` 新增 `agent.invoke@2` 描述符后，`bunx vitest run packages/application/src` 29 文件 / 209 用例全绿。
- 类型检查：contracts / application / storage-prisma / agent-pi-ai / transport-http / apps/worker / apps/api / apps/web 全部 0 错误。
- `bun run docs:check` → `{"failures": [], "checkedFiles": 1130}`；`git diff --check` 无输出。

### 未验证

- 没有任何真实 Provider 请求；两种生成 API 的真实响应差异未验证。
- 迁移未 deploy，`agent.invoke@2` 从未在真实服务里被 dispatch 过。
- @1 与 @2 的退出关系只有文档约定，没有代码级的「新路径验收后自动下线 @1」。

## 完整产品流程的隔离端到端验收（2026-10-20）

新增 `.agents/tasks/39-pi-ai-adapter/product-flow-acceptance.test.ts`，把 Task 39 的四段能力串成一条链跑一遍：配置服务商与凭证 → 同步发现模型 → 配置模型 → 连接选模型 → 由真实 Workflow Host 派发一次 `agent.invoke@2` → 撤销连接后同一链路失败关闭。

只有两处是假的：Provider 的 `/models` 出口（真实环境是受控 HTTPS 外呼，本轮不授权真实外呼）和模型的 `complete()`（计费的模型调用）。其余是产品代码：真实隔离数据库与迁移、真实 SecretStore、真实 Workflow Host 与 Activity Worker、真实 Prisma 连接解析器、真实 Worker 装配（`createWorkerAgentInvocationV2Action`）。断言覆盖：发现只发一次带 Bearer 的请求且快照不含 key；调用用的是连接解析出的地址与模型，而不是调用方声明；数据库文件（含 WAL）里查不到 key；撤销后 Run 终态为 failed、Job 记录 `authentication_required`，且不再发出任何模型调用。

### 验收暴露的真实缺陷

首次运行发现 `ConfiguredModels.list/create/update` 对真实仓储一律返回 `dependency_unavailable`。原因不在调用方：`packages/storage-prisma/src/configured-model-repository.ts` 的读取快照一直带 `createdAt`/`updatedAt`，而 `packages/contracts/src/provider-model.ts` 的 `configuredModelSnapshotSchema` 是 `.strict()` 且没有这两个字段，严格解析必然失败。也就是说，模型列表、手动添加、编辑在真实存储上此前都不可用，只是既有测试都用内存替身，没有覆盖「真实仓储输出 → 严格快照校验」这一步。

修法是把两个时间戳补进契约快照（与 `modelProviderSnapshotSchema` 一致），而不是让仓储丢字段：模型何时配置属于产品信息，`docs/api/0009-provider-model-configuration.md` 的 ModelSnapshot 字段清单同步补上。连带更新 5 处测试夹具。

### 验证

- `bunx vitest run .agents/tasks/39-pi-ai-adapter/product-flow-acceptance.test.ts` → 1/1 通过（4.0s）。
- `bunx vitest run` → 1101 passed / 1 failed；唯一失败仍是 `connection-smoke.test.ts` 的冻结迁移数量（37 vs 42），需要先提交两个未跟踪迁移才能把冻结基线前移，属既有阻塞项。
- `bun run typecheck` 全部包与三个应用 0 错误；`bun run docs:check` → `{"failures": [], "checkedFiles": 1131}`；`git diff --check` 无输出。

### 仍需单独授权

- 一次真实的 Provider 目录请求与一次真实的模型生成请求。
- 迁移 deploy、正式服务启动、浏览器验收。
- 提交迁移并把 `connection-smoke` 的冻结基线前移到含 `modelId` 的提交。
