# Task 39 历史记录（一）：接线、凭证合同与基线（2026-10-08 至 2026-10-14）

> 由 `walkthrough.md` 按文档大小治理拆出；内容原样保留，不重写。后续见[历史记录（二）：真实终端与隔离验收](walkthrough-history-02.md)。
## Worker 接线与真实 Provider 验收（2026-10-08）

## Worker 生产凭证合同落地（2026-10-12）

### 已接受合同

生产 profile/Connection/SecretRef 合同由 Proposal [`agent-provider-connection-credential-v1`](../../../docs/proposals/agent-provider-connection-credential-v1.md) 记录并已接受：每 Worker 单一静态非秘密 profile；部署显式指定 `COSMOS_AGENT_CONNECTION_ID`；`Connection.connectorId` 不代表模型 Provider；调用时重新检查 Connection active、SecretRef 并读取 SecretStore；通过 `withCredential` callback 仅在 SDK 调用期间使用 secret；默认关闭、无 fallback。不得把 callback 误称为强租约或保证物理清零。

### 实现调整

- `packages/agent-pi-ai/src/index.ts`：凭证 seam 为 `withCredential(provider, context, use)`；profile-injected model 必须与 invocation provider/model 匹配，单次 maxOutputTokens 不得超过 profile 上限；deadline 在凭证读取过程中也生效，过期后不调用 SDK。
- `apps/worker/src/agent-action.ts`：Worker 按配置 ID 每次读取 Connection，确认返回 ID 匹配、status 为 active 且有 SecretRef；只从 `SecretStorePort.read()` 取 secret，在 callback 的 `finally` 中清除本地引用；取消/Connection 状态/Secret 缺失/读取失败均 fail closed，不调用 SDK。Provider 与 Connection 的真实适配关系仍是部署者责任。
- `apps/worker/src/main.ts`：显式 Worker Agent profile 存在时，把 action 注册到现有 Workflow Host；否则默认 action 列表不增加 Agent。
- Worker config 增加必填 `COSMOS_AGENT_CONNECTION_ID`；本地 profile 的模型/API/endpoint/token 上限均非秘密。没有环境变量凭证或 Fake 回退。
- 修正应用 SecretStore port 注释，明确 `read()` 不是 lease。

### 验证

- `bun run vitest run apps/worker/src/config.test.ts apps/worker/src/agent-action.test.ts apps/worker/src/runtime.test.ts packages/agent-pi-ai/src/index.test.ts packages/application/src/agent-invocation.test.ts packages/storage-prisma/src/connection-state-store.test.ts`：46 tests / 6 files passed；覆盖 Connection/SecretRef、状态 fail-closed、取消、每次只读一次、SDK 之前不调用、profile mismatch/token cap/deadline 和 existing Connection repository behavior。
- `bun run typecheck:apps`：通过；`bun run typecheck:packages`：通过。
- `bun run --cwd apps/worker build` 与 `bun run --cwd packages/agent-pi-ai build`：通过。
- `bun run docs:check`：1041 files，failures=[]。
- `git diff --check`：初次发现 `apps/worker/src/config.ts:78` trailing space，已移除；最终复跑通过。
- 未再次向真实 Provider 发请求；本轮没有改 database/schema、公共 Connection DTO 或 SecretStore 存储实现；没有进行 Git lifecycle 操作。

### 余留限制

此组合是单 Worker-local profile，不是多用户 profile 管理；SecretStore 依然是受限权限明文文件。JS 不承诺安全擦除；Connection revoke 仅阻止后续调用读取，不能撤销已发出的 Provider 请求。没有验证多 Worker/多 profile、OAuth、工具执行、流式调用、长任务/生产部署。此前 DSH 凭证显示事件的轮换提醒仍有效，密钥值未再复制或使用。

### 范围

维护者同意在 Task 39 内追加最小 Worker 运行配置：默认关闭；仅 `COSMOS_AGENT_ENABLED=true` 且完整模型配置时注册既有 `agent.invoke@1` Action；凭证仅由 Worker resolver 从用户级 `COSMOS_TEST_API_KEY` 读取。没有修改 SecretStore、数据库、Agent payload，也不涉及 Task 40。真实验收最多一次外部文本请求，input 明确将 `maxOutputTokens` 设为 64。

### 实现

- `apps/worker/src/config.ts` 增加 Agent 配置解析：provider、model、API、base URL、context window 与 max output tokens；校验 HTTP(S) URL、正整数与 output 不超过 context。默认不启用。
- `apps/worker/src/agent-action.ts` 构造 pi-ai 自定义 OpenAI Chat Completions Model、注入环境变量 resolver，并把既有 Adapter 包成 `agent.invoke@1`。
- `apps/worker/src/main.ts` 只在显式 Agent 配置存在时，将该 Action 注册到已有 Workflow Host；Workflow/Job/Lease durable truth 仍未改变。
- `apps/worker/package.json` 与根 `bun.lock` 记录 Worker 到 `@cosmos/agent-pi-ai` workspace dependency。
- 配置测试覆盖默认关闭、启用缺项拒绝、用户提供模型参数解析；mock composition tests 覆盖凭证只传给 SDK、Action 输出不含 credential、按请求上限传递 64 tokens、缺 credential 时不调用 SDK。

### 验证

- `bun run vitest run apps/worker/src/config.test.ts apps/worker/src/agent-action.test.ts apps/worker/src/runtime.test.ts packages/agent-pi-ai/src/index.test.ts packages/application/src/agent-invocation.test.ts`：29 个测试通过（5 个测试文件）。
- `bun run --cwd apps/worker typecheck`：通过。
- `bun run --cwd apps/worker build`：通过。
- `bun run typecheck:apps`：API、Worker、Web 均通过。
- `bun run --cwd packages/agent-pi-ai build`：通过；之前 Worker 首次 focused test 曾因未构建包 dist 失败，先构建后复跑通过。
- `bun install --lockfile-only`：通过，更新 workspace lockfile。
- `git diff --check`：最终通过。
- 一次真实 `agent.invoke@1` 调用通过 Worker Action/Adapter/default pi-ai client，目标 `jijiapi/gpt-6-luna`，提示为单词 `READY`，请求 `maxOutputTokens=64`。返回 provider/model 正确，`finishReason=stop`，usage 为 input 555 / output 5 / total 4400；检查确认 credential 不在输出中。工具没有显示 key。

### 限制和安全记录

- `COSMOS_TEST_API_KEY` 当前 DSH 进程不可见，因此真实验收从 Windows User scope 安全复制到单次 Bun 子进程环境；PowerShell 未输出 key，测试结果不包含 key。子进程环境仅本次命令生命周期有效。
- 外部请求响应报告的 input/output 与 totalTokens 字段不一致（555+5≠4400）；Adapter 保留 SDK usage 字段，后续可向 provider 核实计量定义。此 smoke 只有一次成功小请求，不等于完整 provider/SLA/错误场景验证。
- 用户提供的模型上限为 32768 输出 tokens；全局配置只校验它不超过 context window，单次实际 Adapter 请求仍以 `AgentInvocationInput.budget.maxOutputTokens` 为准。本次 smoke 为 64。
- config parser 默认关闭 Agent，但真实 action 要通过 explicit workflow host composition；没有运行持久 Worker/database 生命周期，也没有浏览器/E2E/全量测试或再次外呼。
- 本次最终复核：`bun run docs:check` 检查 1040 个文档文件且 failures=[]；`git diff --check` 通过；`bun run typecheck:apps` 的 API/Worker/Web TypeScript 检查通过；Worker build 通过；focused 命令 29 tests/5 files 通过。

## 本轮目标

在不新增 Agent Runtime、Job durable truth 或模型调用旁路的前提下，把真实 `@mariozechner/pi-ai` 接入既有 `AgentInvocationPort`。本轮采用独立 package owner、注入式凭证解析和可注入 SDK facade。

## Baseline / Boundary

- Task 38 已冻结 `agent.invoke@1`、Invocation Port、trusted Worker 与 Fake Adapter 先行边界。
- 未知外部 API 错误统一映射为 `provider_unavailable`；输入和输出分别由合同校验与统一边界限制。

## 实现

- 新增 `@cosmos/agent-pi-ai` adapter package，仅由 `packages/application` 的 port、`packages/contracts` 的 input/output/context、pi-ai SDK 组成。
- 将 pi-ai 的 `AssistantMessage`、stop reason、token usage/cost 映射为公开 invocation output；不把 SDK 类型泄漏到 application/contracts。
- credential 由调用方通过 callback 提供，只填入 SDK 的 `apiKey`，绝不进入 input/context/output。
- 为 openai-completions provider 组合最小自定义 Model；不全局 patch pi-ai provider registry。
- 增加可注入 `PiAiClient` seam，使测试覆盖错误映射、usage 与输出限制时不需要网络。

## 验证

- Task 39 初始 Adapter 阶段的聚焦测试和 package typecheck/build 已通过；详细当时记录保留在历史 Task 文本。后续 Worker 接线阶段的独立验证见本文件顶部对应记录。
- `.gitignore` 覆盖 `packages/*/dist/`。

## 不在范围

- 不调用真实 Provider，不添加 Worker 配置或凭证管理，不使用真实密钥。
- 不改 Worker Workflow/Job/Lease durable truth，不增加 API、数据库或用户界面。
- 不增加工具执行、循环 Agent、流式输出或模型配置 UI。

## 后续

- 后续由 Task 39 Worker 接线切片显式注册 Adapter；凭证必须继续由 Worker 生产 Connection/SecretStore 合同提供。
- 真实凭证验收、部署密钥配置、Provider 预算/可观测性与生产发布各自独立授权。

## Task 39 数据库边界复核与一次性验收方案（2026-10-12）

### 本轮范围与状态

只读核实共享 schema/migration 边界和现有测试 fixture。未创建数据库、未运行 migration/db push、未读取或请求凭证、未发起 Provider 请求。当前工作区含 Task 40 的未提交 schema/migration 与大量其他 dirty changes，均保持原样；没有切换分支/worktree。

### 数据库发现

- `packages/storage-prisma/src/index.fixtures.ts` 的 `withRepository` 为每测试创建 OS 临时根并调用 `prepareDatabase`；该函数通过现有 Prisma CLI 执行 `migrate deploy`，目标 schema 默认取当前工作树的 `packages/storage-prisma/prisma/schema.prisma`，migration 目录也来自该 schema 所在目录。它复用真实 Prisma Repository 和 FileSecretStore，但不是无 migration 的 bootstrap。
- 测试 Connection 路径已存在：`packages/storage-prisma/src/connection-state-store.test.ts` 调 `repository.createConnection({ secretRef })`，再由 repository 的 `secrets.put` 写入 FileSecretStore。新建 Connection 默认 active。
- migration 与 schema 是独立 Git 文件。当前工作树有三项未提交 Task 40 migration（`20261008120000_content_representation`、`20261008130000_story_agent_candidate`、`20261008140000_observation_content_source`）和 Task 40 schema 增量。对唯一数据根运行当前 migration 会把这些 Task 40 schema 变化带入该根：数据文件隔离不等于 schema 来源隔离。
- 当前 `HEAD` 的已提交 schema 已有 `ConnectionInstance.secretRef`、`configJson`、`lastCheckedAt`；Task 40 对 Connection 没有增列。Task 40 schema 的额外模型/字段不被本验收 Action 读取。因此，可通过从当前 `HEAD` 导出 schema 与其 38 项已提交 migrations 到唯一 OS 临时目录，设置该 schema 的 SQLite `DATABASE_URL`，并让现有 Prisma CLI 在临时目录内 `migrate deploy`，避免调用当前 dirty migration 集。Prisma Client 仍来自已安装 workspace 构建（client delegate 包含向后兼容的额外模型，不会要求数据库提供未被调用的新表）；验收只读取 ConnectionInstance 并写 SecretStore 文件。该方案尚未实际部署验证。
- 仓库没有 `prisma db push` 使用先例；搜索没找到该方式。`db push` 不是本仓库已接受测试入口，不作为本轮方案。
- 测试 fixture 会删除临时根作为测试生命周期行为，但一次性验收 runner 应只在显式结果检查与用户确认清理边界后删除其唯一根；不得复用宽泛 `cleanupTemporaryRoots` 删除集合。

### Runner 最小边界（候选，仍需实现与离线验证）

- runner 只属于 Task 39 临时验收路径，不加 Worker 产品配置、API、正式 Workflow/Worker registration 或 durable Activity。它在 `.agent/tmp` 的一次性 runner 调用生产 `createWorkerAgentAction`，并通过 `ActionRegistry.dispatch("agent.invoke@1", ...)` 触发单次请求。
- 可维护 runner 文件的候选路径为 `scripts/task39-connection-smoke.ts`，但它位于 Task 39 约定范围之外的通用 scripts owner；实现前需重新确认 Task 文件允许范围。另一候选是 `.agents/tasks/39-pi-ai-adapter/connection-smoke.ts`，只触及 Task 39 目录。不得改 schema/migration、Worker 产品代码、package manifests 或 Task 40。
- Runner 必须以非命令行、非环境变量的交互 TTY 无回显方式取凭证；检测不到真实 TTY 时在提示/读取之前失败。当前 agent 工具 stdin/stdout 均重定向，用户自己的 PowerShell 虽确认两者不重定向但未连接该执行通道，因此本轮 agent 不能收取密钥；在 Provider 调用授权前应由用户在其真实终端自行启动本地 runner，或提供一个能实际连接交互会话的受控运行方式。不得请求用户把 key 贴到聊天。
- 运行中凭证只写到隔离 FileSecretStore，不能进 argv/env/日志/报告/API payload；不过 SecretStore 是明文文件，Windows 的 mode 0600 不提供权限隔离，必须把本地磁盘与系统访问视为密钥暴露风险，且不声称安全存储或物理清零。
- 不打印 Provider 返回正文；只输出状态、provider/model、token 用量与 `content === "OK"` 谓词。行动输入的确切文本、budget 与 metadata 需在外呼前列出；不得写业务 Story、Workflow Activity 或持久化 payload。
- 隔离数据库、SecretStore、日志/临时文件全部限于本次唯一 OS 临时根内；回滚前盘点并确认精确绝对路径，只移除此唯一目录，再确认该目录不存在。文件系统删除不保证 SSD/系统备份层物理擦除。

### 外呼前置门禁（未授权）

候选模型/API/Provider：`jijiapi/gpt-6-luna` / `openai-completions`，endpoint `https://api-slb.jiji.cc/v1`。合成 user 文本候选为 `Reply with exactly: OK`，`maxOutputTokens=64`。可能产生 Provider 费用，并按 Provider 自身政策保留请求数据。发送前必须再向用户提供准确命令（不含凭证）、真实隔离绝对路径、将写入的文件、输出/日志检查、清理步骤及本地 SecretStore 明文风险，并等候独立的明确 Provider 请求确认。本轮无此确认，不得发起外部调用。

### 分项验证状态

- runner 离线检查：未运行；runner 未实现。
- focused tests：本轮未运行；历史 Action 测试为 mock，不是本轮真实凭证链路证据。
- typecheck：本轮未运行。
- build：本轮未运行。
- docs check：本轮未运行。
- `git diff --check`：本轮未运行。
- Connection-backed 真实 Provider 验收：未运行，仍为 Task 39 未完成项。
- 明确不覆盖：常驻 Worker、Workflow 调度、Activity Job/Attempt/Lease 与 durable Activity 持久化；真实生产部署、错误/SLA/其他 Provider。

## 重启：只读基线与已批准离线切片（2026-10-14）

- 用户批准仅修改本目录 `connection-smoke.ts`、`connection-smoke.test.ts`、`README.md`、`walkthrough.md`；允许唯一隔离根内冻结 schema 迁移、合成凭证/fake SDK 验证。真实外呼未授权，不处置默认库、不修改 Task 40、不进行 Git 生命周期。
- TaskStartSnapshot：root=`D:\Otirik\Workstation\cosmos`，branch=master，HEAD=`f66c33135351af38460fff73d311863dc7b4ef47`，upstream ahead/behind=0/0；只有主 worktree，无 merge/rebase/cherry-pick/revert，无 staged 文件。57 个 tracked dirty 文件及大量 untracked 文件为既有用户状态，含 Task 40 与混合 Worker 入口。
- 新鲜只读证据：HEAD 有 37 项 migrations，历史 38 项说法不准确；默认库有 40 项 completed migrations，含三项 Task 40，checksum 与工作树一致。默认库及指定备份均为 24489984 字节，SHA-256=`04DAD5C99812446B14AB09B5EAFFC0C2DF7A94D22D0174745B5CEF793C006CFB`；备份不能作为 Task 40 迁移前恢复点。仅查迁移登记，无业务记录/SecretStore 读取。
- 历史纠正：runner/test 实际存在；dispatch 仅拒绝 host，当前 agent.invoke@1 为 trusted_worker。历史 READY 请求使用环境变量，不证明新凭证链路已真实验收。旧正文保留，上述更正为当前基线。
- 切片：固定 commit 导出 schema/migrations 并生成 SHA-256 清单；显式注入隔离 Prisma Client，不改 DATABASE_URL/COSMOS_DATA_ROOT；runner 只执行合成凭证/fake SDK，保留原无回显输入 helper 供后续独立批准的真实验收。隔离根保留并报告精确路径，不自动清理。
- Change Necessity：现 runner 自动外呼/删除不满足门禁，文档不能证明执行隔离；在既有验收 owner 内修正，不增加产品 owner 或 fallback。TDD Route：Mode=off / Decision=skipped，无 strict authority；补充行为测试。
- Complexity / Owner-Fit：runner 当前 236 行，目标 <400 行，函数 <100 行，测试目标 <200 行；edit-in-place，只改验收职责。
- 验证计划：runner/Worker/Adapter/Invocation focused tests、必要显式类型检查、四文件结构/链接/空白检查。迁移仅本轮隔离根；build/全仓/E2E/真实 Provider 未运行。

### 本轮新鲜验证与收口

- `bun run vitest run .agents/tasks/39-pi-ai-adapter/connection-smoke.test.ts apps/worker/src/agent-action.test.ts apps/worker/src/config.test.ts packages/agent-pi-ai/src/index.test.ts packages/application/src/agent-invocation.test.ts`：最终 38 tests / 5 files passed，exit 0。沙箱内两次启动均在 esbuild 配置加载阶段报 `Error: spawn EPERM`；同命令经单次权限批准重试通过。最终复跑发生于 Node-compatible 入口修正后。
- 完整链路：冻结 commit 的 37 项 migration→显式隔离 Prisma Client→真实 Connection/FileSecretStore（合成凭证）→生产 Worker Action→Adapter→fake SDK；一次读取、64 token budget、输出谓词与凭证排除、缺失 Secret 的 authentication_required、应用日志排除凭证、fetch 未调用与父进程 DATABASE_URL/COSMOS_DATA_ROOT 不变均通过。此证据不覆盖真实网络或 durable Worker 调度；fetch spy 也不是操作系统级网络隔离证明。
- 两次执行分别保留 `D:\Otirik\Workstation\cosmos\.agent\tmp\task39-offline-hk0wXg` 与 `D:\Otirik\Workstation\cosmos\.agent\tmp\task39-offline-Hu4Uhx`，均仅包含本轮合成验收数据。各根包含冻结 schema/migrations、SHA-256 manifest、SQLite、迁移日志、应用日志和 result.json；合成 secret 在成功分支通过 SecretStore API 删除，根目录未删除。未执行真实 SecretStore 读取。
- `bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node .agents/tasks/39-pi-ai-adapter/connection-smoke.ts .agents/tasks/39-pi-ai-adapter/connection-smoke.test.ts`：exit 0。此前未引用正确 types 的命令报 `Cannot find type definition file for 'node bun'.`，引号纠正后因仓库未安装 Bun types 报 `Cannot find type definition file for 'bun'.`；改用 Node-compatible 入口与已安装 Node types 后通过，没有新增依赖。
- 四文件 readback/结构/本地链接/空白检查：runner 224 行、test 96 行；无新增 owner/fallback，保留无回显 helper 仅供将来单独批准的真实终端验收。根 Vitest 配置、Worker 产品代码、schema/migrations 与 Task 40 未修改。整个 Task 39 目录为既有 untracked 状态，`git diff --check -- .agents/tasks/39-pi-ai-adapter` exit 0 不覆盖 untracked 内容；另逐行检查四文件尾随空白为 0。
- 收口哈希：默认库与指定备份均仍为 `04DAD5C99812446B14AB09B5EAFFC0C2DF7A94D22D0174745B5CEF793C006CFB`；HEAD 仍为冻结 commit。按用户要求不 commit，不创建/删除 branch/worktree；仓库不是 clean。
- 未运行：build、全仓 typecheck/test、浏览器/E2E、常驻 Worker/Workflow Job/Attempt/Lease、真实 Provider 请求、生产部署、全仓 docs check。CLI 入口独立启动未运行；测试验证其导出执行链。
- 历史与当前分离：历史 38 migrations、runner 未实现、环境变量 READY smoke 等叙述原文保留；当前更正见本轮基线与 README。备份与默认库相同且均已含 Task 40 migration，不能声称是迁移前恢复点。
- Checkpoint：已批准离线切片验证完成；Task 39 真实 Connection/SecretStore-backed Provider 验收仍未完成。下一步准备真实终端入口及准确请求清单须另获范围确认，实际请求还须逐次明确授权。证据置信度 B：离线目标及相关回归已通过，真实网络、CLI 独立启动与生产生命周期仍有界未验证。
