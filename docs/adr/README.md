# Architecture Decision Records

ADR 只记录已经稳定、需要长期保留的决定。仍在探索或会随下一轮需求调整的内容保留在 `docs/architecture/` 和对应 Task。

文件名使用四位编号，例如：

```text
0001-durable-workflow-runtime.md
```

每份 ADR 至少包含 Context、Decision、Consequences 和 Revisit Gate。

## 当前 ADR

- [0001 Durable Workflow Runtime](0001-durable-workflow-runtime.md)：固定
  `Job + Workflow`、Cosmos/Harness durable truth、lease fencing 和领域恢复边界；
  “Cosmos 自有脚本内核”和 Step 底层原语部分已由 ADR-0002 取代。
- [0002 `nb-workflow` Kernel 与 Cosmos Durable Host](0002-nb-workflow-kernel-cosmos-host.md)：
  固定规范脚本 Kernel、可选 Backend、Cosmos Host、`TaskStore + WakeupBus`、
  多宿主和 Agent Extension 边界；实施先稳定 `nb-workflow`，再进入 Cosmos
  Worker/Host convergence。
- [0003 Product Service、Worker Admin 与 Worker Gateway 边界](0003-service-worker-api-boundaries.md)：分离产品、运维和远程执行协议；远程 Worker v1 使用 HTTPS long-poll，并由 Action execution placement 控制执行位置；Attempt owner handoff、late evidence 和 Gateway capacity 由 TaskStore fencing/CAS 裁决。Worker Admin 后于本地 Worker 收敛，远程 Gateway 再后置实施。
- [0004 SourceInstance 身份与 revision 并发边界](0004-source-instance-identity-and-revision.md)：固定版本化 `sourceDefinitionRef`、manifest 到 Connector 的显式映射、迁移预检、默认停用和 revision CAS；不覆盖 CollectionPlan、未保存 Probe 或媒体实现。
- [0005 媒体边界 v1](0005-media-boundary-v1.md)：固定 RSS 媒体提取/受控下载与本地保存的 v1 边界——Connector 纯提取、Application 统一媒体获取、公开 `media-download` 能力门控、4 态 + 可空 `errorMessage` 降级原因、10MB/50MB 全局预算、下载安全边界与"不自愈"生命周期；per-source 策略与 `local` 作用域后置。
