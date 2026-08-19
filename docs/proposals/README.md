# 项目提案

`docs/proposals/` 保存尚未生效、需要评审的产品或工程方案。Proposal 用于决定长期行为，不是当前实现规格、Task、待办清单或过程日志。

## 何时创建

满足任一条件时创建 Proposal：

- 新增产品能力或改变用户可观察行为；
- 跨越多个模块、进程或数据所有权边界；
- 改变持久化格式、公开接口、权限、安全、安装、发布或兼容承诺；
- 存在两个以上长期方案，需要记录取舍和放弃原因；
- Bug 的期望行为仍有产品歧义，无法由当前合同判定。

不命中上述 Proposal 触发条件的改动，是否需要公开 Issue、Task walkthrough 或项目状态更新，按 [`repository-workflow.md` 的准入决策表](../standards/repository-workflow.md#准入决策表)执行；本文件不维护第二套例外。

## 文件与状态

文件名使用英文 kebab-case。每份 Proposal 使用以下状态之一：

- `draft`：正在形成问题和方案；
- `reviewing`：方案已完整，等待决策；
- `accepted`：允许更新稳定文档并创建或复用 Task；
- `rejected`：不采用；
- `superseded`：由后续 Proposal 取代。

## 最小内容

每份 Proposal 必须包含：状态、问题、目标与非目标、当前行为与证据、方案与取舍、数据/接口/安全/迁移/发布/回滚影响、对 requirements/architecture/ADR/spec 的预期改动，以及带日期和决策者的决策记录。

## 生效规则

`draft` 和 `reviewing` 只供讨论，不能作为代码、测试或 Agent 的当前行为依据。`accepted` 只授权更新稳定文档和开始 Task；被接受的目标应写入 [`requirements/`](../requirements/)、[`architecture/`](../architecture/) 或 [`adr/`](../adr/)，一次实现记录进入 [`.agents/tasks/`](../../.agents/tasks/)。行为由代码和测试实现后，当前事实收敛到 [`docs/spec/`](../spec/) 和 [`PROJECT-STATUS.md`](../../PROJECT-STATUS.md)。
