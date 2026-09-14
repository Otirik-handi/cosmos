# 治理任务 G04:文档治理第二批——剩余红线文档收敛

## User Request / Topic

维护者 2026-09-14 指示「确认待治理文档,并分配 G 系列编号」。本任务承接 [`docs/proposals/oversized-doc-splitting-v1.md`](../../../../docs/proposals/oversized-doc-splitting-v1.md)(accepted)§2 目标 3:首批四个头部文档已由 [G01](../G01-doc-splitting/) 于 2026-09-11 收口,本批处理仍留在基线红线区(>50 KB)的剩余文档。

## Goal

剩余红线文档全部落回健康区(主文档 ≤30 KB 且 ≤9k token,分册 ≤30 KB);对提案 4.1「不拆」口径成立、不适用拆分的文档,按 4.10 豁免清单显式登记。两种出口都必须让 `docs/doc-governance/docs-baseline.json` 的登记值与条目只减不增。

## Scope

范围(证据:2026-09-14 本地门禁输出,命令见 Verification):

| 文档 | 大小 | 行数 | token 估算 | 结构 | 提案口径冲突 |
|---|---|---|---|---|---|
| `docs/requirements/0002-product-requirements.md` | 99.19 KB | 896 | 33.3k | §0–§15 共 16 章,最长 §7 功能需求(209–477 行) | 无:字节与 token 双超红线 |
| `docs/architecture/0002-information-model.md` | 60.97 KB | 1046 | 20.2k | 14 章,最长 §4 四种容易混淆的判断、§6 推荐系统入门 | 有:§4.1「单一主题内聚且定稿后冻结」不拆 |
| `.agents/tasks/02-rss-ingestion/README.md` | 57.37 KB | 438 | 18.6k | Task 模板 + 242–383 行为追加的 slice 记录 | 有:Phase 1 Task 已冻结,§4.1 冻结文档不拆 |
| `docs/api/0003-product-dtos.md` | 54.19 KB | 2123 | 14.2k | §1–§16 按域分节,行数最多 | 有:§4.1 明确点名「按需查阅的参考型清单…不拆」 |

四份文档的字节均超 50 KB 红线;token 侧前三份超 15k 红线,`0003-product-dtos.md`(14.2k)未超,属「字节先到先触发」(§4.2)。

**非目标**:不动代码(代码侧红线对象见 [`../README.md`](../README.md) 的候选清单);不重写需求与架构语义(只移动内容);不拆 30–50 KB 警戒区观察文档(§2 非目标);不做 `.agent/tmp` 清理与「远端 CI 与治理边界」重复章节去重(G01 遗留裁决)。

## 口径裁定(2026-09-14,维护者按 Agent 建议裁定)

1. **`docs/api/0003-product-dtos.md` → 按域分册**(不豁免)。§4.1 原点名它是「不拆」的参考型清单,与 §4.2 红线冲突;裁定为「红线优先」——触红线的参考清单按 §4.3 按域分册,主文档只留使用说明与索引。豁免清单语义收窄为「按规则只增不减、不适用滚动归档的追加型真相源」,参考清单不适用。
2. **`docs/architecture/0002-information-model.md` → 按广域设计分册**。§4.1 的「单一主题内聚」豁免要求「已定稿冻结」,本文档是持续增长的活动架构文档,不满足该条件;双超红线即拆。
3. **`.agents/tasks/02-rss-ingestion/README.md` → 追加 slice 记录移入分册**。该段是追加式日志,按 §4.3 按预算滚动归档,比走豁免更省字节且不新增豁免语义。
4. **`docs/requirements/0002-product-requirements.md` → 按领域分册**(无口径冲突,原样执行)。

裁定已并入提案 [`docs/proposals/oversized-doc-splitting-v1.md`](../../../../docs/proposals/oversized-doc-splitting-v1.md) §4.1(新增「红线优先」)与 §8 决策记录(2026-09-14 行)。

## Current State

**已收口**(2026-09-14,维护者验收确认)。切片 0–5 全部完成:四份文档全部落回健康区并退出基线(登记条目 12 → 8),`docs:check` 536 文件 0 失败,文档门禁 PASS,代码侧门禁未受影响。四份文档的主文档合计从 271.7 KB 降至 50.2 KB;拆分产物为 18 个分册(最大 23.5 KB / 7,734 token,全部在健康区)。实施在主工作区直接进行(纯文档改动,G01 先例),未建 worktree;改动按切片提交本地 `master`,**未推送**。

四份文档已退出 `docs/doc-governance/docs-baseline.json`;基线内其余 8 条为警戒区观察条目,`generated` 字段按既有做法不变(条目与登记值只减不增由 git 历史追溯)。

## Decisions and Deviations

- 粒度沿用 G01 实践:**一批文档一个 G 任务、按文档切片**,不一份文档一个编号。若维护者要求改为逐文档独立编号,本任务顺延占用 G04–G07,目录更名即可(本任务尚无实施内容,不产生迁移成本)。
- 过程、偏差与验证命令及结果写入 append-only `walkthrough.md`;本 README 只维护当前摘要、范围、门禁与下一步,同一证据不在两处双写。
- 分册粒度按文档自身结构边界切,不按固定字节一刀切;单册超过 30 KB 时继续下钻(提案 §4.4)。

## Implementation Walkthrough

| # | 切片 | 验收(≤3 条) | 状态 |
|---|---|---|---|
| 0 | 口径裁定:四份文档的「拆分 or 豁免」结论;需要时先提提案勘误 | 结论写入本 README;提案、基线、豁免清单三处口径一致 | done(2026-09-14;提案 §4.1 + §8 已并入) |
| 1 | `docs/requirements/0002-product-requirements.md` 按领域分册(7 册;§7 功能需求单独下钻) | 主文档 ≤30 KB;单册 ≤30 KB;标题/行级守恒 | done(2026-09-14;主文档 14.9 KB) |
| 2 | `docs/architecture/0002-information-model.md` 按广域设计分册(3 册) | 同上 | done(2026-09-14;主文档 9.8 KB) |
| 3 | `.agents/tasks/02-rss-ingestion/README.md` 的追加 slice 记录移入分册(3 册) | 同上 | done(2026-09-14;主文档 22.4 KB,切片 2 册改为 3 册) |
| 4 | `docs/api/0003-product-dtos.md` 按域分册(5 册) | 同上 | done(2026-09-14;主文档 3.1 KB) |
| 5 | 收口:基线只减不增、门禁复跑、`docs:check`、walkthrough 回写 | 文档门禁 PASS;四文档退出基线 | done(2026-09-14;基线 12 → 8 条,`docs:check` 0 失败) |

## Verification

每切片:`python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new`;`bun run docs:check`(**必须在实施改动的 worktree 内执行**,主工作区跑会给出假绿灯,见根 `AGENTS.md` 验证节);标题/代码块/列表项拆分前后数量比对;`git diff --check`。

## Follow-ups

- `docs/spec/interfaces/0002-product-api-http.md`(41.99 KB)已超其基线登记值(41.76 KB),文档门禁每次报 warning(tolerated, 不阻塞)。它是基线内唯一在增长的文档,建议列为下一批文档治理候选。
- G01 遗留:分册索引自动生成脚本(按 front matter)、`lychee` 死链检查评估、豁免清单复审;提案 §4.4 的「主文档索引表 ≤5 KB」尚无自动校验。
- 本次切分脚本留在 `.agent/tmp/split-g04.py`(未入库,与 G03 的评分脚本同类)。是否把「结构切分 + 守恒校验」并入 `scripts/` 待维护者决定——若后续还有文档批次,重复手写脚本的成本会高于维护一个带 dry run 的工具。
- 代码侧下一批对象的排序与编号分配(见 [`../README.md`](../README.md))。
