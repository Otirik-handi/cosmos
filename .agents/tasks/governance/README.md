# 治理任务(G 系列)章程

大文件治理(文档 + 代码)及后续治理类工作使用**独立的任务编号体系**,不占用 `.agents/tasks/` 的产品 Task 编号。设立依据:`docs/proposals/oversized-doc-splitting-v1.md` 与 `docs/proposals/code-size-governance-v1.md`(均 accepted)及维护者 2026-09-11 裁定。

## 编号与目录规则

- 目录:`.agents/tasks/governance/G{NN}-{slug}/`,`NN` 从 01 起零填充顺延,**永不复用**;
- 分支与 worktree 引用:`{type}/g{NN}-{slug}`(如 `refactor/g02-storage-prisma`),worktree 同名,创建前仍按仓库规则获维护者审批;
- 治理任务同样遵守 Task 体系的记录规则:README 只维护当前摘要、范围、门禁和下一步,过程/偏差/验证写入 append-only 的 `walkthrough.md`(见 [`../README.md`](../README.md) 与 [`../AGENTS.md`](../AGENTS.md));
- 每个治理任务的验收标准以对应提案为准;编号分配由维护者裁决,或按序列顺延后报维护者确认;
- 产品 Task 的 `{NN}` 编号序列不受本体系影响,两套编号互不混用、互不占位。

## 任务索引

- [`G01-doc-splitting/`](G01-doc-splitting/):文档治理落地——四个存量超标文档拆分(文档治理提案 §2 目标 3)。**已完成收口**(2026-09-11,维护者验收确认)。
- [`G02-storage-prisma/`](G02-storage-prisma/):代码治理首对象——storage-prisma 拆分(代码治理提案 §2 目标 3)。**已完成收口**(2026-09-13,维护者验收确认)。
- [`G03-api-controller/`](G03-api-controller/):代码治理第二对象——`apps/api/src/app.controller.ts` 按资源拆分(方案 B:继承链拆文件 + 门面;评分与选型见该 Task README)。**已完成收口**(2026-09-14,维护者验收确认;代码经 `refactor/g03-api-controller` 合入 master)。
- [`G04-doc-splitting-batch2/`](G04-doc-splitting-batch2/):文档治理第二批——原基线红线区的 4 份文档(PRD、信息模型、Task 02 README、product-dtos)。**已完成收口**(2026-09-14,维护者验收确认):四份判拆、无一走豁免(提案 §4.1 增补「红线优先」),主文档合计 271.7 KB → 50.2 KB,18 个分册全部落在健康区,基线 12 → 8 条,`docs:check` 536 文件 0 失败。

## 待治理候选(编号未分配,待维护者裁决)

确认时间 2026-09-14,依据 `docs/proposals/code-size-governance-v1.md` §4.1 阈值(源码/测试 >800 行 或 >50 KB;入口文件 >300 行)。脚本门禁当前只按字节/token 判红线,行数越界不拦,故下表包含门禁未报的对象。

**字节红线(门禁报「基线内存量红线」)**

| 对象 | 行数 / 大小 | 拆分模式(§4.4) | V |
|---|---|---|---|
| `apps/web/src/components/cosmos/story-panel.tsx` | 1902 / 92.39 KB | 组件分解 | 未测(UI) |
| `packages/application/src/index.ts` | 2048 / 67.32 KB | 单体按聚合拆 | 8 |
| `apps/web/src/app/page.tsx` | 1680 / 62.17 KB | 组件分解 | 未测(UI) |
| `packages/contracts/src/index.ts` | 1455 / 53.54 KB | 桶文件模块地图化 | 10 |

**行数红线(提案口径越界,门禁未拦)**

| 对象 | 行数 / 大小 | 拆分模式(§4.4) | V |
|---|---|---|---|
| `packages/transport-http/src/index.ts` | 1269 / 42.37 KB | 单体 / 桶文件 | 5 |
| `packages/application/src/workflow-host-runtime.ts` | 1203 / 44.83 KB | 单体按聚合拆 | — |
| `packages/worker-admin/src/index.ts` | 1047 / 38.91 KB | 桶文件模块地图化 | — |
| `packages/contracts/src/index.test.ts` | 1011 / 36.37 KB | 测试按行为拆 | — |
| `packages/transport-http/src/index.test.ts` | 964 / 39.60 KB | 测试按行为拆 | — |
| `packages/application/src/media-acquisition.ts` | 916 / 29.48 KB | 单体按聚合拆 | — |
| `packages/storage-prisma/src/workflow-backend.ts` | 896 / 32.16 KB | 单体按聚合拆 | — |
| `apps/worker/src/workflow-ingest.test.ts` | 864 / 38.27 KB | 测试按行为拆 | — |
| `plugins/collectors/src/index.ts` | 818 / 25.98 KB | 桶文件模块地图化 | — |
| `apps/web/src/component-lab/product-fixtures.tsx` | 807 / 28.22 KB | 组件分解 | 未测(fixture) |
| `apps/web/src/components/cosmos/board-view.tsx` | 805 / 31.35 KB | 组件分解 | 未测(UI) |

入口文件 >300 行另含 `packages/domain/src/index.ts`(713)、`packages/logging/src/index.ts`(673)、`plugins/rss/src/index.ts`(557),均为桶文件模块地图化对象。

**未分配编号的理由**:编号分配由维护者裁决。G03 Follow-ups 已列出下一批方向(桶文件群 → 组件分解),建议按此继续顺延;UI 对象按提案 §4.2 记 `V` 未测、不参与 `P` 排序,需维护者先决定是否接入浏览器侧覆盖口径。
