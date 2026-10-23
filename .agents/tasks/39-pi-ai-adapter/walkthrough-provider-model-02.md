# Task 39 Provider/model 配置续篇（二）

> 2026-10-16 至 2026-10-19 的切片记录。
> 本册与后续三册由同一篇按文档大小治理拆出，内容原样保留、不重写。
> 同系列：`walkthrough-provider-model-02.md`、`walkthrough-provider-model-04.md`、`walkthrough-provider-model-06.md`、`walkthrough-provider-model-07.md`。

## ConfiguredModel Prisma 仓储切片

用户批准的精确范围：新增 `packages/storage-prisma/src/configured-model-repository.ts`、对应行为测试和独立 ORM fixture；增量更新存储包 `src/index.ts`、入口导出合同/MODULE 与本篇。实现仅访问 ConfiguredModel 非秘密列；列表/详情按 providerId 限定，创建只写非秘密字段，更新/删除以 `id + providerId + version` 条件 CAS；零命中映射 `version_conflict`。不改 schema/migration、AppModule/API/UI/Worker、依赖或共享 Prisma 生成物；只在全新 `.agent/tmp/task39-configured-model-*` 根生成独立 Prisma Client 并对合成库应用已冻结41 migrations，所有根保留，不访问默认数据库/备份/SecretStore/Provider。

验证结果：聚焦行为测试 `bun run vitest run packages/storage-prisma/src/entry-contract.test.ts packages/storage-prisma/src/configured-model-repository.test.ts packages/application/src/configured-models.test.ts` 最终3文件10/10通过；独立 ORM harness 最终通过，保留根为 `D:\Otirik\Workstation\cosmos\.agent\tmp\task39-configured-model-QTnN6G`，完成生成独立客户端、冻结41 migrations、严格类型检查和真实 ConfiguredModel CRUD/CAS/foreign-key 验证。首轮失败为 harness 类型标注，第二轮为旧日期固定断言，均已修正测试 harness；生产仓储未因这些失败修改。局部严格 NodeNext tsc 最终通过（应用与仓储源/测试，不含过时共享 Prisma 生成入口）；`bun run docs:check` 1092 files/0 failures，`git diff --check` 通过。已知限制：共享 Prisma client 仍陈旧，若把依赖该入口的旧 Provider 仓储纳入同一类型检查仍会出现既有 delegate 缺失错误；本切片未更新 schema/migration/生成物。

Change Necessity: code-change，application 已有 ConfiguredModels 端口但缺真实 Prisma 适配器，纯文档/配置不能完成持久化行为。TDD Route: strict（父计划已有严格路线）。RED 先新增 `configured-model-repository.test.ts`，命令 `bun run vitest run packages/storage-prisma/src/configured-model-repository.test.ts` 因 `Cannot find module './configured-model-repository.js'` 失败；随后实现最小仓储，GREEN 同命令1文件4/4。单文件逻辑局限于映射/where/data；正式共享 Prisma 声明陈旧的已知边界由隔离生成客户端 harness 覆盖，不运行共享 generate。

## Transport Provider 与操作收据切片

续作父计划 C：当前 transport 无 Provider 方法，操作收据只在 application 私有校验，无法作为受支持 HTTP 客户端消费。Change Necessity: code-change。最小范围：contracts/provider-model、index/导出快照/MODULE/测试；application/query 改用同一收据 schema；新 transport client-provider-models.ts/测试，SourcesClient 继承接入和 MODULE；API 合同与本篇。既有公开类型名保留为共享类型的再导出，无新兼容分支。内部重复校验所有权迁往 contracts，校验语义逐字保持；无持久化删除或外部破坏。TDD Route: strict（沿既有决定）；测试先验证分页/路径编码、收据与Provider二选一响应、凭证写入一次、未知结果不重发、固定错误与显式恢复。单文件预计均低于300行，独立资源分册使用唯一request管线；不加新fetch、重试、后台轮询或凭证缓存。写入幂等键由调用方显式传入；浏览器由原生Origin，非浏览器沿fetch注入提供可信头，不自动推导信任。仅注入fetch离线测试，不运行数据库/生成器/迁移/正式服务/Provider。验证：新合同/客户端测试先RED，再相关contracts/application/query/API控制器/transport入口聚焦回归、strict NodeNext tsc、docs:check和diff --check。

## 正式 API 模块装配切片

本轮生命周期为实现/聚焦验证；用户明确批准 model-configuration.module.ts/测试、model-configuration-trust.ts/测试、AppModule 局部、storage-prisma index/入口测试/MODULE、API 合同及本篇。父计划 C，目标让已有凭证与安全查询控制器注册到产品 API，复用既有 Prisma/SecretStore/可信根。验收：独立模块可用注入桩启动且不会自行创建存储；缺失/非法信任配置拒绝新写，合法精确 Origin/authority 才放行；存储公共导出集合与消费者一致。新增 COSMOS_MODEL_CONFIGURATION_AUTHORITIES 为逗号分隔精确 Host 白名单，沿用单个 COSMOS_ALLOWED_ORIGIN；不从请求或 forwarded 推导。Change Necessity: code-change；设计遵循既有显式信任与单一存储所有者合同，不改 schema 或调用协议。TDD Route strict。验证命令为 `bun run vitest run apps/api/src/model-configuration-trust.test.ts apps/api/src/model-configuration.module.test.ts packages/storage-prisma/src/entry-contract.test.ts apps/api/src/model-configuration-body-parser.test.ts apps/api/src/model-provider-write.controller.test.ts apps/api/src/model-provider.controller.test.ts`，再局部 strict tsc、docs:check、diff --check。所有 HTTP 为临时127.0.0.1端口和注入桩，不运行 AppModule/正式服务、数据库/迁移/共享生成器/真实凭证/Provider；仓储共享客户端陈旧类型限制仍保留。

RED：新模块/trust测试因模块缺失失败，入口测试因缺三个值导出失败；实现后上述6文件8/8通过。模块测试使用注入桩，GET列表、非法Origin 403、合法Origin缺幂等键400、合法重传202查询既有操作且不调用save；无默认库初始化。正式AppModule源码局部接入复用 cosmosRepository.prisma/secrets/roots.dataRoot，不创建第二存储客户端。局部strict命令 `bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --experimentalDecorators --emitDecoratorMetadata --types node apps/api/src/model-configuration.module.ts apps/api/src/model-configuration.module.test.ts apps/api/src/model-configuration-trust.ts apps/api/src/model-configuration-trust.test.ts` 通过；补重传断言后曾因测试对象 kind/state 被推宽为 string 出现 TS2322，给合成收据显式标注 ModelProviderOperationSnapshot 后复核通过，不改生产类型。独立只读审查未发现可证实阻断问题，确认共用存储 owner、保守信任解析、独立模块无存储 I/O；证据不覆盖真实save/retry/跨进程/全局日志。已有 DATABASE_URL 可独立覆盖数据库地址，而 key/lock 仍取 dataRoot；多实例共库必须共用同一可信数据根，此部署约束不由同进程桩测试证明。完整AppModule依赖图类型、正式服务、全局日志整链、浏览器未运行；共享Prisma客户端未生成，不将局部类型证据扩张为正式装配已运行。最终聚焦回归仍为6文件8/8；docs:check 检查1085文件零失败，git diff --check通过。审查后的部署约束已同步API合同。下一切片为 transport 的 Provider/操作查询与显式写入客户端；模型CRUD/删除恢复、发现/Responses、UI/Connection 与 Worker @2仍未完成。

## 正式入口请求体解析切片

用户批准仅新增 `apps/api/src/model-configuration-body-parser.ts` 和测试、局部修改 `apps/api/src/main.ts` 及本篇。目标：指定配置POST/PATCH/retry绕过通用JSON/form解析，在控制器先校验原始头和字节；普通API仍使用Nest的JSON和extended表单解析。启动入口显式关闭默认parser并调用helper；不注册新控制器，不运行正式服务/默认库/迁移/Provider。不增加依赖、不读取第三方实现。TDD Route strict：测试首次因helper模块缺失无法收集，属于缺失实现RED；实现后临时HTTP模块验证通过，继续扩展三种路由、大小写/尾斜杠/query回归。未声称正式产品入口已运行。

最终命令 `bun run vitest run apps/api/src/model-configuration-body-parser.test.ts apps/api/src/model-configuration-body-reader.test.ts apps/api/src/model-provider-write.controller.test.ts`：3文件4/4通过。`bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --experimentalDecorators --emitDecoratorMetadata --types node apps/api/src/model-configuration-body-parser.ts apps/api/src/model-configuration-body-parser.test.ts`通过。`git diff --check`通过。类型证据只覆盖helper与测试，不代表main全依赖图或共享Prisma类型已通过；正式服务、全仓、浏览器未运行。helper保留Nest原生parser实现，只在现有三个凭证路由排除，未增加fallback；后续新增原始流路由需同步路由匹配和测试。正式模块的受信Origin/Host与storage导出仍是下一切片，不由本次解析接入完成。

## HTTP 与隔离真实存储验收

用户通过切片选项明确批准新增 `apps/api/src/model-provider-storage-integration.test.ts`、同目录 fixture 和本记录，以及入口 `bun run vitest run apps/api/src/model-provider-storage-integration.test.ts`。仅新建 task39-provider-http 隔离根，冻结当前41迁移与相关源码哈希，独立客户端生成、迁移和严格编译，临时Nest模块绑定127.0.0.1随机端口；不改共享客户端或正式AppModule。所有凭证为合成值，清理故障和发布前版本竞争由测试注入，实际事务、文件存储及原生锁仍走生产源码。保留失败/成功根，不清理真实数据，不外呼Provider。当前状态：隔离整链已通过；独立审查指出锁互斥证据需补强后，新增同操作并发句柄拒绝和释放后重获断言，最终复跑通过。

新鲜入口命令 `bun run vitest run apps/api/src/model-provider-storage-integration.test.ts`：1文件1场景通过（20.36秒）；场景内覆盖创建/真实合成key落盘、替换与旧key删除、留空保留、重复请求无额外写入、真实CAS发布冲突首次409/重传202/按ID和幂等键查询一致、已发布清理失败503/显式retry完成、FK检查。生成、41迁移migrate deploy、strict NodeNext装饰器编译均在独立子进程成功。保留根 `.agent/tmp/task39-provider-http-SqKFpt`，已读取verification.json结果passed。网络计数0仅来自fixture的fetch目的地拦截，不能声称系统级网络审计；CLI使用离线环境和不可达镜像/代理，无真实Provider调用。临时服务正常关闭，Prisma断开，测试根保留。

`bun run docs:check`1079文件零失败，`git diff --check`通过。前一51项聚焦回归见下，不把它描述为本次重跑。测试复制当前源码，仅改本地导入路径，哈希manifest记录源文件；不能替代正式AppModule、main body parser、全局拦截器/日志的产品装配验收。未运行全仓、浏览器或真实Provider；未生成共享Prisma客户端。下一产品装配需明确main中请求体读取器的接入、受信Origin/Host来源以及仓储/锁/SecretStore可信根注入，并先核对相关配置合同；当前仅只读检查，不扩大本次写集合。最终将fixture SHA-256纳入manifest后复跑同一入口，1/1通过（6.59秒），保留新根 `.agent/tmp/task39-provider-http-1jXbVv`，先前成功根也保留。

正式装配前已从代码确认：`apps/api/src/main.ts:35`默认启用Nest body parser，而凭证控制器必须使用原始流；`apps/api/src/app.module.ts:49`尚未登记新控制器。下一切片建议仅新请求解析装配helper/test、main局部、专用配置模块/test、AppModule局部和本篇，按准确批准范围推进。验证需包含指定路由绕过通用parser、其它路由仍正常解析、受信Origin/Host、原始key不进入全局日志以及无默认数据库初始化的独立模块契约；后续共享生成物和正式服务启动仍需分别披露，不能由本隔离测试推导授权。

独立只读审查未发现默认库/真实凭证访问路径；指出初始nativeLock字段仅为串行路径常量，不能证明互斥，已补同进程不同句柄争用返回operation_in_progress与释放后重获。最终同入口1/1通过（6.88秒），根 `.agent/tmp/task39-provider-http-EdSlxd`。该结果只证明本Node/Windows进程内争用，跨进程与Bun证明沿用独立锁测试历史，不由本场景重证。manifest是复制源码时的哈希清单，child不再次校验，不能描述为防篡改机制。迁移41项是冻结守卫，未来增加迁移需重审。测试根按授权保留；网络拦截范围仍仅global fetch。未引入生产抽象或fallback；本切片新增两份测试文件，单一源码所有者不变。正式装配仍待下一准确范围批准。

## 仓储持久化断言补强

本轮续作先补齐独立审查提出的两个有界缺口，仅编辑 model-provider-credential-errors.test.ts 和本篇：在cleanup_pending当下断言持久化行及安全查询均保留冲突原因，并让published恢复测试同时覆盖已有安全原因不会被新冲突覆盖。复用当前查询桩，不改生产合同、不生成客户端、不运行迁移/数据库/SecretStore/Provider。验收为两个冲突码的待清理历史和已发布历史保留；局部回归不能替代真实ORM整链。后续真实存储切片仍受单独执行授权约束。

新鲜聚焦回归 `bun run vitest run packages/storage-prisma/src/model-provider-credential-errors.test.ts packages/application/src/model-provider-credentials.test.ts packages/application/src/model-provider-query.test.ts packages/storage-prisma/src/model-provider-query-repository.test.ts packages/contracts/src/platform.test.ts packages/transport-http/src/client-platform.test.ts apps/api/src/model-provider-write.controller.test.ts apps/api/src/model-provider.controller.test.ts`：8文件51/51通过，其中仓储历史测试6/6。无生产逻辑修改，因此不制造预期RED；本轮补的是现有行为证据。`bun run docs:check`1077文件零失败，`git diff --check`通过；后者不覆盖未跟踪文件。本轮未重跑仓储类型检查，先前共享客户端缺新模型的限制仍有效，未运行全仓测试/构建/真实ORM/浏览器/外呼。HEAD仍d511d79，现有dirty均保留，未commit。

待确认的下一切片：新增独立 `apps/api/src/model-provider-storage-integration.test.ts` 与同目录 fixture；在新建 `.agent/tmp/task39-provider-http-*` 下冻结当前schema与41项迁移SHA-256、生成独立客户端并只对新库migrate deploy；复制并严格编译当前源码，Node本机127.0.0.1随机端口装配独立Nest模块。仅合成key和新FileSecretStore根/原生锁，验证创建、替换、重复请求、发布冲突首次/重传/查询一致及显式清理恢复，不注册AppModule、不改共享生成物。准确入口命令拟为 `bun run vitest run apps/api/src/model-provider-storage-integration.test.ts`；保留根和脱敏结果，不清理失败根，无Provider请求。迁移运行在获该切片明确授权前保持未运行。

## 重启续作：冲突原因持久化切片

本轮继续已批准的 Provider/model 计划。目标是使发布冲突经过补偿、恢复、查询和幂等重传后仍保留安全分类；核心文件为 credential port/service、Prisma credential repository、query schema 及对应测试。保留未知提交结果先回读、已发布状态优先、补偿失败继续待清理三个约束。不改 schema/migration，不运行数据库、真实 SecretStore 或 Provider 请求，不动 Task40、默认数据、备份、会话导出及 Git 生命周期。

Change Necessity: code-change。即时响应覆盖错误码不能修复持久化历史；canonical owner 为恢复/结算事务。最小修复是 recover 接收可选安全冲突原因，只在已提交 phase=registered 时记录；cleanupPending 保留该原因，settle(failed) 使用数据库原因，普通失败仍为 credential_write_failed。删除 application 即时响应覆盖，查询白名单接受两个安全码。cleanup_pending 的状态优先，errorCode 可保留原始冲突；无需新列或第二份状态。此路线修正了最初考虑给 fail 增加参数的方案，因为该方案无法覆盖先补偿失败、后恢复的场景。

TDD Route: strict（继承）。新增测试先得到4项预期失败：协调器未将冲突交给仓储，读取白名单拒绝两种安全码。首次启动因沙箱 esbuild spawn EPERM 未进入测试，扩大执行权限后复现。修复后四文件34/34通过；随后增加已发布阶段不写冲突原因的保护测试，最终结果见后续记录。本轮测试使用内存/查询桩与真实应用协调源码，未执行真实ORM。编辑前未先写入本节，现补记该流程偏差；不把其描述为事前记录。

最终聚焦命令 `bun run vitest run packages/application/src/model-provider-credentials.test.ts packages/application/src/model-provider-query.test.ts packages/storage-prisma/src/model-provider-credential-errors.test.ts packages/storage-prisma/src/model-provider-query-repository.test.ts apps/api/src/model-provider-write.controller.test.ts apps/api/src/model-provider.controller.test.ts packages/application/src/entry-contract.test.ts`：7文件40/40通过。应用/HTTP类型命令 `bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --experimentalDecorators --emitDecoratorMetadata --types node packages/application/src/model-provider-credentials.test.ts packages/application/src/model-provider-query.test.ts apps/api/src/model-provider-write.controller.test.ts`通过。仓储测试类型命令 `bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node packages/storage-prisma/src/model-provider-credential-errors.test.ts`失败：共享Prisma客户端缺modelProvider/modelConfigurationOperation（TS2339）；未生成共享客户端，不声称仓储类型通过。`bun run docs:check`1077文件零失败，`git diff --check`通过。全仓测试、构建、真实ORM、浏览器与Provider请求未运行。

独立只读审查未发现可证实逻辑缺陷；仍有证据边界：真实ORM首次save发布冲突→首次/重传/查询全链未测。审查建议的cleanupPending直接写入断言和published已有原因保留可后续补强，不冒充已验证并发数据库一致性。

## 下一切片：错误恢复线索合同

目标是保留服务端错误正文中的安全operationId。现有transport的CosmosTransportError.body已原样保留JSON，无需改请求管道；公共serviceErrorSchema尚未声明该字段，解析后会丢失。Change Necessity: code-change，canonical owner为contracts/platform.ts；新增可选白名单operationId，保留旧错误结构。验收为合同解析保留有效ID/拒绝非法ID、既有客户端错误对象保留body内恢复线索。文件仅platform.ts/测试、transport client-platform.test.ts和本记录；不注册模块、不访问数据库/SecretStore/外网。TDD Route: strict。

错误恢复合同验证：`bun run vitest run packages/contracts/src/platform.test.ts packages/transport-http/src/client-platform.test.ts`先RED：operationId被schema剥离（其余9项通过）。增加可选白名单字段后，`bun run vitest run packages/contracts/src/platform.test.ts packages/contracts/src/entry-contract.test.ts packages/transport-http/src/client-platform.test.ts packages/transport-http/src/entry-contract.test.ts apps/api/src/model-provider-write.controller.test.ts apps/api/src/model-provider.controller.test.ts`6文件15/15通过。`bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node packages/contracts/src/platform.test.ts packages/transport-http/src/client-platform.test.ts`通过。没有修改通用transport生产代码；此测试不代表Provider专用方法或浏览器恢复UI已实现。下一步仍需HTTP→隔离Prisma/FileSecretStore/原生锁整链，相关生成/迁移边界按现有授权门禁处理。
