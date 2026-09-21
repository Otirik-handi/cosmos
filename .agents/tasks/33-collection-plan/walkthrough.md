# Task 33 Walkthrough（append-only）

## 2026-09-20：定义阶段（Proposal → ADR → Task → API Draft）

- **本轮切片**：把已 accepted 的采集计划决定落成可执行的合同与切片计划，**不写代码**。
- **前置**：`Phase-2-UNDO.md` 的 P0-1 复核结论——架构 §4.6 早已冻结 `CollectionPlan`，§4.7 记录了 Phase 1 的收窄，实现里始终缺席；数据面的隔离（Run／错误／重试／游标按来源）已具备。
- **落地**：
  1. Proposal [`collection-plan-v1`](../../../docs/proposals/collection-plan-v1.md) 起草后经维护者确认 5 项待裁定（全部按建议），转 `accepted` 并记录决策；
  2. PRD 勘误台账 [`ERRATA.md`](../../../docs/requirements/0002-product-requirements/ERRATA.md) 新增 AUT-010 行；
  3. 架构主文档 §19 决定 85、§21 不变量 63；
  4. 新增 ADR [`0023`](../../../docs/adr/0023-collection-plan-v1.md) 并登记进 [`docs/adr/README.md`](../../../docs/adr/README.md)；
  5. 新建本 Task（编号 33 由 Agent 建议、待维护者确认）；
  6. API Draft 补 v1 落地范围：[`0002`](../../../docs/api/0002-product-service-api.md) §4.3、[`0003`](../../../docs/api/0003-product-dtos.md) §2 落地注记、[`0006`](../../../docs/api/0006-scenarios-and-conformance.md) S03。
- **偏差**：无范围偏差。一个发现：API Draft 早已规划 CollectionPlan 的端点、DTO 与 S03 场景，因此本轮只补「v1 落地范围」而不重写目标合同；`docs/api/0003-product-dtos/part-02-04.md` 已封口，按治理规则把更正登记在 0003 主文档的落地注记节。
- **验证**：`bun run docs:check` 711 文件 0 失败、`python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` PASS（含基线内增长 warning）。未运行 typecheck／单元测试／浏览器 E2E——本阶段没有代码改动。
- **下一步**：切片 1a（expand）。开工前需要维护者确认 Task 编号，并给出 worktree 与提交授权（仓库规则：创建 worktree／分支与 commit 各自需要授权）。
