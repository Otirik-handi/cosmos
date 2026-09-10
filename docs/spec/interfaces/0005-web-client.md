# Web Client

## 状态

当前实现规格；后续代码变化应同步更新本文。本文记录当前 Next.js Web 页面（Phase 1 采集
链路与 Phase 2 组织/看板浏览）、开发态 React 组件实验室及其与 Product API 的边界。实验室
浏览器/生产验收结果只在本轮 Task 与 `PROJECT-STATUS.md` 记录，不把 Docker、真实来源或
Windows smoke 写成已验证能力。

## 最后更新

2026-09-09。

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
- **来源健康**：`source-health` Block 把 Source 快照解释为一行行可读状态——启用徽章、定时语义
  （启用+定时显示“每 N 自动抓取”；启用无定时显示“未配置定时，仅手动录入”；停用显示
  “已停用，定时抓取暂停”或“已停用”）、媒体策略摘要、上次运行时间与最近错误。它不新增
  读合同，投影自 `SourceSnapshot` 的 `enabled/config.scheduleIntervalMs/config.media/lastRunAt/lastError`。
  行内“媒体策略”入口打开一个表单（图片下载开关 + 单文件/单次上限 + 失败重试次数 + 保留天数，
  留空表示跟随默认/永久保留），保存走 `PATCH /api/v1/sources/:id`（带 `baseRevisionId`），
  超默认值在本地就被拒绝，409 提示版本冲突并刷新（ADR-0014/0015）。
- **保留期清理**：来源健康区底部提供“预览过期媒体 → 确认清理”两步操作，走
  `POST /api/v1/media-cleanups`（`dryRun: true` 预览、`false` 确认）并轮询
  `GET /api/v1/media-cleanups/:runId` 到终态；预览展示候选条数/字节与最多 5 条样例，
  确认后展示实际清理条数与释放字节。Web 不直接删除任何数据，也不新增读合同（ADR-0015）。
- **分类（Label）与 Topic 筛选**：搜索表单把已加载的 Label 与 Topic 渲染成可多选的筛选
  chip；选中项以 id 数组存在表单状态里，提交时拼成 `search` 的 `labelIds`/`topicIds`
  逗号串。它不新增合同，只是把既有 search 过滤条件接出编辑入口。
- **Story 时间线**：由 `StoryDetail.entries` 的全部 Revision 与 Observation 展平成按时间
  倒序的事件流（来源名、事件类型、标题、时间），纯客户端投影，不新增读合同。
- **Story 相关内容**：与本 Story 共享分类或共享 Entity 的其它 Story，纯读组合
  `search`/`entity`/`story` 三个既有端点，最多 5 条；只用于“相关但不同事件”的浏览提示，
  不改变 Story 的权威关系。
- **Story 证据来源**：`StoryDetail.evidence` 的渲染——把本 Story 当作证据/提及目标的其它
  条目（来源、标题、关系类型、理由），支持解除与从最近条目下拉添加；Story 成员列表里
  每条成员还会显示它作为证据关联到的其它 Story（`EntryDetail.relatedStories`），这是反向
  视图、不额外发请求（ADR-0011）。

## 外部行为
首次挂载时页面将 `loading=true`，并行调用 `client.feed()`（或 active search）和
`client.listSources()`；完成后展示 Feed/空态和 Source summary。随后打开 `/api/v1/events`
EventSource，页面没有 `afterEventId`，因此 transport 不附带 `after` query，API 缺省 cursor
按 `parseEventCursor(undefined)` 从 **0** 开始，而不是“服务端当前 cursor”。收到任意合法事件
置为 connected；收到 `feed.updated.v1`、`run.queued.v1`、`run.succeeded.v1`、`run.failed.v1`、
`run.retry_wait.v1` 或 `job.failed_terminal.v1` 时调用 refresh（这些是存储层实际发出的
类型：Job 成功没有独立事件，Run 终态覆盖它；Job 重试等待以 `run.retry_wait.v1` 表达）。
收到 `run.failed.v1` 时额外写 notice “一次录入运行失败，已刷新“来源健康”；请在来源行内
查看错误信息。”。收到 `snapshot_required` 只写
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
6. **搜索**：输入 text/source/date，或点选分类（Label）与 Topic 筛选 chip（多选，条件以
   逗号串提交），日期转换为 UTC 当日开始/结束 ISO，调用 search，保存 `activeSearch` 和
   第一页结果；筛选 chip 回显为“分类：<名称>”/“Topic：<标题>”。无条件搜索清除 active
   search 语义并恢复 Feed。
7. **加载更多**：有 `nextCursor` 时按当前搜索或 Feed query 追加下一页 items；没有 cursor
   不发请求。
8. **Story 展开**：点击卡片的“打开 Story”调用 `client.story(storyId)`，在页面下方显示
   Story title、来源成员（`entries` 全部成员，含来源名/标题/Entry id，以及该成员作为证据
   关联到的其它 Story）、证据来源（`evidence`：来源、标题、关系类型、理由，可解除或从最近
   条目下拉添加）、时间线（成员 Revision 与 Observation 按时间倒序，来源名与事件类型分开
   表达）、相关内容（共享分类或共享 Entity 的其它 Story，先渲染面板再后台补齐，读取失败
   只留空列表）、最新正文、Entry id、Revision badges 与 Observation badges。
9. **Story 编排**：面板“Story 操作”区可编辑标题（`updateStoryRevision`，携带当前
   `baseRevisionId`）或输入 obsolete Story id 把另一个 Story 归并到当前 Story
   （`mergeStories`）；成功后页面用返回的 StoryDetail 刷新面板。面板不直接发 API
   请求，全部经 props 回调上抛。历史壳（`story.status === "split"`）不渲染这一区。
10. **Story 拆分**：成员数 ≥2 的普通 Story 显示“拆分 Story”表单——2–5 个后继（标题 +
   kind，默认继承当前 Story 的标题与 kind），每个当前成员、证据条目、关联 Entity 与
   Topic 成员各有一个“留在历史壳 / 后继 N”下拉；提交前要求每个后继至少分到一个成员，
   然后调用 `splitStory`（ADR-0012）。成功后面板切到返回的历史壳：标题旁显示“历史壳”
   说明、`来源成员（0）`、后继列表（`data-story-shell` 内的 `data-story-successor-id`
   按钮可继续打开后继），Entry/Revision/Observation 详情与写操作区不再渲染。
11. **Topic 入口与详情**：`topic-list` Block 由 `client.listTopics` 加载（按 Block `limit` 截断），每行显示标题与
    active 成员数，点击“打开”调用 `client.topic(topicId)` 打开 TopicPanel。TopicPanel 展示
    title/purpose/scope 与成员列表（role 徽章、story id、reason、actor、removed），支持
    修改角色（`updateTopicMemberRole`）、移除（`removeTopicMember`）、恢复（`restoreTopicMember`）
    以及编辑标题/目的（`updateTopic`）。
12. **从 Story 侧加入/创建 Topic**：StoryPanel 提供“加入 Topic”（选择已有 Topic + 角色，
    `addTopicMember`）与“创建 Topic 并加入本 Story”（标题 + 目的，`createTopic` 以当前
    Story 为 seed，seed 恒为 `core` 角色）；成员添加入口从 Story 侧发起，不在 Topic 面板
    里做 Story 搜索选择器（ADR-0007 决策 4）。
13. **Entity 入口与详情**：侧栏“Entities”列表由 `client.listEntities` 加载，每行显示名称与
    关联 Story 数，点击“打开”调用 `client.entity(entityId)` 打开 EntityPanel。EntityPanel
    展示规范名/类型/别名与关联 Story、双向类型化关系，支持改名/改类型（`updateEntity`，
    携带 `baseRevisionId`）、别名增删（`addEntityAlias`/`removeEntityAlias`）、解除 Story
    关联（`unlinkStoryEntity`）、添加/移除 Entity↔Entity 关系（`createEntityRelation`/
    `removeEntityRelation`，关系目标从已有 Entity 列表选择）。
14. **从 Story 侧关联/创建 Entity**：StoryPanel 显示当前 Story 已关联的 Entity（来自
    StoryDetail `entities`，可解除 `unlinkStoryEntity`），并提供“关联已有 Entity”（下拉
    已有 Entity + `linkStoryEntity`）与“创建 Entity 并关联本 Story”（名称 + 类型，
    `createEntity` 后 `linkStoryEntity`）；关联入口从 Story 侧发起（ADR-0008 决策 3）。
15. **用户组织（标签/收藏/收藏夹）**：StoryPanel“用户组织”区显示收藏开关（`setFavorite`/
    `unsetFavorite`，目标为当前 Story）、已附加标签（`story.labels`，可 `detachLabel`）、
    未附加标签下拉（`attachLabel`）与新建标签（`createLabel` 后立即 `attachLabel` 到当前
    Story），以及收藏夹成员勾选（`addCollectionItem`/`removeCollectionItem`）与新建收藏夹
    （`createCollection`）。页面在初次加载时 `listLabels`/`listCollections`，打开 Story 时用
    `listCollections({ storyId })` 取回 `containsStory` 成员标记；所有写命令成功后重读
    Story 与相应列表。面板不直接发 API 请求，全部经 props 回调上抛。
16. **批注（Annotation）**：StoryPanel 与 TopicPanel 的“批注”区由 `client.listAnnotations`
    加载（目标分别为当前 Story/Topic，Story 目标用 canonical id），展示正文、可选引用文本、
    作者与时间，支持新建（`createAnnotation`）、编辑（`updateAnnotation`）与删除
    （`deleteAnnotation`）；写命令成功后重读该目标的批注列表。
17. **Saved View**：搜索卡内的“已保存视图”区块由 `client.listSavedViews` 加载；点击视图名
    把其条件回填搜索表单（含分类与 Topic 多选）并以 `client.search` 套用（label/topic id
    以逗号串传参，`activeSearch` 同步更新，因此分页与刷新沿用同一筛选），输入名称 +
    “保存当前条件”调用 `client.createSavedView`（保存表单里的全部条件，包括分类与 Topic），
    删除调用 `client.deleteSavedView`。保存的是查询条件而非结果快照。
18. **健康检查**：点击“检查服务”调用 `client.health()`，保存 health 并显示 service、
   workerStatus 及 storageStatus notice。
19. **看板渲染（Board）**：首次挂载先 `client.ensureDefaultBoard()` 再 `client.listBoards()`（串行，避免 seed 前的空列表），把 `BoardDetail` 交给
   `BoardView` 按 Section 顺序渲染可见 Block；`feed` Block 复用页面的完整阅读流（搜索卡 +
   Feed 列表 + 已保存视图），`source-health` Block 复用页面持有的 SourceActions，`topic-list`
   Block 渲染 Topic 列表，`collection` Block 由组件用 `client.collection(collectionId)` 自取
   收藏夹详情（按 collectionId 重挂载，无同步 setState），`spotlight` Block 用
   `client.listSpotlightPlacements({ boardId })` 自取固定列表并支持逐项解除。未知 Block type
   与悬空引用显示占位文案，不影响其它 Block。看板请求失败时主区直接渲染完整阅读流，不写 error。
20. **看板编辑与人工 Spotlight**：看板工具条提供 Board 切换下拉、编辑模式开关与新建看板；
   编辑模式下分区支持改名/上移/下移/删除，区块支持上移/下移/隐藏/复制/删除/跨分区移动，
   添加区块时 `feed` 可选绑定 Saved View、`collection` 可选绑定收藏夹（都可先建为未绑定态），
   区块配置可改绑定与条数（写命令统一用返回的 `BoardDetail` 刷新当前树）。Story/Topic 面板提供“固定到看板热点区”
   （`client.pinSpotlight` 到当前 Board），成功后递增 `refreshToken` 触发 Spotlight 区块重新拉取。

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
  `labelIds`/`topicIds` 为多选数组（默认空，提交时 join 成逗号串，未选中不发送该字段）；
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
- 来源健康看板：无 Source 显示“创建第一个 RSS 来源。”；每个来源行展示启用/停用徽章、
  名称、`kind · sourceDefinitionRef`、定时语义行（“每 N 分钟自动抓取”/“未配置定时，仅手动
  录入”/“已停用，定时抓取暂停”/“已停用”）、上次运行时间与最近错误（红色截断）；行内提供
  启用/停用按钮，enabled Source 另有手动录入按钮，disabled Source 的运行按钮禁用。
- Source form：loading 显示“正在读取来源定义…”；catalog 不可用时显示错误与“重试读取”；
  ready 时按 manifest 渲染字段，测试结果区显示 running/成功统计/失败原因/超时四态。
- Feed：loading 时显示“正在读取本地 Feed…”；非 loading 且为空显示暂无内容；有 items
  时展示 Story kind、sourceName、title、summary、打开 Story；有 nextCursor 显示加载更多；
  搜索表单在存在 Label/Topic 时渲染多选筛选 chip，命中条件回显为筛选 chip。
- Story panel：展示 title、source、revision 数、来源成员（含反向证据关联）、证据来源、
  时间线（时间/事件类型/来源/标题）、相关内容（标题 + 相关原因）、最新 revision contentText、
  Entry/source 信息、Revision/Observation badges。

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
   `run.failed.v1` 同时写失败 notice；`snapshot_required` 仅写 notice “服务要求重新读取快照，
   正在刷新 Feed。”，不会自动 refresh。
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
   close 清除 story。`story-revision-update`：提交新标题后以返回 StoryDetail 刷新面板；
   `story-merge`：归并成功后来源成员数增加，旧 Story id 的后续打开重定向到 canonical。
   `story-split`：提交后以返回的历史壳刷新面板（成员清空、后继列表可见、写操作区消失），
   点击后继按钮打开该后继的普通 Story 视图。
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
   来源健康行内文案跟随状态变化：停用且配置定时显示“已停用，定时抓取暂停”，启用后显示
   “每 30 分钟自动抓取”（与表单默认一致），无定时的启用来源显示“未配置定时，仅手动录入”。
4. 输入 text/source/date 搜索，观察日期边界为 UTC 当日开始/结束、结果替换 Feed、保存
   nextCursor；点击加载更多，观察新 items 追加而不是覆盖。点选一个分类 chip 后搜索，观察
   请求带 `labelIds` 且筛选区回显“分类：<名称>”；把该条件保存为视图、清除筛选后套用视图，
   观察分类条件与结果一起恢复。
5. SSE 收到 `feed.updated.v1`、`run.queued.v1` 或 Run/Job 终态事件时观察 Feed 自动 refresh；
   收到 `run.failed.v1` 时观察失败 notice；收到
   `snapshot_required` 时只观察指定 notice、没有自动 refresh；触发 EventSource error 时观察
   “SSE 不可用”，且不发生自动重连。
6. 点击 Story 后观察 Story title、类型/subtype 徽章、来源成员列表、时间线事件（来源名 + 事件类型 + 时间）、
   最新正文、Entry、Revision、Observation 展开；给两条 Story 打同一分类后重新打开，观察
   “相关内容”列出对方并标注“共享分类：<名称>”，且不把当前 Story 列进自己；把另一条 Story
   的条目作为证据加入后观察“证据来源”出现该项并标注关系类型，解除后消失；更新标题后标题
   与 Revision 变化、归并后来源成员数增加、旧 Story id 打开仍显示 canonical；Story 404/
   网络失败只显示 error，不显示空的 Story panel；点击关闭移除 panel。受管理 subtype 目录
   加载后，编辑表单的 subtype 下拉只列出当前类型的注册项（含「无 subtype」）；把类型改为
   媒体并选中「漫画」保存后，标题旁徽章显示「漫画」，且用 API 直接提交未注册 subtype
   返回 400 且 Story 保持上一次保存的状态（ADR-0013）。
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
- 时间线投影与相关内容组合：[`apps/web/src/lib/story-timeline.ts`](../../../apps/web/src/lib/story-timeline.ts)、
  [`related-stories.ts`](../../../apps/web/src/lib/related-stories.ts) 与同目录
  `story-timeline.test.ts`、`related-stories.test.ts`。
- 分类/Topic 浏览、时间线与相关内容的浏览器回归：
  [`e2e/browser/phase2-organization.spec.ts`](../../../e2e/browser/phase2-organization.spec.ts)。
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
  展示空、configured（含定时）、untimed（启用无定时）和 disabled 状态及行内启停按钮，
  每行解释启用徽章、定时语义、上次运行与最近错误；
- `FeedBrowser`：接收 Feed、Source、搜索表单、loading、cursor 与 Story 回调；
- `BoardView`：接收 `BoardDetail`、transport client、页面持有的 `feedSlot`/`sourceActionsSlot`（ReactNode 插槽）与 Topic 列表/打开回调，按 Section 顺序渲染可见 Block；首个可见 `feed` Block 渲染页面传入的完整阅读流，其余 Block 按 type 分发（`spotlight` 自取本 Board 的固定列表、`source-health` 渲染来源健康插槽、`topic-list` 渲染 Topic 列表、`collection` 自取收藏夹详情并渲染成员 Story）；未知 type 与悬空 `savedViewId`/`collectionId` 降级为占位，不阻断其它 Block（ADR-0010）。`editable` 打开编辑控件：分区标题/上移/下移/删除、区块上移/下移/隐藏/复制/删除/跨分区移动/条数与绑定配置、添加区块与添加分区；非编辑模式下隐藏的 Block 完全不渲染（编辑模式保留“已隐藏”占位以便恢复）；
- `StoryPanel`：接收 `StoryDetail`、关闭回调与 `onUpdateStoryRevision`/`onMergeStory`
  回调，展示 revision/observation 元数据与来源成员/操作区；回调由宿主注入（真实页
  面调用 transport client，组件实验室用 stub，不发 Product API 请求）。

首页首载调用 `ensureDefaultBoard` 幂等 seed 默认看板并按 Board 树渲染；看板加载失败时主区回退为完整阅读流，不阻断阅读。侧栏保留服务状态、Entities 列表与新建来源表单；来源健康与 Topic 列表迁入对应 Block。

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
- 不实现用户认证、授权、跨用户隔离、interaction/read-state（含“未读”过滤）、文件上传、
  offline cache、service worker 或通知中心。
- Schema 驱动表单只消费 manifest 中 string/integer 字段并按已知字段名渲染展示文案；
  其它类型的配置字段、多 operation 选择和 catalog 变更的实时刷新不在当前 UI。
- 未保存配置 Probe 的轮询固定 1.5s/30s；不提供后台继续等待、进度百分比或历史探测列表；
  真实公网 RSS 的探测/录入端到端仍未验收（当前证据来自受控本地 RSS）。
- 不把 EventSource unavailable 后“服务恢复会重新连接”文案写成已实现自动 reconnect；
  当前代码只显示 unavailable，后续连接依赖页面重新挂载或上层操作。
- Browser visual/e2e、Docker、真实网络来源和跨进程 recovery 未在当前代码和测试中验证；本规格的验收步骤需在相应运行环境中单独执行。
