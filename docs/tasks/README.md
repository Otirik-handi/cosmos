# Task Walkthroughs

重大功能、数据合同、扩展协议、运行时恢复或用户主流程使用一个持续更新的 Task。

目录名使用 `{NN}-{kebab-case-name}`。同一功能后续调整继续更新原 Task，不创建碎片化记录。

每个 Task 至少记录：

- User Request / Topic
- Goal
- Scope / Non-goals
- Current State
- Decisions and Deviations
- Implementation Walkthrough
- Verification
- Follow-ups

跨 Task 的产品 TODO 在建立远端 Issue 系统后迁移到 Issue；在此之前由 `PROJECT-STATUS.md` 汇总。

当前实现切片：

- [`02-rss-ingestion/`](02-rss-ingestion/)：Phase 1 RSS/RSSHub + fixture 录入、离线查询与最小 Story projection。
- [`03-runtime-logging/`](03-runtime-logging/)：API、Worker、Connector、存储和 Web 服务端的结构化运行日志。
- [`04-workflow-runtime/`](04-workflow-runtime/)：后续 Durable Workflow、Job 恢复、Connection/Adapter、Knowledge/Research 和 Harness 边界；其 Spike 仅作保护区/parity 证据。
- [`05-normalized-content-model/`](05-normalized-content-model/)：`NormalizedIngestItem`、Publisher、ContentKind、ContentMetrics 和 TemporalValue 的实现合同；worktree 为保护区。
- [`06-nb-workflow-kernel-convergence/`](06-nb-workflow-kernel-convergence/)：`nb-workflow@0.2.0` Kernel 稳定门禁已解除，执行权转交 Task 07；当前 Kernel 行为以合入实现源码/测试为准。
- [`07-deferred-workflow-host/`](07-deferred-workflow-host/)：Deferred Activity、Cosmos Durable Host、Activity Job、固定 Ingest parity 和 Worker Admin 实施 Task；已以 `5ce628690ab0110b0525e8ebcbacbe673ced9c55` 本地合入 `master`，未 push、未创建远端 PR。当前代码/测试证明 Durable Host、固定 ingest durable path 和 direct loopback Admin 的已实现边界；完整 parity、跨进程 recovery、长时 fencing、SIGTERM 活跃 Attempt deadline、Docker/browser/真实来源及 Gateway/Redis/多主机仍未完成或未验证。

实现规格入口：[`../spec/README.md`](../spec/README.md)。先读 spec 索引与公共合同，再按组件读取
spec 和测试锚点；Task walkthrough 记录过程与偏差，不替代已合入实现规格。
