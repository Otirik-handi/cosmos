# 治理任务 G01:文档治理落地——四个存量超标文档拆分

## User Request / Topic

`docs/proposals/oversized-doc-splitting-v1.md`(accepted)§2 目标 3:治理四个存量超标文档。需求原话与裁决见 `docs/requirements/0001-original-requirements.md` 2026-09-10/09-11 条目。

## Goal

四个超标文档全部落回健康区(主文档 ≤30 KB 且 ≤9k token),历史内容按规范移入分册(每册 ≤30 KB),交叉引用与锚点修复,内容零丢失,基线相应缩减。

## Scope / Non-goals

**范围**:`.agents/tasks/04-workflow-runtime/walkthrough.md`(349 KB)、`.agents/tasks/04-workflow-runtime/README.md`(155 KB)、`PROJECT-STATUS.md`(109 KB,状态型混合文档)、`docs/architecture/0001-cosmos-foundation.md`(147 KB,广域设计)。

**非目标**:不动代码;不拆基线内观察文档(PRD、information-model、02-rss README、0003-dtos);不处理 `.agent/tmp` 清理;不改 spec/架构语义(0001 拆分只移动内容)。

## Current State

提案 accepted(2026-09-11);门禁已接入 CI(`size-governance.py --check`,基线 16 条);等待开始切片。

## Decisions and Deviations

- 拆分在主工作区直接进行(纯文档改动,不建 worktree;代码治理才走 Task 26 的 worktree 流程)。
- 分册按大小切(≤30 KB),不按编号范围一刀切;walkthrough 的 Round 编号不单调,切分以文件内实际顺序为准。
- PROJECT-STATUS 按 §4.5 状态型拆法:主文档只留当前快照 + 活跃风险 + 未完成边界 + 索引,历史按月切 `PROJECT-STATUS/history-YYYY-MM.md`。

## Implementation Walkthrough

| # | 切片 | 验收(≤3 条/片) | 状态 |
|---|---|---|---|
| 1 | walkthrough.md:分析 Round 分布 → 历史整段移入 `walkthrough/rounds-*.md` 分册 → 主文档留当前状态 + 有效决定 + 预算内最近记录 + 索引 | 主文档 ≤30 KB;每分册 ≤30 KB;标题集合比对零丢失 | todo |
| 2 | README.md(04):Spike 详情按阶段拆分册,主文档留背景/目标/范围/最小合同/当前状态 | 同上 | todo |
| 3 | PROJECT-STATUS.md:历史切片按月移入 `PROJECT-STATUS/history-*.md`,主文档留快照/风险/边界/索引,消除重复章节 | 同上;主文档开头为当前快照 | todo |
| 4 | 架构 0001:按领域拆 `0001-cosmos-foundation/` 分册,主文档留索引 + 不变量 + 决定 | 同上;交叉引用与锚点全部修复 | todo |
| 5 | 收口:更新 `docs/doc-governance/docs-baseline.json`(只减不增)、扫描报告、索引自动核对 | 全仓门禁 PASS;四文档退出基线 | todo |

## Verification

每切片:`python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new`;标题/代码块/列表项数量拆分前后比对;相对链接存在性;`git diff --check`。

## Follow-ups

索引自动生成脚本(按分册 front matter);`lychee` 死链检查评估;基线清空后豁免清单复审。
