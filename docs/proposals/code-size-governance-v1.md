# Proposal:代码侧大文件治理与拆分框架 v1

> 状态:accepted(2026-09-11 修订六条)
>
> 日期:2026-09-11
>
> 关联:文档治理提案 [`oversized-doc-splitting-v1.md`](oversized-doc-splitting-v1.md)(并行推进,互不阻塞);扫描脚本 [`scripts/size-governance.py`](../../scripts/size-governance.py);首个治理对象 `packages/storage-prisma/src/index.ts`
>
> 动机:文档扫描发现大文件只是 token 消耗异常的一部分,代码与测试同样超标且变更更频繁;Agent 全量读入大文件是上下文成本的主要来源。

## 1. 问题

代码+测试共 182 个文件 / 2.29 MB,估算全量读入约 65.6 万 token;红线(>50 KB)10 个(代码 7 + 测试 3)、警戒 8 个。头部病例(大小 / 估算 token / 近 30 天提交次数):

- `packages/storage-prisma/src/index.ts`:268 KB / 75k token / 24 次,7018 行、10 个导出、0 个 `export *` —— 是单体实现文件而非桶文件;
- `apps/api/src/app.controller.ts` + 其测试:70 KB + 57 KB,22/17 次;
- `apps/web/src/app/page.tsx`:62 KB,23 次;
- `packages/application/src/index.ts`(67 KB)、`packages/contracts/src/index.ts`(54 KB)、`packages/transport-http/src/index.ts`(41 KB):待核实桶/单体;
- `packages/storage-prisma/src/workflow-host-store.ts` + 测试:93 KB + 55 KB。

关键事实:**大文件同时是变更热点**(Top 超标文件与 Top churn 文件高度重合),治理优先级无争议。工具链现状:bun/tsc/vitest(三配置)在位;eslint、prettier、覆盖率、依赖图工具均未安装。

后果:Agent 一次典型任务(改 outbox store 重试逻辑)需全读 index.ts 75k + 测试 15k ≈ 9 万 token,占满 128k 上下文大半;触发摘要压缩、重读翻倍。

## 2. 目标与非目标

### 目标

1. 任何一次 Agent 工作会话,「理解 + 定位 + 修改 + 验证」的总读取量控制在约 3 万 token 以内。
2. 建立代码侧阈值体系、拆分模式库、MODULE.md 索引规范、Agent 阅读协议、SOP 与 CI 门禁(基线只减不增)。
3. 首个治理对象:`packages/storage-prisma`(重灾区,治理任务编号 G02,编号体系见 `.agents/tasks/governance/README.md`)。

### 非目标

- 不治理文档(走 [`oversized-doc-splitting-v1.md`](oversized-doc-splitting-v1.md));不治理生成物、第三方、锁文件、运行数据。
- 不一次性重写、不做跨包大迁移、不为减 token 制造微文件(目标是最小必要上下文)。
- 不改变外部行为、公共 API、数据契约;不碰 Prisma schema/migration/版本号。

## 3. 当前行为与证据

- 扫描与分类数据:2026-09-10 全仓扫描(407 文件 / 5.22 MB),`size-governance.py` 可复现;临时输出 `.agent/tmp/scan-py.txt`(未入库)。
- 变更频率:`git log --since=2026-08-10 --name-only` 统计,前述头部病例即 Top churn。
- `storage-prisma/index.ts`:`wc -l` 7018 行,行首 `export` 10 处、`export *` 0 处。
- 工具链:`package.json` 无 eslint/prettier/@vitest/coverage-v8/madge/knip/dependency-cruiser。
- 仓库现状:AGENTS.md 与 `.agents/tasks/AGENTS.md` 无代码文件大小约束;无任何门禁。

## 4. 方案

### 4.1 阈值体系(已确认)

换算基准:1 KB ≈ 280 token(tiktoken 实测 255~300)。目标:单文件全量读入 ≤ 1 万 token。

| 对象 | 警戒 | 红线 |
| --- | --- | --- |
| 源码/测试单文件 | >400 行 或 >25 KB | >800 行 或 >50 KB |
| 入口/桶文件 index.ts | >100 行 | >300 行(只做导出与模块地图) |
| 单函数 | >50 行 | >100 行 |
| 圈复杂度 | >10 | >15 |
| 包 MODULE.md | — | >3 KB |

**不拆边界**:≤400 行且内聚的文件明确不拆——字节超标而行数不超标、且内聚的,同样不拆,进基线观察;拆分产物落在 100~600 行为佳(纯类型文件除外);低于 100 行且无独立职责视为过度拆分,不允许为达标制造碎片。

### 4.2 优先级评分模型(全部可自动采集)

```
P = (T + L + H + D) / (V + R)
  T = token 成本分(全量读入 token/7.5k,上限 10)   L = 规模分(行数/700,上限 10)
  H = 变更热度分(近30天提交/2.5,上限 10)          D = 被耦合分(被 import 次数/4,上限 10)
  V = 测试覆盖分(0~10;低分触发"先补测试"前置,不降优先级)
  R = 合同风险分(包入口 +2 / 牵连 contracts 或 Prisma schema +1 / 公开 DTO +1)
```

实测初排 Top 6:storage-prisma/index.ts > app.controller.ts(+test)> page.tsx > application/index.ts > contracts/index.ts(+test)> workflow-host-store.ts(+test)。

### 4.3 拆分决策树

文件超阈值 → 生成物/vendor?标记排除 → 资源/数据?索引化 → 文档/配置?移交文档流程 → 源码/测试:核实桶/单体 → 测试跑不绿先补测试(只锁当前行为)→ 选模式 → 门面保持 → 最小切片 → 三绿验证 → 提交,循环。

**拆分顺序(固定)**:①桶文件先做模块地图化与显式导出(不动实现);②测试按行为拆;③单体按聚合拆。先治桶、再治测试、最后动实现,保证每一步都有测试护栏;某一步对该对象不适用(如对象本身不是桶文件)则跳过进入下一步。

### 4.4 拆分模式库

| 模式 | 病例 | 要点 |
| --- | --- | --- |
| 按聚合拆仓储 | workflow-host-store.ts | Run/StepRun/Outbox/ConsumerBinding/Lease 各一文件,原路径门面 re-export |
| 按资源拆控制器 | app.controller.ts | 多 Controller 或下沉 service;路由表不变,e2e 全量回归 |
| 组件分解 | story-panel.tsx、page.tsx | 子组件 + hooks + 常量,同目录就近;复用 component-lab fixture |
| 桶文件模块地图化 | application/contracts/transport-http 的 index.ts | 先加 MODULE.md 不动代码;再 `export *` 改显式具名导出;knip 清死导出 |
| 单体仓储拆分 | storage-prisma/index.ts | 见 §4.8 示例 |
| 测试按行为拆 | 三个 50 KB+ 测试 | 按 describe 拆,与源码拆分同 Task 联动;覆盖率不降 |

反面约束:不做微文件化——拆出文件须能一句话说清职责,100~600 行为佳(纯类型文件除外);低于 100 行且无独立职责视为过度拆分。

### 4.5 索引与导航规范

- 新增 `packages/<pkg>/MODULE.md`(含 apps/*),硬性 ≤3 KB:职责一句话、公共入口导出清单、子模块地图(文件→职责→token 估算)、阅读顺序、禁区、更新日期。
- `repo-map.json` 由 `size-governance.py --map` 生成(机器可读:包名、入口、类别、大小、红线标记)。
- **不做手工 symbol-index**(必然腐烂):符号定位交给 grep/LSP,MODULE.md 只维护文件级职责。
- **维护责任**:MODULE.md 与代码变更同 PR 更新,不允许代码先行、文档欠账;`repo-map.json` 由脚本生成,CI 重新生成后与提交版本做 diff,不一致即 fail。

### 4.6 Agent 阅读协议(与文档提案 4.6 同构)

1. 读根 AGENTS.md → 目标包 MODULE.md → 需要时 repo-map.json;
2. 定位一律符号搜索/grep/LSP,禁止通读猜;
3. 按 offset/limit 读区段;**全量读超 400 行的文件必须在回复中说明理由**;
4. 修改后只重读改动区段;
5. 禁读 node_modules/dist/.next/.worktree/锁文件/.cosmos 运行数据;
6. 落点:`.agents/tasks/AGENTS.md` + 根 AGENTS.md 一句话引用,本提案 accepted 后更新。

### 4.7 SOP 与工具链

SOP:申请治理任务编号(G 系列)与 worktree(仓库规则:需审批)→ 基线记录(大小/行数/导出清单/三配置测试/构建字节数)→ 测试护栏 → 一次一个切片(移动 + 门面 re-export)→ 单独 commit(可独立 revert)→ 回顾回写。单 Task 只治一个文件(或一个包的桶文件群)。

**行为等价底线(三条同时满足,缺一不可)**:现有测试全绿 + 公共入口契约测试通过 + 导出签名 diff 为零。公共入口契约测试是每包新增的测试资产(断言入口的导出符号集合),把「导出零 diff」从一次性脚本比对升级为长期护栏;PR 层的脚本比对保留,两者互为冗余。

**验证闭环(每个切片必须全过)**:tsc → vitest 三配置(unit/property/e2e)→ build:packages → 导出签名 diff → 循环依赖检查。

工具链分三阶段引入(均 devDependency,已确认授权):

1. 零新依赖:扩展 `size-governance.py`(--json/--check --baseline/--map、行数/导出/churn 统计);
2. typescript-eslint + prettier:max-lines 800、max-lines-per-function 100、complexity 15、禁 `ExportAllDeclaration`;
3. madge(循环依赖)+ knip(死导出)+ @vitest/coverage-v8(覆盖分数据源)。其中 **madge 属于验证闭环的一环,提前至首个治理 Task 前安装**;knip 与 coverage 可随后续切片后置。

codemod 仅用于桶文件显式导出化等机械替换,先 dry run 再执行(仓库规则)。

### 4.8 典型示例:storage-prisma/src/index.ts

拆前:268 KB 单文件含存储根解析、多个 Prisma Store 实现、内嵌类型。拆后:

```
packages/storage-prisma/src/
├── index.ts              ← 门面:仅显式 re-export,≤100 行
├── MODULE.md             ← 模块地图
├── storage-roots.ts      ← resolveStorageRoots 与根布局
├── workflow-host-store/  ← run/step-run/outbox/consumer-binding/lease-fencing 各一文件
├── workflow-backend.ts   ├── workflow-value-store.ts
├── file-blob-store.ts    ├── workflow-event-sink.ts  └── connector-state-store.ts
```

典型任务(改 outbox 重试)读取量:拆前 75k + 15k ≈ 9 万 token;拆后 MODULE.md 1k + outbox 区段 5k + 测试区段 5k ≈ 1.1 万 token,**下降约 88%**。

拆分顺序遵循 4.3:`index.ts` 本身是单体而非桶文件,桶文件步骤对该对象不适用、跳过;先 `index.test.ts`(51 KB)、`workflow-host-store.test.ts`(55 KB)按行为拆,最后 `index.ts` 按聚合拆。

**首个对象验收标准**:`index.ts` 门面 ≤100 行;导出签名零 diff(入口契约测试 + 脚本比对双重确认);典型任务读取量从约 9 万 token 降至 **≤1.5 万 token**。

## 5. 取舍与备选

| 备选 | 结论 |
| --- | --- |
| 阈值字节+行数双轨(50 KB/800 行) | 采纳(字节对齐 token 成本,行数防宽格式漏网;入口/函数/复杂度单独设阈值) |
| 只按字节一刀切 | 拒绝(桶文件与单体文件密度差异大) |
| CI 门禁 = 基线只减不增 | 采纳(存量豁免、新增即拦、基线条目只许删不许加) |
| 立即全量硬门禁 | 拒绝(存量债务会阻塞日常开发) |
| 单独 proposal | 采纳(阈值/拆法/验证与文档提案完全不同) |
| 并入文档提案 | 拒绝 |
| 手工 symbol-index | 拒绝(腐烂;用生成 repo-map + grep/LSP) |
| 微文件化 | 拒绝(搜索与拼接成本反升;100~600 行为佳,<100 行无独立职责视为过度拆分) |
| 固定拆分顺序:桶文件 → 测试 → 单体 | 采纳;任意顺序拒绝(测试护栏必须先于实现拆分) |
| 工具一步到位 | 拒绝(分三阶段,先零依赖脚本,降低维护面;madge 因验证闭环提前) |

## 6. 数据、接口、安全、迁移、发布与回滚影响

- **数据/接口**:无 Prisma schema、无 migration、无 API 行为变更;重构仅移动实现,包入口导出符号冻结为零 diff 硬约束。
- **安全**:不涉及;结构化日志约定不变。
- **迁移**:新增 devDependencies(分阶段)、`governance-baseline.json`、各包 MODULE.md、repo-map.json;首个治理 Task 编号待维护者分配。
- **发布**:不涉及版本号/发布/部署。
- **回滚**:每切片独立 commit 可 revert;基线文件回滚即恢复旧口径。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- `docs/requirements/0001-original-requirements.md`:追加 2026-09-11 原话(随本提案一并完成)。
- `.agents/tasks/AGENTS.md`:增加代码阅读协议与切片纪律(accepted 后)。
- 根 `AGENTS.md`:JS/TS 章节增加一句阈值引用(accepted 后)。
- 不新增 ADR、不改 `docs/spec/`:不改变行为合同与架构边界,约定本体在本提案与 AGENTS.md。

## 8. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-11 | 起草,状态 `reviewing` | Agent |
| 2026-09-11 | **用户确认六项**:①代码阈值表(单文件 800 行/50 KB、入口 300 行、函数 100 行、复杂度 15)采纳;②CI 门禁采用基线只减不增;③分阶段引入 typescript-eslint/madge/knip/@vitest/coverage-v8;④包入口导出符号冻结合同、拆分零 diff;⑤首个治理 Task 选 storage-prisma,编号按流程申请;⑥框架落为本提案评审 | 用户(评审确认) |
| 2026-09-11 | **用户修订六条并全部并入**:①行为等价底线 = 现有测试全绿 + 公共入口契约测试 + 导出签名 diff 为零;②不拆边界(≤400 行且内聚不拆、100~600 行为佳、<100 行无独立职责视为过度拆分);③拆分顺序固定为桶文件 → 测试 → 单体;④验证闭环 = tsc + vitest 三配置 + build:packages + 导出签名 diff + 循环依赖检查;⑤MODULE.md 与代码同 PR 更新、repo-map 脚本生成并 CI 校验 diff;⑥storage-prisma 验收:index.ts ≤100 行、导出零 diff、典型任务读取量 9 万 → ≤1.5 万。派生调整:madge 因进入验证闭环提前至首个治理 Task 前安装。维持 `reviewing` | 用户(评审确认)+ Agent(并入) |
| 2026-09-11 | 用户宣布提案通过并授权实施所需权限;状态转 `accepted`。实施载体:Task 26(storage-prisma 治理,编号按序列顺延),madge 随 Task 前置安装 | 用户(评审确认) |
| 2026-09-11 | 用户裁定:治理类任务不沿用产品 Task 编号,新增 G 系列专门编号(目录 `.agents/tasks/governance/G{NN}-{slug}`,分支引用 `{type}/g{NN}-{slug}`);原 Task 26 更名 G02;章程写入 `.agents/tasks/governance/README.md` | 用户(评审确认) |
