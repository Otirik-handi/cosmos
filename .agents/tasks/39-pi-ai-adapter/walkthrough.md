# Task 39 Walkthrough：单独实现真实 pi-ai Adapter

> 后续产品配置扩展按顺序记录在[过程续篇：Provider/model](walkthrough-provider-model.md)；2026-10-22 及更早的过程记录已归档到[历史记录（一）](walkthrough-history-01.md)、[历史记录（二）](walkthrough-history-02.md)与[历史记录（三）](walkthrough-history-03.md)。本文件保留当前状态、未收口的问题与 2026-10-23 起的记录。

## 2026-10-15 及更早已归档

2026-10-08 至 2026-10-15 的接线、凭证合同、基线与隔离验收记录见[历史记录（一）：接线、凭证合同与基线](walkthrough-history-01.md)与[历史记录（二）：真实终端入口与隔离验收](walkthrough-history-02.md)。其中的结论仍有效，只是不再随本文件增长。

## 2026-10-22 的模型页诊断与修复已归档

2026-10-22 的五节记录（写信任未注入、发现请求体被提前消费、固定 lookup 与 Node `all` 约定不符、批量录入与重复模型 ID、草稿行与预算占位）见[历史记录（三）](walkthrough-history-03.md)。其中的结论仍有效，只是不再随本文件增长。

## 文档对齐：把「已实现」和「没实现」分开写（2026-10-23）

用户要求把工作区与 Task 39 声明逐项对账，对完账后指定先做三件事：修文档口径、把 API 默认端口变更独立记录、删掉游离文件。对账发现文档侧有五处互相矛盾的说法，以及三处「合同写了、代码没有」。

### 改动

1. `docs/api/0009-provider-model-configuration.md`：状态行从笼统的「已实现并通过隔离测试」拆成两段——已实现清单与未实现清单（Provider 删除、`GET /model-providers/:id/connections`、`409 in_use`、模型改删的路径形状）；路由表加「状态」列，逐行标「已实现 / 路径不同 / 未实现」，并注明 `PATCH`/`DELETE /model-providers/:providerId/models/:modelId` 是当前形状；错误码段落补 `credential_missing`（当前实现的一部分，原先没登记）并注明 `in_use` 目前没有任何代码会返回、删被引用模型会退化成 503。
2. `docs/api/README.md`：索引行从「Draft，尚未实现」改为「部分实现」并指向文内路由表。
3. `.agents/tasks/39-pi-ai-adapter/README.md`：Current State 里「无新增持久化、HTTP endpoint、Prisma migration 或第二 runtime」注明只描述 Adapter 历史切片；扩展段从「尚未开始业务实现」改为已落地/未落地两张清单。
4. `docs/requirements/0002-product-requirements.md`、`docs/architecture/0001-cosmos-foundation.md`：章节标题由「已接受、待实现」改为「已接受、部分实现」，正文补未落地项。
5. `docs/proposals/agent-provider-connection-credential-v1.md`：顶部取代声明由「（尚未实现）」改为「（部分实现）」。
6. `docs/spec/README.md`：Migration 顺序补上 `20261015000000_provider_model_configuration` 与 `20261018160000_workflow_activity_dispatch_fence`。
7. 新增 `docs/adr/0031-api-default-port-14310.md` 并登记到 `docs/adr/README.md`：把「开发编排、E2E、Compose、文档的 API 首选端口由 `4310` 改为 `14310`」记成正式决定，写明动因（`4310` 在本机常被 QQ 占用，导致文档端口与真实监听见不一致、并行栈探测竞态、Compose 发布冲突）、不变项（顺延逻辑、Web `3000`、Worker Admin `9091`）与 Revisit Gate；`docs/spec/operations/0002-development-runtime.md` 的端口段落加了指向该 ADR 的链接。
8. 删除 `packages/application/src/secret-store.js`（11 字节，内容只有 `export {};`，是 tsc 误生成的游离文件）。

### 验证

- `bun run docs:check`：`{"failures": [], "checkedFiles": 1145}`。
- `git diff --check`：退出 0（`docs/adr/README.md` 曾因末尾空行报 `new blank line at EOF`，已修）。
- `python scripts/size-governance.py --check --baseline docs/doc-governance/docs-baseline.json`：本次编辑/新增的文件无体积告警；整体仍 FAIL，全部是既有超限文件。

### 偏差与边界

- 本轮只改文档与删除一个游离文件，**没有补任何实现**。三处「合同写了、代码没有」仍是缺口：Provider 删除、`GET /model-providers/:id/connections`、`409 in_use`（删被引用的模型仍会得到 503）。
- 模型改删的路径与合同不一致这件事，只做了标注，没有决定改实现还是改合同。
- 端口变更当初没有走 Task 记录，ADR-0031 是事后补记；`4310` 仍出现在测试夹具的 `baseUrl` 字面量里（那是任意主机值，不是默认端口，未改）。

## Provider 删除与被引用删除的冲突码（2026-10-23）

对账列出的三处「合同写了、代码没有」，用户评估后决定做两项、砍一项：补 Provider 删除，并把「删除被引用的模型」从 503 改成明确的引用冲突；「编辑 Provider 前查询受影响连接」不新增服务端端点，改由界面用连接列表与模型列表自行 join。

### 改动

1. `packages/application/src/model-provider-removals.ts`（新增）：`ModelProviderRemovals.remove(providerId, expectedVersion)` 校验入参后调仓储；行删成功后按返回的 `secretRef` 删除本地凭证，删除失败只记日志（行已删即删除成功，残留文件是可清理垃圾）。错误码在 `not_found`/`in_use`/`version_conflict`/`operation_in_progress` 之外一律折成 `dependency_unavailable`。
2. `packages/storage-prisma/src/model-provider-removal-repository.ts`（新增）：单事务内按 `not_found` → `version_conflict` → `operation_in_progress` → `in_use` → 删模型 → 删 Provider 的顺序判定。引用检查必须与删除同事务，否则会放过检查之后新建的连接。
3. `packages/storage-prisma/src/configured-model-repository.ts`：`delete()` 把外键 `P2003` 翻成 `{code:"in_use"}`。原先它会落到 `safeFailure` 的兜底分支变成 503「稍后重试」，而只要那条连接还在，重试永远不会成功。
4. `packages/application/src/configured-models.ts`、`apps/api/src/configured-model.controller.ts`、`apps/api/src/model-provider-write.controller.ts`：错误码与 409 映射加 `in_use`；后者新增 `DELETE /api/v1/model-providers/:id`（body `{expectedVersion}`、需要 Idempotency-Key、204 空响应体）。
5. `apps/api/src/model-configuration-body-parser.ts`：Provider 顶层路径的原始体登记从「仅 PATCH」扩到「PATCH 或 DELETE」。漏掉 DELETE 会重演发现路由那个 bug——请求体先被通用 JSON 解析器读光，控制器只能返回 `invalid_input`。
6. `apps/api/src/model-configuration.module.ts`、`apps/api/src/app.module.ts`：新增 `COSMOS_MODEL_PROVIDER_REMOVALS` 端口与真实装配（仓储 + `prisma` + `secrets` + 清理失败日志）。
7. `packages/transport-http/src/client-provider-models.ts`：`deleteModelProvider(providerId, expectedVersion, idempotencyKey)`。
8. `apps/web/src/components/cosmos/model-provider-panel.tsx`：Provider 行加删除按钮 + 确认框；被引用时把 `in_use` 的原因留在列表上方（常驻），因为用户要照着它去改连接。编辑框在能算出受影响连接时提示「有 N 个连接正在用这个服务商的模型」，数字由界面 join 连接列表与模型列表得到。`provider-model-draft.ts` 的 `WriteFailureNotice` 加 `inUse`，两个模型的删除提示文案同步。
9. 文档：`docs/api/0009-provider-model-configuration.md` 路由表把 Provider 删除标为「路径不同」并写明实际形状，状态段与 `docs/api/README.md`、`docs/architecture/0001-cosmos-foundation.md`、`docs/requirements/0002-product-requirements.md`、`docs/proposals/agent-provider-connection-credential-v1.md`、本 Task README 的已落地清单同步。

### 验证

- `bun run vitest run apps/api apps/web scripts packages/application packages/storage-prisma packages/transport-http`：158 文件 / 842 用例，先因 `entry-contract` 冻结清单失败一次，补清单后全绿。
- 真实 sqlite 集成：`packages/storage-prisma/src/model-provider-removal-integration.test.ts`（42 迁移、隔离根）覆盖「被引用拒绝、版本过期、删除后外键干净」。
- HTTP 级：`apps/api/src/model-provider-write.controller.test.ts` 新增一轮用例，断言 204 空响应体、`in_use` 409、越权 Origin 403、缺幂等键与多余字段 400。
- `bun run --cwd apps/api typecheck`、`packages/{application,storage-prisma,transport-http}` 与 `apps/web` 的 `tsc --noEmit` 全部退出 0。

### 偏差与边界

- Provider 删除是同步 `DELETE` + 204，不是合同原设计的 202 OperationSnapshot。契约表按「路径不同」标注，改回需要单独决定。
- 没有做「编辑 Provider 前查询受影响连接」的端点，改用界面聚合；它只是提示，不构成服务端保证。
- 删除只清理本地凭证副本，不撤销服务商侧的 key；这一点与既有合同一致。
- 改这一轮时踩过一个工具坑：用 PowerShell 的 `Get-Content`/`Set-Content` 管道改含中文的源文件会把 UTF-8 写成 GBK 乱码（PowerShell 5.1 按系统代码页解码）。`model-provider-panel.tsx` 从 `HEAD` 取回，`provider-models-section.tsx` 从压缩记录里取回后重放当天的改动。含中文的文件只能用编辑工具或 node/ts 脚本按 `utf8` 读写。

## 第二轮对账与 0009 收口（2026-10-23）

用户要求在上一轮改动生效后再次对账。结论：实现本身对得上，文档系统落后于实现。用户指定先修第 1 项，即 `docs/api/0009-provider-model-configuration.md` 自身的前后矛盾。

### 改动（只动 0009）

1. 状态图例从三种扩到四种（已实现 / 路径不同 / 不实现 / 已退役）：表里本来就有「已退役」行，图例却只声明三种。
2. 路由表补两行已在服务、表里却没有的路由：`GET /model-providers/:id/models/:modelId`、`GET /model-configuration-operations/by-key/:key`（后者原先只在正文被顺带提过）。
3. `in_use` 统一为「事务内检查引用后返回 409，不会退化成可重试的依赖错误」：原文说「当前没有任何代码会返回它、会退化成 503」，而上一轮恰好改成了 409，同文件另一处又写着会返回。
4. 冲突响应承诺的「返回至多 100 个受影响连接 id/name 与 hasMore」标注为未实现：实际错误体只有 code/message/retryable 与可选 operationId。
5. Provider 删除段落重写：原文是「CAS 标记 deleting + 登记操作 + 保留操作收据」，实际是同步单事务——校验版本、确认无进行中写操作、检查引用，通过后删模型与 Provider，提交后再删本地凭证文件；被引用时整体拒绝、不做部分删除。
6. 崩溃窗口表删掉「删除已标 deleting」一行，并说明同步删除没有可恢复中间态、所以不占一行。
7. 受影响连接段落改为如实描述：界面用 `GET /connections` 与模型列表自行 join，没有专门端点，且只是当时快照、不是锁。
8. 末段「两个路由未注册」改为「Provider 读写与删除、操作查询（含 by-key）与重试、同步发现、模型读写均已注册；受影响连接查询不实现」。
9. `ProviderSnapshot.state` 与 `invalid_model_selection` 注明 `deleting` 只存在于 schema、生产代码不写入（只有测试夹具造它），判定条件按「模型不存在或所属 Provider 不是 active」表述。
10. 发现协议段改为实际行为：不按 `api` 类型分支，两种协议都请求同一个 `GET <baseUrl>/models`；受控 HTTPS transport 段从「首阶段范围」改为指向 `packages/application/src/provider-model-directory-https.ts` 与其合成测试。
11. 顺手修两处文字错误：`COSMOS_ALLOWED_ORIGIN` 示例 `4300`→`3000`；「不发生成请求」→「不发起生成请求」。

### 验证

- `bun run docs:check`：`{"failures": [], "checkedFiles": 1150}`；`git diff --check`：退出 0（仅 `packages/contracts/src/agent.test.ts` 的既有 CRLF warning；0009 是未跟踪文件，不参与该检查）。
- `python scripts/size-governance.py --check --baseline docs/doc-governance/docs-baseline.json`：0009 无体积告警（23219 字节，健康区）；本次拆分后 `walkthrough.md` 13018 字节、`walkthrough-history-03.md` 18322 字节，均在健康区。
- 核对方式：路由表对照装饰器扫描得到的 14 条注册路由；`in_use` 与 `deleting` 对照 `packages/storage-prisma/src`、`packages/application/src` 的写入点（`deleting` 只在测试夹具中被写入）。

### 偏差与边界

- 只修 0009，第二轮对账的第 2~4 项（规格缺三张表与客户端方法、PROJECT-STATUS 与 spec 索引过期、浏览器验收缺失）未动。
- 路由表仍按「目标形状」写，靠「路径不同」状态与正文说明当前实际路径；改成当前形状会丢掉设计意图，需单独决定。
- 0009 仍是未跟踪的 Draft，本轮没有改变它的跟踪状态。

## 补规格覆盖缺口（2026-10-23）

第二轮对账的第 2 项：实现早已在跑，四份规格却完全没提 Provider/model 配置。用户指定先做这一项。只改文档，不动代码。

### 改动

1. `docs/spec/storage/0001-prisma-repository.md`：「状态与持久化」表补 `ModelProvider`、`ConfiguredModel`、`ModelConfigurationOperation` 三行，`ConnectionInstance` 行补 `modelId`/`version` 与模型型连接说明；「状态转换」补 CAS 与操作收据的状态；「错误与降级」写明 P2002→`already_exists`、P2003→`in_use` 两个例外；「实现与测试锚点」补六个仓储文件与六个隔离测试；migration 顺序补两条；「最后更新」改为 2026-10-23。
2. `docs/spec/interfaces/0004-http-client.md`：新增「Provider/model 配置方法」表，逐行列出 14 个客户端方法与它们的 path、header、成功 schema，并写明 `deleteModelProvider`/`deleteConfiguredModel` 用 `DELETE` + 204、`createModelProvider`/`updateModelProvider` 按 201/202 分流、发现失败也返回 200 快照；补一条「写入受本机信任门限制，403 不是可重试错误」；「依赖」补 provider/model schema；「重建验收」加第 7 条；「实现与测试锚点」补两个 client 文件与测试。
3. `docs/spec/interfaces/0002-product-api-http.md`：新增 `### Model provider 配置` 一节，14 条路由一行一条，写明哪些返回 201/202/204、哪几类 409，以及信任门与「新增写路由必须同时登记原始 body」这条维护约束；`### 409` 补 `already_exists`/`in_use`/`version_conflict`/`operation_in_progress` 四类；「其它错误」前补 403 `forbidden_origin` 与 413；「实现与测试锚点」补四个控制器与信任门/body 读取文件；「非目标/边界」写明 Provider 删除是同步 204、受影响连接查询不实现。
4. `docs/spec/contracts/0001-public-contracts.md`：新增「Provider/model 配置 DTO 与命令」整条，覆盖 `api` 枚举、`baseUrl` 的离线语法约束（https、无 userinfo/端口/query/fragment、主机名含点、非 localhost/IP）、四个 Provider schema、四个模型 schema、发现侧三个 schema 与独立错误码枚举；「实现与测试锚点」补 `provider-model.ts` 与它的测试。
5. `docs/spec/README.md`：索引表补 `Pi-ai Adapter`（`application/0011-pi-ai-adapter.md`，此前这份规格没有任何索引行）与 `Model Provider 配置` 一行；第 15 条的「已接受但尚未实现」改为「已接受且部分实现」，写明 `agent.invoke@1` 与 fake adapter、`agent.invoke@2` 已落地，真实 Harness/Artifact/Workspace/Knowledge/Research 仍未实现。

### 验证

- `bun run docs:check`：`{"failures": [], "checkedFiles": 1151}`；`git diff --check`：退出 0。
- `python scripts/size-governance.py --check --baseline docs/doc-governance/docs-baseline.json`：三份被编辑的 spec 都在基线登记内，脚本对「基线内文件增长」只报 warning，不阻塞。
- 字段与行为全部对照源码写，没有凭记忆：schema 取 `packages/storage-prisma/prisma/schema.prisma:96-171`，DTO 取 `packages/contracts/src/provider-model.ts` 全文，客户端方法取 `client-provider-models.ts` 与 `client-configured-models.ts` 全文，路由取四个控制器的装饰器。

### 偏差与边界

- 编辑后三份 spec 继续变大：storage 55.5→59.5 KB、0002 52.8→58.6 KB、contracts 50.6→53.8 KB。它们本来就在 50 KB 红线之上（登记在 `docs/doc-governance/docs-baseline.json`），本轮只能保证内容正确，没有做拆分——那需要单独一轮并按分册规则切。
- `docs/spec/interfaces/0005-web-client.md`（70 KB，也是基线内超标文件）没有补模型页交互契约，只在路由清单里提过 `/models` 一句；补它会再推高一个已超标的文件，留给拆分那一轮一起做。
- 本轮没有改任何代码，也没有新增或修正任何实现行为。

## 状态文件与索引改口（2026-10-23）

第二轮对账的第 3 项。前两轮已经把 0009 和四份规格补齐，但仓库的「当前能力」入口还停在 Task 38 之前的说法：`PROJECT-STATUS.md` 全文没有 Task 39 这一条，`docs/spec/README.md` 第 15 条把 Agent Invocation 整条列在「不得推断成当前能力」的清单里。

### 改动

1. `PROJECT-STATUS.md`「当前下一步」新增 Task 39 条：写明已交付的真实 SDK 适配（@1 部署 profile、@2 按连接选模型）、模型页背后的三个模型与两条 migration、14 条 Product API 路由、信任门、凭证协调、模型型 Connection 单选与 Worker 消费；同时点明「真实 Provider 仅一次隔离最小请求」与四项未完成（模型页与选模型无浏览器验收、@1 与旧 profile 退出需真实服务验收、Provider 删除是同步 204 而非 202 收据、受影响连接由界面聚合）。
2. 同一文件的 Task 38 条：把这句「真实 `pi-ai` Adapter……另开后续 Task」改成「已由 Task 39 承接交付」，避免读者按原文去找一个不存在的后续 Task。
3. 同一文件的 Phase 3 入口状态：由「真实 `pi-ai` Adapter……仍未实现」改为「已由 Task 39 交付」，并把「下一步需单独创建真实 `pi-ai` Adapter Task」删掉——那件事已经做完。
4. `docs/spec/README.md` 第 15 条：这条例在「不得推断成当前能力」的清单里，原文把 Agent Invocation 整体列为未实现，与 @1/@2 已落地的事实冲突。改为只列真正未实现的部分（真实 Harness、产品 Artifact、Workspace、Knowledge、Research），并把 `agent.invoke@1`／`@2` 与 fake adapter 明确标成「已落地，属于当前实现」。

### 验证

- `bun run docs:check`：`{"failures": [], "checkedFiles": 1151}`；`git diff --check`：退出 0。
- `PROJECT-STATUS.md` 落在健康区：28325 字节 / 8994 token（网关是 ≤30 KB 且 ≤9000 token）。第一版写完是 9.1k token 被 `size-governance.py` 判为警戒区，删减了三轮才压回线下——这个文件原本就贴着 token 上限（HEAD 版本 8792 token），加一整条 Task 39 只有约 200 token 的余量。
- `docs/spec/README.md` 的新条目仍指向 `ADR-0030`、Task 38 与 Task 39，三个链接都没有断。

### 偏差与边界

- `PROJECT-STATUS.md` 的余量已经用尽。再加任何一条「已完成/R 进行中」的记录都会再次越过 9k token，正确做法是把更早的完成记录挪进 `PROJECT-STATUS/history-*.md`（该目录已有 10 份分册，且 `docs/README.md` 写明 PROJECT-STATUS 只维护「当前」状态）。
- 只改了口径，没有新增验收证据：模型页与连接选模型的浏览器验收依然缺失，本轮的措辞按「未完成」如实写，没有借文档改写把它变成已完成。
- `docs/spec/interfaces/0005-web-client.md` 的模型页交互契约仍未补（原因见上一节）。

## Task README 的 Non-goals 与扩展段冲突（2026-10-23）

第二轮对账的第 4 项。`README.md` 的 Scope / Non-goals 是 Adapter 历史切片的边界，扩展段在其后另开一节；两份内容并列放着，读起来像互相否决。

### 改动

`.agents/tasks/39-pi-ai-adapter/README.md` 的两条 Non-goals 加了限定：

- 「不新增数据库/migration」→ 括注「仅指 Adapter 历史切片：Provider/model 扩展已新增两条 migration，见下方扩展段」。
- 「不新增 Product HTTP API、Web 配置页面或模型管理 UI」→ 括注「同样仅指 Adapter 历史切片：Provider/model 扩展已有 Product API 与模型页」。

没有删改任何一条 Non-goal 本身，也没有把扩展段的内容塞回 Scope——两条历史边界在 Adapter 范围内仍然成立，只是不再被读成对扩展的否决。

### 验证

- `bun run docs:check`：`{"failures": [], "checkedFiles": 1151}`；`git diff --check`：退出 0。
- `rg` 复查全目录：`不新增 Product`、`不新增数据库`、`不新增持久化` 只剩 README 的这两条带括注的行与 walkthrough 自己的记录，没有残留的裸声明。

### 偏差与边界

- 这仍是「加限定」而不是「重写边界」：如果后续想给 Adapter 切片和 Provider/model 扩展各写一份独立 README，需要单独一轮。
- `walkthrough-provider-model.md` 里那句「ADR 等代码落地后再修订、不新建重复 ADR」记录了当时的决定，但 provider/model v2 至今没有对应 ADR；这属于另一处缺口，本轮没有处理。

## 模型页与删除的浏览器验收（2026-10-23）

补 E 切片缺的那一格：`walkthrough-provider-model.md` 要求「实际浏览器验证：桌面/平板、键盘/标签/焦点、错误恢复、console/pageerror，所有 Provider 流量模拟」。此前 `e2e/` 里没有任何模型页用例，实验室虽然注册了 `model-provider-panel` 与 `provider-models-section` 两个场景，但从未在浏览器里跑过。

### 改动

- 新增 `e2e/component-lab/model-configuration.spec.ts`（10 个用例）：服务商行与徽章、展开模型区与草稿行、创建不落 key、编辑留空保留 key 与受影响连接、发现弹窗多选追加、被引用删除的常驻原因、删除成功走 toast、空态、键盘可达、1024 px 平板视口。全部用例断言 `console.error` 与 `pageerror` 为空。
- 夹具补两个场景能力：`renderModelProviderPanelLab` 的 `state` 增加 `conflict`，用 `modelPanelConflictClient` 让 `deleteModelProvider` 抛 409 `in_use`；`modelPanelLabMethods` 补 `deleteModelProvider` 与 `listConnections`（编辑框要 join 连接列表算受影响连接数）。`registry/definitions-cosmos.tsx` 同步登记 `conflict` 场景。

### 一个真实的缺口：实验室场景本来就渲染不出来

`ModelProviderPanel` 顶部无条件调用 `useToast()`，而 `/dev/components` 不在 `(shell)` 或 `(reading)` 路由组下——`ToastProvider` 只挂在那两个组的 layout 里，根布局没有。Base UI 的 `useToastManager()` 在没有 Provider 时直接抛错，所以这个场景一进页面就崩。

实测证据：临时去掉包装后跑 `renders a provider row…`，失败信息是 `expect(locator('[data-component-lab-preview]')).toHaveCount(1)` 收到 `0`——整个预览台都没渲染出来，不是渲染出一个空面板。恢复包装后 10/10 通过。夹具现在用 `<ToastProvider>` + `<ToastHost>` 包住面板。

### 验证

- `bun run test:browser:component-lab model-configuration`：10 passed。
- `bun run test:browser:component-lab`（全量 40 个）：40 passed，`registry.test.ts` 与其余六个 spec 未受影响。
- `bun run vitest run apps/web`：21 文件 / 146 用例通过（含组件实验室注册表完整性 12 项）。
- `bunx tsc --noEmit --incremental false -p apps/web/tsconfig.json`：退出 0；`bun run lint:web`：0 errors / 19 warnings（既有）。
- e2e 目录没有独立 typecheck 脚本；用临时 `moduleResolution: "bundler"` 配置跑 `tsc`，新 spec 无错误，唯一报错是既有 `source-form.spec.ts:157` 的 `requestAnimationFrame` 类型。

### 偏差与边界

- 这仍是实验室夹具验收：没有 API 服务参与，写入路径走的是 stub client，所以它证明的是「界面按合同渲染与交互」，不能替代真实服务验收，也不能替代「真实 Provider 外呼」。
- 键盘用例只断言「打开→Esc→关闭」与「焦点没被困在已卸载的对话框里」。没有断言焦点落回触发按钮：读取期间「正在读取上游模型列表…」会把该按钮短暂禁用，禁用元素不能持有焦点，恢复目标不稳定。
- 选模型（`connection-panel` 的模型单选）本轮没有新增用例——那个交互已有 `connection-model-selection.test.ts` 的单元覆盖，浏览器侧仍缺。
- 模型夹具拆到了 `apps/web/src/component-lab/model-fixtures.tsx`：加完本轮夹具后 `product-fixtures.tsx` 到了 50.42 KB，越过单文件红线。拆完 45.60 KB / 1255 行，**仍在红线内**——但这个文件在 `HEAD` 就是 45.19 KB / 1245 行（`.worktrees` 里那份 HEAD 快照同为 45.19 KB），属既有违规；真正修复要按域拆 connection/story/board 三组，另开一轮。
