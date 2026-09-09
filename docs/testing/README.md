# 测试入口与验收边界

本文是 Cosmos 测试层级、fixture、验收、临时数据和验证证据合同的真相源。当前默认门禁离线、可重复，不读取用户真实 `.cosmos` 数据，也不要求 Docker、公网来源或 OpenCLI；具体某次运行结果和未运行项只在对应 Task 与 [`PROJECT-STATUS.md`](../../PROJECT-STATUS.md) 记录。

## 分层入口

| 层级          | 命令                                                                         | 当前覆盖                                                                                                       |
| ------------- | ---------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| 单元          | `bun run test`                                                               | 包内和应用单元行为测试；默认配置排除 `*.property.test.ts`                                                       |
| 属性          | `bun run test:property`                                                      | 独立收集 `packages/**` 与 `apps/**` 下的 `*.property.test.ts`，覆盖幂等、租约 fencing 和 Worker recovery priority |
| 类型/数据库   | `bun run typecheck`、`bun run db:validate`、`bun run db:generate`            | 全仓 TypeScript、Prisma schema 与 Client                                                                       |
| 构建          | `bun run build`                                                              | packages、API、Worker、Next Web 生产产物                                                                       |
| Node 进程 E2E | `bun run test:e2e`                                                           | 构建后的真实 API/Worker、隔离 SQLite、HTTP、SSE、结构化日志；包含 ingest、Admin、跨进程 recovery、调度失败隔离 |
| 浏览器 E2E    | `bun run test:browser`、`bun run test:browser:component-lab` | 真实 Next/API/Worker Stack 产品流与首页主题偏好持久化/明暗跟随；开发态组件实验室交互、props、提交阻断、token、全局外观切换与隔离验收 |
| Windows smoke | `powershell -NoProfile -ExecutionPolicy Bypass -File scripts/smoke-node.ps1` | Windows Node API/Worker、迁移、受控 HTTP RSS、Feed/Search/Story、SSE、requestId 和脱敏日志                    |

`bun run test:e2e` 使用独立的 `vitest.e2e.config.ts`，先构建 API/Worker，再串行运行 `e2e/**/*.e2e.test.ts`。默认 `vitest.config.ts` 明确排除 `*.property.test.ts`；`bun run test:property` 使用独立的 `vitest.property.config.ts`，只收集当前三份 property 文件：`apps/worker/src/runtime.property.test.ts`、`packages/application/src/workflow-control.property.test.ts` 和 `packages/storage-prisma/src/workflow-host-store.property.test.ts`，不会扫描普通单元测试。

浏览器新增或改变用户流程时，回归测试落在 `e2e/browser/*.spec.ts`；可抽取的 URL 编解码、排序或状态转换等纯逻辑留在 unit 层。Task 必须把响应式与可访问性验收写成可观察条件；实际浏览器验证至少覆盖受影响 viewport、键盘操作、焦点/标签、console、page error 和失败网络请求。`test-results/` 中截图和 trace 被忽略，PR 通过外部附件提交必要的脱敏证据。

组件实验室的自动化验证分为两层。单元层比较 `apps/web/src/components/ui/*.tsx`、`apps/web/src/components/cosmos/*.tsx` 的公共组件模块与实验室注册表，拒绝未登记组件、不存在的模块、重复组件/场景 id、缺少默认场景、无效控件默认值和未登记 token；URL、localStorage 和 JSON 快照解析以 `unknown` 进入 Zod 边界，并覆盖非法输入不替换既有有效状态。该层属于默认 `bun run test` 与 CI Quality。

实验室新增或改变交互时必须在真实开发 Web 表面验证 `/dev/components`：组件/场景/视口/主题/配色 URL 可复现，前进后退正确，token 覆盖只影响预览画布，本地草稿可恢复，非法 JSON 导入保持原状态。浏览器验收覆盖 320、768、1024、1440 px、键盘与焦点、console、page error 和失败网络请求。生产 Web 还需在 build/start 后确认 `/dev/components` 返回 404，且实验室没有 Product API、SSE 或用户数据请求；开发态通过不能替代生产隔离验收。

数据迁移类改动必须在 `.agent/tmp/<name>-<uuid>/` 构造包含旧数据的隔离数据库：从受影响历史 schema 或最小 legacy seed 建库，执行待交付 migration，再断言字段映射、约束、索引和应用读取。全新空库 migration 只证明安装路径，不能替代旧数据升级。destructive contract 还需单独验证备份恢复和旧字段无活跃引用；具体命令与 seed 由 Task 记录，在形成稳定公共入口前不伪造通用脚本。

StoryRevision 版本化与 merge alias 的迁移升级以 `packages/storage-prisma/src/story-revision-versioning.test.ts` 为锚点（legacy 库 → backfill per-story revision → 唯一约束）；Story 编排命令行为（move/update/merge、alias 重定向与冲突）由 `story-orchestration.test.ts` 使用隔离库 seed 覆盖。浏览器产品流程中的归并/标题更新/旧 ID 重定向由 `e2e/browser/ingest.spec.ts` 覆盖。

Topic 域模型 v1（ADR-0007）的迁移为全新表（`20260908000000_topic_domain_v1`），无旧数据 backfill，仍按门禁跑 fresh + 旧库 upgrade 两态。Topic 语义（TopicRevision 指纹、membership revision/tombstone、merge 去重、Story merge 的 membership 迁移）由 `packages/storage-prisma/src/topic-domain.test.ts` 使用隔离库 seed 覆盖；角色枚举的写入校验/读取降级由 `packages/contracts/src/index.test.ts` 覆盖；API 错误映射由 `apps/api/src/app.controller.test.ts` 覆盖；Web 组件由 `apps/web/src/component-lab/registry.test.ts` 登记。

Entity/关系 v1（ADR-0008）的迁移为全新表（`20260908120000_entity_relation_v1`），无旧数据 backfill，仍按门禁跑 fresh + 旧库 upgrade 两态。Entity 语义（EntityRevision 指纹/no-op、Story↔Entity 幂等 link/unlink 与 provenance、Entity↔Entity 类型化关系与唯一约束、Story merge 的 StoryEntity 迁移 move/collision）由 `packages/storage-prisma/src/entity-relation-domain.test.ts` 使用隔离库 seed 覆盖；类型枚举写入校验/读取降级与命令 schema 由 `packages/contracts/src/index.test.ts` 覆盖；API 错误映射与 transport client 由 `apps/api/src/app.controller.test.ts`、`packages/transport-http/src/index.test.ts` 覆盖；Web EntityPanel/StoryPanel 关联入口由 `apps/web/src/component-lab/registry.test.ts` 登记。

用户组织 v1（ADR-0009）子切片 A（Label/Collection/Favorite）的迁移为全新表（`20260908140000_user_organization_v1`），无旧数据 backfill，仍按门禁跑 fresh + 旧库 upgrade 两态。Label 唯一命名与多态附加、Collection 成员幂等与 `containsStory` 投影、Favorite 幂等与 Story 详情投影、Story merge 的 `CollectionItem`/`Favorite`/`LabelAssignment` 迁移由 `packages/storage-prisma/src/user-organization-domain.test.ts` 使用隔离库 seed 覆盖；`targetTypes`/`favoriteTargetTypes` 受管枚举由 `packages/domain/src/index.test.ts` 覆盖，命令 schema 与读取侧放宽由 `packages/contracts/src/index.test.ts` 覆盖；transport client 路径由 `packages/transport-http/src/index.test.ts` 覆盖；API 回执与 404/409 映射由 `apps/api/src/app.controller.test.ts` 覆盖。子切片 B（Annotation）的迁移为全新表（`20260908160000_annotation_v1`），批注的创建/编辑/删除、`targetRevisionId` 写入捕获与 Story merge 的 targetId 重定向由同一 storage 测试文件覆盖，命令 schema 与读取侧放宽由 contracts 测试覆盖。子切片 C（Saved View）的迁移为全新表（`20260908180000_saved_view_v1`），SavedView CRUD 与 `search` 的 `labelIds`/`topicIds` any-of 过滤（含移除成员后不再命中）由同一 storage 测试文件覆盖；命令 schema 与 `SearchQuery` 扩展由 contracts 测试覆盖，transport 路径与 API 回执由 `packages/transport-http/src/index.test.ts`、`apps/api/src/app.controller.test.ts` 覆盖。

可配置看板 v1（ADR-0010）子切片 A 的迁移为全新表（`20260909100000_board_section_block_v1`），子切片 B 的 Spotlight 迁移同样为全新表（`20260909120000_spotlight_placement_v1`），均无旧数据 backfill，仍按门禁跑 fresh + 旧库 upgrade 两态。默认 Board 幂等 seed、Board 唯一名与缺失错误、按类型 config 白名单（未知 type 拒绝、非法 config 抛 ZodError）、跨 Section move 重排与 visible 切换、duplicate 原位副本、删除 Block 不删除被绑定 SavedView、Spotlight 幂等 pin/解除与目标标题解析、Story merge 的 placement 重定向（含同 Board 冲突丢弃）由 `packages/storage-prisma/src/board-domain.test.ts` 使用隔离库覆盖；`blockTypes`/`spotlightTargetTypes` 枚举由 `packages/domain/src/index.test.ts` 覆盖，命令/读取侧 schema、`blockConfigSchemaFor` 与 pin 目标枚举由 `packages/contracts/src/index.test.ts` 覆盖；transport 路径由 `packages/transport-http/src/index.test.ts` 覆盖，API 端点与错误映射由 `apps/api/src/app.controller.test.ts` 覆盖；Web `BoardView`（含编辑模式与 Spotlight 区块）由 `apps/web/src/component-lab/registry.test.ts` 登记，浏览器侧由 `e2e/browser/ingest.spec.ts` 覆盖隐藏/恢复与固定/解除流程。

Phase 2 验收补完（分类/Topic 浏览、Story 时间线、相关内容）不新增 Prisma 模型、migration、合同或 API 端点，只把既有读能力接出 Web 入口：时间线投影（多来源成员 Revision/Observation 展平排序、TemporalValue 退化与无时间回退）由 `apps/web/src/lib/story-timeline.test.ts` 覆盖，相关内容组合（共享分类/共享实体的去重、排除当前 Story、5 条上限、单信号失败降级）由 `apps/web/src/lib/related-stories.test.ts` 覆盖；分类/Topic 筛选与 Saved View 条件回填属于 `apps/web/src/components/cosmos/feed-browser.tsx` 与 `apps/web/src/app/page.tsx` 的行为，浏览器侧由 `e2e/browser/phase2-organization.spec.ts` 覆盖（分类筛选 + 保存/套用带分类条件的视图、时间线事件、相关内容共享分类、Topic/Entity/收藏/收藏夹/批注流程与 Topic 成员改角色/移除/恢复）。

性能修复使用 Task 记录的确定性 seed 或本地生成器，数据位于 `.agent/tmp/`。修复前后必须使用同一数据形状、规模、环境、命令和测量口径并重复采样；墙钟阈值不进入默认 `bun run test`，优先用查询次数、查询计划/索引、复杂度或有界结果等确定性断言防回归。原始基准输出不入库，Task/PR 记录完整命令、数据规模、环境、样本统计、波动和结论。

## 文档治理

组件实验室的自动化验证分为两层。单元层比较 `apps/web/src/components/ui/*.tsx`、`apps/web/src/components/cosmos/*.tsx` 的公共组件模块与实验室注册表，拒绝未登记组件、不存在的模块、重复组件/场景 id、缺少默认场景、无效控件默认值和未登记 token；URL、localStorage 和 JSON 快照解析以 `unknown` 进入 Zod 边界，并覆盖非法输入不替换既有有效状态。该层属于默认 `bun run test` 与 CI Quality。

实验室新增或改变交互时必须在真实开发 Web 表面验证 `/dev/components`：组件/场景/视口/主题/配色 URL 可复现，前进后退正确，token 覆盖只影响预览画布，本地草稿可恢复，非法 JSON 导入保持原状态。浏览器验收覆盖 320、768、1024、1440 px、键盘与焦点、console、page error 和失败网络请求。生产 Web 还需在 build/start 后确认 `/dev/components` 返回 404，且实验室没有 Product API、SSE 或用户数据请求；开发态通过不能替代生产隔离验收。

外观主题回归边界：生产表面验证无存储时跟随系统、显式 Night 刷新保持并压过后续系统变化、“跟随系统”清除 key 后即时响应 `prefers-color-scheme`，以及 `<html>` 首帧属性正确；实验室表面验证同一持久偏好驱动 chrome，URL `theme/colorway` 仅控制预览根，token override 不泄漏。两类表面均监听 hydration/server-rendered HTML 匹配的 console/page error，并在 390px 断言无页面级横向溢出。

`bun run docs:check` 要求治理入口存在、根 README 可达 Agent 治理入口，并锁定 canonical workflow 同时保留私密安全报告与普通非安全 Bug 的公开 Issue 路由。它检查根目录、`docs/`（排除原始需求与 research）、`.agents/`、`.local/README.md` 和 `.github/` 中活跃 Markdown 的相对目标文件或目录，并拒绝退休路径、反斜杠、仓库越界和 Windows 盘符绝对路径。query 和 fragment 不参与目标路径解析，门禁不校验标题锚点或代码行号是否存在。它不执行应用代码，也不替代类型检查、行为测试、构建或运行时验收；文档迁移和治理规则变更必须运行该命令。Markdown 结构、代码围栏和链接语义由 diff 人工审查，尾随空白由 `git diff --check` 检查。

## 隔离与进程

Node E2E 通过 `scripts/e2e/helpers.ts` 为每个场景创建 `.agent/tmp/<name>-<uuid>/`，分别放置 Data、Blob 和 Log Root，并调用 Prisma migration。API、Worker 和 Worker Admin 使用动态端口；测试不能假设 `9091` 空闲。Windows 停止进程树使用 `taskkill /t /f`，POSIX 使用进程组终止；所有测试在 finally 中停止服务。

受控 RSS recovery 使用 `scripts/e2e/controlled-rss.ts` 的真实 HTTP 请求、请求到达和 lease expiry 同步，不使用固定 sleep 伪造接管。验证从 API、SQLite、结构化日志和最终 Feed/Run 读取，不接受进程自报成功。

默认 ingest、scheduling、浏览器和 Windows smoke 通过受控本地 HTTP RSS 服务验证产品 `source.rss@1/fetch + feedUrl` 合同；Source 创建默认停用，测试必须再调用 activation command。`fixture-rss` 只保留在 Connector/迁移层测试，不得作为 Product API 或 Web 配置入口。

媒体获取测试使用 `fixtures/rss/basic.xml`（含不可达 enclosure 触发 `skipped`）和 `fixtures/rss/media-av.xml`（音视频 `metadata_only`）覆盖降级分支。Worker 通过 `COSMOS_MEDIA_ALLOWED_HOSTS` 环境变量放行测试媒体源，默认为空即拦截私网；该变量仅用于测试环境，不进入产品 Source 配置（ADR-0005）。

浏览器 Stack 由 `scripts/e2e/web-stack.ts` 管理隔离 API/Worker/Next 进程。动态 API 端口在 Next production build 前注入，Web 使用 same-origin `/api` rewrite；需要先安装 Chromium：

```text
bunx playwright install chromium
```

测试监听 `pageerror`、未预期 console error 和网络失败，并在 teardown 清理全部子进程。截图和 trace 位于被忽略的 `test-results/`，不作为业务状态来源。

浏览器断网场景（`e2e/browser/offline.spec.ts`）使用本地受控 RSS 与本地 SVG 图片（`fixtures/rss/offline-media.xml`、`fixtures/rss/media/fixture-image.svg`），不依赖真实外网；Browser 栈通过 `COSMOS_MEDIA_ALLOWED_HOSTS=127.0.0.1` 放行该测试媒体源，Playwright 再以路由拦截模拟断网并验证站内 `/api/v1/assets` 图片加载。

安全漏洞的完整复现命令、载荷和原始证据只留在 `.agent/tmp/` 或批准的私密报告渠道。公开测试使用能证明授权、containment 或校验边界的泛化输入；Task、PR、截图和日志只写脱敏摘要，不能为了“完整命令”暴露漏洞细节。

## 可选验收

Docker 只通过显式命令执行：

```text
bun run test:docker
```

命令检查 Docker CLI/daemon，执行 `docker compose -f docker/compose.yml up --build -d`，等待 API/Web/Worker 与 Compose 内受控 RSS 服务，按 `source.rss@1/fetch` 完成激活、Run 和 Feed 验收，最后执行 `down --volumes --remove-orphans`。Docker 不属于 `test`、`test:e2e` 或默认 CI；缺少 Docker 前置时命令明确失败。

真实来源只通过显式命令执行，并且每种来源独立校验前置：

```text
COSMOS_REAL_RSS_URL=<url> bun run test:real:rss
COSMOS_ALLOW_REAL_NETWORK=true bun run test:real:aihot
COSMOS_ALLOW_REAL_NETWORK=true COSMOS_OPENCLI_PATH=<path> OPENCLI_PROFILE=<profile> bun run test:real:bilibili
```

真实来源脚本使用隔离 API/Worker/SQLite，要求 Run 成功、item count 在 bounded 范围内并通过日志脱敏检查。缺变量、联网许可或 OpenCLI/Browser Bridge 前置时立即失败；这些命令不进入默认 CI，也不把网络错误解释为离线 Worker 回归。

## CI 分层

`.github/workflows/ci.yml` 将质量、Node E2E、浏览器 E2E 和 Windows smoke 分为独立 job。质量 job 依次执行 `bun run docs:check`、数据库检查、类型检查、单元测试、属性测试、Web lint 和构建；Node/browser/smoke job 分别报告自己的结果。当前 workflow 未按路径跳过 job，因此纯文档 PR 在远端仍运行完整默认 CI；本地最短路径只要求文档门禁、人工 diff 审查和 `git diff --check`。Docker 和真实来源没有加入默认 CI。

## 证据边界

测试通过只证明对应层的可观察合同：单元测试不替代进程 E2E，Node E2E 不替代浏览器验收，浏览器验收不替代 Docker 或真实来源。受控 RSS、SSE 消费和结构化日志是当前 Cosmos 的可复现测试边界；当前哪些层级已通过或未运行，以 [`PROJECT-STATUS.md`](../../PROJECT-STATUS.md) 为准。本文不引入 Agent/LLM replay。
