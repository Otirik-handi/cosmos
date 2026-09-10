# 治理任务(G 系列)章程

大文件治理(文档 + 代码)及后续治理类工作使用**独立的任务编号体系**,不占用 `.agents/tasks/` 的产品 Task 编号。设立依据:`docs/proposals/oversized-doc-splitting-v1.md` 与 `docs/proposals/code-size-governance-v1.md`(均 accepted)及维护者 2026-09-11 裁定。

## 编号与目录规则

- 目录:`.agents/tasks/governance/G{NN}-{slug}/`,`NN` 从 01 起零填充顺延,**永不复用**;
- 分支与 worktree 引用:`{type}/g{NN}-{slug}`(如 `refactor/g02-storage-prisma`),worktree 同名,创建前仍按仓库规则获维护者审批;
- 治理任务同样遵守 Task 体系的记录规则:README 只维护当前摘要、范围、门禁和下一步,过程/偏差/验证写入 append-only 的 `walkthrough.md`(见 [`../README.md`](../README.md) 与 [`../AGENTS.md`](../AGENTS.md));
- 每个治理任务的验收标准以对应提案为准;编号分配由维护者裁决,或按序列顺延后报维护者确认;
- 产品 Task 的 `{NN}` 编号序列不受本体系影响,两套编号互不混用、互不占位。

## 任务索引

- [`G01-doc-splitting/`](G01-doc-splitting/):文档治理落地——四个存量超标文档拆分(文档治理提案 §2 目标 3)。
- [`G02-storage-prisma/`](G02-storage-prisma/):代码治理首对象——storage-prisma 拆分(代码治理提案 §2 目标 3)。
