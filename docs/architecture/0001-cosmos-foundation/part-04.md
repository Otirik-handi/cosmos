---
parent: docs/architecture/0001-cosmos-foundation.md
range: §4
sealed_at: 2026-09-11
tags: [architecture, cosmos-foundation]
tokens_est: 5118
---

## 4. Source、Trigger、Workflow 与 Action

用户体验可以类似 GitHub Actions，但底层需要拆开四个概念。

| 概念 | 责任 | 示例 |
| --- | --- | --- |
| `SourceDefinition` | 描述一种来源类型及其配置 schema | RSS、IMAP、Telegram、BiliBili 首页推荐 |
| `SourceInstance` | 用户配置好的一个具体来源 | 用户 A 的 BiliBili 首页、某个邮箱收件箱 |
| `TriggerBinding` | 判断何时启动一个 Workflow，并绑定输入和定义版本 | 手动、cron、轮询发现变化、webhook、内部事件 |
| `WorkflowDefinition` | 编排一组有顺序和分支的步骤 | 拉取 → 标准化 → 去重 → 入库 → 触发分析 |
| `ActionDefinition` | 可复用执行能力 | `rss.poll`、`http.fetch`、`agent.run`、`artifact.publish` |
| `WorkflowRun` | 某一版 Workflow 对输入快照的一次执行 | 2026-08-06 08:00 的日报 Run |
| `Activity` | Run journal 中一次需要稳定恢复的交互 | Action 调用、Query、Signal、Timer、Child Workflow |
| `Job` / `Attempt` | 宿主可领取的任务，以及持有 lease 的一次实际尝试 | Worker 第 2 次执行 `rss.poll@1` |
| `Step` | 可选的命名逻辑分组和 UI 投影 | “拉取”“入库”“研究” |

### 4.1 Trigger 类型

第一版合同预留以下 Trigger：

- `manual`：用户点击、CLI 或 API 触发。
- `schedule`：cron 或固定间隔。
- `poll`：按计划执行轻量检查，仅在游标、版本或条件变化时发出事件。
- `webhook`：外部平台主动通知。
- `event`：订阅 Cosmos 内部领域事件，例如 `entry.created`、`story.materially_updated`。
- `condition`：基于查询结果、状态或阈值触发，例如“DeepSeek 状态由 available 变为 degraded”。
- `dependency`：另一个 Workflow 或 Step 成功、失败或产出特定结果后触发。

“轮询邮箱，有新邮件则触发”应建模为：

1. `schedule` 唤醒 IMAP Poll Trigger；
2. Trigger 使用持久 checkpoint 检查 UID / ModSeq；
3. 有变化时发出 `source.change_detected`；
4. Workflow 调用 IMAP Action 获取并录入新邮件。

Trigger 只负责发现“应该开始”，不承担完整抓取、LLM 和写库逻辑。这样同一套 IMAP Action 可以被手动触发、定时触发或其它 Workflow 调用。

### 4.2 Action 类型

- `connector`：调用外部平台或读取本地输入。
- `transform`：解析、清洗、规范化、切分和格式转换。
- `library`：通过公开 Command 写入 Entry、Asset、关系或 Annotation。
- `query`：查询信息库、Saved View 或关联图。
- `control`：条件、分支、循环、fan-out、fan-in、wait 和 retry。
- `script`：执行用户提供的受控代码。
- `agent`：启动带模型、工具、预算和配置能力范围的 Agent Run。
- `artifact`：创建或更新 Artifact Revision。
- `render`：把 Board、Workspace 或 Artifact 渲染成网页、图片或其它格式。
- `delivery`：后续向 Telegram、QQ、Email 等渠道发送。

`ActionDefinition` 是能力合同，不是任务实例。它声明版本化的输入/输出 schema、Capability、幂等、超时、取消、重试和恢复语义；一次实际调用由 Workflow 记录为 Activity，Cosmos Host 在需要外部执行时创建 Job，每次 Worker 执行形成一个带 lease 的 Attempt。Step 只在需要逻辑分组或 UI 投影时创建。

### 4.3 Workflow 定义

Workflow 使用版本化定义描述 Trigger Binding、输入、步骤、能力范围和预算。脚本式 Workflow 是最底层、最灵活的执行形态；Graph、IR 和 Comfy 类表达属于上层编排格式，可以转换为脚本式 Workflow 语义，不建立第二套执行 Runtime。

```yaml
id: important-mail-intake
version: 1

triggers:
    - kind: schedule
      every: 2m
    - kind: manual

capabilities:
    - source:mail.personal.read
    - library:entry.write
    - agent:classify.run

steps:
    - id: poll
      uses: connector.imap.poll@1
      with:
          source: mail.personal

    - id: ingest
      foreach: ${{ steps.poll.items }}
      uses: library.entry.ingest@1

    - id: classify
      if: ${{ steps.ingest.created }}
      uses: agent.run@1
      with:
          profile: mail-importance
          input: ${{ steps.ingest.entryId }}
```

上例只表达合同方向，具体 DSL 在实现 Task 中通过 schema 和行为测试确定。

Workflow Definition、Action Definition、Trigger Binding 与 Workflow Run 的关系是：

```text
TriggerBinding
  -> WorkflowDefinition@version
      -> WorkflowRun(inputSnapshot, definitionSnapshot)
          -> Journal
              -> Activity[]
                  -> ActionDefinition@version
                      -> Job
                          -> Attempt + Lease
          -> Step projection[] (optional)
```

- `WorkflowDefinition` 描述可执行流程；它可以由脚本注册，也可以由 Graph/IR 转换生成。
- `ActionDefinition` 描述可复用能力；它不代表某一次执行。
- `TriggerBinding` 只负责触发时机、绑定的来源/输入、并发与计划策略，不拥有执行状态。
- `WorkflowRun` 保存触发原因、定义版本、输入快照、预算、父子关系和最终收口，是一次实际执行的 durable truth。
- `Activity` 以稳定 path、序号、kind 和输入 fingerprint 标识，完成后可在 replay
  中复用；输入 fingerprint 改变时，Runtime 必须按已定义规则使相关后缀失效。
- `Job` 是 Host 执行 Activity 的持久任务，`Attempt` 才是具体 Worker lease；
  Job 终态不能由 WakeupBus 或 Worker 内存决定。
- `Step` 不参与底层 replay 身份，可由脚本命名、trace 或产品 UI 投影生成。

#### 脚本式 Workflow 与上层编排格式

- 脚本式 Workflow 适合开发者表达复杂控制流、复用 TypeScript 函数和组合 Action，是 Runtime 的底层执行语义。
- Workflow IR/Graph 适合持久化、版本化、检查、可视化和由用户/知识管理者生成；它们转换成脚本式 Workflow 语义，而不是拥有独立的执行器。
- 脚本式 Workflow 不能绕过 Runtime；执行时必须产生可追踪的定义版本、Run、Activity journal、必要的 Job/Attempt、输入/输出引用和 DomainEvent。Step 是可选投影。
- Graph/IR 不能直接执行任意网络、文件或进程操作；转换后的副作用仍必须映射到已注册的 ActionDefinition 和 Capability。
- 不是所有脚本都需要或能够反向转换成 Graph；支持从 Graph/IR 到脚本语义的单向转换即可。
- `nb-workflow` 是规范脚本 Kernel，拥有 Activity journal、`path + seq + kind +
  fingerprint`、`wf.map`/`wf.all`、`wf.ask`/resume、受控非确定性、取消传播和
  Child Workflow 的脚本语义。它通过 Backend/Port 使用内存或持久实现，不依赖
  Cosmos 领域。
- Cosmos 提供 `nb-workflow` 的 Durable Backend/Host：把 Run/Journal 映射到现有
  Prisma Store，把需要执行的 Activity 映射到 ActionDefinition/Job，把领域写入
  映射到 Application Command。当前独立 Runtime Spike 必须经 Task 06 收敛后才能
  视为该目标架构的实现。
- Graph/IR/Comfy 只转换成 `nb-workflow` 脚本语义，不拥有第二个执行器。不是所有
  TypeScript Workflow 都必须能反向转换成 Graph。

#### Workflow 类型

Workflow 使用轻量 `kind + tags` 分类，不为每类 Workflow 复制一套 Runtime：

- `ingest`：把外部来源事实编排进入 Cosmos。
- `knowledge`：对 Entry 做规则、模型或 Agent 分析，生成 Story/Topic/关系 Proposal。
- `research`：查询 Cosmos 信息库并主动访问已配置的外部渠道。
- `maintenance`：重建索引、清理、对账和修复。
- `delivery`：生成、渲染和发送用户可见结果。
- `interaction`：处理用户/Agent 交互、等待输入和恢复。
- `custom`：用户或插件定义的其它流程。

分类只影响展示、默认优先级/预算和运维统计，不改变 Workflow 的执行语义。

### 4.4 自定义代码与插件

扩展包使用 manifest 声明：

- 唯一 ID、版本和兼容的 Cosmos SDK 版本；
- 提供的 Source、Source Operation、Trigger、Action 或 Board Block；
- 配置 schema 与 Secret 引用；
- 网络、文件、模型、库查询、库写入和外部投递能力声明；
- 幂等、超时、取消和恢复能力；
- 运行入口和资源预算。

`SourceOperation` 是未来由 Adapter 对外部来源提供的一项可调用操作，例如 `bilibili.dynamic`、`bilibili.recommendation` 或 `rss.poll`。它声明输入配置、输出的标准化 `NormalizedIngestItem`、稳定 external key、`originLocator`、`discoveryContext`、媒体状态、checkpoint 读写范围和错误语义；它不是 Workflow，也不直接写 Cosmos 数据库。

Phase 1B 当前实现使用较小的 `IngestConnector` 运行时边界：目标合同以版本化 `SourceDefinitionManifest.ref` 作为 SourceInstance 的持久身份；manifest 必须显式声明运行时 `connectorId`，Worker 再通过该 id 解析 Connector。迁移期保留旧 `Source.kind` 作为兼容投影，但新 Product API 不接受 kind，代码不得根据字符串隐式推导 ref。`SourceOperation` 是未来在一个 Provider 下区分多个采集操作的设计粒度，当前首批 manifest 使用稳定的 `fetch` operation。

Workflow 通过 `ActionDefinition` 调用 Source Operation。Adapter manifest 只注册能力和 schema，用户的 Connection、SourceInstance 和采集计划再把某个 operation 绑定到具体凭证、范围、Trigger、Workflow 版本和 StateStore 命名空间。

执行策略分两级：

1. 内置、受信任扩展可以在受控 Worker 中运行。
2. 用户或第三方代码默认在独立进程中运行，只通过 RPC SDK 访问能力。

第一版只实现用户明确安装的本地可信扩展，不建设细粒度权限 UI 或不可信代码沙箱。公开合同仍不得依赖进程内对象或直接数据库访问，以免后续无法隔离。

### 4.5 Agent 是可选 Extension/Action，不是 Core 或特殊旁路

`nb-workflow` Core 不直接依赖 Agent 或 `neuro-agent-harness`。可选 Agent
Extension 提供 `wf.agents.invoke()` 等脚本 API，底层仍记录为 journaled Activity
并调用版本化 `agent.invoke@1` ActionDefinition。Cosmos 的 Harness Adapter 在
Worker 中实现该 Action；Harness 文档和稳定合同完成前不接入。

`agent.invoke@1` 与其它 Action 使用相同的 Run、配置能力范围、超时、取消、产出
和重试合同。当前单用户阶段按最大产品权限运行，不建设审批 UI；
Capability/Service 边界主要用于可靠执行、数据隔离和未来扩展。Agent 可以：

- 查询 Entry、Story、Topic、Annotation 和 Saved View；
- 调用已注册并可用的外部搜索/抓取 Action；
- 创建 Annotation、关系建议和 Artifact Revision；
- 请求用户输入或补充信息；
- 发出后续 Workflow Event。

Agent 可以创建或维护 Topic、Workspace、Artifact、Source 和其它内部对象。当前不强制新外部 Source、数据范围扩大或外部发送经过审批；未来多人、远端或不可信扩展再增加独立权限策略，不能改变 Workflow/Service 合同。

Agent 不能：

- 改写 Observation；
- 绕过 Connector 或 Library Command 直接写表；
- 绕过已注册的 Adapter/Action、Capability、SecretRef 或 Application Command；
- 把自己的结论伪装成来源原文。

状态所有权固定为：

| 状态 | 所有者 |
| --- | --- |
| Workflow Run、Activity journal、Job、Attempt、lease | Cosmos Workflow Host |
| Agent Invocation、Session、Profile、Model Runtime | `neuro-agent-harness` |
| 知识管理者共享长期记忆 | `nb-memory` |
| Entry、Story、Artifact 等领域事实 | Cosmos Domain |

Harness 自身的恢复能力不能同时成为 Cosmos Job 的 durable truth。等待、取消、
usage、SessionRef、模型/Profile 版本快照和 unknown external result 的公共合同，
必须在 Harness Adapter Task 中明确后才能进入生产接线。

### 4.6 Connection、State 与采集计划

外部 Provider、Adapter、SourceInstance 和用户连接需要分开：

| 概念 | 责任 | 示例 |
| --- | --- | --- |
| `Provider` / Producer | 外部平台或数据提供者 | Bilibili、RSS、AI HOT |
| `Adapter` / Connector | 连接 Provider 的代码 | Bilibili Connector、RSS Connector |
| `ConnectionInstance` | 用户登录或授权后可复用的连接 | “我的 Bilibili 主账号” |
| `SourceInstance` | 用户配置的具体采集目标 | 动态、推荐流、某个 RSS |
| `Trigger` | 何时或因何启动 | 每 30 分钟、每 2 小时、内部事件 |
| `WorkflowBinding` | 该采集目标使用哪一版 Workflow | `bilibili.dynamic@1` |
| `CollectionPlan` | 用户可见的独立采集计划 | “主账号动态每 30 分钟” |

同一个 `ConnectionInstance` 可以被多个 `CollectionPlan` 引用。每个计划把 Source
Operation、Trigger、WorkflowBinding、checkpoint namespace、发现上下文、预算、
错误、重试和重叠策略组合为独立边界。重叠策略至少预留 `forbid`、`queue`、
`replace`、`allow` 和 `merge`；用户配置采集计划，不直接配置 Worker。

凭证和普通 Adapter 状态分离：

- `SecretStore` 由 Cosmos 统一提供；Adapter 负责登录协议和凭证格式，但不自行决定凭证的持久化位置。
- `ConnectionInstance` 只保存连接状态、授权范围和 `SecretRef`；Cookie、Token、Refresh Token 不进入普通配置、Job payload、DomainEvent 或日志。
- `ConnectorStateStore` 保存 cursor、ETag、分页 token、速率状态等非秘密状态。Adapter 可以定义状态 schema，Cosmos 负责命名空间、版本、备份、并发和恢复。
- OpenCLI/Browser Bridge 可以作为外部登录态管理例外，Cosmos 只保存 profile 引用；长期仍需映射到统一 Connection 合同。


### 4.7 产品配置入口与可用性 E2E

第一条可用产品 E2E 不等于预配置 Ingest 管线跑通。产品验收必须从空数据根目录开始：用户在 Web 选择 `rss` SourceDefinition/Connector，按其配置 schema 填写实际 RSS URL，完成服务端校验、测试未保存配置、保存为停用 Source、单独启用和调度配置；Worker 只读取已启用配置执行抓取，Web 再展示内容与来源健康。`fixture-rss`、fixture XML、本地受控 HTTP 源、fake Blob 和直接调用 Worker Admin 只属于集成/管线测试。

本产品入口的用户可观察能力依次为：

1. 选择可用 Connector/SourceDefinition，并读取版本化配置 schema；首版只开放 `rss`，不把 `fixture-rss` 暴露为产品来源。
2. 按 schema 创建、编辑、服务端校验、测试、保存、停用/启用 Source；本切片以一个 SourceInstance 保存版本化 `sourceDefinitionRef`、`operationId`、已校验配置、revision 和可选调度字段，不新增独立 `CollectionPlan` 持久对象或第二套 Draft 状态机。`CollectionPlan` 仍是后续扩展边界。
3. 默认定时抓取 30 分钟、测试立即执行、用户可修改或关闭定时、已排队 Run 使用创建时配置快照，是本次选择的实现建议；具体调度字段、时区/间隔校验和修改生效时机仍需设计验证。

API 继续是 manifest/schema、Command、Query、Run 控制和 SSE 的控制面；Connector executable 与外部网络访问留在 Worker。SourceDefinitionRef 到 Connector 的映射必须来自不可变 manifest，不得由 API 或 Worker 隐式猜测。SourceInstance 的 revision 是独立的单调并发令牌；`updatedAt` 只表示时间，不能充当 revision。上述身份与并发边界已冻结，但不冻结 CollectionPlan、未保存 Probe、媒体下载或未认证作用域合同。
未认证单用户作用域和未来认证替换点是待设计建议，不是当前已冻结的持久化合同。
