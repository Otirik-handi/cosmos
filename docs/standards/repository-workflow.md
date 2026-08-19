# 仓库维护流程

本文件说明 Cosmos 的记录如何衔接。具体 Git、安全、Agent 协作和授权规则以根 [`AGENTS.md`](../../AGENTS.md) 为准；公开贡献要求见 [`CONTRIBUTING.md`](../../CONTRIBUTING.md) 与 [`CONTRIBUTING.en.md`](../../CONTRIBUTING.en.md)。

## 记录分工

- GitHub Issue：公开问题、需求、分流状态和实现授权。
- [`docs/proposals/`](../proposals/)：尚未生效且存在长期取舍的方案。
- [`docs/requirements/`](../requirements/)：用户原话、产品范围和验收意图。
- [`docs/architecture/`](../architecture/) 与 [`docs/adr/`](../adr/)：当前设计和稳定决定。
- [`.agents/tasks/`](../../.agents/tasks/)：一次实现的范围、过程、验证、偏差和交接。
- [`docs/spec/`](../spec/)：代码已实现、可观察且可重建的当前行为。
- [`PROJECT-STATUS.md`](../../PROJECT-STATUS.md)：仓库现状、验证边界和跨任务下一步。

## 准入决策表

本表是 Proposal、公开 Issue、Task walkthrough 和 `PROJECT-STATUS.md` 是否必需的唯一决策表。其它入口只链接本表，不复制或改写矩阵。

| 改动类型 | Proposal | 公开 Issue | Task walkthrough | `PROJECT-STATUS.md` |
| --- | --- | --- | --- | --- |
| 拼写、断链或不改变含义的小型文档修正 | 不需要 | 可选 | 不需要 | 不需要 |
| 不改变用户行为、产品数据、公开接口、安装、发布或兼容承诺的纯机械仓库迁移 | 不需要 | 可选 | 需要 | 治理路径或仓库状态改变时更新 |
| 当前合同可判定的局部 Bug | 不需要 | 需要 | 通常复用相关 Task | 模块状态改变时更新 |
| 新增或改变用户可观察行为的小功能 | 接受后实施 | 需要且已接受 | 由维护者复用或创建 | 状态改变时更新 |
| 跨模块、进程或数据所有权，或改变持久化、公开接口、权限、安全、安装、发布、兼容承诺 | 接受后实施 | 需要且已接受 | 需要 | 需要 |
| 产品数据迁移、数据生命周期或正式发布 | 接受后实施 | 需要且已接受 | 复用相关 Task | 需要 |

按可观察影响和合同变化分类，不按修改文件数量分类。纯机械仓库迁移是窄例外；只要改变行为、产品数据或对外承诺，就进入对应的 Proposal 行。非公开的维护者或用户明确请求可以作为内部授权来源，但 Task 必须记录该请求；公开贡献仍按“公开 Issue”列执行。

## 变更流程

1. 按上表从用户请求或 Issue 确认问题、可观察结果、记录要求和授权边界。
2. 需要 Proposal 时，用户原话仍先追加到原始需求；Proposal 接受后，才把目标写入 PRD、架构或 ADR 并创建或复用 Task。
3. 使用 `{type}/{refs}-{slug}` 分支和 `.worktree/<slug>` 隔离实现；Task 持续记录范围、决定、偏差和证据。
4. 代码与行为测试按 [`docs/testing/`](../testing/) 分层验证；只报告实际运行结果，不用低层检查替代高层验收。
5. 行为落地后更新 `docs/spec/`；仓库状态或跨任务边界变化时按表更新 `PROJECT-STATUS.md`。Task 保留实施过程，不成为第二份当前合同。
6. PR 使用仓库模板。commit、push、创建 PR、合并、关闭 Issue、清理 worktree、发布和部署分别遵守用户授权。

每项含义只在一个权威来源维护；其它文档写摘要和链接，不复制正文。
