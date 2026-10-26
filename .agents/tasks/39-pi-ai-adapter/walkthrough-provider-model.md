# Task 39 过程续篇：Provider/model 产品配置

> 本册只保留目标、差距、实施顺序与验收门禁；B2b 的落地证据在 `walkthrough-provider-model-08.md`，`agent.invoke@2` 的真实请求证据在 `walkthrough-provider-model-09.md`。
> 同系列：`walkthrough-provider-model.md`（本篇）、`walkthrough-provider-model-02.md`、`walkthrough-provider-model-04.md`、`walkthrough-provider-model-06.md`、`walkthrough-provider-model-07.md`、`walkthrough-provider-model-08.md`、`walkthrough-provider-model-09.md`。

后续进展：[安全读取与后续产品接线](walkthrough-provider-model-02.md)。

> 本文件是 [walkthrough](walkthrough.md) 的顺序续篇，不是第二套 tracker。历史 Adapter 和隔离真实验收证据留在原文。
> 当前阶段：A 目标合同已完成设计复核，B1 与 B2a 已验证；B2b-1 内部锁组件已完成聚焦验证和独立静态审查。完整凭证协调与产品流程尚未实现。

## 本轮切片与 TaskStartSnapshot

- 用户整体接受 [Provider/model Proposal](../../../docs/proposals/connection-credential-entry-v1.md)，允许下一步；按仓库维护流程的维护者直接请求例外记录，不创建公开 Issue 或新 Task 编号。
- 复用 Task 39：新能力服务于同一 pi-ai 调用链、Worker 凭证边界与首个产品配置消费者；这是显式扩展，不反写原 Task 的无 UI/无迁移历史范围。
- 基线：工作目录为当前仓库，HEAD `f66c33135351af38460fff73d311863dc7b4ef47`；master，约 57 个 tracked dirty 文件及大量 untracked。全部视为用户改动，不清理、不覆盖、不按 HEAD 重建。
- schema 已有 Task 40 的 45 行差异及三个未跟踪迁移；Worker main、多个公共导出与 ADR 也已 dirty。当前没有取得这些共享文件的写入独占权。
- Change Necessity：最终需要 code-change，当前切片仅 documentation。ArchitectureReviewRequired：yes，涉及 Provider 凭证所有权、持久化、公开接口和调用路由。
- 当前可写集合仅为本续篇、Task README/原 walkthrough 的入口，以及已读 Proposal 的接受状态。创建本续篇已在用户可见进度中通知。
- 仍禁止默认 `.cosmos`、指定备份、现有 SecretStore、Task 40 修改、Git 生命周期、部署和外呼。迁移执行（包括新隔离验证）须单独确认。

## 目标与完成条件

1. 用户在“模型”页创建/编辑 Provider 和模型，key 只写 SecretStore；保存不外呼，读取不返回 key，编辑留空保留原值。
2. 模型型 Connection 选择一个已有模型，Worker 每次按 Connection → Model → Provider → SecretStore 解析；新路径不回退旧部署模型配置或环境凭证。
3. 显式模型发现、两种生成协议分别通过模拟传输验证；真实请求、数据库升级和实际浏览器验证分别报告，不能用单元测试或历史真实请求替代。

## 已核实差距与设计约束

- 当前 Connection DTO 只有 connectorId，没有现成模型连接类型。拟以明确登记的模型连接种类识别，不把任意 connectorId 或旧连接猜成模型连接；准确标识与创建/清空选择规则在接口冻结时确定。
- 当前 `AgentInvocationInput` 只有 provider/model，没有 connectionId。先冻结可信 Connection 选择入口及所有调用者，再决定新增版本或兼容演进；不得把路由偷偷塞进 metadata，也不承诺 `agent.invoke@1` 输入永远不变。
- 当前 Worker 按静态 profile 取 Connection.secretRef；Adapter 注入模型类型只接受 openai-completions。Responses 需要真实 SDK 合同核对与独立行为测试，不能只增加下拉选项。
- 新 Provider 持有独占 secretRef；非模型连接仍保留既有 secretRef。保留旧代码直到新路径完成验证并明确切换，保留不等于运行时 fallback。不得自动导入旧配置或读取/搬运现有 key。
- 公网 HTTPS 必须校验实际连接目标，不能只校验 URL 或 DNS 后仍让 fetch 重新解析；重定向拒绝。SDK 请求与发现必须共用同一受控目的地策略，禁止进程全局 fetch 补丁成为产品实现。
- 当前 ADR-0017 和旧 Agent Provider Proposal 描述已实现旧路径，暂不抹除。新合同冻结后记录“接受的目标/尚未实现”与准确取代段落；ADR 等代码落地后再据证据修订，不新建重复 ADR。

## 能力依赖与实施顺序

顺序为 A → B → C → D → E → F；每个切片先核对文件 dirty diff，再冻结当轮准确可写集合。以下是候选范围，不是对所有共享文件的无条件写入许可。

### A：技术合同与稳定设计（下一切片）

- 输出：Provider/model 结构、版本 CAS、脱敏错误、专用 key 写命令、删除恢复、Connection 种类、调用路由及旧路径退出合同。
- 候选文件：本续篇；`docs/api/` 的独立 Draft；PRD/架构主文档中的目标设计入口；旧 Proposal 的局部取代说明。新建文档前通知，先读各索引与大小预算。
- 验收：每个公开命令有输入/输出/错误及首个消费者；没有凭证值读取端点；目标设计不伪装成当前实现。
- 设计建议：Provider 非秘密字段含 id/name/API/baseUrl/version/credentialState；模型含本地 id/providerId/上游模型 ID/显示名/contextWindow/maxOutputTokens。模型能力不由发现结果臆测，输出上限不超过上下文窗口。
- 发现建议边界：已保存 Provider ID，GET 基础地址下的 models，10 秒、1 次、0 重试、0 重定向、1 MiB 响应上限、最多 1000 候选，不跟随任意分页 URL；返回白名单字段。准确合同在 A 中与现有协议核对后冻结。
- 凭证协调：新引用先写后 CAS 关联；冲突仅补偿本次新引用。旧引用清理失败需可观察、可重试的非秘密操作状态；Provider 删除须先阻止新关联再处理自身 key 和模型，失败不得报告删除完成。并发引用检查与提交须处于同一数据库事务，不能靠 UI。
- 安全：精确受信 Origin/Host 与 JSON、no-store、错误白名单、无请求体日志；没有 Origin 的非浏览器请求策略及代理部署假设必须明确，CORS 不是认证。

### B：Provider 持久化与凭证协调

- 候选：新的 contracts/provider-model 模块及测试、application 服务/port、storage-prisma 独立仓储模块与测试；公共导出只做必要增量。
- schema 与新 migration 属共享高风险文件：先取得写入边界，再添加 Provider/Model/关联及版本字段，保留 Task 40 原样；不覆盖 schema 或重写已有迁移。
- 验收：合成 key 创建/替换/失败补偿；并发更新/引用阻止删除；隔离 fresh 与 legacy 升级均通过后才声称迁移已验证。迁移运行必须另行批准，未批准时明确 pending，不绕过门禁。

### C：产品 API 与 transport

- 候选：新 `apps/api/src/app.controller/provider-models.ts` 及路由测试；`packages/transport-http/src/client-provider-models.ts` 及测试；仅必要的 controller/入口注册。
- 验收：写命令不接受客户端 secretRef、读响应无 key；恶意底层异常也不泄漏；保存与列表的外呼次数为零，发现只接受 Provider ID。

### D：受控模型发现与 SDK 协议

- 候选：agent-pi-ai 的受控传输/模型配置模块及测试，application 发现 port 与 API 消费者。
- 验收：Chat Completions/Responses 分别 mock 验证，不自动降级；DNS/私网/IP 字面量/IPv6/重定向/超大响应均受控；重试和日志默认值不绕过预算。
- 不新增依赖或读取被禁第三方目录来猜 API；需要第三方实现证据时先明确读取范围或使用公开官方资料。

### E：模型页面与 Connection 选择

- 候选：新 `apps/web/src/app/(shell)/models/page.tsx`、Provider 编辑/模型列表独立组件及 copy；现有 side-nav、connection-panel、transport 消费与组件实验室登记；新独立浏览器场景，不混入 Task 40 的阅读器测试。
- 验收：创建/编辑/取消/失败均清空 key，无浏览器持久化或回填；保存零 Provider 请求、发现需显式点击；模型连接才显示单选、被引用删除给出阻止原因。
- 实际浏览器验证：桌面/平板及现有视口约定、键盘/标签/焦点、错误恢复、console/pageerror/失败网络；所有 Provider 流量模拟。未授权启动服务或迁移时不声称完成此项。

### F：Worker 消费与旧配置退出

- 候选：`apps/worker/src/agent-action.ts`/测试、config/测试、main 的 Agent 注册局部、Adapter 模型 seam、调用合同与已登记生产者。
- 验收：每次读取新关联，轮换/撤销/删除/不匹配均 fail closed；缺配置不回退旧 profile/环境/Fake；两种 API、取消、预算与无泄漏通过隔离链路。
- main 混有 Task 40 repository.blobs 改动，只允许经逐行核对的 Agent 区域增量；不能整体替换。
- 退出只移除已无消费者的旧部署模型字段和注册路径，保留默认关闭及一般 Worker 行为；不删除旧凭证或验收根。若发现仍有消费者，记录阻塞，不做双轨 fallback。

**已执行（2026-10-25）**。前置的真实服务验收在两次 HTTP 200 后满足（见 [第九册](walkthrough-provider-model-09.md)），于是：

- 删除 `apps/worker/src/agent-action.ts` 与 `agent-action.test.ts`；`config.ts` 去掉 `WorkerAgentConfig`、`WorkerRuntimeConfig.agent`、`parseWorkerAgentConfig` 与只服务它的 `parseRequiredPositiveInteger`，保留注释说明 `COSMOS_AGENT_*` 现在被静默忽略（升级部署里还留着也要能起）。
- `main.ts` 的 actions 数组只剩无条件注册的 `agent.invoke@2`；Admin manifest 的 actionEvidence 由 `actions.descriptors()` 驱动，因此自动不再列 `agent.invoke@1`。
- **没有**退役 `agent.invoke@1` 的契约层：`AgentInvocationPort`、输入/输出 schema、`FakeAgentInvocationAdapter` 与 catalog 条目都还在，因为 `packages/application/src/story-agent.ts` 按这个端口注入（Task 40 尚未接入生产）。catalog 里 `agent.invoke@1` 仍是 `enabled`，但已没有进程注册它——这是「契约保留、执行者退出」的已知不一致，记录在此，不做双轨 fallback。
- 那次 `@1` 真实验收的装配（凭证按次读取、连接/SecretRef 校验、取消与 fail closed）留在 `.agents/tasks/39-pi-ai-adapter/connection-smoke.ts` 的 `createTask39AgentAction`，只为复现证据；对应的 8 项 fail-closed 用例迁进 `connection-smoke.test.ts` 的 `Task 39 @1 evidence action composition`。
- 未删任何旧凭证、验收根或 `.cosmos/` 数据。

## 测试路线与验证门禁

- TDD Route：mode auto，decision strict；authority 为仓库维护流程增量实现要求。公共合同、凭证、持久化和调用行为先失败测试，再最小实现、整理与实际表面验证。当前纯文档切片不制造 RED。
- 执行路线：inline，跨层合同顺序依赖强且共享 dirty 文件多；后续只读独立 review 可另行委派，不让多个代理写 schema/公共 DTO/walkthrough。
- 每个代码切片先列准确命令与隔离路径，禁止无隔离的全测试或默认数据库命令。候选验证包括 contracts/application/adapter/Worker 的聚焦 Vitest、相关 package typecheck、模拟 API/transport、隔离迁移、浏览器。
- 文档切片运行 `bun run docs:check`；对本轮文件单独检查链接、围栏、尾随空白。`git diff --check` 不覆盖未跟踪文件，不能单独作为本 Task 文档证据。
- 最终请独立 review 凭证并发/删除恢复/网络目的地及旧路径退役；修复问题后复跑受影响门禁。
- 真实发现和生成各需重新披露准确命令、Provider/model、文本、预算、绝对隔离根、费用/副作用、日志与清理，并取得该次明确批准。历史 QmVMec 成功不替代新 UI/新路径验收。

## A：目标合同草案与当前基线

- 维护者要求继续后重新核实：HEAD `d511d799dd40d804820a27ed6a90054a23abb728`，master 相对上游 ahead 1 / behind 0；tracked 与 index 起始干净，仅两份排除提交的会话导出 untracked，均不读取、不处理。旧 dirty/共享写入描述是此前快照，不作为本轮状态。
- 新增 [Provider/model Draft 合同](../../../docs/api/0009-provider-model-configuration.md)，同步 API 索引、PRD/架构目标入口及旧 Agent Provider Proposal 的局部取代说明；业务实现仍未开始。精确本轮写入范围为上述五个设计文档和本续篇。
- 明确模型连接种类 `cosmos.agent`、本地 modelId 关联、`agent.invoke@2` 的 connectionId 输入；保留 @1 历史合同，F 切换前不移除生产注册，不把 metadata 当路由。
- 发现复用可信 Worker/Job；凭证写入以非秘密操作记录协调，新独占 ref 发布与旧 ref 清理分离，崩溃不重放 key；清理失败可见并仅重试自身 ref。网络策略禁止私网/重定向/自动重试，实际目的地绑定及 SDK 注入尚需实现证据。
- 新鲜验证：`bun run docs:check` 检查 1047 文件、零失败；`git diff --check` 通过。正在独立只读复核设计，不代表功能、迁移、浏览器或 Provider 验收完成。
- 下一代码切片先做 contracts 的失败测试与最小实现；schema/migration 写入及任何隔离迁移仍须对应范围确认，不会因目标合同落盘自动执行。

## B1：共享配置合同切片

- Change Necessity：code-change；复杂度 medium，TDD Route: strict（沿用已记录 auto 决策）。仅校验 Provider/model 写入与非秘密快照，不提前接入数据库或发布新 Action。
- 准确可写集合：新增 `packages/contracts/src/provider-model.ts` 与 `provider-model.test.ts`；必要增量 `packages/contracts/src/index.ts`、`packages/contracts/entry-surface.txt`、`packages/contracts/MODULE.md`；本续篇记录证据。保留旧 Connection/@1/Task40 合同。
- 验证命令：`bun run vitest run packages/contracts/src/provider-model.test.ts packages/contracts/src/agent.test.ts packages/contracts/src/entry-contract.test.ts`，再运行 `bun run typecheck:contracts`；均为纯内存 schema 测试，不初始化仓储、SecretStore 或数据根。导出快照用既有 `scripts/entry-export-surface.ts` 显式更新，不新增依赖。
- RED/GREEN 只证明输入及投影结构，不能证明凭证落盘、API 防泄漏、网络目的地、迁移或用户可用流程。

## 本切片证据与审查结论

- A 独立只读审查发现四项 Important：pending 恢复缺少执行者 fence、编辑影响提示缺读取接口、Connection 增量 DTO 不完整、发现中断未映射终态；均补入 Draft，复审确认合同层面闭合。API 索引位置也已修正。跨进程锁在 Windows/Node/Bun 的实现证明仍是 B 门禁，不能以文档替代。
- B1 严格 RED：新增六项测试首次全部因接口未实现失败；GREEN 后 3 文件 11 项通过、contracts typecheck 通过。追加 URL 模型标识回归先观察到 1 项失败，再使用独立上游模型标识校验修复；create/update/snapshot 共用，不禁止合法 namespace/model。
- 新增六个 schema 与六个类型显式导出；既有工具将入口快照从 549 更新至 561 项，入口运行时测试通过。普通 Connection 与 @1 未改。
- 最近文档检查为 1049 文件零失败，diff 空白检查通过。仅纯内存测试；未访问仓储/SecretStore，不生成数据根。未运行构建、全仓测试、浏览器、迁移、真实请求；未改 Task40/default DB/备份/会话导出，未 commit/push。
- 下一边界：B2 持久化需要在 Prisma schema 做 Provider/模型/操作记录与 Connection 关联的局部增量，并新增独立 migration；不改任何 Task40 字段/既有迁移。准确迁移目录及隔离 fresh/legacy 验证命令在启动前列出并单独取得批准；当前未执行。

## B2：待批准的最小持久化切片

本节是审批提案，不是迁移或共享 schema 的执行许可。先做 B2a 结构与升级证据，再做 B2b 凭证协调；不把整个 B–F 混成一次修改。

### B2a 文件与数据边界

- 修改 `packages/storage-prisma/prisma/schema.prisma`：仅新增 ModelProvider、ConfiguredModel、ModelConfigurationOperation 所需结构，以及 ConnectionInstance 的可空模型关联和版本字段；保留其它模型与现有 Connection.secretRef，不导入旧凭证、不自动选择模型。准确列与约束先由测试和目标合同逐项映射，不预设删除级联可以代替引用检查。
- 新增候选 `packages/storage-prisma/prisma/migrations/20261015000000_provider_model_configuration/migration.sql`：仅一个新增迁移，落盘前确认目录不存在；名称冲突时停下重新列范围，不覆盖已有迁移。所有既有迁移（包括 Task40）保持原样。
- 新增 `packages/storage-prisma/src/provider-model-migration.test.ts`：只验证 fresh 与合成 legacy 升级、旧 Connection 字段保持、modelId 默认空、版本初始化、外键/唯一约束及失败事务不破坏数据。此测试不声明凭证协调或产品仓储已通过。
- 本续篇记录 RED/GREEN、文件差异和完整命令。B2a 不修改 API/Web/Worker、仓储继承链或公共导出；不调用 SecretStore。

### 申请的验证方式（尚未运行）

拟在上述测试实现并审查隔离守卫后运行：

```text
bun run vitest run packages/storage-prisma/src/provider-model-migration.test.ts
```

- 测试以 `mkdtemp` 在仓库 `.agent/tmp/task39-provider-model-migration-<随机后缀>/` 创建独立根，完整绝对路径随结果报告，保留目录，不自动删除。fresh 与 legacy 分属不同子目录，各自显式注入数据库 URL；不接受调用者传入数据库路径。
- 通过已安装 Prisma CLI 的解析器定位可执行文件，以参数数组调用，并仅向子进程传入审核过的必要环境和隔离 DATABASE_URL；不改父进程环境、不下载依赖。命令与实际 schema 路径由测试固定，不使用 migrate dev/reset/db push。
- fresh 应用复制到隔离根的完整迁移集合；legacy 先仅应用新增迁移之前的既有集合，写入合成旧 Connection，再应用新增迁移。只读取新建测试库，不复制或查询默认数据库/备份。所有迁移从工作区文件复制，记录路径与摘要，不从历史默认数据建 seed。
- 只运行上述聚焦命令前必须确认其确实执行迁移；不能将它标为普通无副作用单元测试。Prisma validate/generate 和 storage typecheck 不隐含纳入授权：generate 可能写共享生成物，B2a 不需要 Client 读取新模型，后续使用时另列准确产物与命令。
- 已只读核实 `scripts/prisma.ts:8-19` 会在分派命令前创建数据根/数据库文件，`:39-43` 会继承 DATABASE_URL。因此不直接运行根 db:validate/db:migrate/db:generate，也不以设置一个变量就声称已隔离。

### B2b 入口门禁

凭证服务/仓储与跨进程锁另列切片；必须先证明 Windows、Node/Bun 支持的真正进程间排他方案，以及执行者退出后的恢复。不用过期锁文件接管活执行者，不把 SQLite CAS 当作对未终止文件 I/O 的互斥证明。若现有依赖不能兑现，先提交设计取舍，不擅自新增依赖或降级合同。

## B2a 开工快照与实施约束

- 维护者明确批准 B2a 后正式开工。新鲜基线 HEAD `d511d799dd40d804820a27ed6a90054a23abb728`、master、ahead 1 / behind 0、单一 worktree；此前 A/B1 的八个 tracked 修改及三个新增设计/合同文件保留，两份会话导出保持不读不动。schema 无既有 diff，未发现进行中的 Git 操作。
- 可写仅 schema、单一新增 migration、`provider-model-migration.test.ts` 及本续篇。Change Necessity 为 code-change，ArchitectureReviewRequired 为 yes（沿用已冻结目标合同）；TDD Route: strict，authority 为既有 recorded auto decision。先对真实隔离迁移观察 RED，再补结构。
- Provider 保存非秘密配置、可空已发布 secretRef、版本及操作占用；ConfiguredModel 外键归属 Provider，Provider 内上游 ID 唯一；Connection 添加可空模型外键及版本。操作收据独立保留 providerId、执行代次、阶段及新旧 ref，不保存 key 或命令 payload，不随 Provider 删除级联消失。占用/发布/恢复的跨进程协调不是本切片实现。
- 迁移只增表、增列和索引；旧 Connection.secretRef 及 Task40 完全保留，不导入旧配置，不回填模型选择。真实 SecretStore 不参与测试，合成 ref 只写隔离数据库文本列。删除限制由 FK 与后续事务引用检查共同承担，不把 FK 当成完整产品语义。

## B2a 首轮运行证据

- 已按批准正式写入四文件：schema 局部增量、`20261015000000_provider_model_configuration/migration.sql`、`provider-model-migration.test.ts` 和本续篇；无既有迁移改动。
- RED：`bun run vitest run packages/storage-prisma/src/provider-model-migration.test.ts` 真实执行隔离迁移后两项失败，分别为 `no such table: ModelProvider` 与 `no such column: modelId`。保留根 `.agent/tmp/task39-provider-model-migration-F55DqB`、`.agent/tmp/task39-provider-model-migration-gm0scu`。
- 首轮 GREEN：同命令 2/2 通过（13.53 秒），fresh 根 `.agent/tmp/task39-provider-model-migration-h58MXa`、legacy 根 `.agent/tmp/task39-provider-model-migration-hd1oB2` 均保留。legacy 从工作区此前 40 个迁移构造合成 Connection，再增量应用第 41 个；未复制默认数据库。
- 覆盖真实 SQL 的 Provider 内模型唯一约束、跨 Provider 同模型名、模型/Provider 外键限制、Connection 缺失模型拒绝、失败事务回滚、版本默认值、操作幂等键/占用唯一性、Provider 删除后收据保留和关联索引；父进程环境不修改。未调用真实 SecretStore 或任何 Provider。
- Prisma 子进程只传显式隔离 URL 和必要环境，stdio 写隔离日志，不使用根 Prisma 包装脚本；迁移 SQL 路径与 SHA-256 清单留在隔离根。未执行 validate/generate，未产生新 Prisma Client，因此测试仅用既有 Client 的原生 SQL 能力，不声称 ORM 新模型访问已验证。
- 独立只读审查未发现可确认为 Important 的 B2a 问题；审查者未复跑测试，SQL/schema 一致仅为静态核对。根据审查补强 Provider.secretRef 与 Operation.newSecretRef 重复非空拒绝，以及落库迁移名称/校验和与 manifest 的逐条对应。
- 补强后最终聚焦命令仍为 `bun run vitest run packages/storage-prisma/src/provider-model-migration.test.ts`：1 文件 2/2 通过（14.29 秒，退出 0）。最终保留根 `.agent/tmp/task39-provider-model-migration-ACVzty`（fresh）、`.agent/tmp/task39-provider-model-migration-HKbk5k`（legacy）。另已通过隔离库 `foreign_key_check` 与 `integrity_check`。
- 本切片只新增数据库结构和隔离验证，无新运行时回退或双重凭证所有者；复杂度范围仍为单一迁移测试。证据置信度 B：真实隔离 SQL 目标验证通过，但未生成客户端，未证明 ORM、并发锁、凭证协调、API/UI、Worker 新链路或整体 Task39 完成。

## `@2` 连接作用域 smoke

runner 的三个 `@2` 模式、四次真实外呼的取证与结论、以及完成条件 ③ 的 `@2` 成功证据，见[本续篇（九）](walkthrough-provider-model-09.md)。结论：前三次 400 是终端粘贴损坏的凭证而非代码缺陷，第四次用正确凭证在 `.agent/tmp/task39-real-v2-YQqFPF` 上拿到 `responseStatus: 200`。

## 当前未运行与下一步

A 为目标设计完成，不等于 API 已上线；B2a 隔离迁移 2/2 GREEN，B2b-1 内部组件接入已批准。至本次收口，原本「未运行」的几项已有证据：`bun run test:browser:component-lab` 全量 45 passed（`connection-panel` 9 项含新增模型单选 5 项）、`bun run vitest run apps/web` 21 文件 146 项、全量 `bun run vitest run` **198 文件 1134 项**、`.agents/tasks/39-pi-ai-adapter` 2 文件 40 项（含从已删除的 `agent-action.test.ts` 迁入的 8 项 `@1` fail-closed）、`bun run docs:check` 0 失败、完成条件 ③ 的两半真实请求。F 切片已执行：Worker 不再读 `COSMOS_AGENT_*`、不再注册 `agent.invoke@1`，`apps/worker/src/agent-action.ts` 与其测试已删除。`bun run build` 在本轮收口时实跑并以 exit 0 通过（Next 13/13 静态页预渲染）。仍**未运行**：默认数据库升级、生产部署。

收口时的全量浏览器套件实跑 `bun run test:browser` → **58 passed / 2 failed（3.7m）**，两条失败都不是本 Task 引入的，故不阻塞完工，但要如实记下它们让仓库整体仍非全绿：

| 失败 | 现象 | 归属 |
| --- | --- | --- |
| `e2e/browser/layout-and-budget.spec.ts:295` | 首屏 JS `401433` > 上限 `335974`（超约 65 KB） | Task 36 的预算门禁；本会话未改首页外壳，`d511d79`/`9fccfcb` 均为会话基线 `4e10172` 的祖先 |
| `e2e/browser/story-reading.spec.ts:63` | 找不到 `article div.whitespace-pre-wrap` | Task 40 把正文改由 `content-block-reader.tsx:62` 渲染成 `<p className="my-4 whitespace-pre-wrap">`，选择器仍找 `div` |

两条都可单独修（前者属 ADR-0029「未达标按实测调整预算，不静默放宽」范畴，后者是选择器跟随表示层），但不能靠放宽断言或删用例消红。

代码体积治理本轮**没有**拆任何文件：`apps/web/src/components/cosmos/connection-panel.tsx`（34.22 KB）、`packages/storage-prisma/src/workflow-host-store/activity-store.ts`（30.71 KB）、`packages/application/src/workflow-host-runtime.test.ts`（32.57 KB / 915 行）已按维护者裁决登记进 [拆账台账](../governance/split-backlog.md)，拆文件需单独开治理 Task；其中第三项在 `origin/master` 上就已 31.44 KB，与本轮无关。
