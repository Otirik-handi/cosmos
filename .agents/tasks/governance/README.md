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

- [`G05-application/`](G05-application/):代码治理第三对象——`packages/application` 的入口与实现拆分(桶文件模块地图化 + 显式导出 → 测试按行为拆 → 单体按聚合拆;评分与选型见该 Task README)。**已完成收口**(2026-09-14,维护者验收确认;经 `refactor/g05-application` 以 `--no-ff` 合入 master `66862ff`,worktree 与分支已清理):入口 **2149 → 98 行**,导出面逐字节零 diff(147),**madge 循环依赖 3 → 0**,读取量入口 −93%,typecheck 0 / unit 75·514 / property 3·4 / e2e 4·4 / build 0 / `docs:check` 0 失败(合并后在 master 重跑)。已推送 `origin`(2026-09-14);推送触发 CI,首次 Node process E2E 因既有用例时序 flake 失败、重跑失败作业后 4 作业全绿(详见该 Task walkthrough 勘误节)。
- [`G06-redline-code/`](G06-redline-code/):红线代码批次——`packages/contracts/src/index.ts`(桶+单体混合,走完整三步)与 `apps/web` 的 `page.tsx`、`story-panel.tsx` 两个 UI 单体(桶文件步骤不适用;验收 = 现有浏览器用例全绿 + 导出面不变)。**已完成收口**(2026-09-14,维护者授权收尾;经 `refactor/g06-redline-code` 以 `--no-ff` 合入 master `df76e96`,worktree 与分支已清理,已推送 origin):contracts 入口 **1455 → 168 行**(导出面 432 逐字节零 diff、madge 0 环)、`page.tsx` **1680 → 738 行**(6 个域 hook)、`story-panel.tsx` **1902 → 757 行**(15 个内部件);`code-baseline.json` 18 → **8 条**;合并后 master 重验 typecheck 0 / unit 81·515 / property 4 / e2e 4 / 浏览器 17 / lint 0 error / `docs:check` 600 文件 0 失败。维护者指令 3 文件同批,偏离「单 Task 一文件」SOP 已记入该 Task Decisions。
- [`G07-transport-http/`](G07-transport-http/):代码治理第四对象——`packages/transport-http` 单体拆分(纯单体:0 处 `export *`、解析后 4 个导出,桶文件步骤跳过)。**已完成收口**(2026-09-14,维护者授权「直到 G07 完成」;经 `refactor/g07-transport-http` 以 `--no-ff` 合入 master `06065cd`,worktree 与分支已清理,已推送 origin):`index.ts` **1269 → 11 行**(门面,读取量 10,592 → 141 token,−98.7%)、`index.test.ts` 964 行 → 6 个域文件(17 用例守恒);按 G03 先例「继承链拆文件 + 门面」拆为 `types` + `client-base`(protected `request` 唯一管道)+ platform/sources/content/organization/board 5 个资源分册;**导出面 4 个逐字节零 diff**、madge 0 环、全仓 typecheck 0 / unit 87 文件·516 用例 / property 4 / e2e 4;`code-baseline.json` 8 → **6 条**;完整口径红线文件 **10 → 8**。

## 待治理候选(编号未分配,待维护者裁决)

确认时间 2026-09-14,依据 `docs/proposals/code-size-governance-v1.md` §4.1 阈值(源码/测试 >800 行 或 >50 KB;入口文件 >300 行)。脚本门禁当前只按字节/token 判红线,行数越界不拦,故候选含门禁未报的对象。

**实测排名(P 与 N 的完整表格、D 口径问题)见 [`G05-application/README.md`](G05-application/README.md) 的「评分与选型依据」**——同一证据不在两处维护。分配现状:G05 取 `packages/application`;G06 取 `contracts`、`page.tsx`、`story-panel.tsx`。

**红线口径(维护者 2026-09-14 裁定)**:采用**完整红线**——源码/测试 **>800 行** 或 >50 KB 或 >15k token,三者先到先触发;行数越界与字节越界**同等**作为治理触发条件。

**门禁缺口**:`scripts/size-governance.py --check` 目前只判字节/token,**行数越界不拦**,因此 CI 报不出行数越界文件;把行数阈值并入 `--check`(并为其建立行数基线)是根因修复,列为下一步机制任务。G06 收口时汇报的「红线 0 个」仅对字节口径成立。

**完整口径下当前超红线文件(10 个,全部为行数越界;G07 治理其第 1、4 项)**:

| 文件 | 行 | 字节 |
|---|---|---|
| `packages/transport-http/src/index.ts` | 1269 | 41.4 KB |
| `packages/application/src/workflow-host-runtime.ts` | 1205 | 43.8 KB |
| `packages/worker-admin/src/index.ts` | 1047 | 38.0 KB |
| `packages/transport-http/src/index.test.ts` | 964 | 38.7 KB |
| `packages/application/src/media-acquisition.ts` | 918 | 28.8 KB |
| `packages/storage-prisma/src/workflow-backend.ts` | 896 | 31.4 KB |
| `apps/worker/src/workflow-ingest.test.ts` | 864 | 37.4 KB |
| `plugins/collectors/src/index.ts` | 818 | 25.4 KB |
| `apps/web/src/component-lab/product-fixtures.tsx` | 807 | 27.6 KB |
| `apps/web/src/components/cosmos/board-view.tsx` | 805 | 30.6 KB |

**G 系列暂停**（维护者 2026-09-14）：G01–G07 已完成收口，系列暂时告一段落；**不做非红线文件**。恢复时从下表次序（行数降序）继续，并按「完整口径」判定触发（行数或字节或 token 先到先触发）；门禁尚未拦行数，选型时**必须用 `--json` 自行核对 `lines` 字段**，不要只看门禁结论。

治理队列: **G07 = `packages/transport-http`**(index.ts + index.test.ts,完整口径下最大者,已开工);其余 8 个对象(G08 起)的排序待维护者裁定——候选次序建议按行数降序,即 `application/workflow-host-runtime.ts`(1205)→ `worker-admin/index.ts`(1047)→ `application/media-acquisition.ts`(918)→ `storage-prisma/workflow-backend.ts`(896)→ `worker/workflow-ingest.test.ts`(864)→ `plugins/collectors/index.ts`(818)→ `component-lab/product-fixtures.tsx`(807)→ `cosmos/board-view.tsx`(805)。
