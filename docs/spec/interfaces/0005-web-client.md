# Web Client

## 状态

当前实现规格；后续代码变化应同步更新本文。本文记录当前 Phase 1 Next.js Web 页面、
开发态 React 组件实验室及其与 Product API 的边界。实验室浏览器/生产验收结果只在本轮 Task
与 `PROJECT-STATUS.md` 记录，不把 Docker、真实来源或 Windows smoke 写成已验证能力。

## 最后更新

2026-09-02。

## 组件定位

Web Client 是 `apps/web/src/app/page.tsx` 的一个 client-side Next App Router 页面，
使用 `HttpCosmosClient` 读取 Feed/Source/Health 与来源定义 Catalog、以未保存配置 Probe
测试 RSS 配置、创建默认停用的 Source、在来源列表行内启用/停用、手动触发已启用 Source
的 Run、搜索分页、展开 Story，并用 SSE 事件触发刷新。`layout.tsx` 提供中文语言、字体变量、
metadata 和全局样式；`components/ui/*` 是 UI primitive，`lib/utils.ts` 只提供
Tailwind class 合并。`instrumentation.ts` 是 Next server instrumentation：Node runtime
按需创建并缓存一个 `cosmos-web` logger，`register()` 写一次 `web.started`，
`onRequestError` 只写脱敏后的请求元数据和错误对象。

页面是本地优先的信息聚合工作台展示层，不直接依赖 Prisma、SQLite、Data Root 或 Blob
Root。服务端路由和共享 DTO 详见 [Product API HTTP](0002-product-api-http.md)，transport
错误与 schema 校验详见 [HTTP Client](0004-http-client.md)。Catalog page、CapabilitiesResponse、
AttemptSnapshot/AttemptPage 与 Asset download 虽由 API 提供，但当前 `HttpCosmosClient`
没有对应方法；本页面也不调用这些边界。

### 在系统中的位置与作用
它是 Cosmos 面向用户的 Next.js 展示层，位于浏览器页面与 `HttpCosmosClient` 之间，负责把 Product API 数据组织成信息聚合工作台。

### 解决的问题
它提供 Feed/Source/Health、搜索、Story 展开、手动 Source Run 和 SSE 刷新等可见交互，同时把数据库、Blob 和 API 细节留在服务端/transport。

### 使用方式
浏览器加载 `page.tsx` 后由 client component 调用 `HttpCosmosClient`；需要刷新时监听 SSE，
配置来源（catalog 读取、未保存配置 Probe、保存停用、行内启用/停用）或触发 Run 也通过
已有 client 方法和 API 路由完成，不直接访问 Prisma。

### 典型情景
本地浏览内容、检查 Source/Health，验证一次未保存配置的探测结果，保存并启用来源后
观察手动/定时 ingest 的页面刷新，验证搜索分页或展开 Story；Catalog、Attempt 或
Asset download 中未被 client 封装的部分不由它承担。

## 概念与定义

- **Feed**：API `FeedPage.items` 的 Story-level cards；页面展示 title、summary、kind、
  source，并以 `storyId` 作为卡片 key。
- **Source**：共享合同中的可采集来源快照；Web 表单由 `source.rss@1` manifest 的
  descriptive configurationSchema 驱动，创建后默认保持停用，由用户在来源列表行内
  通过 activation command 单独启用/停用。
- **未保存配置 Probe**：`source-config-probe` Job 的 dry-run。表单“测试配置”提交
  `sourceDefinitionRef + operationId + config`（不创建 Source），Web 轮询该 Job 快照
  直到终态或超时；结果显示抓取条数、耗时、样例标题，失败/超时有独立提示。
- **来源定义状态**：表单打开时读取 `GET /api/v1/source-definitions` 并定位
  `source.rss@1`；loading/error/ready 三态，error 提供重试，不回退到硬编码字段。
- **页面刷新**：按当前 `activeSearch` 重新并行读取 Feed/Search 与 Source，并替换而不是
  合并现有列表；匹配的 feed/run/job SSE 事件使用同一刷新路径，`snapshot_required` 只写 notice。
- **SSE state**：`connecting`、`connected`、`unavailable` 三态 UI 指示；底层
  `HttpCosmosClient` 的 source error 只会把它置为 unavailable。

## 外部行为
首次挂载时页面将 `loading=true`，并行调用 `client.feed()`（或 active search）和
`client.listSources()`；完成后展示 Feed/空态和 Source summary。随后打开 `/api/v1/events`
EventSource，页面没有 `afterEventId`，因此 transport 不附带 `after` query，API 缺省 cursor
按 `parseEventCursor(undefined)` 从 **0** 开始，而不是“服务端当前 cursor”。收到任意合法事件
置为 connected；收到 `feed.updated.v1`、`run.succeeded.v1`、`run.failed.v1`、`job.succeeded.v1`、
`job.retry_wait.v1` 或 `job.failed_terminal.v1` 时调用 refresh。收到 `snapshot_required` 只写
notice “服务要求重新读取快照，正在刷新 Feed。”，当前代码不会因此调用 refresh；`onError` 把
状态置为 unavailable。Effect cleanup 关闭 SSE source。

页面提供以下用户流程：

1. **配置来源（schema 驱动）**：打开“新建来源”卡片时读取 `GET /api/v1/source-definitions`，
   定位 `source.rss@1` 并按其 configurationSchema 渲染字段：`feedUrl`（必填 http(s) URL）、
   `scheduleIntervalMinutes`（分钟输入，默认 30，清空表示不自动抓取；保存时换算为
   canonical `scheduleIntervalMs`）。表单通过 React Hook Form + Zod 校验。
2. **测试未保存配置**：点击“测试配置”先触发表单校验，通过后 `POST
   /api/v1/source-config-probes`（不携带幂等键，服务端生成缺省键），随后每 1.5s 轮询
   `GET /api/v1/source-config-probes/:jobId`，30s 未达终态显示超时提示；`succeeded`
   展示抓取条数、耗时、样例标题与“还有更多内容”提示，`failed_terminal`/`cancelled`
   显示错误文本。全程不创建 Source、不写事实数据；表单字段变化会使结果立即作废。
3. **保存停用来源**：提交 `POST /api/v1/sources` 的 `source.rss@1` command（默认停用，
   含 `scheduleIntervalMs`）；成功显示 notice、关闭并 reset 表单，然后 refresh。不再
   自动启用。
4. **行内启用/停用**：来源列表每个来源提供启用或停用按钮（同一 activation command，
   `baseRevisionId=source.revisionId`，`Idempotency-Key: web-activation:<id>:<revisionId>:enable|disable`）；
   返回 409 conflict 时提示版本冲突并刷新列表，用户可重试。
5. **手动运行**：对 enabled Source 点击按钮，调用 `triggerSource(source.id)`；queued/
   running 显示 Run 已排队，随后 refresh；其它 status 显示当前状态。disabled Source
   的运行按钮不可点击。
6. **搜索**：输入 text/source/date，日期转换为 UTC 当日开始/结束 ISO，调用 search，
   保存 `activeSearch` 和第一页结果。无条件搜索清除 active search 语义并恢复 Feed。
7. **加载更多**：有 `nextCursor` 时按当前搜索或 Feed query 追加下一页 items；没有 cursor
   不发请求。
8. **Story 展开**：点击卡片的“打开 Story”调用 `client.story(storyId)`，在页面下方显示
   Story title、来源、最新正文、Entry id、Revision badges 与 Observation badges；点击
   关闭清除 story。
9. **健康检查**：点击“检查服务”调用 `client.health()`，保存 health 并显示 service、
   workerStatus 及 storageStatus notice。

## 输入

### Runtime/config

页面在模块初始化时创建：

```ts
new HttpCosmosClient({
    baseUrl: process.env.NEXT_PUBLIC_COSMOS_API_URL ?? "",
})
```

空 base URL 产生同源 `/api/v1/...` URL；若设置绝对 URL，则浏览器直接访问该 API base URL。
Next rewrite 在 `apps/web/next.config.ts` 将 `/api/:path*` 转到
`${COSMOS_API_URL ?? "http://localhost:4310"}/api/:path*`。这些环境变量不是页面运行时
表单输入，不提供认证或 Secret。

### Form input

- Source form：`name` trim 后 1–200 字符（默认 `Cosmos RSS`）；`feedUrl` 必须是
  http(s) URL（默认占位 `https://example.com/feed.xml`），字段集合来自
  `source.rss@1` manifest 的 descriptive schema，未知类型字段不渲染；
  `scheduleIntervalMinutes` 为可选整数分钟（默认 `30`，1–44640，清空即关闭定时）。
  保存固定发送
  `{name, sourceDefinitionRef: "source.rss@1", operationId: "fetch", config: { feedUrl, scheduleIntervalMs? }}`
  且不含 enabled；创建后保持停用。测试配置发送
  `{sourceDefinitionRef, operationId, config}` 到 probe 端点，轮询间隔 1.5s、上限 30s。
- Search form：text trim/max 500，sourceId、publishedAfter、publishedBefore 可为空；
  search command 固定 `limit: 20`。非空 date 变成 `YYYY-MM-DDT00:00:00.000Z` 或
  `YYYY-MM-DDT23:59:59.999Z`。
- Source run：无 idempotency key 参数，transport 不发送该 header。
- SSE：页面没有 `afterEventId` 或持久 cursor；`HttpCosmosClient.openEventStream` 因此打开不带
  query 的 `/api/v1/events`。API 对缺省 cursor=0，页面首次连接会从 sequence 0 replay，而不是
  从服务端当前末尾连接；页面也不读取/写入 `Last-Event-ID`。

## 输出

页面显示：

- 顶部 Cosmos/Phase 1 标识、说明、新建来源和检查服务按钮；notice/status 与 error/alert
  互斥显示最新状态文本。
- 四个状态卡：服务器部署模式/health（有 health 时显示 service·workerStatus）、Source
  数与启用数、Prisma+SQLite 文案、SSE 已连接/正在连接/SSE 不可用。
- Source actions：无 Source 显示“创建第一个 RSS 来源。”；每个来源行内提供启用/停用
  按钮，enabled Source 另有手动录入按钮，disabled Source 的运行按钮禁用。
- Source form：loading 显示“正在读取来源定义…”；catalog 不可用时显示错误与“重试读取”；
  ready 时按 manifest 渲染字段，测试结果区显示 running/成功统计/失败原因/超时四态。
- Feed：loading 时显示“正在读取本地 Feed…”；非 loading 且为空显示暂无内容；有 items
  时展示 Story kind、sourceName、title、summary、打开 Story；有 nextCursor 显示加载更多。
- Story panel：展示 title、source、revision 数、最新 revision contentText、Entry/source
  信息、Revision/Observation badges。

页面使用共享 DTO 的 response shape，不在 UI 重新定义 API DTO；`readError` 对
`CosmosTransportError` 显示 `服务请求失败（HTTP <status>）。`，其它 Error 显示 message，
未知值显示 `发生未知错误。`。

## 状态与持久化

页面业务状态均为 React 内存 state，不写 URL query 或 IndexedDB：

- `feed`、`nextCursor`、`activeSearch`、`sources`、`story`、`health`；
- `notice`、`error`、`loading`、`showSourceForm`；
- `definitionState`（来源定义 loading/ready/error）、`probeState`（idle/running/
  succeeded/failed/timeout）、`activatingSourceId`（进行中的启用/停用行）；
- `eventStreamState`（connecting/connected/unavailable）。

唯一的产品 localStorage 持久化是外观主题偏好 `cosmos.theme.preference.v1`
（见下方“外观主题”）；刷新页面会重新加载 API snapshots 并恢复主题偏好，SSE
连接不持久化 last event id。API/数据库/Blob 是唯一业务持久真相，其余 UI
状态只做当前视图投影。

## 外观主题

Web 默认使用 NeuroBook 视觉主题（`data-cosmos-theme="neurobook"`）配 macOS Light /
macOS Night 两种配色（`data-cosmos-colorway`）。产品偏好是三值枚举
`system | macos-light | macos-night`：

- `<head>` 内的静态引导脚本在首帧前读取 `cosmos.theme.preference.v1` 与
  `prefers-color-scheme`，把最终 theme/colorway 属性、`dark` class 和
  `style.colorScheme` 写到 `<html>`；脚本只含仓库常量，解析或存储异常回退浅色；
- `ThemeProvider` 用模块级 store 作为唯一浏览器真相：订阅 matchMedia（仅 system
  生效）与 storage 跨标签同步，并把同一属性幂等写回 `<html>`；服务端快照固定
  system → 浅色；
- 首页头部与实验室 header 的 `ThemeSwitcher` 提供键盘可达的三态切换；
  “跟随系统”删除存储 key，显式选择写入；写入失败仅影响当前标签页且 UI 不声称已持久化；
- 实验室 URL 的 `theme=neurobook&colorway=macos-*` 只控制预览画布根节点
  （含局部 `dark` class），与全局 chrome 偏好互不覆盖；token override 仍是预览内最高优先级。

`globals.css` 以 `[data-cosmos-theme]` 承载字体/密度/圆角/动效/表面角色，
以 `[data-cosmos-colorway]` 把两套 macOS 取值映射到现有 shadcn 语义 token；
`prefers-reduced-motion` 将主题动效时长归零。生产构建下 `/dev/components`
仍返回 404，主题能力不改变 Product API、SSE 或表单语义。

## 状态转换

1. `unmounted → loading/connecting`：页面挂载，初始化 forms，启动 refresh 和 SSE。
2. `loading → loaded`：feed/search 与 sources 都 resolve，写入 arrays，`loading=false`；
   Feed 空数组进入空态。
3. `loading → error`：任一初始 promise reject，写 error；finally 仍将 loading=false。
4. `connecting → connected`：收到合法 SSE message；`connecting → unavailable`：
   EventSource error 或 malformed event（transport onError）。
5. `connected/unavailable → refreshing`：只在匹配 feed/run/job event 时重新读取当前 query；
   `snapshot_required` 仅写 notice “服务要求重新读取快照，正在刷新 Feed。”，不会自动 refresh。
6. `source-form-open → loading → ready/error`：打开表单读取 catalog；error 可重试并回到
   loading；ready 前不渲染表单字段。
7. `probe idle → running → succeeded/failed/timeout`：测试配置提交后进入 running；
   轮询到 `succeeded`（含 result）显示统计，`failed_terminal`/`cancelled` 显示失败原因，
   30s 未终态显示超时；任一表单字段变化或重新打开表单立即回到 idle（作废旧结果）。
8. `source-form-open → submitting → closed/notice`：合法创建成功后关闭/reset并刷新；
   reject 保持 form 并显示 error。保存不再触发启用。
9. `source-row → activating → refreshed/conflict`：行内启用/停用期间该行按钮禁用；
   成功后 refresh；409 conflict 提示版本冲突并 refresh。
10. `feed/search → paginating`：存在 nextCursor 时追加 page.items；失败保留已有 items
   并显示 error。
11. `feed-card → story-open`：Story API 成功写 StoryDetail；失败不打开并显示 error；
   close 清除 story。
12. 页面卸载 → SSE closed：effect cleanup 调用 transport close。

## 副作用

- 浏览器 fetch：初始化/refresh 并行请求 Feed/Search 与 Sources；打开表单读取
  source-definitions；测试配置提交并轮询 probe Job；保存、启用/停用、搜索、分页、
  health、Story、Run 分别请求对应 API。
- 浏览器 EventSource：挂载建立一个 SSE 连接，事件驱动 refresh，卸载关闭连接。
- API Source create/activation/run 与 source-config-probe Job 会产生服务端持久副作用
  （probe 只持久化 Job 记录，不写 Observation/Entry/Asset/checkpoint）；页面自身不直接
  写业务数据。
- React state 更新和表单 reset 是内存副作用；UI primitive 仅影响渲染。

Web server instrumentation 的副作用独立于 client page：在 Node runtime，Next 调用
`register()` 时 `getWebLogger()` 动态 import `@cosmos/logging` 并惰性创建模块级缓存 logger，
随后写一条 `web.started`（runtime、mode）；重复 hook 调用复用同一 logger。Next 调用
`onRequestError(error, request, context)` 时复用/创建该 logger，截掉 `request.path` 的 query
后写 `web.request.failed`，字段只有 method、path、routeType、routerKind、可选 digest，
错误对象作为 logger error 参数传递。Edge runtime 两个 hook 都因 `getWebLogger()` 返回 null
而无日志副作用。当前测试只锚定 Node-style logger 初始化、started/error 事件和 query 不进入
结构化 fields，不代表浏览器/e2e 或生产日志 sink 已验收。

## 错误与降级

- 初始 refresh、SSE 事件 refresh、catalog 读取、Source create、activation、probe 提交/轮询、
  search、pagination、health、run、Story 任一请求失败，都不抛出到 React page boundary；
  捕获后使用 `readError` 写 error/status 或对应的局部状态（catalog 错误在表单内提供重试，
  probe 失败在结果区显示原因）。
- probe 轮询到达 30s 上限显示超时文案，提示可稍后重新“测试配置”；不做后台继续轮询。
- activation 409 conflict 显示“版本冲突”提示并刷新列表，不自动重试启用。
- SSE unavailable 时页面明确提示“数据仍可手动刷新；服务恢复后会重新连接。”但当前代码
  不自动重连；用户可使用检查服务、搜索或其它按钮产生请求。
- Snapshot required 不直接在浏览器恢复某个 cursor；当前代码只写 notice，不自动 refresh 当前 snapshot。
- 空 Feed 是正常空态，不是错误；Source 列表为空显示创建引导。
- 表单 Zod 错误通过 FieldError 就地显示，提交按钮在 `isSubmitting` 时禁用并显示保存中。
- HTTP 400/404/5xx 的 status 在 transport error notice 中可见，但 API error body 的
  code/details 不在当前页面呈现；未捕获的非 `Error` 使用通用文本。

## 依赖

- Next.js 16 App Router、React 19 client component；
- `@cosmos/contracts` 的 Source/Feed/Search/Health/Story DTO 与 create schema；
- `@cosmos/transport-http` 的 `HttpCosmosClient`、`CosmosTransportError`；
- React Hook Form、`@hookform/resolvers/zod`、Zod；
- lucide icons、Tailwind/shadcn-style UI primitives、`cn` utility；
- API runtime/rewrite：[`apps/web/next.config.ts`](../../../apps/web/next.config.ts)、
  [`apps/api/src/main.ts`](../../../apps/api/src/main.ts)。

## 配置

- `NEXT_PUBLIC_COSMOS_API_URL`：客户端 API base URL，默认空字符串（同源 rewrite）。
- `COSMOS_API_URL`：Next rewrite 的 server-side destination，默认 `http://localhost:4310`。
- Next 输出为 standalone；日志 incomingRequests/browserToTerminal 被关闭；具体 build/start
  脚本见 `apps/web/package.json`。
- 页面 `layout.tsx` metadata 为 title `Cosmos`、description “本地优先的信息聚合与个人情报工作台”，
  html lang=`zh-CN`，载入 Geist/Geist Mono 与 `globals.css`。

没有页面级 API timeout、重试、认证、SSE replay 配置或持久 UI 配置。

## 重建验收

1. 使用空 `NEXT_PUBLIC_COSMOS_API_URL` 启动 Web，观察初始化请求为同源 `/api/v1/feed` 与
   `/api/v1/sources`，页面先显示 loading，成功后显示四个状态卡和 Feed/Source 内容。
2. 打开“新建来源”，观察 `GET /api/v1/source-definitions` 读取与字段渲染（`feedUrl` 必填、
   定时默认 30 分钟）；让 catalog 请求失败，观察表单错误与“重试读取”。填写合法值后点击
   “测试配置”，观察 `POST /api/v1/source-config-probes` 与按间隔的
   `GET /api/v1/source-config-probes/:jobId` 轮询，成功显示抓取条数与样例标题，且没有
   `POST /api/v1/sources`。点击“保存来源（停用）”后观察创建请求不含 enabled、表单关闭，
   来源列表新增停用来源。对停用来源点击启用，观察
   `POST /api/v1/sources/:id/activation-commands`（header `Idempotency-Key:
   web-activation:<id>:<revisionId>:enable`）后来源变为启用。
3. 对 enabled Source 点击录入，观察 POST `/api/v1/sources/:id/runs`，queued/running 时
   notice 包含 Run id；disabled Source 的录入按钮不可点击，且 API 对未启用 Source 的手动
   Run 返回 409 conflict。对同一来源点击停用，观察 activation command 以
   `...:disable` 幂等键发送；在列表过期时并发修改可复现 409 conflict 提示与列表刷新。
4. 输入 text/source/date 搜索，观察日期边界为 UTC 当日开始/结束、结果替换 Feed、保存
   nextCursor；点击加载更多，观察新 items 追加而不是覆盖。
5. SSE 收到 `feed.updated.v1`、Run/Job 终态事件时观察 Feed 自动 refresh；收到
   `snapshot_required` 时只观察指定 notice、没有自动 refresh；触发 EventSource error 时观察
   “SSE 不可用”，且不发生自动重连。
6. 点击 Story 后观察 Story title、最新正文、Entry、Revision、Observation 展开；Story
   404/网络失败只显示 error，不显示空的 Story panel；点击关闭移除 panel。
7. 点击检查服务，观察 health card 更新为 `service · workerStatus`，notice 包含
   `storageStatus`；让 health 请求非 2xx，观察 error 文本包含 HTTP status。
8. 刷新浏览器或卸载页面，观察所有 React/SSE 状态重新初始化，且除主题偏好外没有
   localStorage/IndexedDB/URL 持久 cursor；Next rewrite 将 `/api/*` 转到配置 API host。
9. 清空 `cosmos.theme.preference.v1` 后分别以系统浅色/深色加载首页，观察 `<html>`
   首帧即为对应 neurobook 配色；点击“macOS Night”后 storage 写入并在刷新与系统
   变化下保持；切回“跟随系统”后 key 删除并即时跟随系统。

## 实现与测试锚点

- 页面状态、调用、SSE、表单、搜索、Story 和渲染：[`apps/web/src/app/page.tsx`](../../../apps/web/src/app/page.tsx)。
- 文档 metadata、lang、字体、主题引导与 Provider：[`apps/web/src/app/layout.tsx`](../../../apps/web/src/app/layout.tsx)。
- 外观主题合同/Provider/引导脚本：[`apps/web/src/theme/theme.ts`](../../../apps/web/src/theme/theme.ts)、
  [`theme-provider.tsx`](../../../apps/web/src/theme/theme-provider.tsx)、
  [`theme-bootstrap.ts`](../../../apps/web/src/theme/theme-bootstrap.ts) 与
  [`theme.test.ts`](../../../apps/web/src/theme/theme.test.ts)。
- 三态外观切换器及其实验室登记：[`components/cosmos/theme-switcher.tsx`](../../../apps/web/src/components/cosmos/theme-switcher.tsx)、
  [`component-lab/registry.tsx`](../../../apps/web/src/component-lab/registry.tsx)。
- 主题浏览器回归：[`e2e/browser/theme.spec.ts`](../../../e2e/browser/theme.spec.ts)、
  [`e2e/component-lab/theme.spec.ts`](../../../e2e/component-lab/theme.spec.ts)。
- Web server instrumentation、logger cache、register/onRequestError：[`apps/web/src/instrumentation.ts`](../../../apps/web/src/instrumentation.ts)。
- instrumentation lifecycle/redaction test：[`apps/web/src/instrumentation.test.ts`](../../../apps/web/src/instrumentation.test.ts)。
- 全局 Tailwind/theme 样式：[`apps/web/src/app/globals.css`](../../../apps/web/src/app/globals.css)。
- class merge utility：[`apps/web/src/lib/utils.ts`](../../../apps/web/src/lib/utils.ts)。
- Next rewrite/output/logging：[`apps/web/next.config.ts`](../../../apps/web/next.config.ts)。
- Web scripts/dependencies：[`apps/web/package.json`](../../../apps/web/package.json)。
- HTTP URL/schema/error/SSE behavior：[`packages/transport-http/src/index.ts`](../../../packages/transport-http/src/index.ts)、[`packages/transport-http/src/index.test.ts`](../../../packages/transport-http/src/index.test.ts)。
- Shared form/response contracts：[`packages/contracts/src/base.ts`](../../../packages/contracts/src/base.ts)、[`packages/contracts/src/index.ts`](../../../packages/contracts/src/index.ts)。

## React 组件实验室

组件实验室是 `/dev/components` 下的开发工具，不属于 Product API 或产品导航。Server Component
先检查 `process.env.NODE_ENV`，非 development 调用 `notFound()`；开发态通过 Suspense 承载
使用 `useSearchParams()` 的 client workbench。实验室不创建 `HttpCosmosClient`、EventSource，
不读取 Prisma、SQLite、Data Root、Blob Root 或用户数据。

受管公共模块位于 `apps/web/src/components/ui/*.tsx` 与
`apps/web/src/components/cosmos/*.tsx`，每个模块在静态 registry 中有唯一 id、默认场景、
控件 schema、合成 fixture、token 子集和 render 目标。`registry-integrity.ts` 比较两个目录与
注册表，拒绝缺失、重复、无默认场景、缺控件值或未登记 token；当前登记 8 个 UI primitive 和
6 个 Cosmos 展示组件。

实验室全局 chrome 使用持久化外观偏好（`ThemeSwitcher`）；URL `theme=neurobook&colorway=macos-*`
只控制预览根节点，缺省确定性 `macos-light`。

首页 `page.tsx` 是数据请求容器：它独占 `HttpCosmosClient`、SSE、React Hook Form 的
`handleSubmit`、搜索/分页/Story 状态和错误处理。无副作用展示组件只接收共享 DTO、展示状态和
回调：首页与实验室复用同一实现，实验室使用固定 synthetic fixture，不复制演示组件。

当前产品展示组件边界：

- `SourceForm`：接收来源表单 `UseFormReturn`、来源定义状态（含 manifest）、提交事件、
  测试回调与 probe 状态、目录重试回调，展示 catalog 加载/错误、Zod 字段错误、submitting
  状态与 probe 四态反馈；
- `StatusSummary`：接收 health、source summary 和 connecting/connected/unavailable 状态；
- `SourceActions`：接收 `SourceSnapshot[]`、run 回调与启用/停用回调（含进行中行 id），
  展示空、disabled 和 configured 状态及行内启停按钮；
- `FeedBrowser`：接收 Feed、Source、搜索表单、loading、cursor 与 Story 回调；
- `StoryPanel`：接收 `StoryDetail` 与关闭回调，展示 revision/observation 元数据。

实验室 URL 只保存 `component`、`scene`、`viewport`、`theme`、`colorway`；非法值归一化并以
`replace` 修正，用户操作以 `push` 保留浏览器前进/后退。已登记 token 的临时输入在失焦时校验，
版本化快照写入 `localStorage`，JSON 导入整份原子校验；覆盖只写预览根节点的 inline custom
properties，不写 `:root`，因此实验室 chrome 与产品页面不受污染。

实现入口：[`apps/web/src/component-lab/registry.tsx`](../../../apps/web/src/component-lab/registry.tsx)、
[`apps/web/src/component-lab/workbench.tsx`](../../../apps/web/src/component-lab/workbench.tsx)、
[`apps/web/src/app/dev/components/page.tsx`](../../../apps/web/src/app/dev/components/page.tsx)。
组件登记、URL/快照/草稿测试和实验室浏览器/生产验收边界见
[`docs/testing/README.md`](../../testing/README.md) 与
[`Task 09`](../../../.agents/tasks/09-react-component-lab/README.md)。

## 非目标/边界

- 当前页面只开放 RSS 配置；不宣称浏览器端可配置 Bilibili/OpenCLI、Secret、
  Connection、Plugin、Workflow definition 或 arbitrary Action。
- 不实现用户认证、授权、跨用户隔离、Saved View、interaction/read-state、文件上传、
  offline cache、service worker 或通知中心。
- Schema 驱动表单只消费 manifest 中 string/integer 字段并按已知字段名渲染展示文案；
  其它类型的配置字段、多 operation 选择和 catalog 变更的实时刷新不在当前 UI。
- 未保存配置 Probe 的轮询固定 1.5s/30s；不提供后台继续等待、进度百分比或历史探测列表；
  真实公网 RSS 的探测/录入端到端仍未验收（当前证据来自受控本地 RSS）。
- 不把 EventSource unavailable 后“服务恢复会重新连接”文案写成已实现自动 reconnect；
  当前代码只显示 unavailable，后续连接依赖页面重新挂载或上层操作。
- Browser visual/e2e、Docker、真实网络来源和跨进程 recovery 未在当前代码和测试中验证；本规格的验收步骤需在相应运行环境中单独执行。
