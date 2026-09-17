# Task 26 walkthrough：Entry 跨来源重复/转载关系 v1（ING-006 第二切片）

> 过程、偏差与验证的唯一记录；当前摘要、范围与门禁状态见 [README.md](README.md)。

## 2026-09-17：切片定义复核与开工

- 背景：维护者 2026-09-16 接受 Proposal [`entry-duplicate-relations-v1`](../../../docs/proposals/entry-duplicate-relations-v1.md)（ING-006 的「标记重复/转载」半边）与 [ADR-0022](../../../docs/adr/0022-entry-duplicate-relations-v1.md)，分配 Task 26、批准 worktree 与分支。实施顺序排在 Task 10 的「实施切片 4」（ORG-017）之后；该切片已合并（`6809c0b`），本切片按其三步走做法实施。
- worktree `.worktree/t26-entry-duplicate-relations`、分支 `feat/t26-entry-duplicate-relations`、base `aab0748`（维护者 2026-09-17 再次确认名字与 base）。`git fetch origin` 因本机无 GitHub 凭据失败（`schannel: SEC_E_NO_CREDENTIALS`），改用本地已缓存的 `origin/master`（= `aab0748`，与 `master` 一致），没有从远端刷新。
- 开工前向维护者确认了三处会决定实现形态的读法，三条都得到明确回答：
  1. **反向提交 409 的范围**：ADR-0022 决定 3 只把它写在**有向类型**那一条。确认按 ADR 实现——同一对条目按**无序对**查找已有行，`syndicated_from` 方向相反才 409，对称类型的反向提交只是同一行的覆盖写。任务描述里「反向提交与自关联 409」若读成对所有类型都成立，会与「对称类型保证同一对只有一行」冲突。
  2. **Web 入口位置**：仓库没有独立的条目详情页（`EntryDetail` 只通过 Story 详情与「相关内容」投影到前端）。确认 v1 的入口放在 Story 面板「来源成员」每一行，不新增 UI 面，符合 ADR-0022 决定 7。
  3. **worktree/分支/base**：见上。

## 2026-09-17：实现（三步走）

### 切片 1：域语义 + 持久化

- `packages/domain/src/index.ts`：`entryRelationTypes`（三个受管词）+ `symmetricEntryRelationTypes` + `isSymmetricEntryRelationType` + `normalizeEntryRelationEndpoints`（对称类型按 id 字典序归一化，有向类型保留调用方方向）。
- `packages/storage-prisma/prisma/schema.prisma`：新表 `EntryRelation`（`(fromEntryId, toEntryId)` 唯一 + `relationType` + provenance + 时间戳、两个 `onDelete: Cascade` 外键、`(toEntryId)` 索引）+ `Entry` 两条反向关系字段；migration `20260916140000_entry_relation_v1`（全新表、forward-only、无 backfill）。
- `packages/application/src/errors.ts`：`EntryRelationConflictError`（`code: "conflict"`，映射 409）。
- `packages/storage-prisma/src/repository/entry-relations.ts`（新文件，插在 `entity-links` 与 `labels` 之间）：`linkEntryRelation` / `unlinkEntryRelation`。写完返回 `fromEntryId` 那一侧刷新后的 `EntryDetail`。
- `packages/storage-prisma/src/repository/repository-internals.ts`：`entryRelationIndexByEntry` —— 双边查询 + 按「读到的这一侧」给出 `direction`，对端条目的标题/来源在同一查询里 join。放在这里而不是仓储类里，是因为 `story()`/`entry()` 所在的 `helpers-2` 是写入类的祖先，只有模块级函数能被两侧共用（一处投影真相）。
- `helpers-2.ts`：`story()` 的成员行与 `entry()` 都投影 `relations`；`mergeStories`/`splitStory` **未改动**，由回归断言保护。

### 切片 2：公共合同与 Product API

- `packages/contracts/src/entry-relation.ts`：`entryRelationTypes` 读取侧放宽、`entryRelationSchema`（含 `direction`）、`entryDetailSchema.relations`、`entryRelationProvenanceSchema`、`linkEntryRelationCommandSchema` / `unlinkEntryRelationCommandSchema`。
- `packages/application/src/repository-port.ts`：端口加两条命令。
- `packages/transport-http/src/client-content.ts`：`linkEntryRelation` / `unlinkEntryRelation` → `POST /api/v1/entry-relations` 与 `.../removals`。
- `apps/api/src/app.controller/content.ts`：两个端点，错误经 `sourceCommandError` 落到 400/404/409。

### 切片 3：Web + 组件实验室

- `apps/web/src/lib/entry-relations.ts`（新）：类型标签、方向措辞（`转载自 X` / `被 X 转载` / `重复于 X` / `近似于 X`，未知类型显示原文）、对端候选过滤（排除自己与已挂关系的条目）、表单草稿。
- `apps/web/src/components/cosmos/story-panel/source-members.tsx`：成员行显示关系徽章、关系类型/对端来源/理由与「解除」，并内联展开「标记重复 / 转载」表单。表单状态留在该组件内，面板只提供两条写命令。
- `story-panel.tsx` / `app/home/use-story-workspace.ts` / `app/page.tsx`：两个回调的透传；写命令返回的是条目侧的 `EntryDetail`（不是本 Story），所以成功后重读 `client.story(storyId)` 刷新成员行。
- 组件实验室：`product-fixtures.tsx` 新增 `entry-relations` 场景（第二条成员转载自第一条）+ `registry.tsx` 登记；`e2e/component-lab/story-panel.spec.ts` 新增渲染用例。
- 浏览器验收：`e2e/browser/phase2-entry-relation.spec.ts`（新文件）。

## 偏差与实现取舍

1. **合同改动跨了两个切片**：切片 1 只该有 domain + migration + storage，但 storage 的读取投影本身就是 `EntryDetail`，所以切片 1 一并加了 `entryRelationSchema` 与 `EntryDetail.relations`（否则包不编译）；写命令 schema 留在切片 2。README 的切片表未因此修改，记在这里。
2. **成员行标注复用 `EntryDetail.relations`**，没有新增第二个字段：Story 成员本来就是 `EntryDetail`，一个字段同时满足 ADR-0022 决定 7 的两处读取，避免出现两份投影真相。ADR 里「不带对端 Story 链接」由「对端只给 id/标题/来源」实现，不额外取数。
3. **写命令返回 `fromEntryId` 那一侧**（对称类型下 `from`/`to` 只是这一对的输入顺序）。这样与 `entity-relations` 的返回形态一致；Web 因此需要重读 Story，这一条写在 `use-story-workspace.ts` 的注释里。
4. **对称类型反向提交是覆盖写，不是 409**：见开工记录第 1 条。有向↔有向方向相反才 409；对称↔有向互为覆盖（行会整体翻向），并由「一对条目只有一行」的断言保护。
5. **删掉了 `SourceMembersSection` 上两个死 props**（`title`、`relatedStories`）：它们在改动前就没有被使用，重写该文件时顺手清掉，`lint:web` 警告数因此从 83 降到 81。
6. **`apps/web/src/components/cosmos/story-panel.tsx` 在改动前已是 824 行**（超过 800 行红线），本切片为透传两个回调又加了约 12 行。这是既有欠账，不是本切片引入；拆出成员行/操作区属于另一次行为等价重构，记为 follow-up。
7. **浏览器 spec 命名 `phase2-entry-relation.spec.ts`**：`e2e/browser/ingest.spec.ts` 是「空信息库上的第一次录入」写法（取 Feed 第一张卡片与 `items[0]` 当自己的内容），因此套件里排在它前面的 spec 会让它失败。第一版命名为 `entry-relation.spec.ts`（排在 `ingest` 之前）时实测如此，于是与其它后置 spec 一样放到 `ingest` 之后，并**回退了当时为了让它过而改的 `ingest.spec.ts`**——那个 spec 的排序依赖是既有事实，不在本切片范围，已记为 follow-up。

## 验证（2026-09-17，worktree 内实际运行）

- `bunx vitest run packages/domain` → **1 文件 / 22 用例全绿**（含新增 3 例：枚举稳定、只有两种对称、归一化顺序与有向保留）。
- `bunx vitest run --no-file-parallelism packages/storage-prisma/src/entry-relation-domain.test.ts` → **12 例全绿**（有向两侧读取、对称反向同写一行、幂等不追加事件、改类型覆盖、有向反向 409、自关联 409、未知端点 404、对称→有向翻行不新增、解除幂等、条目删除级联、成员行含 Story 外对端、未知类型降级、`mergeStories`+`splitStory` 前后逐字段不变、隔离旧库 upgrade 只新增空表且唯一键生效）。Windows 下用 `--no-file-parallelism`。
- `bunx vitest run --no-file-parallelism packages/storage-prisma` → **30 文件 / 159 用例全绿**（428.6s，本轮未出现既有的 Windows SQLite 抖动）。
- `bunx vitest run packages/contracts packages/transport-http apps/api` → **30 文件 / 159 用例全绿**。
- `bunx vitest run apps/web` → **14 文件 / 89 用例全绿**。
- `bun run test`（全量）→ **99 文件 / 599 用例全绿**。
- `bun run typecheck` → exit 0。
- `bun run build`（packages + api + worker + Next standalone）→ 通过。
- `bun run lint:web` → **0 error / 81 warning**（改动前 83；本切片涉及的文件 0 warning）。
- 组件实验室：`bun run test:browser:component-lab` → **15/15 通过**，含新增的 `entry-relations` 场景用例。
- 文档门禁（worktree 内）：`bun run docs:check` → **666 文件 `failures: []`**；`python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` → **PASS（含 warning）**，6 条 warning 都是基线内文件的既有增长（本切片新增的是 `docs/testing/README.md` 与 5 个 `docs/spec` 段落）；`git diff --check` → exit 0。
  - 注意：size 门禁会扫描文件系统，第一次跑时被上一次浏览器运行的 `test-results/` 产物判为「新增红线文件」（该目录在 `.gitignore` 里、不是仓库内容），删掉产物后复跑 PASS。
  - `docs/spec/storage/0001-prisma-repository.md` 现在 49.27 KB，离 50 KB 红线只剩不到 1 KB（它是基线登记文件，增长只报 warning）——记为 follow-up。
- 浏览器套件：见下节。

### 导出面与路由表守卫

- `packages/contracts/entry-surface.txt` 按入口治理规则显式重生成：**+10 行**（`EntryRelation`/`EntryRelationProvenance`/`EntryRelationType`/`LinkEntryRelationCommand`/`UnlinkEntryRelationCommand` 与 5 个 schema），其余逐字节不变。
- `packages/application/entry-surface.txt` 重生成：**+1 行**（`EntryRelationConflictError`，因为它在应用层的公共导出面里）。`packages/transport-http/entry-surface.txt` 重生成后 **0 行 diff**（新增的是客户端方法，不是模块导出）。
- `apps/api/src/app.controller.route-table.test.ts` 的快照 `.agents/tasks/governance/G03-api-controller/route-snapshot-app.controller.txt` 由 **115 条更新为 117 条**（新增 `POST /entry-relations`、`POST /entry-relations/removals`）。

## 浏览器套件：一条需要单独说明的失败

**结论：本切片没有让浏览器套件变绿；但同样能证明失败与新增功能无关。**

实测证据（2026-09-17，同一 worktree、同一命令 `bunx playwright test --config playwright.config.ts`，每次都新建栈）：

| 条件 | 次数 | 结果 |
|---|---|---|
| 单跑 `phase2-entry-relation.spec.ts` | 1 | **1 passed** |
| 只跑 `phase2-entry-relation.spec.ts` + `phase2-organization.spec.ts` | 1 | **9 passed** |
| 整套（含本切片 spec） | 4 | **每次都有 1–2 条失败**：3 次失败在 `:539` FTS5 搜索用例的 `page.locator("article")).toHaveCount(0)`；1 次同时失败 `:103`（证据关系反向视图 `toBeVisible` 超时）与 `:539` |
| 整套（**移走**本切片 spec） | 4 | 3 次 21/21；1 次失败在 `media-policy.spec.ts:89`（5.1 分钟，像卡死） |
| 整套 + 额外诊断 spec：**只录入来源**，不归并、不碰新功能 | 1 | **22 passed** |
| 整套 + 额外诊断 spec：录入来源 **+ 归并两条 Story**，完全不碰条目关系 | 1 | 20/22：失败在 `:103` 与 `:417`（后者 5.1 分钟） |

**判断（含不确定）**：

- 最后一行是关键对照：一个**只做既有行为**、完全不碰本切片功能的 spec 同样能让 `phase2-organization.spec.ts` 失败，而且失败点漂到 `:103`/`:417`。所以失败不是新功能代码引入的，而是「共享栈上多一次录入 + 归并」这类内容量变化触发。
- `phase2-organization.spec.ts` 是**登记在案**的不稳定文件（[`docs/testing/known-unstable-cases.md`](../../../docs/testing/known-unstable-cases.md) 第 1 条：失败点在用例之间漂移、单跑通过、只出现在多场景连跑）。本轮观察到的漂移与登记描述一致，`:103` 正是登记过的那个用例。
- **未查清的部分（已写进登记条目，不用重跑结案）**：`:539` 失败现场 `role=status` 显示「搜索到 0 条结果。」，页面上却仍有 1 个 `article`（内容是刚录入来源的条目），10 秒内 23 次都读到 1。该 `article` 只能是页面级 `FeedBrowser` 渲染的（全仓只有它渲染 `<article>`），而 `onSearch` 在同一次状态更新里同时写 `activeSearch`、`feed` 与提示语，所以「提示语说 0 条、列表还留着上一次的内容」在代码上无法解释——**不排除应用存在搜索状态不一致**，但本轮没有证据把它归因到本切片，也没有为了让它过而放宽断言。
- 未运行：Node 进程 E2E（`bun run test:e2e`）、`bun run test:property`、Docker/Compose、Windows Node smoke、真实公网来源验收。

## 2026-09-17：手动验收、合并与推送

- **维护者手动验收通过**（2026-09-17），并明确选择 (a)：接受「浏览器套件的失败与新增功能无关」这一结论并放行。
- 提交：worktree 分支提交 `a1f0be2`（45 文件：代码 + `docs/spec` + `docs/testing` + 两个新 e2e 用例 + Task 26 的 README/walkthrough）；`--no-ff` 合入 master `c308733`（`merge: cross-source duplicate relations inside Task 26`），推送 `origin`（`894f47f..c308733`）。worktree `.worktree/t26-entry-duplicate-relations` 与分支 `feat/t26-entry-duplicate-relations` 已按授权清理。
- **合并期间 master 前进过**：本切片基于 `aab0748`，期间 master 落到 `894f47f`（Task 28「移动端宽度检查暂停 + ingest spec 重试幂等」与 G08「CI 门禁分区 + 状态文档减负」）。合并**无冲突**；45 个文件全部原样落到 master，比对本分支尖端与 master 后，只有两个文件因 master 各自也有改动而不同（`docs/testing/README.md` 1 行、`docs/testing/known-unstable-cases.md` 17 行，都是 Task 28 的追加），无本切片内容丢失。
- **合并提交上重跑的门禁**（在 worktree 内检出 `c308733` 后运行，因为主工作区的 `node_modules` 与 lockfile 不一致、缺 vitest 可执行文件与 `@dnd-kit/*`，没有擅自修主工作区）：`bun run typecheck` 0；`bun run test` **99 文件 / 599 用例全绿**；`bun run build` 通过；`docs:check` 0 失败。主工作区在 `c308733` 上另跑：`docs:check` **680 文件 0 失败**、size 门禁 **PASS**（6 条基线内文件增长的 warning）、`git diff --check` 干净。
- **远端 CI（2026-09-17）**：run [35192008223](https://github.com/Otirik-handi/cosmos/actions/runs/35192008223)（`c308733`）**五个 job 全绿**——Docs、Quality、**Browser E2E**、Windows Node smoke、Node process E2E。也就是说本地上文记录的浏览器套件失败**在远端 CI 上没有复现**（CI 配了 retries）；本轮据此不改上文证据，只把这条结果并列记录：本地的 4/4 失败与远端的全绿同时是事实，机制仍未查清。
- **Task 28 已顺手修掉本切片记下的一个既有欠账**：`e2e/browser/ingest.spec.ts` 现在用随机来源名并把健康看板/阅读流断言限定在自己的来源卡片内，因此它不再依赖「必须排在套件最前」。本切片把新 spec 放到 `ingest` 之后是当时的必要处理，现已不再必要（不影响结论，故未回改文件名）。
- 合并时同步的状态文档：`PROJECT-STATUS.md`（基线改 `c308733`、ING-006 那条改为已合并、验证边界换成本轮数字、worktree 清单更新）与 Task 26 的 README。该记录提交为 `9f22c15` 并推送，其 CI run 35192785400 同样**五个 job 全绿**，即 `master` 的当前位置在远端是绿的。
- 合并后仍然开着的项不在此重复，见 [README.md](README.md) 的 Follow-ups。
