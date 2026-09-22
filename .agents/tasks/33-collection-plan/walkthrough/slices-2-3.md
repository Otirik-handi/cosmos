# Task 33 Walkthrough 分册：切片 2 与切片 3

本册是 Task 33 walkthrough 的历史分册，只搬位置、不改写条目。后续记录继续写在主文件 [walkthrough.md](../walkthrough.md)。

## 2026-09-21：切片 2 开工前 —— 产品面形态与三处合同补充

- **本轮切片**：把产品面从「来源健康」改造成「采集计划」并按连接分组，新建流程能选连接，从而在一个连接下建出第二个计划。1c-1c 已让计划行成为唯一事实，界面形态此时才定。
- **决定（维护者确认，记录）**：
  1. **把「来源健康」改造成「采集计划」并按连接分组**（不新增并存区块）。符合 ADR-0023 决策 5；来源名作为内容出处保留在 Feed 卡片。
  2. **`POST /sources` 增加可选 `connectionId`**：与既有 `scheduleIntervalMs` 同例——创建命令在同一步里建出来源与默认计划，连接也是计划自有字段，一步原子，不会留下「建了来源但没绑上连接」的半成品。
  3. **看板区块的 type 键 `source-health` 不动，只改显示标签**：type 是看板布局里已持久化的标识，改它要迁移；标签是用户看到的文字，随产品术语改为「采集计划」。
- **三处合同补充（计划读投影要能独立支撑产品面，记录不静默）**：
  - 计划快照增加 `lastRunAt`／`lastError`，取**归计划**的 Run／WorkflowRun（ADR-0023 决策 2 已把运行归属计划）。1c-2a 当时记的「等计划视图真正需要时再加」现在到期了。
  - 计划快照增加 `sourceRevisionId`：v1 的删除仍是目标域命令（`DELETE /collection-plans/{id}` 是 Planned），产品面要拿目标的 revision 才能发它。这是「计划引用目标」的读投影，与 `SourceSnapshot.planRevisionId` 对称。
- **仍有后果的假设**：v1 计划与目标一对一，所以按连接分组时「连接下有几个计划」等于「连接下有几个目标」；「同一目标多个计划」落地后分组逻辑不用改。
- **下一步**：实现。

## 2026-09-21：切片 2 —— Web 计划管理面

- **本轮切片**：产品面从「来源健康」改造成「采集计划」并按连接分组，新建流程能选连接，从而在一个连接下建出第二个计划。验收 3（不打开数据库就能在一个连接下建出第二个计划，并看到两个计划各自的频率与最近一次失败）达成。
- **改动文件**：
  1. `packages/contracts/src/base.ts`：`createSourceCommandSchema` 增加可选 `connectionId`（与 `scheduleIntervalMs` 同例：创建命令在同一步里建出来源与默认计划）。
  2. `packages/contracts/src/collection-plan.ts`：计划快照增加 `sourceRevisionId`（v1 删除仍是目标域命令）、`lastRunAt`／`lastError`（取归计划的 Run／WorkflowRun）。
  3. `packages/storage-prisma/src/repository/helpers-4.ts`：把「最近一次运行诊断」抽成 `latestRunDiagnostics(db, where)`，来源与计划两个读投影共用同一套口径。
  4. `packages/storage-prisma/src/repository/sources.ts`：`createSource` 把连接写进计划；`toCollectionPlanSnapshot` 变为类的 protected 方法（要取目标 revision 与运行诊断），新增 `CollectionPlanRow` 形状。
  5. `apps/api/src/app.controller/sources.ts`：创建路由先校验连接存在（否则会撞外键变成 500）。
  6. `apps/web/src/components/cosmos/collection-plan-list.tsx`（新，取代 `source-actions.tsx`）：按连接分组的计划列表，行数据来自 `CollectionPlanSnapshot`；「未绑定连接」组固定压尾。
  7. `apps/web/src/components/cosmos/source-form.tsx`：新增连接选择；标题／按钮改为「新建采集计划」「保存计划（停用）」。
  8. `apps/web/src/app/home/use-source-workspace.ts`、`page.tsx`、`status-summary.tsx`、`board-view.tsx`、`component-lab/*`：接线与术语同步（看板区块 type 键 `source-health` 不动，只改显示标签）。
  9. `e2e/browser/collection-plan-multi.spec.ts`（新）：切片 2 的验收——一个连接下两个计划，各自频率、各自启停、跑一次后失败只落在坏的那一行，刷新后仍在。
  10. 9 个既有 spec 的术语同步（`新建来源`→`新建计划` 等 36 处，先 dry run 再应用）。
- **决定（维护者确认，见开工前记录）**：改造而非并存；创建命令带 `connectionId`；看板 type 键不动只改标签。
- **连带修正（本轮发现并修掉的一处既有测试脆弱性）**：
  - `offline.spec.ts` 的「已保存图片能从 API 渲染」断言原本依赖浏览器对**屏外** `loading="lazy"` 图片的预加载时机（该图在详情面板折叠线以下，约 y=900／面板高 720）。本切片给页面加了计划与连接的加载请求后，预加载被推迟，断言开始在默认轮询窗口内超时。**先做了对照实验**：同一 spec 在 master 上 `--repeat-each=3` 3/3 通过、在本分支 3/3 失败；加长轮询窗口后本分支也能通过（`naturalWidth: 32`），证明图片本身可取、几何位置与 master 完全一致（同为 y=956、面板 720）。因此这是断言的时机假设问题，不是图片服务回归——已改为**先滚进视口再断言**，`--repeat-each=3` 3/3 稳定通过。
- **RED → GREEN**：RED（实现前实跑）为各文件的类型错误与既有断言失败（含 9 条单元用例、3 条浏览器用例）；GREEN：`bun run typecheck` 全仓 **0**；`bun run test` **116 文件 / 656 用例全绿**；`bun run test:e2e` **5 文件 / 6 用例全绿**；浏览器 E2E **26 用例全绿**（含新增的切片 2 验收）。
- **门禁**：`bun run db:validate` 通过；`bun run docs:check` 722 文件 0 失败；`size-governance --fail-on-new` PASS；`git diff --check` 干净。
- **未运行**：真实来源验收（切片 3）。
- **下一步**：切片 3（连接器选择与 schema 驱动表单），使 Bilibili 双计划能在产品面建出并跑真实来源。

## 2026-09-21：切片 3 开工前 —— 表单从硬编码 RSS 改为 manifest 驱动

- **本轮切片**：新建计划时可选来源定义（不再硬编码 RSS），字段按所选 manifest 的 JSON Schema 渲染（含 `enum` 与认证提示），使 Bilibili 计划能在产品面建出。这是 Task 33 的最后一块。
- **读到的现状（决定了改法）**：
  - `readManifestFields` 只认 `type === "string" | "integer"`，而 Bilibili manifest 的 `mode` 是**只有 `enum` 没有 `type`** 的属性——照现状它会被整条跳过，表单根本渲染不出「动态 / 推荐流」这个必填选择。
  - manifest 里 `profile` 与 `mode` 的**条件依赖**（`mode: "feed"` 才需要 `profile`）只写在 canonical Zod 的 `superRefine` 里，JSON Schema 投影表达不了。表单不做这个推断，交给服务端校验并把错误回显——这是有意的边界，不在这里复制一份规则。
- **决定（记录，不静默选择）**：
  1. **字段类型只由 manifest 的 JSON Schema 决定**：`enum` → 选择框、`integer` → 数字、`string` → 文本；三种以外不渲染，也不猜。
  2. **客户端只做能从 JSON Schema 读出来的校验**（必填、整数、最小/最大、枚举取值）；更细的规则（如 Bilibili 的条件必填）由服务端 canonical schema 裁决，错误原样回显。
  3. **认证提示按 `manifest.auth` 展示**：`kind !== "none"` 时显示 label（Bilibili 是「OpenCLI 浏览器登录态」），不在这里做凭证输入——连接才是凭证的载体（ADR-0017）。
- **仍有后果的假设**：字段值与 config 的映射是「按 manifest 属性名一一对应」，不做重命名；`scheduleIntervalMs` 仍不进 config（定时是 TriggerBinding，ADR-0018）。
- **下一步**：实现。

## 2026-09-21：切片 3 —— 连接器选择与 manifest 驱动表单

- **本轮切片**：新建计划时可选来源定义（不再硬编码 RSS），字段按所选 manifest 的 JSON Schema 渲染（含 `enum` 与认证提示），使 Bilibili 计划能在产品面建出。Task 33 的最后一块。
- **改动文件**：
  1. `apps/web/src/components/cosmos/source-form.tsx`：重写为 manifest 驱动——来源定义选择器；`readManifestFields` 支持 `enum`（→ 选择框）、`integer`/`number`（→ 数字）、`string`（→ 文本）；新增 `validateManifestFields`（必填、整数、范围、枚举取值）与 `toConfigFromFields`（按字段类型转换）；`auth.kind !== "none"` 时渲染认证提示与 label；配置字段收敛到 `config` 子对象（`config.<属性名>`）。
  2. `apps/web/src/app/home/use-source-workspace.ts`：保留目录里全部 `enabled` 定义供选择；`selectedDefinitionRef` 状态与 `selectDefinition`（切换时整组重置配置字段）；probe 与创建都改用所选定义的 ref 与首个 operationId；提交前跑字段级校验并按字段报错。
  3. `apps/web/src/app/page.tsx`、`home/page-runtime.ts`：接线与默认值（`config.feedUrl` 起始值）；删除只为 RSS 服务的 `toSourceConfig`。
  4. `apps/web/src/component-lab/product-fixtures.tsx`：新增合成的 Bilibili 定义（`mode` 只有 `enum` 没有 `type`、`auth: external`），用来覆盖这两条分支。
  5. `e2e/browser/collection-plan-connectors.spec.ts`（新）：切片 3 验收——一个 Bilibili 连接下建出「热门」与「动态」两个计划，字段来自 manifest，认证提示出现；另有一条断言必填枚举留空会在本地被拒、且切换定义会清空上一组字段。
  6. `docs/spec/interfaces/0005-web-client.md`、`docs/api/0002-product-service-api.md`：把「表单固定 `source.rss@1`」的陈述改成选择器 + 按所选定义渲染，并补上创建命令接受 `connectionId`。
- **连带修正（本轮发现的一处产品缺陷）**：必填枚举原先**静默取第一个选项**（选择框没有空选项），用户没选也会按「热门」建计划。已改为必填枚举同样保留空选项（“请选择…”），留空在本地就报「请填写采集模式。」。这是新验收 spec 的第二条用例逼出来的。
- **RED → GREEN**：RED（实现前实跑）为各文件的类型错误与既有断言失败；GREEN：`bun run typecheck` 全仓 **0**；`bun run test` **116 文件 / 656 用例全绿**；`bun run test:e2e` **5 文件 / 6 用例全绿**；浏览器 E2E **28 用例全绿**（含新增的 2 条连接器验收）。
- **门禁**：`bun run db:validate` 通过；`bun run docs:check` 723 文件 0 失败；`size-governance --fail-on-new` PASS；`git diff --check` 干净。
- **未运行（明确记录）**：**真实来源验收**。`bun run test:real:bilibili` 需要 `COSMOS_OPENCLI_PATH`（外部 OpenCLI 可执行文件）、`OPENCLI_PROFILE`（浏览器里已登录的 profile）、`COSMOS_REAL_RSS_URL` 与 `COSMOS_ALLOW_REAL_NETWORK=true`，且本机网络不可用（同轮 `git fetch` 也因 schannel 凭证失败）。因此切片 3 的验收只完成了**产品面那一半**：Bilibili 双计划能在产品面建出（浏览器 E2E 已证），真实抓取未验证。
- **下一步**：Task 33 的 v1 完成定义（expand + backfill + read switch + 产品面）已齐，剩真实来源验收与第 4 步 contract（单独排期）。
