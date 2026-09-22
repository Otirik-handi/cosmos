# Proposal：Trigger 剩余形态 v1（Webhook 落地，其余三种后置）

> 状态：`accepted`
>
> 日期：2026-09-22
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) AUT-004、AUT-015、AUT-016、OPS-005、OPS-009（关联 AUT-005、AUT-010）
>
> 关联设计：架构 [`part-04.md`](../architecture/0001-cosmos-foundation/part-04.md) §4.1（Trigger 类型）、§4.4（manifest 与 Source Operation）、§4.6（CollectionPlan）；ADR [`0018`](../adr/0018-trigger-sdk-v1.md)（TriggerBinding v1）、ADR [`0023`](../adr/0023-collection-plan-v1.md)（采集计划 v1）、ADR [`0017`](../adr/0017-connection-secret-state-v1.md)（Connection/Secret/State）
>
> 关联既有切片：Task [`23`](../../.agents/tasks/23-trigger-sdk/README.md)（Trigger/SDK v1）、Task [`33`](../../.agents/tasks/33-collection-plan/README.md)（采集计划 v1）、Task 22（Connection/Secret/State）、Task 21（Run 控制）

## 1. 问题

AUT-004 要求 Trigger 可由 Webhook、内部事件、条件变化或上游 Workflow 结果触发，且每次触发保存触发原因、输入、时间和对应定义版本。Task 23 只交付了 `schedule`/`manual` 两种形态并把其余形态明确后置，[`Phase-2-UNDO.md`](../../Phase-2-UNDO.md) 因此把 AUT-004 列为 P0-2「完全未交付」。

对现状的核查改变了这个缺口的**性质**和**依赖判断**（证据见 §3）：

- 架构 §4.1 已经预留**七种** Trigger 类型（`manual`、`schedule`、`poll`、`webhook`、`event`、`condition`、`dependency`），需求表的四种形态正是其中的 `webhook`、`event`、`condition`、`dependency`。所以这不是新增需求，而是**已冻结的架构合同未落地**——与 AUT-010 同一性质（ERRATA 2026-09-20 对 AUT-010 的原话）。
- `Phase-2-UNDO.md` 记「Webhook 不依赖 Phase 3，内部事件／上游 Workflow 结果依赖」。逐条核实后，**只有上游 Workflow 结果（`dependency`）真依赖 Phase 3**：它要求用户先有自己的 Workflow，而「用户自定义 Workflow 产品面」按 PRD 定级 Phase 3（ERRATA 2026-09-20 记载）。内部事件与条件变化缺的是仓库里还没有的订阅分发与条件求值，与 Phase 3 交付物没有合同依赖。
- Webhook 的瓶颈既不是 Phase 3 也不是代码量，而是**没有消费者**：四个内置来源都只声明一个轮询 `fetch` 操作，没有任何来源能主动推送。

不先裁定口径，Phase 2 会重复 ORG-021 那种「按需求表字面无法完成」的自相矛盾（同类问题已见 [`ERRATA.md`](../requirements/0002-product-requirements/ERRATA.md)）。

## 2. 目标与非目标

### 目标（v1）

1. **口径**：AUT-004 按「Phase 2 只交付 Webhook」收窄；其余三种形态记为 Phase 3。需求文字与验收条件不改写（沿用 AUT-010 先例）。
2. **Webhook 形态的 v1 合同**：入口定位对象、凭证与鉴权、幂等与重放、触发证据、体积上限与脱敏、与采集计划的关系。
3. **可验收的消费者**：为 Webhook 指定一个 Phase 2 内可达的真实消费者，避免重演 EXT-006「合同先行、无人消费」。

### 非目标（明确后置）

- `event`（内部事件）、`condition`（条件变化）、`dependency`（上游 Workflow 结果）的实现。
- 自定义 Trigger/Action 的运行时注册（AUT-005，Phase 3，依赖插件运行时）。
- `TriggerBinding` 迁移的第 4 步（contract，ADR-0023 已裁定单独排期与授权）。
- 入口的公网暴露、TLS、反向代理与部署形态（属既有 Phase 1 后置债）。
- Run 级时间/token 预算快照（按 ERRATA 2026-09-20 的记载随 RUN-006/RUN-009 后置）。
- `poll` 类型：轮询来源今天由 `schedule` + 持久 checkpoint 表达（AUT-003 已交付），v1 不为它单列类型。

## 3. 当前行为与证据

### 3.1 合同与实现现状【代码核实】

| 事实 | 证据 |
| --- | --- |
| 实现只有两种触发类型 | `triggerKindSchema`（`packages/contracts/src/base.ts`）、`ingestTriggerKindSchema`（`packages/contracts/src/action.ts`）都只枚举 `schedule`/`manual` |
| 架构已预留七种类型 | 架构 §4.1 列出 `manual`/`schedule`/`poll`/`webhook`/`event`/`condition`/`dependency`，并写明「第一版合同预留」 |
| 触发证据今天的形态 | Run 的 `triggerKind`（原因，最粗）+ `inputSnapshot`（输入）+ `createdAt`（时间）+ `manifestHash`（定义版本）；四项证据里只有「原因」无法表达 manual/schedule 之外的来源 |
| 领域事件已落地但无人订阅 | `DomainEvent` 表与 `appendDomainEvent` 已在约 15 个领域写入（`packages/storage-prisma/src/repository/`），读取只用于时间线/审计；全仓没有订阅者或分发器 |
| 没有推送型来源 | 四个内置 manifest 各只声明一个 `fetch` 轮询操作（`packages/application/src/catalog.ts`） |
| 没有 inbound 入口 | `apps/api` 无 webhook 路由；架构只预留了类型名，鉴权、幂等、限流均未设计 |
| 绑定归属正在迁移 | `TriggerBinding.sourceId` 唯一 + `planId` 可空唯一（`packages/storage-prisma/prisma/schema.prisma`）；ADR-0023 的 backfill／read switch／contract 未完成 |
| 凭证边界 | SecretStore v1 是受限权限明文文件、不加密-at-rest（ADR-0017 的既定边界） |

### 3.2 Webhook 的消费者【代码核实 + 文档核实】

- **外部平台推送**：需要真实认证 Adapter 接入（EXT-006 的后续，Phase-2-UNDO 的 P1-2 未闭合），Phase 2 内不可达。
- **用户自己的自动化**：本机脚本或其它工具调用 Cosmos 入口触发某个采集计划。不需要新 Adapter，符合「v1 面向单个本地用户」的产品口径（OPS-007），Phase 2 内可达。

选后者作为 v1 验收消费者，Webhook 就不是「合同先行、无人消费」。

## 4. 方案与取舍

### 决策 1：口径——Phase 2 只欠 Webhook

理由：

- Webhook 是四种形态里唯一既有冻结合同、又不依赖 Phase 3 的。
- 内部事件与条件变化的产品价值峰值在 Knowledge Workflow（Phase 3）之后：现在落地，事件订阅与条件求值在 Phase 2 内没有真实消费者，等于再养一个没有消费者的合同。
- 上游 Workflow 结果是唯一真依赖 Phase 3 的形态，无论选哪个口径都必须后置。

**备选 B（Phase 2 交付 Webhook + 内部事件 + 条件变化，只后置上游结果）**：拒绝。订阅分发与条件求值是两条新的架构面（需要各自的合同、持久化与验收），且 Phase 2 内没有消费者，会把 Phase 2 的尾巴变成一个新阶段。

**备选 C（AUT-004 整行改标 Phase 3）**：不作为首选。它把不需要等 Phase 3 的 Webhook 一起推后，且与 ERRATA 2026-09-16「AUT-004 是真正属于 Phase 2 的尾巴」的记载冲突，需要一条新勘误覆盖。若维护者的目标是尽快关闭 Phase 2，C 是唯一的零实现选项（见待裁定项 1）。

### 决策 2：Webhook 的定位对象与凭证

入口以 `TriggerBinding` 为定位对象（不依赖 ADR-0023 的 contract 步），产品面按采集计划呈现：

- 每个 webhook 绑定持有一个**不透明入口标识**（不可猜，不是实体 id），`kind = webhook`。
- 凭证走既有 `SecretStore`，公开合同只暴露不透明 `SecretRef`；请求必须携带该凭证，校验失败不入队，也不透露绑定是否存在。
- 凭证轮换、停用与入口变更走 `TriggerBinding.revision`；已入队的 Run 使用创建时的快照（AUT-015／AUT-016 的既有语义）。
- 明确记录边界：SecretStore v1 不加密-at-rest（ADR-0017）。Webhook 凭证不因此升级加密要求，但必须在 spec 里写明，不做静默升级。

**备选**：复用 Connection 凭证做入口鉴权。拒绝（v1）。连接凭证表达「Cosmos 如何访问外部平台」，Webhook 凭证表达「外部如何访问 Cosmos」，方向相反；混用会让 AUT-009 要求可见的「授权范围」与「失效原因」无法解释。

### 决策 3：触发证据（AUT-004 验收）

每次 Webhook 触发固化四项证据，落在 Run 的既有位置，不新增表：

| 需求要求 | v1 落点 |
| --- | --- |
| 触发原因 | 触发类型 `webhook` + 绑定标识 + 外部事件标识（可读、可审计，不含 Secret） |
| 输入 | `inputSnapshot`（沿用 ingest 的输入快照：来源/计划、游标与 checkpoint revision） |
| 时间 | Run 的 `createdAt`（入队）与 `startedAt`（开始执行） |
| 定义版本 | `manifestHash`（沿用） |

这会扩展公开的触发类型枚举（新增 `webhook`），属 EXT-003 的版本化合同扩展：不兼容版本必须被拒绝并解释原因。

### 决策 4：幂等、限流与脱敏

- **幂等**：外部事件标识作为幂等键，重复投递不产生第二个 Run（入队路径已有幂等键能力）。
- **限流与体积**：入口设请求体积上限与速率上限，超限返回可识别状态且不写入。
- **脱敏**：请求体不进日志与事件 payload（OPS-005）；只保留摘要（大小、哈希、来源标识）。
- **可区分**：「入队失败」与「已接受但未入队」必须能分开表达（RUN-005 的精神，虽然 RUN-005 本身定级 Phase 5）。

### 决策 5：与采集计划的关系

- 入口挂在 `TriggerBinding`（今天 `sourceId` 唯一、`planId` 可空），解析时按 `planId` 优先、否则按来源——与 ADR-0023 的 read switch 顺序一致，不需要第二套路径。
- 产品面按「采集计划」呈现：新建/编辑计划时可选 Webhook 触发，并从计划面板拿到入口地址与凭证；不新增独立的「触发器」页面（与 ui-surface-ownership 的「同一件事只有一个可写入口」一致）。

## 5. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：`TriggerBinding.kind` 增加 `webhook` 取值；入口标识与凭证引用落在绑定上，可能需要 migration 加列或约束（是否新增表见待裁定项 3）。
- **接口**：新增 inbound 端点（路径与版本语义见待裁定项 4）；采集计划的产品命令/查询回显入口地址与凭证**状态**（只回显引用，不回显明文）。
- **安全**：入口是**新的外部副作用面**——鉴权、幂等、限流、体积上限、脱敏缺一不可；凭证明文-at-rest 的既有边界必须写进 spec。
- **迁移与发布**：一次 migration；不涉及版本号、发布、部署与公网暴露。
- **回滚**：回滚代码后 `kind = webhook` 的绑定不会被任何调度器消费，入口端点消失；已入队的 Run 与其证据保留。

## 6. 验收草案

1. 带 Webhook 触发的采集计划：从计划面板拿到入口地址与凭证，用用户自己的自动化调用后生成一个 Run，四项触发证据可查。
2. 重复投递同一外部事件标识：不产生第二个 Run。
3. 错误凭证或超限请求：不产生 Run，且不透露绑定是否存在。
4. 日志与事件 payload 中不含请求体与凭证明文。
5. 需求表口径上，Phase 2 不再按字面欠 AUT-004 的四种形态。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- [`part-07-1.md`](../requirements/0002-product-requirements/part-07-1.md)：AUT-004 行补 v1 形态注记（Webhook 落地、其余三种记 Phase 3）。
- [`ERRATA.md`](../requirements/0002-product-requirements/ERRATA.md)：新增一条勘误，沿用 AUT-010 先例——只记 v1 形态裁定，需求文字与验收条件不改写。
- [`part-04.md`](../architecture/0001-cosmos-foundation/part-04.md) §4.1：注明七种预留类型里已实现与后置的边界，指向本 Proposal 与 ADR。
- `docs/adr/`：新增 ADR「Trigger 剩余形态 v1」，冻结「Webhook 是 Phase 2 唯一形态」与入口的凭证、幂等、脱敏边界。
- `docs/spec/`：contracts（触发类型与证据字段）、interfaces（inbound 端点、采集计划面板）；`apps/api` 的路由表断言测试需同批更新。
- `.agents/tasks/`：**复用 Task 23** 记录实施切片（其 Follow-ups 第一条正是本项），不新建编号。
- [`PROJECT-STATUS.md`](../../PROJECT-STATUS.md)：同步 AUT-004 的状态与 P0-2 的处置。

## 8. 待裁定项

| # | 问题 | 建议 |
| --- | --- | --- |
| 1 | 口径选 A（Phase 2 只交付 Webhook）、B（Webhook + 内部事件 + 条件变化）、C（AUT-004 整行改标 Phase 3） | A |
| 2 | Webhook 的 Phase 2 消费者：a 用户自己的自动化（本机脚本/工具）、b 等真实认证 Adapter 推送（若选 b，Webhook 应一并后置） | a |
| 3 | 入口凭证存储：a 复用 SecretStore（不加密-at-rest，与 ADR-0017 一致）、b 为入口凭证单独引入加密 | a |
| 4 | inbound 端点的路径与版本语义：a 独立于产品 API 前缀（如 `/hooks/...`，产品 API 现为 `/api/v1`）、b 并入 `/api/v1` | a |
| 5 | 入口标识形态：a 不透明 token（不可猜）、b 复用 TriggerBinding id | a |
| 6 | ADR 时机：a 实现前写（边界含安全与外部副作用）、b 实现切片落地后写 | a |

## 9. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-22 | 起草，状态 `reviewing`，等待裁决待裁定项 1–6 | Agent |
| 2026-09-22 | **前置裁定**：AUT-004 按「Phase 2 只交付 Webhook、其余三种形态记 Phase 3」收窄；先出本 Proposal 再谈实现；实施记录复用 Task 23 | 用户（本轮确认） |
| 2026-09-22 | **确认**：待裁定项 1–6 全部按建议采纳——口径 A、消费者取「用户自己的自动化」、入口凭证复用 SecretStore（不加密-at-rest）、inbound 端点独立于 `/api/v1`、入口标识用不可猜的不透明 token、ADR 在实现前写。稳定决定沉淀为 ADR [`0024`](../adr/0024-trigger-forms-v1.md) | 用户（评审确认） |
