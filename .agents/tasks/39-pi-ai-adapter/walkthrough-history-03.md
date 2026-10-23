# Task 39 历史记录（三）：模型页产品入口的诊断与修复（2026-10-22）

> 由 `walkthrough.md` 按文档大小治理拆出；内容原样保留，不重写。当前状态与未收口的问题仍在[`walkthrough.md`](walkthrough.md)。

## 产品入口保存失败：写信任未注入（2026-10-22）

用户报告「添加服务商」保存失败（`https://api-slb.jiji.cc/v1` + OpenAI Responses，同一配置在 dsh 里可用）。诊断结论与修复如下。

### 诊断（只读，含运行证据）

- `.cosmos/logs/api.jsonl` 三次 `POST /api/v1/model-providers` 均为 `status:403`，同一时段 `GET /api/v1/model-providers` 为 200：请求到达 API，不是网络或上游问题。
- 对运行中的 `127.0.0.1:14310` 直接探测：`GET /healthz` 200；带 `Origin: http://localhost:3000` + `Host: localhost:14310` 的 POST 返回 `403 {"code":"forbidden_origin"}`。
- 用 bun 直接执行 `resolveModelConfigurationTrust({})` 得到 `{origins:[],authorities:[]}`；补上两个变量后得到完整集合。同一方式执行 `assertModelConfigurationWrite` 复现 `forbidden_origin` 与 `allowed`。
- 根因：运行中的 API 没有 `COSMOS_ALLOWED_ORIGIN` 与 `COSMOS_MODEL_CONFIGURATION_AUTHORITIES`。`bun run dev` 会注入，`bun run dev:api`（`scripts/dev-service.ts`）此前只注入端口，于是写信任集合为空，所有模型配置写入 403，读取不受影响。
- 界面把 403 归入 `unavailable`，所以显示成「网络、基础地址或上游服务暂时不可用」，把用户引向了 Provider 配置。

### 修复（用户批准的三项）

1. `scripts/dev-port.ts` 新增 `withApiTrustEnvironment(environment, apiPort, webPort)`，由现有两个 helper 组合；`scripts/dev-service.ts` 的 api 分支改用它，Web 端口取 `COSMOS_WEB_PORT` 或默认 3000。信任合同未放宽：仍是显式单 Origin + 精确 Host 列表，不从请求头推导。
2. `apps/web/src/components/cosmos/provider-model-draft.ts` 的 `writeFailureNotice` 识别 `forbidden_origin` 并返回新增的 `forbiddenOrigin`，`models.ts` 与两个面板的文案映射补齐该键；提示改为指向来源白名单，不再误导到网络。
3. `.env.example` 补 `COSMOS_MODEL_CONFIGURATION_AUTHORITIES` 并写清两个变量的精确匹配要求、`dev`/`dev:api` 自动注入与手工部署需显式设置。
4. 同步合同：`docs/api/0009-provider-model-configuration.md` 第 115 行记录自动注入行为与 `403 forbidden_origin` 的界面口径。

### 验证

- `bun run vitest run apps/web/src/components/cosmos/provider-model-draft.test.ts scripts/dev-port.test.ts apps/api/src/model-configuration-trust.test.ts`：3 文件 / 25 用例通过；`403 forbidden_origin` 由断言 `unavailable` 改为 `forbiddenOrigin`。
- `bun run vitest run apps/web`：21 文件 / 140 用例通过。`bun run vitest run scripts`：3 文件 / 24 用例通过。
- `bunx tsc --noEmit --incremental false -p apps/web/tsconfig.json` 与 `bun run --cwd apps/api typecheck` 退出 0。
- `bun run docs:check` 1142 文件 0 失败；`git diff --check` 通过。
- `bun run lint:web` 退出 1：2 条 `react-hooks/set-state-in-effect` 错误（`provider-models-section.tsx:103`、`:108`）与 19 条既有警告，均非本次改动引入，未修。
- 未运行：全仓 `bun run test`、构建、浏览器验收、真实 Provider 请求、migration deploy。用户机器上运行中的 API 仍是旧环境，需要重启后才带上信任变量。

### 边界

- 只解决本地/开发启动路径。生产部署仍必须显式设置两个变量，缺失时写入照旧整体拒绝——这是合同，不是缺陷。
- 浏览器若用 `127.0.0.1:3000` 打开而白名单只有 `localhost:3000`，仍会 403，现在会显示来源未授权而不是网络故障。是否扩展为多 Origin 白名单需要改信任合同，未做。

## 产品入口获取模型列表失败：原始请求体被提前消费（2026-10-22）

用户报告 Provider 保存成功、点「获取模型列表」失败；同一 Provider 与 baseURL 在 dsh 中能取到列表。

### 诊断（只读，含运行证据）

- `.cosmos/logs/api.jsonl` 中四次 `POST /api/v1/model-providers/:id/discoveries` 全为 `status:400`、`durationMs` 0～1，同段 `GET .../models` 为 200：请求在本地就被拒，未发出上游调用。
- 用无 BOM 的 JSON 体对运行中 API 复现，得到固定的 `400 {"code":"invalid_input","message":"Model discovery rejected."}`；改为多余键、缺 content-type、非法 id 也都是同一 400，说明失败发生在能否读到请求体，而不是字段取值。
- 最小中间件探针（`.agent/tmp/probe-discovery-body.ts`，`.agent/` 已在 `.gitignore`）观察 `configureModelConfigurationBodyParsers` 之后的请求状态：`POST /api/v1/model-providers` 为 `readableEnded:false`（未被消费），`POST /api/v1/model-providers/x/discoveries` 为 `readableEnded:true` 且 `body` 已被通用解析器解析。
- 根因：`apps/api/src/model-configuration-body-parser.ts` 的写路径白名单只列了 `model-providers`、`model-providers/:id/models`、`model-configuration-operations/:id/retries` 等，漏掉 `model-providers/:id/discoveries`。该路由因此落入通用 JSON 解析器；控制器随后 `readModelConfigurationBody` 发现流已结束，按 `invalid_input` 拒绝，界面显示为「获取模型列表失败」。
- 与 dsh 对照（`D:\Otirik\GitRepo\deepseek-harness`）：`packages/llm/llm-pi-ai/src/discovery.ts` 对非 Anthropic 协议同样取 `${baseURL}/models` 并带 `authorization: Bearer`，URL 与鉴权口径一致，差异只在本仓库的路由登记。

### 修复（用户批准的两处）

1. `apps/api/src/model-configuration-body-parser.ts` 的 POST 分支并入 `model-providers/:id/discoveries`，并加注释说明「漏登记会被报成 invalid_input」这一失效方式。
2. `apps/api/src/model-configuration-body-parser.test.ts` 增加 discoveries 用例（断言请求体能被原样读出），并补注释说明该断言防的是哪一处回归。

### 验证

- `bun run vitest run apps/api/src/model-configuration-body-parser.test.ts`：通过。回退第 1 处修改后同一用例失败（`201` 变 `500`），确认它是真实回归护栏。
- `bun run vitest run apps/api`：28 文件 / 136 用例通过。`bun run --cwd apps/api typecheck` 退出 0。
- 探针复跑：`discoveries` 现在 `readableEnded:false`，请求体不再被提前消费。
- 端到端（另起 `COSMOS_API_PORT=14399` 实例，验证后已停止）：合法请求体 + 不存在的 provider 返回 `404 not_found`（请求已进控制器与运行器）；非法请求体仍返回 `400 invalid_input`（控制器校验未被削弱）。
- 未运行：真实 Provider 的列表外呼（需要用户凭据且会产生外部调用）、浏览器点击验收。

### 边界与后续

- 上游响应形状尚未验证。本仓库 `packages/application/src/provider-model-catalog.ts` 只接受 `{ data: [...] }`；dsh 同时接受 `{ data: [...] }` 与 `{ models: {...} }` 映射。若该 Provider 回的是后者，修复本段后仍会报 `malformed_response`，届时需要单独扩展解析器——未做，等实际结果再决定。
- 用户机器上运行中的 API 仍是旧代码，需重启后才会走新的路由登记。

## 产品入口获取模型列表失败：地址固定 lookup 与 Node 的 all 约定不符（2026-10-22）

重启 API 后点击「获取模型列表」仍失败，界面提示「暂时连不上上游，可以稍后再试。」，后端日志 `POST /api/v1/model-providers/:id/discoveries` 为 `200`、`durationMs:5`。

### 诊断（只读，含运行证据）

- 200 + 5ms 说明请求已进控制器、返回的是失败快照；`durationMs` 5 毫秒不足以完成任何一次 TLS 握手，失败点在本地。
- 该文案对应 `failureReasons.unreachable`（`apps/web/src/copy/areas/models.ts:70`），来源错误码是 `dependency_unavailable`。
- 先排除 DNS 与地址审核：`api-slb.jiji.cc` 解析出 6 个 A 记录（`179.253.243.34`、`68.68.251.212`、`68.68.249.206`、`69.63.199.69`、`68.68.248.59`、`179.253.251.1`），全部通过 `isPublicAddress`；无 AAAA 记录。
- 分层探针（`.agent/tmp/probe-discovery-layers.ts`）把外呼拆成 DNS 审核 / TLS+HTTP / 完整 `requestModels` 三层，结果：地址审核全通过；TLS 层报 `ERR_INVALID_IP_ADDRESS`、`Invalid IP address: undefined`；完整 `requestModels` 在 2ms 内抛 `dependency_unavailable`。
- 调用约定探针（`.agent/tmp/probe-lookup-contract.ts`）记录 Node 实际传给自定义 `lookup` 的参数：`{"hints":0,"all":true}`；`process.version` 为 `v26.3.0`，`net.getDefaultAutoSelectFamily()` 为 `true`。
- 根因：`packages/application/src/provider-model-directory-https.ts` 的 `createNodeHttpsEgress` 里，自定义 `lookup` 固定以 `callback(null, address, family)` 回单个地址。Node 20+ 默认开启 `autoSelectFamily`，`net.connect` 会以 `all: true` 调用 `lookup`，此时回调必须给数组；只给单个字符串时 net 取 `address.address` 得到 `undefined`，抛 `ERR_INVALID_IP_ADDRESS`，被 `requestModels` 的 catch 统一包成 `dependency_unavailable`。任何 Provider 都无法获取列表，与具体上游无关。

### 修复

1. `packages/application/src/provider-model-directory-https.ts` 抽出 `createPinnedLookup(address, family)`：`options.all === true` 时回 `[{ address, family }]`，否则回单个地址。注释记录两种形状都只能出现已审核地址——不要把解析结果透传。
2. `packages/application/src/provider-model-directory-https.test.ts` 新增 `describe("createPinnedLookup")` 两个用例，直接断言回调参数形状（`{all:true}` → 数组；无 `all` → 单地址），不触网。

### 验证

- `bun run vitest run packages/application`：29 文件 / 211 用例通过；`tsc -p packages/application/tsconfig.json --noEmit` 退出 0。
- 回退验证：把 `options.all === true` 分支短路后，新用例失败（`expected '93.184.216.34' to deeply equal [ { address: '93.184.216.34', … } ]`），确认用例锁住了这处回归。
- `bun run vitest run apps/api`：28 文件 / 136 用例通过。
- 端到端真实发现（临时 API 实例，验证后已停止）：修复前 `status: failed`、`errorCode: dependency_unavailable`、25ms；`bun run build:application` 重建 `dist` 后重启实例，同一 Provider 得到 `status: succeeded`、3 个候选（`codex-auto-review`、`gpt-5.6-luna`、`gpt-6-luna`）、623ms。
- 顺带确认上游形状：该 Provider 返回 `{ data: [...] }`，`malformed_response` 那条潜在问题未发生，暂不扩展解析器。

### 边界与后续

- `apps/api` 的开发启动是 `node .../tsx watch src/main.ts`，解析 `@cosmos/application` 走 package exports 的 `import` 条件即 `dist/index.js`，不是 `src`。所以改 `packages/*/src` 后必须 `bun run build:packages`（本次只重建了 application），否则运行中的 API 仍是旧逻辑；而 `bun run dev` 只做 migrate，不构建 workspace 包。这是本轮第二个「改了却没生效」的陷阱，是否需要让 dev 前置构建或改用源码解析，属独立决定，未做。
- 通过本次真实发现写入的一条 discovery 快照留在默认数据根，属于验证副作用，未清理。

## 模型页批量录入与重复模型 ID（2026-10-22）

用户拿到候选列表后提出：候选要能在弹窗里勾选，勾完追加到下方表单；录入表单要能一次录多个模型；上下文窗口与输出上限要预填默认值。同时确认三件事——弹窗列全部候选（已配置的置灰）、保存语义是「追加」、并修掉重复模型 ID 的后端错误。

### 改动

1. `packages/storage-prisma/src/configured-model-repository.ts`：`create` 捕获 Prisma `P2002` 并转成 `already_exists`。这是 `@@unique([providerId, modelId])` 唯一权威判据；不翻译的话会退化成 503 `dependency_unavailable`，界面提示「稍后重试」而重试永远不会成功。
2. `packages/application/src/configured-models.ts`：`failure`/`safeFailure` 的 code 联合加入 `already_exists`，原样透传。
3. `apps/api/src/configured-model.controller.ts`：`codes` 映射 `already_exists → 409`。
4. `apps/web/src/components/cosmos/provider-model-draft.ts`：`emptyModelDraft()` 预填 `262144`/`32768`（两个预算在库里非空，「选填」只能做成预填默认值）；新增 `createModelDraftRow` 与 `modelRowCommands`，后者逐行校验、行内不合法即整批不提交、批内重复 modelId 标在行上、完全空着的行跳过；`writeFailureNotice` 识别 `already_exists` → `alreadyExists`；跨字段的「输出上限 > 上下文窗口」错误（合同 refine 在根路径）改落到 `maxOutputTokens` 输入框，不再静默失败。
5. `apps/web/src/components/cosmos/provider-models-section.tsx`：单行表单改为多行草稿卡片（每行可删、可加行、一次「全部添加」），串行提交，成功的行移出、失败的留在列表里标红并提示「已添加 N 个，M 个失败」。
6. `apps/web/src/components/cosmos/provider-model/discovery-dialog.tsx`（新建，放在 `provider-model/` 子目录）：发现结果的勾选弹窗，右上角关闭、每行一个复选框、右下角保存；已配置候选显示但不可勾选。放在子目录是因为组件实验室的公开模块清单守则（`apps/web/src/component-lab/registry.test.ts`）只登记 `components/cosmos` 顶层文件，而这是 `provider-models-section` 的内部配套件，不是独立公共模块——与既有 `components/cosmos/story-panel/` 的处置方式一致。
7. `apps/web/src/copy/areas/models.ts`：补批量录入、弹窗与 `alreadyExists` 文案，删掉因按钮改造而失去消费者的 `models.models.add`、`discovery.add`、`discoveryFillsId`。
8. `apps/web/src/components/cosmos/model-provider-panel.tsx`：两个 `Record<WriteFailureNotice, string>` 补 `alreadyExists`。
9. 测试：`provider-model-draft.test.ts` 增加默认值、跨字段错误落点、批量校验、空行跳过、`already_exists` 五个用例；`configured-model-repository.test.ts` 增加 P2002 → `already_exists` 与非 P2002 不吞两个用例；`configured-models.test.ts` 增加透传用例。

### 验证

- `bun run vitest run apps/web`：21 文件 / 145 用例通过。
- `bun run vitest run apps/api`：28 文件 / 136 用例通过；`bun run --cwd apps/api typecheck` 退出 0。
- `bun run vitest run packages/storage-prisma/src/configured-model-repository.test.ts packages/application/src/configured-models.test.ts`：12 用例通过。
- `tsc --noEmit --incremental false -p apps/web/tsconfig.json`、`-p packages/storage-prisma/tsconfig.json`、`-p packages/application/tsconfig.json` 均退出 0。
- `bun run lint:web`：`✖ 21 problems (2 errors, 19 warnings)`，2 个 error 是既有 `react-hooks/set-state-in-effect`（`apps/web/src/components/cosmos/provider-models-section.tsx:111`、`:116`），改动前同样存在，未新增。
- `bun run docs:check`、`git diff --check` 通过。
- 未运行：真实浏览器点击验收（需要用户自己起服务并点一遍）；真实上游发现已在此前一轮验证过，本轮未再外呼。

### 偏差与边界

- 「选填」只做在界面层：`ConfiguredModel` 的 `contextWindow`/`maxOutputTokens` 是 NOT NULL，清空输入框会按默认值提交，不是真的留空。要改成真可选需要迁移与合同变更，未做。
- 一次提交多行是逐行串行 POST，没有服务端批量端点；中途失败会留下「部分成功」，界面用「已添加 N 个，M 个失败」说明，不假装原子。
- 重复模型 ID 现在从「503 稍后重试」变成「409 已存在」，但界面上的批量提交只按行报告失败原因，不会自动跳到已有条目。

## 模型页草稿行与预算占位的三处修正（2026-10-22）

用户验收后提了三点：弹窗勾选后是从第一个表单开始填，而不是每勾一个就新建一行、把默认空行留在最上面；上下文窗口与输出上限的默认值应该做成 placeholder，不填就用默认值；每张卡片左上角的序号要去掉。

### 改动

1. `apps/web/src/components/cosmos/provider-model-draft.ts`：`emptyModelDraft()` 的两个预算改为空串，默认值只用于提交时兜底（`toBudgetOrDefault` 已在做这件事）与输入框 placeholder；新增 `fillDraftRows(rows, selected, nextKey)`——先占用「模型 ID 与显示名称都为空」的行，多出来的候选才新建，返回 `touched` 供组件清错误。抽成纯函数是因为仓库没有 DOM 测试环境，这条规则只能用纯函数钉住。
2. `apps/web/src/components/cosmos/provider-models-section.tsx`：`appendCandidates` 改用 `fillDraftRows`；两个预算 `Input` 加 `placeholder={String(defaultContextWindow)}` / `String(defaultMaxOutputTokens)`；删掉卡片头部的序号 span，行头只剩右对齐的删除按钮。
3. `apps/web/src/copy/areas/models.ts`：`defaultsHint` 改为「预算字段留空就按输入框里的默认值提交，可按上游实际能力改小。」
4. 测试：`provider-model-draft.test.ts` 的默认值用例改为断言 `emptyModelDraft()` 预算为空串、留空提交 262144/32768；新增 `fillDraftRows` 用例（空行被填满且不新建、已有内容的行不被覆盖）。

### 验证

- `bun run vitest run apps/web/src/components/cosmos/provider-model-draft.test.ts`：21 用例通过。
- `bun run vitest run apps/web`：21 文件 / 146 用例通过。
- `tsc --noEmit --incremental false -p apps/web/tsconfig.json`：退出 0。
- `bun run lint:web`：`✖ 21 problems (2 errors, 19 warnings)`，仍是既有的 `react-hooks/set-state-in-effect`（行号因编辑位移到 `:114`、`:119`），未新增。
- 未运行：真实浏览器点击验收。

### 偏差与边界

- 预算字段留空提交默认值，仍然不是「真可选」：`ConfiguredModel` 两列 NOT NULL，真留空要迁移与合同变更。
- `fillDraftRows` 只把「模型 ID 与名称都为空」算作可填充的空行；只填了预算的行视为填到一半，不会被覆盖。
