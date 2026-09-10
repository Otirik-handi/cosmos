# 治理任务 G01:文档治理落地——四个存量超标文档拆分

## User Request / Topic

`docs/proposals/oversized-doc-splitting-v1.md`(accepted)§2 目标 3:治理四个存量超标文档。需求原话与裁决见 `docs/requirements/0001-original-requirements.md` 2026-09-10/09-11 条目。

## Goal

四个超标文档全部落回健康区(主文档 ≤30 KB 且 ≤9k token),历史内容按规范移入分册(每册 ≤30 KB),交叉引用与锚点修复,内容零丢失,基线相应缩减。

## Scope / Non-goals

**范围**:`.agents/tasks/04-workflow-runtime/walkthrough.md`(349 KB)、`.agents/tasks/04-workflow-runtime/README.md`(155 KB)、`PROJECT-STATUS.md`(109 KB,状态型混合文档)、`docs/architecture/0001-cosmos-foundation.md`(147 KB,广域设计)。

**非目标**:不动代码;不拆基线内观察文档(PRD、information-model、02-rss README、0003-dtos);不处理 `.agent/tmp` 清理;不改 spec/架构语义(0001 拆分只移动内容)。

## Current State

**已收口**(2026-09-11,维护者验收确认)。切片 1–5 全部完成并本地提交,四个存量超标文档全部落回健康区并退出基线(16 → 12 条,余 12 条为非目标观察文档与遗留文件)。后续事项见 Follow-ups。

## Decisions and Deviations

- 拆分在主工作区直接进行(纯文档改动,不建 worktree;代码治理才走 Task 26 的 worktree 流程)。
- 分册按大小切(≤30 KB),不按编号范围一刀切;walkthrough 的 Round 编号不单调,切分以文件内实际顺序为准。
- PROJECT-STATUS 按 §4.5 状态型拆法:主文档只留当前快照 + 活跃风险 + 未完成边界 + 索引,历史按月切 `PROJECT-STATUS/history-YYYY-MM.md`。

## Implementation Walkthrough

| # | 切片 | 验收(≤3 条/片) | 状态 |
|---|---|---|---|
| 1 | walkthrough.md:分析 Round 分布 → 历史整段移入 `walkthrough/rounds-*.md` 分册 → 主文档留当前状态 + 有效决定 + 预算内最近记录 + 索引 | 主文档 ≤30 KB;每分册 ≤30 KB;标题集合比对零丢失 | done(2026-09-11) |
| 2 | README.md(04):Spike 详情按阶段拆分册,主文档留背景/目标/范围/最小合同/当前状态 | 同上 | done(2026-09-11) |
| 3 | PROJECT-STATUS.md:历史切片按月移入 `PROJECT-STATUS/history-*.md`,主文档留快照/风险/边界/索引,消除重复章节 | 同上;主文档开头为当前快照 | done(2026-09-11,重复章节去重留作后续) |
| 4 | 架构 0001:按领域拆 `0001-cosmos-foundation/` 分册,主文档留索引 + 不变量 + 决定 | 同上;交叉引用与锚点全部修复 | done(2026-09-11,无锚点引用需修复) |
| 5 | 收口:更新 `docs/doc-governance/docs-baseline.json`(只减不增)、扫描报告、索引自动核对 | 全仓门禁 PASS;四文档退出基线 | done(2026-09-11) |

## Verification

每切片:`python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new`;标题/代码块/列表项数量拆分前后比对;相对链接存在性;`git diff --check`。

## Follow-ups

索引自动生成脚本(按分册 front matter);`lychee` 死链检查评估;基线清空后豁免清单复审。

## 过程记录(append-only)

### 2026-09-11 切片 1:walkthrough.md 拆分

- 原 349 KB / 9055 行 / 109 节 → 主文档 337 行 / 16.4 KB(估算 4979 token,健康区)+ 16 个分册 `walkthrough/rounds-*.md`(每册正文 15.7~23.2 KB,tokens_est ≤7028,全部健康区)。
- 主文档保留 Round 107–108(文件顺序上最新的两轮)+ 历史分册索引表;分册按大小切(23 KB 字节预算,为 9k token 红线留余量)。非单调 Round 编号(89–91 插在 11 与 14 之间)按文件内实际顺序切分:分册名编码 min–max Round 号,front matter `range` 记录精确区段(如 `Round 11–14、Round 89–91`)。
- 验证:节标题多重集守恒(109/109);行级多重集守恒(原文零丢失,新增 152 行 = 各分册 front matter + 主文档索引节);全仓无 `walkthrough.md#` 锚点引用,外部链接不受影响;门禁 `--check --fail-on-new` PASS,基线移除 walkthrough 条目(16 → 15,只减不增)。
- 工具:`.agent/tmp/split-walkthrough.py`(一次性切分脚本,临时目录不入库;切片 2–4 可复用其分组与守恒校验逻辑)。

### 2026-09-11 切片 2:Task 04 README.md 拆分

- 原 155 KB / 3467 行 / 67 节 → 主文档 24 KB / 514 行(est 7642 token)+ 6 个分册 `readme/sections-*.md`(20.3~23.5 KB,tokens_est ≤7170)。
- 主文档保留 §1–8 核心(背景/目标/范围/最小合同/当前状态与风险/验证要求)+ 最新 Round 71–73;归档 §4.1/§5(历史规划)、Spike A–AS、变更记录、重复编号的第二段 Spike AJ–AO、Round 68–70。
- 发现并核实:README 的 Round 68–73 与 walkthrough 分册同名 Round 内容不同(短摘要版 vs 详版),非跨文件重复,各自保留。
- 验证:67 节标题守恒、行级零丢失(新增 62 行);门禁 PASS,基线 15 → 14。

### 2026-09-11 切片 3:PROJECT-STATUS.md 拆分(状态型混合)

- 原 109 KB / 864 行 / 42 节 → 主文档 23.6 KB(est 7470 token,7 个快照节:一句话结论/当前运维边界/当前下一步/当前架构基线/后置决定/尚未实现/验证边界)+ 6 个月度/主题分册 `history-*.md`(8.2~23.3 KB)。
- 2026-09 Phase 2 切片 39 KB 超单册预算,按 §4.4 下钻为两册;滚动归档只切历史,未动当前快照与有效决定。
- 遗留:重复章节「远端 CI 与治理边界」×2 原样保留在 history-2026-08-legacy.md(零丢失纪律),去重留作后续裁决。
- 验证:42 节标题守恒、行级零丢失(新增 62 行);门禁 PASS,基线 14 → 13。

### 2026-09-11 切片 4:docs/architecture/0001-cosmos-foundation.md 拆分(广域设计)

- 原 147 KB / 2506 行 / 22 章 → 主文档 22.4 KB(est 7179 token,保留 §19 当前决定 + §21 架构不变量)+ 7 个领域分册 `part-*.md`(14.3~21.6 KB)。
- §20(核心边界结论与后置决定,11 KB)因主文档预算归档为 `part-18-20.md`,经索引可达;§22 变更记录归档,后续变更条目追加于主文档「变更记录(续)」(索引节已注明)。
- 验证:22 章标题守恒、行级零丢失(新增 71 行);全仓无该文档锚点引用;门禁 PASS,基线 13 → 12。
