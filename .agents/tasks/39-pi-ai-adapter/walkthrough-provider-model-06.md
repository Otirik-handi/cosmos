# Task 39 Provider/model 配置续篇（六）

> 2026-10-20，本册从「独立 HTTP 读取控制器」到「Provider 发现端口 Host 真相源校正」末尾。
> 同系列：`walkthrough-provider-model-02.md`、`walkthrough-provider-model-04.md`、`walkthrough-provider-model-06.md`、`walkthrough-provider-model-07.md`。

## 独立 HTTP 读取控制器

用户另行批准新增 `apps/api/src/model-provider.controller.ts` 和同名测试，仅更新本篇。实现 Provider 列表/单条、操作按 ID/幂等键四条 GET 路由；独立 token `COSMOS_MODEL_PROVIDER_QUERY` 注入读取服务，不导入 AppModule，不构造默认仓储。首跑因模块不存在 RED；实现后本机 Nest 临时模块绑定127.0.0.1随机端口验证通过，finally关闭服务。

`bun run vitest run apps/api/src/model-provider.controller.test.ts packages/application/src/model-provider-query.test.ts packages/storage-prisma/src/model-provider-query-repository.test.ts apps/api/src/app.controller.route-table.test.ts` 4文件11/11通过；本机 HTTP 实测四路由、分页参数拒绝重复/非法值、404/503固定消息及 no-store，既有 AppController 路由表未变。`bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --experimentalDecorators --emitDecoratorMetadata --types node apps/api/src/model-provider.controller.ts apps/api/src/model-provider.controller.test.ts`通过。

复杂度控制：新控制器仅负责 HTTP 参数与错误映射，响应白名单由已验证应用读取服务负责；没有兼容回退。HTTP 测试注入内存 reader，当前未证明正式模块装配或 HTTP→真实ORM整链。后续发现全局异常过滤器枚举缺口，见下节。

## 独立审查及 HTTP 证据补强

咨询审查完整读取指定读取链源码/单测和合同前64行，未发现可证实 Critical/Important；未执行测试或数据库访问。指出原 HTTP 测试的 reader 桩 DTO 不完整，幂等查询桩包含 key，且缺非法/重复 cursor 路径。此为覆盖缺口，不是已证实生产泄露。

随后在已批准测试文件范围内改用真实 ModelProviderQuery（测试直接导入当前源码，避免旧构建产物），底层只注入内存仓储；完整 Provider/Operation DTO 经过真实服务严格校验、控制器与 RequestExceptionFilter。新增 unsafe Provider 含 secretRef 时503且不泄露 PRIVATE_SENTINEL、非法cursor由应用服务映射400、重复cursor由HTTP拒绝；收据不含幂等键字段。`bun run vitest run apps/api/src/model-provider.controller.test.ts packages/application/src/model-provider-query.test.ts apps/api/src/request-logging.test.ts` 3文件12/12通过；`bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --experimentalDecorators --emitDecoratorMetadata --types node apps/api/src/model-provider.controller.test.ts`通过。不声称HTTP→真实ORM或正式模块已验证，无迁移/SecretStore/外部请求/生产代码修改。

## 正式错误合同兼容

用户另行批准仅修改 contracts 的 platform.ts、新增 platform.test.ts，扩展控制器测试并更新本篇。静态检查发现 RequestExceptionFilter 会将未登记代码回退；真实过滤器接入测试后 RED：dependency_unavailable 被改写为 service_unavailable，合同测试 invalid_input 不合法。随后仅扩展 serviceErrorCodeSchema 九个已批准 Provider 错误码，旧码保留，不修改过滤器逻辑。

`bun run vitest run packages/contracts/src/platform.test.ts packages/contracts/src/entry-contract.test.ts apps/api/src/model-provider.controller.test.ts apps/api/src/request-logging.test.ts` 4文件10/10通过；真实本机 HTTP 经过 RequestExceptionFilter 验证 invalid_input/not_found/dependency_unavailable、no-store和安全消息。`bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --experimentalDecorators --emitDecoratorMetadata --types node packages/contracts/src/platform.test.ts apps/api/src/model-provider.controller.test.ts`通过。复杂度控制：只扩展既有枚举与测试，不新增错误映射所有者或回退。

本轮仍未注册正式模块，也未执行生产数据或真实凭证操作。没有注册正式 AppModule，正式服务暂不提供新增路由；写接口、Origin限制、实际凭证保存仍未接线。本切片不运行迁移/生成、不访问数据库/SecretStore、不发外部请求、不动 Task40/默认库/备份/共享构建产物/会话导出，不做 Git 生命周期。

## Transport Provider/model 客户端切片

用户批准的下一边界是 contracts 与 transport 的 Provider/model 客户端：共享操作收据和分页 schema，Provider 列表/详情，创建/更新的显式幂等键，按 ID/幂等键查询以及调用方显式 retry。canonical receipt schema 从 application 私有校验迁移到 `packages/contracts/src/provider-model.ts`；`ProviderModelsClient` 接入既有 `HttpCosmosClient` 继承链，所有请求继续经过 `client-base.ts` 的唯一 `request()` 管线。写入不自动重发；未知结果由调用方查询操作收据。没有数据库、迁移、SecretStore、Provider、正式服务或共享生成器操作。

TDD 首次 RED 为四个缺少客户端方法；实现后又发现 API 写入有两种成功合同：202 返回操作收据，201 返回已保存 Provider 快照。因此统一请求管线新增可选 `schemaForStatus(status)`，错误仍由原管线读取完整 body 并抛出 `CosmosTransportError`，资源分册没有直接 fetch。客户端写方法按 202 选择 `modelProviderOperationSnapshotSchema`，其它成功状态选择快照 schema；调用者传入的 `Idempotency-Key` 只发送一次。共享 operation kind 收紧为 `create|update`，错误码继续使用已批准白名单。

验证：`bun run vitest run packages/transport-http/src/client-provider-models.test.ts packages/contracts/src/provider-model.test.ts packages/contracts/src/entry-contract.test.ts packages/application/src/model-provider-query.test.ts` 4文件21/21通过；覆盖分页与 URL 编码、201 即时快照、202 收据、未声明成功状态拒绝、失败后按 operationId 查询而不重发、PATCH 及按幂等键 GET。严格检查命令 `bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node packages/transport-http/src/client-provider-models.ts packages/transport-http/src/client-base.ts packages/transport-http/src/client-provider-models.test.ts packages/contracts/src/provider-model.ts` 通过。此前合同入口因快照 CRLF/LF 差异出现一次失败，规范 `packages/contracts/entry-surface.txt` 为 LF 后复跑通过。`bun run docs:check` 已检查1087文件零失败，`git diff --check`通过。

本切片仍未覆盖模型 CRUD/删除、Discovery/Responses、UI/Connection、Worker 或完整产品入口；没有运行全仓测试、完整构建、浏览器、真实 ORM、真实凭证或真实 Provider。共享 Prisma 生成客户端的陈旧类型限制仍保留，整体 Task39 继续进行中。

## ConfiguredModel 应用层 CRUD 切片

用户批准本切片范围：新增 `packages/application/src/configured-models.ts` 与测试；必要更新 application 入口快照和 MODULE。只复用既有 contracts schema，通过注入 `ConfiguredModelRepository` 实现列表、详情、创建、版本更新和删除；测试使用内存 fake，不修改 schema/migration、storage-prisma、API/UI/Worker、SecretStore、默认库、Task40，也不发 Provider 请求。

严格 TDD：首次 RED 命令 `bun run vitest run packages/application/src/configured-models.test.ts` 因 `Cannot find module './configured-models.js'` 失败；实现后 GREEN 为该文件5/5。实现校验 Provider/model 标识、公开快照、创建字段、更新版本栅栏与持久化 contextWindow 合并检查、删除版本栅栏，并将缺失映射为 `not_found`、版本冲突保留为 `version_conflict`、其它依赖错误映射为 `dependency_unavailable`，不传播原始错误内容。入口新增 `ConfiguredModels` 与 `ConfiguredModelRepository`，由生成器更新 `packages/application/entry-surface.txt`。

最终验证：`bun run vitest run packages/application/src/configured-models.test.ts packages/application/src/entry-contract.test.ts packages/contracts/src/provider-model.test.ts` 3文件13/13通过；严格 NodeNext 命令 `bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node packages/application/src/configured-models.ts packages/application/src/configured-models.test.ts packages/application/src/entry-contract.test.ts` 通过；`bun run docs:check` 检查1089文件零失败；`git diff --check` 通过。

该切片仍未接真实 storage-prisma 仓储、API 路由、Provider/模型数据库运行时、Discovery/Responses、UI/Connection、Worker 或正式产品入口；未运行迁移/生成、全仓测试、完整构建、浏览器、真实凭证或真实 Provider。整体 Task39 继续进行中；下一步需单独批准 storage-prisma ConfiguredModel 仓储与隔离 ORM 验证。

## ConfiguredModel API 与 transport CRUD 切片

用户已明确批准本切片：新增 ConfiguredModel API 控制器及测试，接入既有 `ModelConfigurationModule`/AppModule 依赖，必要时扩展 raw-body 路由规则，并在既有 HTTP transport 增加 ConfiguredModel CRUD 方法及测试；非秘密写入沿用精确 Origin/Host 信任门禁。明确不改 schema/migration、正式服务启动方式、UI、Worker、Task40、默认数据库/备份，不发送 Provider 请求；HTTP 验证只使用注入 fetch/隔离桩。

TDD Route: strict。Change Necessity: 现有 ConfiguredModels 仅有 application 与 storage 端口，HTTP API 和 transport 尚无模型 CRUD，无法被产品消费者使用；最小代码边界是 API controller/module wiring 与 transport resource。Slice Card：Goal=通过受信 API 暴露 Provider-scoped ConfiguredModel CRUD；Files=新增/更新 apps/api 的模型控制器、module/test、必要 body-parser 测试及 packages/transport-http 的模型客户端/test/MODULE；Boundary=非秘密字段、Provider 范围、版本 CAS、无自动 Provider 请求；Verification=先 RED，再聚焦 API/transport/application/contracts 测试、严格 tsc、docs:check、git diff --check；Stop=若需 schema/migration、正式 AppModule 启动、UI/Worker 或外部请求则暂停并重新请求范围。

实施记录：新增 `apps/api/src/configured-model.controller.ts`，复用注入的 ConfiguredModels service 和既有信任/body reader，提供 Provider 范围的列表、详情、创建、版本更新、版本删除；列表包装成 `{ items, nextCursor: null }` 与 transport page 合同一致，固定错误响应不携带底层异常。AppModule 和 ModelConfigurationModule 的依赖接线已由前序获批组合切片提供，本次仅扩展模块 token 并在隔离 Nest 测试中注入桩。Transport 新增 `ConfiguredModelsClient` 并接入继承门面，请求统一经过既有 `request()`；写请求显式传入 caller-owned Idempotency-Key，不自动重发，DELETE 收到 204 空体时返回 void。body parser 对 ConfiguredModel POST/PATCH/DELETE 路由排除通用 parser，测试同时覆盖这些 raw 流和普通 JSON/form parser。

严格 TDD 新 controller 测试首轮 RED 发现跨 Provider 详情读取返回 200/null；controller 改为固定 not_found/404。随后 HTTP 测试发现 ConfiguredModel POST 未排除通用 parser而返回400，补全 body-parser 路由；又发现 Origin 拒绝错误被映射503，补入 forbidden_origin/403 与 payload_too_large/413。最终聚焦命令 `bun run vitest run apps/api/src/configured-model.controller.test.ts apps/api/src/model-configuration-body-parser.test.ts packages/transport-http/src/client-configured-models.test.ts packages/application/src/configured-models.test.ts apps/api/src/model-configuration.module.test.ts packages/contracts/src/provider-model.test.ts packages/contracts/src/entry-contract.test.ts packages/transport-http/src/entry-contract.test.ts packages/transport-http/src/client-provider-models.test.ts packages/application/src/model-provider-query.test.ts apps/api/src/model-provider-write.controller.test.ts apps/api/src/model-provider.controller.test.ts` 12文件35/35通过；覆盖Provider范围、404、创建、版本冲突安全响应、删除、Origin拒绝、parser raw路径及普通parser保留、transport路径编码/idempotency/version/204空响应以及相邻Provider回归。严格 NodeNext tsc（含Nest decorators及 parser/test/controller/module/transport 源与测试）通过。`bun run docs:check` 检查1096文件零失败；`git diff --check` 通过。contracts 入口快照需包含新增 `configuredModelPageSchema`；本次确认文件生成脚本只输出快照而不写文件，故按既有格式补录该导出后入口合同通过。

未运行正式 AppModule、全仓测试/构建、浏览器、真实 ORM/默认数据库、迁移/共享生成器、SecretStore 或 Provider 请求；HTTP 测试使用本机随机端口与内存注入桩，不证明正式部署配置或真实存储整链。Task39 仍未完成，Discovery/Responses、UI/Connection、Worker @2 和完整产品验收仍待后续切片。

## Pi-ai Responses 模型协议适配切片

Change Necessity: code-change。现有 ConfiguredModel 合同允许 Provider 级 `openai-responses`，但 `PiAiAgentInvocationAdapterOptions.model` 仅接受 `Model<"openai-completions">`，因此 Responses 配置不能进入适配器；仅文档或 UI 选项不能提供协议行为。最小修改限于 `packages/agent-pi-ai/src/index.ts` 与 `src/index.test.ts`，新增 Responses 模型描述并将注入模型类型放宽为两个已支持 API 的联合；不新增网络客户端、发现逻辑、Worker 路由、fallback 或运行时重试。TDD Route: strict（父计划既有决定）。测试只通过注入的 `PiAiClient.complete` 验证选定模型和 API 标识，不调用 Provider。

Slice Card：Goal=让已配置的 OpenAI Responses 模型可通过现有注入 seam 进入 adapter；Files=agent-pi-ai index 与测试、本 walkthrough；Boundary=仅离线 SDK 模型配置/调用适配，不做网络目的地安全、发现 Job/Attempt、正式 Worker @2 注册、UI、外呼或 Task40；Verification=先 RED，再 agent-pi-ai 聚焦测试、严格 NodeNext tsc、docs:check、diff check；Stop=若 pi-ai 类型/调用协议要求新增传输 owner 或网络行为，本切片暂停并重新冻结范围。

TDD 结果：新增的两个测试首轮 RED，均因 `createPiAiOpenAIResponsesModel is not a function` 失败；实现模型构造器及注入模型联合类型后，首次 GREEN 有一项失败，原因是测试 fake 固定返回旧 provider/model 标识，已改为回显其接收的模型字段；随后 `bun run vitest run packages/agent-pi-ai/src/index.test.ts` 通过1文件13/13。测试验证 Responses API 模型属性、被 adapter 送入注入 client、结果不进行 Chat Completions fallback；SDK 与凭证均为 fake。

严格类型检查 `bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node packages/agent-pi-ai/src/index.ts packages/agent-pi-ai/src/index.test.ts` 通过；`bun run docs:check` 检查1096文件、failures=[]；`git diff --check` 通过。未运行真实 Provider、Worker正式注册、外部网络、发现、数据库、迁移、浏览器、构建或全仓测试。该切片只闭合离线 SDK 协议选择 seam；Task39 仍未完成，发现/受控socket策略与Job/Attempt消费者、UI/Connection、Worker @2 整链验收依旧待办。

## Provider 模型发现设计批准（2026-10-18）

- 用户批准将以下内容作为 Task39 发现实现基线；这只批准设计，不等于代码、迁移、正式服务、真实 Provider 请求或 Git 生命周期授权。
- 首版发现协议仅面向明确兼容 OpenAI `GET /models` 的 Provider。Provider 的生成类型 `openai-completions` / `openai-responses` 不推定其支持该发现协议；不支持者继续手动录入模型，不额外建立多协议发现注册表。
- API 接收 Provider 标识并排队，不读取凭证、不执行 SDK/网络。发现必须由专用 discovery WorkflowRun 发起，其 Activity Job/Attempt/Lease 与 Run envelope/Kernel state 是唯一执行和恢复真相；Worker Activity 执行前校验 Provider version。每 Provider 一个非终态 Run，Activity Job 固定 maxAttempts=1、10 秒总预算、1 MiB 响应、1000 唯一候选、零自动重试/重定向/分页；结果只含安全 `{modelId,name}` 候选与固定错误码，必须由用户确认后另行创建模型。API 创建 Run 时使用 Idempotency-Key，并以 Provider 范围原子约束非终态发现 Run。
- 已知恢复风险：当前 Host 允许过期 leased Job 重新领取，也会恢复仍为 running 的 Run，故 maxAttempts=1 不能防止 Activity 被 Workflow recovery 重放。实现前需设计并验证持久化 dispatch fence：可能已开始外呼的 Activity 不得再次请求 Provider；恢复路径需在同一 Host/Workflow owner 内将 Run 收敛为 `outcome_unknown`，然后才释放该 Provider 占用。若无法沿用既有持久化 owner，暂停并修订 Host 合同/架构，不能新增第二状态机。
- 受控 HTTPS transport 负责 DNS 答案审核、实际连接到审核地址、原主机 TLS/SNI 校验及请求/响应预算；不得仅预解析后交给会重解析的 fetch，不得全局 monkey-patch fetch 或绕过环境代理。测试全部用合成网络边界，不请求公网 Provider。生成调用接入 transport 是后续阶段门槛：pi-ai 当前版本须经本地源码与行为测试证实逐请求 transport 注入；不得擅自升级/修改 SDK，也不得声称发现安全证明生成安全。
- 生成调用接入 transport 是后续阶段门槛：只有在当前 pi-ai 版本存在经本地源码和行为测试证实的逐请求 transport 注入后，才评估复用同一策略；不得擅自升级/修改 SDK，也不得声称发现安全证明生成安全。
- 恢复语义不作未经验证的保证：当前 Host 允许过期 Activity Job 重新领取，Run recovery 也可能重放活动 Activity；修复只能落在既有 Host/Workflow 持久化 owner，不新增并行状态机。确认实现可行前不得开始任何可运行 discovery consumer。
- 设计审阅范围：API Draft 的「发现任务与网络边界」章节；当前文档应保持 Draft/未实现标识。修订后先做合同与实现方案复审，再执行批准的离线代码切片；Prisma migration、真实 Provider 请求与 Git 操作仍分别遵守各自授权边界。

## Provider 发现恢复 fence 设计修订（2026-10-18）

- 用户批准将 Host 级 dispatch fence 纳入 Task39 设计并更新文档供复审；仅为设计文档授权，不授权代码、schema/migration、真实 Provider 请求或 Git 生命周期。
- 依据现有 Host 合同，过期 `leased` Activity 可被重新领取，Kernel 仍为 running 的 Run 也可恢复；`maxAttempts=1` 仅限制正常重试，不阻止租约接管后的再次执行。因此 API Draft 已细化为：发现 Activity 首次外呼前，由持有当前 Run/Job lease 的 Host 操作原子写入持久化 dispatch fence；只有未设置 fence 的工作可在租约过期后接管执行。
- fence 写入后，任何 recovery owner 均不得再次 dispatch。崩溃发生在发包前或发包后都统一按可能已发出处理：经既有 Host/Workflow owner 的受 fence 保护路径将 Activity/Run 收敛为 `outcome_unknown`；Run 终态后才释放 Provider 占用。数据库 fence 无法撤销已取得唯一 dispatch 权的暂停进程；它恢复后仍可能迟到地发出这一次请求，故 `outcome_unknown` 不表示 Provider 一定未收到请求，也不能保证 Run 终态后零外呼。旧 executor 的迟到结果必须被拒写；显式重试前 UI 告知结果未知及请求可能已发送。该合同只防止 Host recovery 再授权第二次请求，不承诺跨数据库/公网 exactly-once。fence 的持久化载体、事务边界和如何通过现有恢复 owner 生成终态仍是实施设计必须回答的问题；若不能在既有 owner 内完成，则暂停并先修订 Host 合同/架构，不在 application/API 新增并行真相。
- API Draft 的验收已补充：并发首次 fence 只允许一个 owner、fence 前崩溃可由新租约安全执行、fence 后崩溃不重复外呼并收敛 outcome_unknown、Provider 占用只在终态释放、旧 executor 迟到不能写入。Host 当前 spec 仍只描述当前实现；若设计复审接受 Host 合同扩展，实施前须先更新 Host 架构/目标合同，代码落地后再按 docs/spec 规则记录实现行为。
- 下一步：请用户复审 `docs/api/0009-provider-model-configuration.md` 第 89-107 行及本节。复审通过后才转入 writing-plans；此前不实施代码。
