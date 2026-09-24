# G08：代码规模门禁并入行数轨（P4-2 的根因修复）

## User Request / Topic

2026-09-24 维护者裁定 P4-2 先做机制修复再拆文件；G 编号 G08 由维护者分配（G01–G07 已收口，G 台账写明剩余对象「G08 起」）。

## Goal

把行数阈值并入 `scripts/size-governance.py --check` 并建立行数基线，让「超红线代码文件」这类欠账**被 CI 拦住**，不再无声累积。

**为什么这是根因修复**：P4-2 之所以能攒到 10 个超 800 行文件，是因为 CI 的规模门禁只跑 `-c docs`（文档类），代码类根本不检查；而脚本虽然算了 `lines`（`size-governance.py` 的 `data.count(b"\n")`），`--check` 却只拿字节/token 判定。两个缺口叠起来，行数欠账对门禁完全不可见。

## Scope / Non-goals

Scope：

- `--check` 增加行数轨，与字节/token 三轨先到先触发；行数阈值可配（`--warn-lines` / `--fail-lines` / `--entry-warn-lines` / `--entry-fail-lines`）。
- 用 `--write-baseline` 为存量建行数基线。
- CI 增加代码类门禁步骤。

Non-goals：

- **不拆任何文件**（那是 G09 起的批次任务）。
- 不收紧警戒线（见决定 1）。
- 不改 `docs-baseline.json` 的结构与阈值，不改文档类门禁口径。
- 不引入 Python 测试基础设施（见决定 5）。

## Current State

- 生命周期阶段：实现与验证完成；**未 commit、未合并**。
- 连贯目标：让代码类规模欠账进入 CI 门禁。
- 可观察验收（≤3 条）：
  1. 代码类门禁在 CI 中运行，且新增超红线文件会让它失败；
  2. 存量越界文件全部登记进基线后，门禁通过；
  3. 文档类门禁行为不变（同一批命令仍 PASS）。
- 依赖：无新增依赖；复用既有 `--write-baseline` / `--fail-on-new` / 基线机制。
- 受影响合同：**CI 门禁口径**（`docs/standards/` 与 `docs/proposals/code-size-governance-v1.md` 已定义阈值，本次是把它接上）；无 Prisma schema、无 migration、无公共 DTO、无 API。
- 预计核心文件：`scripts/size-governance.py`、`docs/doc-governance/code-baseline.json`、`.github/workflows/ci.yml`、`.agents/tasks/governance/README.md`。
- 验证层级：夹具树实跑（行为证据）→ 真实仓库门禁实跑 → 文档门禁无回归。

## Decisions and Deviations

### 1. 本批只拦红线（维护者 2026-09-24 裁定）

提案的阈值表是双轨：源码/测试 >400 行进警戒、>800 行是红线；入口 >100 / >300。维护者 2026-09-14 的裁定原话是「采用**完整红线**——>800 行 或 >50 KB 或 >15k token」，**警戒线那套此前从未对代码生效**。

两个口径的代价差 5 倍：只拦红线需要登记 **16** 条基线；红线+警戒都拦需要 **67** 条（378 个扫描文件里 67 个落在警戒区或以上），而且从此任何新写的 400 行文件都会卡 CI。

**裁定：本批只拦红线。** 实现方式是把 CI 命令的行数参数设成 `--warn-lines 800 --fail-lines 800 --entry-warn-lines 300 --entry-fail-lines 300`（warn 与 fail 相等 ⇒ 警戒档对行数永不触发），而**脚本默认值仍是提案的 400/100**，所以手动跑仍能看到完整画面。收紧时只需删掉那四个参数。

### 2. 行数轨只对源码/测试生效

提案的阈值表写的是「源码/测试单文件」。文档的长度治理由文档阈值（KB/token）负责，拿 800 行去卡一份长文档是类别错配——一份 900 行的 Markdown 完全可能是健康的。实现按 `item["cat"] in ("code", "tests")` 限定，夹具用例 F 钉住这条。

### 3. 入口口径 = 直接位于 `src/` 下的 `index.*`

与 `--map` 的入口口径（`{key}/src/index.ts`）保持一致：入口/桶文件只该做导出与模块地图，混进实现就该被拦。`apps/*/src/main.ts` 这类进程入口不在本口径内（提案只说「入口/桶文件 index.ts」）。

### 4. 基线 schema 不变（`path → bytes`）

不把基线值改成 `{bytes, lines}`：那要迁移两个 CI 消费的基线文件，收益只是让「基线内文件的行数增长」单独可见。**取舍**：基线内文件的行数增长不单独报，但字节增长会报 warning——而大文件加行几乎必然伴随字节增长，所以信号不会丢。

### 5. 未新增自动化测试（如实记录）

仓库没有 Python 测试基础设施：`scripts/*.test.ts` 都是**导入 TS 函数**的 vitest 用例，而这是一个 Python 脚本；引入 pytest 或让 vitest 去 spawn python 都会把新依赖塞进所有人的开发环境与 CI。

**取舍**：改用夹具树实跑作为行为证据（7 个用例，见验证段）。代价是这道门禁的回归保护弱于自动化测试——如果后续它成为改动热点，应补一层能被 CI 跑的测试。

### 6. CI 落点放在 docs job

该 job 的注释写明「不跑 bun install：这两条命令只依赖 bun 与 python3」，代码类门禁同样只要 python3，所以放这里不必把 quality job 拉进来。**不改 job 名**（改名可能影响仓库的必需检查配置，属另一个决定）。

## Implementation Walkthrough

1. **常量与判定**（`scripts/size-governance.py`）：新增 `WARN_LINES=400` / `FAIL_LINES=800` / `ENTRY_WARN_LINES=100` / `ENTRY_FAIL_LINES=300` 与 `ENTRY_PATH_RE`；`over_thresholds(item, args)` 改为三轨判定（原先收 4 个位置参数，现收 `args`，三个调用点同步）。
2. **健康区判定与口径输出**：基线内文件「已回到健康区」的判定与门禁口径打印都带上行数轨（入口按入口阈值）。
3. **CLI**：新增四个行数参数，默认值取提案值。
4. **基线**：`--write-baseline` 生成 16 条（6 → 16）。
5. **CI**：docs job 增加代码类门禁步骤，带注释说明「本批只拦红线」与收紧方式。

## Verification

**夹具树实跑（7 例，全部符合预期）**：`.agent/tmp/verify-g08.ps1`（一次性 scratch，未进仓库）。

| 用例 | 夹具 | CI 口径下期望 | 实测 |
| --- | --- | --- | --- |
| A | 普通代码 900 行 | FAIL（红线） | ✅ exit=1，`新增红线文件 … 10.44 KB / 约 2.7k token`（字节/token 都远低于阈值，**纯靠行数**判出） |
| B | 普通代码 500 行 | PASS | ✅ exit=0 |
| C | 入口 `src/index.ts` 400 行 | FAIL（入口红线） | ✅ exit=1 |
| D | 入口 `src/index.ts` 250 行 | PASS | ✅ exit=0 |
| E | 代码 900 行但已登记基线 | PASS（存量豁免） | ✅ exit=0 |
| F | 文档 900 行 | PASS（行数轨不适用） | ✅ exit=0 |
| G | 普通代码 500 行、**默认**阈值 | FAIL（警戒区） | ✅ exit=1，证明警戒轨存在、且 CI 的四个参数确实把它限定为只拦红线 |

**真实仓库实跑**：

- 改前（代码类从未进 CI）：门禁对行数无感知。
- 改后未写基线：`-c code tests --check … --fail-on-new --warn-lines 800 --fail-lines 800 --entry-warn-lines 300 --entry-fail-lines 300` → **FAIL（10 项）**，其中 `packages/domain/src/index.ts`（25.40 KB / 6.6k token）与 `packages/logging/src/index.ts`（19.47 KB / 5.0k token）、`plugins/rss/src/index.ts`（21.26 KB / 5.5k token）**只可能由行数轨抓出**——这三个文件在字节/token 口径下完全隐形。
- 写基线后：同命令 → **PASS**（扫描 376 个文件，基线 16 条，豁免 1 条）。
- **文档类门禁无回归**：`-c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` → **PASS（含 warning）**，与改前一致。

**未运行**：`bun run test`、`bun run typecheck`（本 Task 只改 Python 脚本、基线 JSON 与 CI YAML，不触及 TypeScript；合并前仍应跑一次全量）、真实 CI run。

## Follow-ups

- **收紧警戒线**：本批只拦红线；要启用提案的 400/100 行警戒，需先把 67 条存量登记进基线（或先拆分到 400 行以下）。
- **逐文件拆分（P4-2 主体）**：维护者 2026-09-24 裁定的顺序是「先拆非 UI 文件」，batch 1 = `packages/domain/src/index.ts`（885 行）与 `packages/application/src/media-acquisition.ts`（918 行）。单文件拆分 ≈ 一个 G 系列 Task（独立 worktree、导出面零 diff、madge 环检查、全量门禁、维护者验收）。
- **G 台账待更新**：把「门禁缺口」一条标记为已修复，并把治理队列的起点从 G08 改到 G09。
