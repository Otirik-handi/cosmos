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
- [`04-workflow-runtime/`](04-workflow-runtime/)：后续 Durable Workflow、Job 恢复、Connection/Adapter、Knowledge/Research 和 Harness 边界。
- [`05-normalized-content-model/`](05-normalized-content-model/)：`NormalizedIngestItem`、Publisher、ContentKind、ContentMetrics 和 TemporalValue 的实现合同。
- [`06-nb-workflow-kernel-convergence/`](06-nb-workflow-kernel-convergence/)：`nb-workflow` Kernel 与 Cosmos Durable Host 的设计收口；当前暂停，等待 Kernel 稳定。
- [`07-deferred-workflow-host/`](07-deferred-workflow-host/)：由 leader agent 协调的 Deferred Activity、Cosmos Host、Activity Job、固定 Ingest parity 和 Worker Admin 实施 Task。
