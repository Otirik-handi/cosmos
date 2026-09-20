# Task 32 walkthrough（过程、偏差与验证）

> 本文件是 Task 32 的唯一过程记录（append-only）；README 只保留摘要、范围、口径与下一步。
>
> 2026-09-18 按文档大小治理拆出封口分册：切片 1–5 的逐片证据与「Phase 1 收口结果」移入 [`walkthrough/slices-1-5.md`](walkthrough/slices-1-5.md)（只搬位置、不改写条目）。

→ 切片 1-5 与 Phase 1 收口结果 已归档:[walkthrough/slices-1-5.md](walkthrough/slices-1-5.md)

## Phase 1 缺口复核与口径登记（2026-09-18，本 Task 合并后）

### 复核方法与结果

对 PRD §7 中所有 `Phase 1`/`Phase 1B`/`Phase 1C` 行（AUT/RUN/ING/LIB/REC/BRD/OPS/EXT 系列）与 §12 Phase 1 的验收条件逐条核对，并回到代码确认「已交付」的断言。结果：**本 Task 负责的五条全部闭合**，但需求表另有 4 行不属本 Task 范围且未闭合、3 类口径/验证缺口未被登记。逐条状态与证据登记进 PRD 勘误台账（不在此重复）：Gateway 三行（RUN-010/RUN-011/OPS-010）、`EXT-008`、AUT-001 的「删除凭据」、§12 Phase 1 验收。

### 本轮实际改动（第一轮为纯文档；第二轮的源码改动见下文 EXT-008 节）

| 文件 | 改动 |
|---|---|
| `docs/requirements/0002-product-requirements.md` | 勘误表新增 4 行后**整表拆出**为独立台账（见下），主文档只留索引链接；分册索引加一行 |
| `docs/requirements/0002-product-requirements/ERRATA.md` | **新建**：分册勘误登记台账（含全部历史条目，只搬位置不改写）+ 本轮 4 条新条目 |
| `docs/requirements/0002-product-requirements/part-07-1.md` | 表后加 AUT-001 与 RUN-010/011 两条收口注记 |
| `docs/requirements/0002-product-requirements/part-07-3.md` | 表后加 OPS-010 与 `EXT-008` 两条收口注记 |
| `docs/requirements/0002-product-requirements/part-10-12.md` | §12 Phase 1 前言补「本节是权威口径、状态变化只登记勘误」与逐项定状态摘要 |
| `.agents/tasks/32-phase1-closure/README.md` | Current State 改为已合并事实；Follow-ups 改为三项待裁定 + 后置债 |
| `PROJECT-STATUS.md` | 基线改 `b9e596f`、合并/推送事实、Phase 1C 四行未闭合、三项待裁定、验证缺口；两处已完成记录移入分册 |
| `PROJECT-STATUS/history-2026-09-4.md` | 接收移入的 ING-006 合并与需求表改标记录 |

### 拆分原因（文档治理）

主文档与 `PROJECT-STATUS.md` 在本轮编辑后分别到约 9.6k / 9.5k token，越过文档治理的警戒线（>9k token），size 门禁报「新增警戒区文件」。按 [`oversized-doc-splitting-v1`](../../../docs/proposals/oversized-doc-splitting-v1.md) 的「追加型文档按预算滚动归档」处理：勘误登记是纯追加台账 → 拆成 `ERRATA.md`；`PROJECT-STATUS.md` 的两条已完成记录 → 移入既有分册。拆分**只搬位置、不改写条目**，结果两个文件分别回到约 5.4k / 8.9k token。

### 本轮明确不做的事

- **AUT-003 真实来源验收（未运行）**：`COSMOS_REAL_RSS_URL`、`COSMOS_ALLOW_REAL_NETWORK`、`COSMOS_OPENCLI_PATH`、`OPENCLI_PROFILE` 在本次环境中均未设置；该验收需要真实公网 URL 与显式网络授权，属维护者授权范围，本轮不自行发起。
- **AUT-001 删除凭据不实现**：需先裁定「Connection 删除是否连带删除密钥字节」；当前无 `secret_ref` 来源，实现会先于需求落地。
- **浏览器用例（删除来源入口、LIB-001 三个过滤控件）不新增**：属新测试范围，需单独切片与授权；本轮只登记缺口。

### 待维护者裁定（三项）

1. Gateway 三行的目标阶段与排期顺序（需求表仍按 `Phase 1C` 读作待交付，直到改标）。
2. `EXT-008`：补「没有 Connector executable 的 API 构建」测试与独立构建实跑，还是收窄口径。
3. AUT-001「删除凭据」：补实现还是收窄口径。

### 本轮验证

| 命令 | 结果 |
|---|---|
| `bun run docs:check` | **700 文件 0 失败**（首轮 3 处相对链接断链：主文档 → Task 32 的 `../.agents/` 应为 `../../.agents/`、`ERRATA.md` 拆出后两处需多退一级；均已修正后复跑通过） |
| `python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` | **PASS**（含既有基线文件增长 warning）；首轮 FAIL 2 项（新增警戒区：`PROJECT-STATUS.md` 29.6 KB / 约 9.7k token、PRD 主文档 28.5 KB / 约 9.6k token），按上文拆分后解除 |
| `git diff --check` | 干净 |

未运行（口径登记轮）：typecheck / test / build / browser —— 该轮只改 Markdown，无源码与配置变化，按仓库规则不重复跑代码门禁。

## EXT-008 边界的行为测试与 catalog 只读修正（2026-09-18，第二轮）

口径登记完成后，对仍待裁定的三项中唯一可以先用测试收敛的 `EXT-008` 做了实现层验证。

### 发现与修正

- 新增 [`packages/application/src/catalog-manifest-only.test.ts`](../../../packages/application/src/catalog-manifest-only.test.ts)：断言四个内置来源的 manifest/schema/capability 在**没有任何 Connector executable** 时全部可得、`/connectors` 目录由同一批 manifest 投影、catalog 实例没有 `fetch`/`execute`/`resolve` 等执行面、`apps/api/package.json` 依赖不含 `@cosmos/plugin-collectors`、执行必须显式注册 executable（`ConnectorRegistry`）。
- 该测试首轮 **RED**：`StaticCatalog.listSourceDefinitions()` 返回的是内部数组，调用方 `push` 一次就能改掉进程级共享 catalog 的 `capabilities`。这是真实缺陷而非测试写法问题——`operationIds` 与 `capabilities` 参与 `SourceProbeService.validate` 的可用性判断，manifest 被改写会让校验与展示偏离构建时的定义。
- 修正 [`packages/application/src/catalog.ts`](../../../packages/application/src/catalog.ts)：`StaticCatalog` 的读接口（`listSourceDefinitions`/`getSourceDefinition`/`getSourceDefinitionByRef`/`listWorkflowDefinitions`/`getWorkflowDefinition`/`listActionDefinitions`/`getActionDefinition`/`listConnectors`）改为按值返回副本，构造函数改用一个私有 `copySourceDefinition` helper。**这是本轮唯一的源码改动**，行为等价（只影响返回值的所有权），未改任何签名与类型。

### 验证

| 命令 | 结果 |
|---|---|
| `bunx vitest run packages/application/src/catalog-manifest-only.test.ts` | 5 passed（首轮 4 passed / 1 failed，修正后全绿） |
| `bunx vitest run packages/application apps/api packages/contracts` | 33 文件 / 232 用例全绿 |
| `bunx vitest run`（全仓） | **105 文件通过 / 617 用例全绿**；1 个文件失败是环境问题（`apps/web/src/component-lab/registry.test.ts` 与 `apps/web` 的 `@dnd-kit/*` 在主工作区 `node_modules` 中缺失，属 `PROJECT-STATUS.md` 已记录的「主工作区 node_modules 与 lockfile 不一致」），与本轮改动无关 |
| `bun run --cwd packages/application typecheck`、`bun run --cwd apps/api typecheck` | 0 |
| `bun run typecheck`（全仓） | **未通过**，两类既有环境问题：① `packages/storage-prisma/src/repository/sources.ts` 的 `deletedAt` 报错来自陈旧 Prisma Client，已用 `bun run db:generate` 重新生成后消除；② 剩余 3 处 `@dnd-kit/*` 找不到模块，属上述主工作区依赖不一致 |
| `bun run db:generate` | 通过（重新生成 Prisma Client 6.19.3，消除 9 处陈旧类型报错） |
| `bun run docs:check` / size 门禁 / `git diff --check` | 700 文件 0 失败 / PASS / 干净 |

### 结论与剩余

`EXT-008` 的第一、二条验收条件（Catalog Query 在没有 Connector executable 时可用、Worker 注册精确 manifest evidence）现有行为测试与结构性证据；第三条（独立构建/部署实跑）在维护者裁定前按「未运行」登记。

## 三项裁定的落地（2026-09-18，第三轮）

维护者同日对三项待裁定逐一答复，本轮按裁定实现并登记。

### 裁定 1：Gateway 三行改标 `Phase 3`

- 勘误台账条目改为「由 `Phase 1C` 更正为 `Phase 3`」，理由是与插件运行时、Agent 执行位置（`remote_worker` placement）同源；`part-07-1.md` / `part-07-3.md` 的表后注记同步。
- 结果：§7 不再把这三行读作 Phase 1 的待交付项。

### 裁定 2：`EXT-008` 记为已交付，独立构建实跑并入既有生产验收清单

- 勘误台账条目改为「Phase 1 已交付」，并写明第三条验收并入「manifest-only API、executable-only Worker 与独立 Migrator 完整生产验收」一条（与 Docker/独立 Migrator 同批）。
- `PROJECT-STATUS.md` 的「尚未实现」清单相应保留该生产验收一条，不再单列 `EXT-008`。

### 裁定 3：AUT-001「删除凭据」补实现

源码改动两处 + 测试三处：

- [`packages/storage-prisma/src/repository/base.ts`](../../../packages/storage-prisma/src/repository/base.ts)：`PrismaCosmosRepositoryBase` 新增 `secrets: SecretStorePort`，缺省按 Data Root 的 `secretRoot` 构造 `FileSecretStore`（与既有 `blobs` 同构），并支持注入替身。
- [`packages/storage-prisma/src/repository/sources.ts`](../../../packages/storage-prisma/src/repository/sources.ts)：`deleteConnection` 先读连接的 `secretRef`，在同一动作里「删行 + 解引用」后删除密钥字节；顺序是先删行后删密钥（行删掉即视为删除完成，密钥残留只是可清理垃圾；反过来会留下指向空密钥的活连接）。密钥删除失败只记 `connection.secret.delete_failed` warn，不让删除失败（重试删除幂等）。
- **同批修掉一个潜在缺陷**：[`packages/storage-prisma/src/secret-store.ts`](../../../packages/storage-prisma/src/secret-store.ts) 的路径校验原先「含 `:` 即判为逃逸」，而产品侧写入的 ref 形态是 `secret:conn-1`（API 与仓储测试都用它）——任何真实凭据都写不进去。现改由 `isAbsolute` 与「解析后仍在根内」判断逃逸，`../`、绝对路径、空 ref 仍被拒。这个缺陷是新增的「删除凭据」用例第一次真正 `put` 一个产品形态 ref 时暴露的。

### 验证（第三轮）

| 命令 | 结果 |
|---|---|
| `bunx vitest run packages/storage-prisma/src/secret-store.test.ts packages/storage-prisma/src/connection-state-store.test.ts` | 8 passed（新增 4 例：删除连接后 `secrets.read` 返回 null、无 secretRef 的连接删除幂等、`secret:` 形态可写入、三种逃逸/空 ref 被拒） |
| `bunx vitest run`（全仓） | **105 文件通过 / 620 用例全绿**；1 个文件失败仍是主工作区缺 `@dnd-kit/*` 的环境问题 |
| `bun run --cwd packages/storage-prisma typecheck`、`packages/application`、`apps/api` | 0 |
| `bun run docs:check` / size 门禁 / `git diff --check` | 701 文件 0 失败 / PASS / 干净 |

未运行：全仓 `bun run typecheck`（主工作区缺 `@dnd-kit/*`）、`bun run build`、浏览器套件、真实来源验收。

## 三项授权的收尾（2026-09-18，第四轮）

维护者授权三件事：补两个浏览器用例、跑真实来源验收、commit + push。执行前先修好了主工作区环境。

### 环境修复（前置，不是本任务范围）

主工作区 `node_modules` 缺 `@dnd-kit/*`（`package.json` 与 `bun.lock` 都声明了、只是没装），导致全仓 typecheck 与浏览器套件不可用——这就是 `PROJECT-STATUS.md` 长期记录的「主工作区 node_modules 与 lockfile 不一致」。执行 `bun install`（833 个包）后：**`bun run typecheck` 全仓 0 错误**、`bun run test` **106 文件 / 632 用例全绿**、`bun run build` 通过。**`bun.lock` 与 `package.json` 无改动**（`git status` 为空）。此前几轮记的「@dnd-kit 缺失导致 1 个文件失败」由此作废。

### 补两个浏览器用例

新增 [`e2e/browser/source-lifecycle-and-search-filters.spec.ts`](../../../e2e/browser/source-lifecycle-and-search-filters.spec.ts)（2 例），补上 Task 32 切片 1 与切片 4 各自记录的「只有组件层证据」缺口：

1. **删除来源两段确认（AUT-001）**：第一次点击只切确认态并显示「删除来源只移除配置与定时…」、来源仍在；第二次点击后来源从来源健康看板消失；**同时断言已录入的 Story 仍在 Feed 里**（墓碑语义）。
2. **LIB-001 三个过滤维度**：作者条件命中 0 条（fixture 条目没有 `<author>`，`normalizePublisher` 因此返回 null）；媒体类型「视频」0 条、「文章」命中全部（RSS 连接器固定 `kind: "article"`）；录入状态与媒体类型的条数一律以**同一条件直查 `/api/v1/search`** 为准。

**两处实施中修正**（都记在此以免被读成一次通过）：
- 首版用 Feed 的 Story 卡片数去比搜索结果条数——两者不是同一投影（Feed 是 Story 卡片、搜索是 Entry 分页），单跑碰巧相等、整套跑时暴露。改为同一条件直查 API。
- 直查 API 首版用 `limit=50`，而页面提交固定 `limit: 20`；整套跑时共享栈数据变多（37 vs 20）才暴露。改为与页面同页大小。

### 真实来源验收（AUT-003 条件请求所在链路）

```text
COSMOS_REAL_RSS_URL=https://www.ruanyifeng.com/blog/atom.xml COSMOS_ALLOW_REAL_NETWORK=true bun run test:real:rss
Real rss acceptance passed: Run run_b562e08e-6bdc-4eaa-8ed7-75fc156a16cd, bounded item count 3.
```

真实公网 RSS 的完整采集链路（隔离 API/Worker/SQLite、创建来源、激活、Run、item count 边界与日志脱敏检查）通过。**边界**：该脚本只跑一次抓取，因此 **304 短路本身没有被这次验收直接观察到**——条件请求的证据仍是 `plugins/rss` 的 fixture 用例（Task 32 切片 3）。

### 浏览器套件（全量，本机）

```text
COSMOS_E2E_WEB_PORT=4183 bunx playwright test --config playwright.config.ts
24 passed (1.4m)
```

含新增 2 例；**`phase2-organization.spec.ts:103` 与 `:417` 本轮通过**（这两条是 `known-unstable-cases.md` 登记为「未归因」的用例）。本轮未复现整套失败，但不据此宣布归因完成——单次通过不等于稳定，登记保持不变。

### 验证汇总（第四轮）

| 命令 | 结果 |
|---|---|
| `bun install` | 833 packages，`bun.lock` / `package.json` 无改动 |
| `bun run typecheck` | 全仓 0 |
| `bun run test` | **106 文件 / 632 用例全绿** |
| `bun run build` | 通过（API + Worker + Next standalone） |
| `bunx playwright test --config playwright.config.ts` | **24 passed** |
| `COSMOS_REAL_RSS_URL=… bun run test:real:rss` | 通过，Run `run_b562e08e…`，item count 3 |
| `bun run docs:check` / size 门禁 / `git diff --check` | 见提交前门禁 |

未运行：`test:property`、Node 进程 E2E、Windows Node smoke、Docker/Compose、组件实验室套件、AI HOT 与 Bilibili 真实来源（本轮只授权并执行了 RSS 一项）。

### 远端 CI（推送后补记）

推送 `af302f7` 后 fork 远端 CI 运行 [35497299186](https://github.com/Otirik-handi/cosmos/actions/runs/35497299186) **五个 job 全绿**：Docs 8s、Quality 4m27s、Windows Node smoke 2m58s、Browser E2E 3m31s、Node process E2E 1m12s。

因此上表「未运行」里的 **Node 进程 E2E 与 Windows Node smoke 已由远端 CI 覆盖并通过**（这两项本地一直未跑）。首次查询时用了 `gh run list` 的默认仓库解析，读到的是上游 `notnotype/cosmos` 的历史运行；本仓库 CI 在 fork `Otirik-handi/cosmos`，需用 `-R Otirik-handi/cosmos` 指定。

## 三项验证缺口的补齐（2026-09-20）

上一轮列出的验证缺口逐个关闭。

### AUT-003 的 304 短路（此前只有 `plugins/rss` 的 fixture 证据）

真实公网验收只跑一次抓取、观察不到第二次的 304，所以改用受控服务把服务端行为钉死：

- [`scripts/e2e/controlled-rss.ts`](../../../scripts/e2e/controlled-rss.ts)：`ControlledRssRequest` 增加 `headers`（键小写），测试才能断言 Worker 真的带上了条件头。既有用例不受影响。
- 新增 [`e2e/conditional-fetch.e2e.test.ts`](../../../e2e/conditional-fetch.e2e.test.ts)（2 例，真实 API/Worker/SQLite 隔离栈）：
  1. 受控服务返回 200 + `ETag`/`Last-Modified`；第一次抓取**不带**条件头，抓完后**直读 `ConnectorState` 表**断言 `http-cache` 里的验证器与响应一致。
  2. 受控服务改为 304；第二次抓取**真的带上** `If-None-Match`/`If-Modified-Since`，Worker 记录 `connector.transport.not_modified`，条目数不变（短路、不重新解析正文）。

**两处实施中修正**：首版把 `waitForRequest(1)` 放在排队 Run 之前——抓取由 Run 触发，请求还没发生就等，必然超时；改为先排队再等。另：`test:e2e` 在 Windows 需要 `BUN_BINARY` 指向真实 bun.exe（既有已知前置，见 `docs/testing/README.md`）。

### `test:property` 与组件实验室套件

两项此前一直记「本机未运行」，本轮实际跑通（数字见下表）。

### 验证（第五轮，全部实际运行）

| 命令 | 结果 |
|---|---|
| `bunx vitest run --config vitest.e2e.config.ts`（含新增用例） | **5 文件 / 6 用例全绿** |
| `bun run test:property` | **3 文件 / 4 用例全绿** |
| `bun run test:browser:component-lab` | **14 passed** |
| `bun run typecheck` | 全仓 0 |
| `bun run test` | **106 文件 / 632 用例全绿** |
| `bun run docs:check` / size 门禁 / `git diff --check` | 见提交前门禁 |

### 关闭后的剩余（都不是 Phase 1 缺口）

- **后置债**：Docker/Compose 容器验收、发布部署、真实公网长时定时抓取、非 Windows 平台 smoke（由 CI 覆盖）、长时 Worker 重启演练。
- **真实来源**：AI HOT 与 Bilibili 本轮未跑（授权范围只到 RSS）。
