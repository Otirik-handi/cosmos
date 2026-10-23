# Task 39 Provider/model 配置续篇（四）

> 2026-10-19 至 2026-10-20，本册从「写入审查错误分类修复（局部）」到「隔离 ORM 读取验收」末尾。
> 同系列：`walkthrough-provider-model-02.md`、`walkthrough-provider-model-04.md`、`walkthrough-provider-model-06.md`、`walkthrough-provider-model-07.md`。

## 写入审查错误分类修复（局部）

独立只读审查确认retry错误码被吞，发布冲突列为候选；主线程读真实repository确认recover使用findUniqueOrThrow、publish含CAS conflict。用户另行批准application service/port/tests、storage repository及新增errors测试、HTTP控制器/测试与本篇；无数据库或外呼授权。

先RED：服务not_found变dependency_unavailable、两种发布冲突丢失分类；仓储测试初次桩缺findUniqueOrThrow导致TypeError（测试桩问题，随后补合成P2025方法）。实现recover显式findUnique/null→not_found；safeFailure保留not_found。publish保留安全冲突分类，但仍recover确认已提交状态并cleanup；只有未发布且补偿完成failed时返回原冲突，HTTP409；cleanup_pending优先，不跳过凭证补偿。HTTP额外断言不存在操作404与retryable false。

`bun run vitest run packages/application/src/model-provider-credentials.test.ts packages/storage-prisma/src/model-provider-credential-errors.test.ts apps/api/src/model-provider-write.controller.test.ts` 3文件26/26通过。显式strict NodeNext tsc（experimentalDecorators/emitDecoratorMetadata）检查application协调测试与HTTP控制器/测试通过。仓储源码未做真实生成客户端类型检查/ORM执行，本轮仅查询桩。

尚未闭合：发布冲突errorCode目前只保留在即时调用收据，数据库失败历史仍由settle写credential_write_failed，后续重查/重传丢冲突分类。需后续冻结并实现持久化收据错误语义；本轮不得声称审查项全部关闭。正式装配/HTTP真实存储/用户UI均未完成，无迁移/真实SecretStore/Provider请求/Git生命周期。

## 正式装配前待解决的消费边界

只读核对 transport-http/src/client-base.ts:62-85 与 types.ts:13-22：统一request只保留响应JSON，错误对象只有status/body，未保留X-Cosmos-Operation-ID。因此HTTP回读失败虽保留header，当前transport还不能将该恢复线索交给UI。未来切片应优先定义安全operationId的传递与恢复路径，并保持已有调用者兼容；本轮不改transport，不声称UI恢复已可用。浏览器还须核对CORS exposeHeaders，或采用响应体内白名单operationId方案，不能只凭本机fetch能读header推断浏览器跨源可用。

后续既有控制器范围内修复：保存收据已设X-Cosmos-Operation-ID、但query.get失败时，固定错误body同时带该服务端响应头中的operationId（字符串且通过ID白名单）；不从客户端请求头采纳值。HTTP断言先RED body缺operationId，再GREEN控制器/协调回归2文件21/21，显式strict NodeNext tsc通过。transport当前保留body，因此该路径已有恢复线索；公开ServiceError schema/transport消费和浏览器流程仍需后续验证，不声称UI完成。

下一步建议：先审查写入链并修具体问题，再用独立批准切片修transport/响应合同；随后批准范围内验证HTTP→隔离真实存储整链，最终才注册AppModule与请求读取器。数据库迁移、真实Provider请求继续分别授权。

## 集中回归与响应回读失败

最新无数据库集中回归：`bun run vitest run apps/api/src/model-provider-write.controller.test.ts apps/api/src/model-provider.controller.test.ts apps/api/src/model-configuration-body-reader.test.ts apps/api/src/model-configuration-write-policy.test.ts apps/api/src/request-logging.test.ts packages/application/src/model-provider-credentials.test.ts packages/application/src/model-provider-query.test.ts packages/storage-prisma/src/model-provider-query-repository.test.ts packages/contracts/src/platform.test.ts packages/application/src/entry-contract.test.ts`，10文件43/43通过。随后仅在HTTP测试补保存成功后query.get失败：固定503/dependency_unavailable、不回显合成key且保留X-Cosmos-Operation-ID可查收据；测试2/2及显式strict NodeNext tsc通过，无生产实现改动。

新鲜Git状态显示未跟踪 `packages/application/src/secret-store.js`，只读内容为`export {};`；无法确认来源，保留不删除，不把工作区声称干净。两份会话导出仍未读取。整体非正式装配/构建验收。

## 幂等竞争响应专项

用户单独批准凭证port/service/test、写控制器/test与本篇，新增内部`replayed?: true`，仅三处命中已有操作时返回；首次操作及retry不添加，不写数据库或公开DTO。严格TDD先RED4项：初次查询/持锁查询/登记返回winner均未标记，HTTP复用completed仍201返回Provider。修复后控制器复用路径202查询安全操作快照，不把标记透传。

`bun run vitest run packages/application/src/model-provider-credentials.test.ts apps/api/src/model-provider-write.controller.test.ts packages/application/src/entry-contract.test.ts` 3文件22/22通过；显式strict NodeNext tsc（experimentalDecorators/emitDecoratorMetadata）检查协调测试和HTTP控制器/测试通过。标记只区分执行结果，不新增事务或幂等真相源。证据限于内存分支与本机HTTP映射，尚未模拟两个真实HTTP首次并发；真实ORM/FileSecretStore/原生锁及正式装配未连成整链。无迁移/真实数据/SecretStore/Provider请求/Git生命周期。

补充重叠HTTP证据：真实协调器内存测试用受控Promise使首个PATCH停在put；此时第二个同key PATCH返回202/pending/resourceVersion null，put1/delete0；释放后继续原有cleanup_pending与显式恢复，put始终1。`bun run vitest run apps/api/src/model-provider-write.controller.test.ts packages/application/src/model-provider-credentials.test.ts` 2文件21/21及测试显式strict NodeNext tsc通过。此为已登记后真实HTTP重叠，不代表两次预查询同时miss的端到端竞争或跨进程事务；生产源码未改。

## 独立保存与恢复 HTTP 初始接线

用户“继续”后重新启用目标；单独批准新增 model-provider-write.controller.ts/测试与本篇。请求读取器测试先补充未发送结束块的32769字节请求及时413，以及客户端中断使读取以invalid_input结束，生产读取器未改。

写控制器首跑模块缺失RED。新增创建、编辑和显式恢复三路由，使用原始请求读取器、严格DTO、单值Idempotency-Key、固定安全错误、no-store与操作ID。独立Nest模块bodyParser:false，本机随机端口HTTP验证；未注册正式AppModule。凭证服务与查询服务当前为内存桩，非真实协调器整链；测试使用合成key且检查响应不含该值。最新 `bun run vitest run apps/api/src/model-provider-write.controller.test.ts apps/api/src/model-configuration-body-reader.test.ts apps/api/src/model-configuration-write-policy.test.ts apps/api/src/model-provider.controller.test.ts packages/application/src/model-provider-credentials.test.ts` 5文件23/23通过；写控制器/测试和读取器测试的显式strict NodeNext tsc（experimentalDecorators/emitDecoratorMetadata）通过；docs:check1076零失败，diff --check通过（不覆盖未跟踪文件）。当前只能声称初始HTTP接线，幂等重传响应、cleanup_pending已提交状态表达、真实协调器恢复、慢请求与正式配置仍需专项复核，不以此作为产品保存验收完成。

后续幂等专项：新增HTTP断言，已存在幂等键重传`{}`应返回既有操作且保存调用次数不变；先RED实际400 invalid_input。控制器在受限正文与幂等键校验后、创建/更新DTO解析前查询operationByKey，仅not_found进入保存，其它查询失败关闭操作。既有收据返回202与操作ID，不读取Provider当前版本替代历史收据。`bun run vitest run apps/api/src/model-provider-write.controller.test.ts packages/application/src/model-provider-credentials.test.ts` 2文件17/17通过；控制器/测试显式strict NodeNext tsc通过。尚未证明同时首次请求间的竞态返回语义，应用协调器仍负责幂等竞争防重。复杂度控制：预查询只负责既有收据响应，不替代事务幂等所有者，不增加凭证回退。

后续cleanup_pending专项：先RED证明已发布与未发布均只给模糊requires attention；依据resourceVersion是否为null分开固定消息，已发布明确Configuration saved，未发布明确Configuration was not published，保留503/code/operationId/resourceVersion，不读取或返回凭证。两分支HTTP断言及凭证协调回归2文件17/17通过，显式strict NodeNext tsc通过。仅补固定文案分支，不改变发布/恢复所有权；真实协调器经HTTP整链仍待验证。

后续真实协调器HTTP测试：在已批准测试范围直接注入当前源码ModelProviderCredentials，底层ProviderCredentialRepository/操作锁/SecretStore为内存桩；按HTTP PATCH触发发布→旧ref删除失败，503明确已保存、resourceVersion2；显式POST恢复完成，put仍1次/delete2次；之后PATCH幂等重传不增加put/delete。响应不含合成key/ref。控制器测试2/2及显式strict NodeNext tsc通过。该证据证明真实应用编排穿过HTTP，不证明真实Prisma/FileSecretStore/原生锁整链、并发首次请求或正式模块；未改生产实现。

仅新增两文件/更新本篇及已授权读取器测试补强，无真实数据库/SecretStore/迁移/生成/外部请求/Git生命周期。Task40、默认数据库、备份、会话导出未动。目标继续进行中。

## 专用请求流读取基础

用户单独批准新增 `apps/api/src/model-configuration-body-reader.ts` 与测试、更新本篇。严格TDD首跑模块缺失RED，随后真实本机随机端口HTTP验证。原始rawHeaders检测重复Origin/Host/Content-Type，再调用纯入口策略；拒绝Content-Encoding；仅累计Buffer实际字节，超过32768时释放已积累片段、暂停流并固定413，供调用方响应后关闭连接。无效UTF-8采用fatal解码，JSON异常不回显正文；中断分支返回固定400。

`bun run vitest run apps/api/src/model-configuration-body-reader.test.ts apps/api/src/model-configuration-write-policy.test.ts` 2文件5/5通过，实测分块且无Content-Length、32768边界、32769超限、重复Origin/Content-Type、压缩、无效UTF-8/JSON。`bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node apps/api/src/model-configuration-body-reader.ts apps/api/src/model-configuration-body-reader.test.ts`通过。

复杂度控制：专用读取器复用既有策略，不触碰通用JSON解析或其它路由。正式接线必须先于通用body parser，并负责拒绝后连接关闭/超时；当前未实测客户端中断分支、慢请求、Bun HTTP或正式Nest装配。未新增保存/恢复路由，未连接SecretStore/数据库，无迁移/生成/外呼/Git生命周期。Task39整体未完成。

## 本机写入入口策略（独立基础）

用户另行批准仅新增 `apps/api/src/model-configuration-write-policy.ts` 和同名测试、更新本篇。沿用严格TDD，首跑模块缺失RED；新增纯函数接收显式受信Origin/API authority与元数据，不读环境/请求正文，固定安全错误。Origin/Host精确匹配，拒绝缺失/null Origin、多值头与伪造Host；不读取forwarded数据。仅application/json及可选UTF-8 charset，实际字节数必须为非负安全整数，32768允许、32769拒绝。不使用Content-Length推断大小。

`bun run vitest run apps/api/src/model-configuration-write-policy.test.ts apps/api/src/model-provider.controller.test.ts packages/contracts/src/platform.test.ts` 3文件6/6通过。`bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node apps/api/src/model-configuration-write-policy.ts apps/api/src/model-configuration-write-policy.test.ts`通过。

复杂度控制：一个纯策略函数，无回退、环境默认或另一存储所有者。当前仅验证调用方提供的测量值；实际HTTP头重复归并检查、流计数/解析、受信配置校验和正式路由接线未完成。不改全局CORS、不运行正式API/迁移/数据库/SecretStore/Provider请求，不触碰Task40/默认库/备份/会话导出，不做Git生命周期。后续必须在实际请求流验证chunked/无Content-Length/超限提前中断与固定响应，不能把本测试写成产品安全已完成。

前篇：[合同、持久化与凭证协调](walkthrough-provider-model.md)。本篇继续同一个 Task，不替代前篇历史证据。产品目标仍为 Provider 拥有凭证、Connection 选择模型；整体实现未完成。

## 安全读取基础切片

用户批准只新增 application 的 model-provider-query.ts/测试、storage-prisma 的 model-provider-query-repository.ts/测试，必要更新 application index/entry-surface、两包 MODULE、本篇和前篇入口链接。不接 API/UI/Worker，不改 schema/依赖，不生成客户端或执行迁移；不访问真实数据库/SecretStore/Provider，不动 Task40、默认数据、备份、会话导出，不做 Git 生命周期。

TDD Route: strict（沿用已记录路线）。两个测试套件先因目标模块不存在而 RED；实现后发现 operationByKey 同步校验抛错，统一 async 查询接口，再修复测试桩空元组类型。只用内存和查询桩。

读取合同：Provider 列表默认50/最大100，按 ID 稳定排序，额外取一项决定 nextCursor；非事务跨页快照。发布前 secretRef 为 null 的创建占位不进入列表或单条；数据库只选择公开列，不取 ref 内容。已发布 Provider 的 cleanup_pending 由操作收据查询投影，普通读取不触发恢复。操作按 ID/幂等键精确查询，只返回 id/kind/providerId/state/errorCode/resourceVersion。应用服务 strict 校验白名单；依赖失败、额外字段和未知错误码统一 dependency_unavailable，不携带原始异常。configured 仅代表已发布关联，不代表文件存在或认证有效。

复杂度控制：两个小模块，应用层负责输入/输出校验，存储层负责列选择和状态投影；没有回退或自动恢复。两次查询之间的状态变化不承诺事务快照。真实生成 Prisma 客户端结构兼容性、隔离 ORM 查询行为、API/transport/UI/Worker、删除和发现均未验证/未接线，后续另定切片。

最新验证：`bun run vitest run packages/application/src/model-provider-query.test.ts packages/storage-prisma/src/model-provider-query-repository.test.ts packages/application/src/model-provider-credentials.test.ts packages/application/src/entry-contract.test.ts packages/storage-prisma/src/entry-contract.test.ts`，5文件25/25通过。`bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node packages/application/src/model-provider-query.ts packages/application/src/model-provider-query.test.ts packages/storage-prisma/src/model-provider-query-repository.ts packages/storage-prisma/src/model-provider-query-repository.test.ts`通过。`bun run docs:check`检查1066文件、零失败；`git diff --check`通过（不覆盖未跟踪文件）。该切片没有运行全仓测试、构建、真实 ORM 或外呼；不以桩测试声称 ORM 或产品验收完成。

## 隔离 ORM 读取验收

用户另行批准两文件范围：新增 `packages/storage-prisma/src/model-provider-query-integration.test.ts`，更新本篇。仅在新 `.agent/tmp/task39-provider-query-*` 根内复制当前 schema/41项迁移并记录 SHA-256，调用已安装 Prisma CLI 生成独立客户端、部署隔离迁移；严格编译当前合同/应用服务/存储投影副本后由 Node 执行。子进程使用白名单环境、显式 DATABASE_URL/数据根、禁止自动安装并指向无效代理；不读 SecretStore，不发 Provider 请求，不改共享生成物/生产代码/默认库/备份/Task40/会话导出，不做 Git 生命周期。

首次根 `.agent/tmp/task39-provider-query-WynoJz` 中 generate/migrate/strict typecheck/compile通过，执行失败于工作区旧 contracts 构建产物缺少 `modelProviderSnapshotSchema` 导出（在查询前失败）。测试改为在隔离根复制当前 contracts 源码并重定向 import，避免共享构建产物；未改生产实现。失败根保留。

命令 `bun run vitest run packages/storage-prisma/src/model-provider-query-integration.test.ts` 最新1/1通过，根 `.agent/tmp/task39-provider-query-TxyQKH` 保留；verification.json已回读 passed。真实生成客户端可传入查询适配器，实际验证创建占位隐藏、两页排序与游标、configured→cleanup_pending→configured、操作 ID/幂等键一致、响应字段白名单和 foreign_key_check。只使用合成 ref，没有真实 key/SecretStore。`bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node packages/storage-prisma/src/model-provider-query-integration.test.ts`通过。

边界：这是隔离新库的顺序行为验证，不证明并发事务快照、历史库升级、生产数据、API/UI/Worker或外呼。工作区旧 contracts 构建产物尚未重建；未来 API 打包验证必须确认新导出可加载。整体 Task39 保持进行中。
