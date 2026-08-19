# Cosmos Agent 治理

仓库级开发规则从根目录 [`AGENTS.md`](../AGENTS.md) 开始；`.agents/` 只保存可版本控制的开发 Agent 治理资料，不属于 Cosmos 产品运行时的 Agent 数据。

- [`tasks/`](tasks/)：重大实现的任务合同、持续 walkthrough 和正式验证记录。
- 本地运行与测试数据使用根规则指定的 `.agent/tmp/`；用户管理的本地资产位于 [`.local/`](../.local/README.md)。

创建、推进或审查 Task 时，先读 [`tasks/README.md`](tasks/README.md) 和 [`tasks/AGENTS.md`](tasks/AGENTS.md)，再按链接读取相关需求、架构、ADR、当前实现规格和测试规范。
