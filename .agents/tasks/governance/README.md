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

- [`G05-application/`](G05-application/):代码治理第三对象——`packages/application` 的入口与实现拆分(桶文件模块地图化 + 显式导出 → 测试按行为拆 → 单体按聚合拆;评分与选型见该 Task README)。**实施完成,待维护者验收**(2026-09-14,维护者已批准对象与 worktree):分支 `refactor/g05-application` 5 个提交;入口 **2149 → 98 行**,导出面逐字节零 diff(147),**madge 循环依赖 3 → 0**,读取量入口 −93%,typecheck 0 / unit 75·514 / property 3·4 / e2e 4·4 / build 0 / worktree 内 `docs:check` 0 失败。

## 待治理候选(编号未分配,待维护者裁决)

确认时间 2026-09-14,依据 `docs/proposals/code-size-governance-v1.md` §4.1 阈值(源码/测试 >800 行 或 >50 KB;入口文件 >300 行)。脚本门禁当前只按字节/token 判红线,行数越界不拦,故候选含门禁未报的对象。

**实测排名(P 与 N 的完整表格、D 口径问题)见 [`G05-application/README.md`](G05-application/README.md) 的「评分与选型依据」**——同一证据不在两处维护。要点:

- `P` 前三名:`packages/application/src/index.ts`(2.64)、`packages/transport-http/src/index.ts`(2.49)、`packages/contracts/src/index.ts`(1.90);后两者与 `application` 构成 §4.4 点名的桶文件群。
- `V` 未测对象(UI 组件与 component-lab fixture,提案 §4.2)按 `N` 排序:`page.tsx` 13.80 > `story-panel.tsx` 12.53 > `product-fixtures.tsx` 10.36 > `board-view.tsx` 3.63;是否先接入浏览器侧覆盖口径由维护者决定。
- 不在上列但同样越界:`packages/domain/src/index.ts`(714 行)、`packages/logging/src/index.ts`(674 行)、`plugins/rss/src/index.ts`(558 行)为入口文件 >300 行的桶文件对象;`apps/worker/src/workflow-ingest.test.ts`(865 行)为纯测试对象,`V` 不适用。
- G05 已按模型首位取 `packages/application`;排名对 `D` 口径敏感(见该 README),改判其它对象只需该目录更名。
