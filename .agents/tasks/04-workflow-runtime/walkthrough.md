# Workflow Runtime Spike Walkthrough

> 本文件是 `docs/tasks/04-workflow-runtime/README.md` 的 append-only 实施记录。
>
> 每一轮只记录已经执行的动作、验证证据、偏差和下一步；未验证内容不得写成完成。

## 历史分册索引

更早的 Round 记录已按大小切分归档到 `walkthrough/` 子目录(每册 ≤30 KB,封口后只读,勘误记入本文件勘误节或同级 `ERRATA.md`);
当前状态与有效决定以主文档保留记录和 Task README 为准。每册头部带 front matter(parent/range/sealed_at/tags/tokens_est)。

| 分册 | 覆盖范围 | 大小 | 内容 |
|---|---|---|---|
| [rounds-0000-0010.md](walkthrough/rounds-0000-0010.md) | Round 0–10 | 22.7 KB | 文档基线与分支建立…per-Consumer Group |
| [rounds-0011-0091.md](walkthrough/rounds-0011-0091.md) | Round 11–14、Round 89–91 | 20.7 KB | bounded retry 与 ex…持久 Consumer Regist |
| [rounds-0015-0021.md](walkthrough/rounds-0015-0021.md) | Round 15–21 | 21.0 KB | Consumer Binding r…runtime-level stal |
| [rounds-0022-0028.md](walkthrough/rounds-0022-0028.md) | Round 22–28 | 21.5 KB | 可停止的 Workflow Work…统一 terminal Applic |
| [rounds-0029-0036.md](walkthrough/rounds-0029-0036.md) | Round 29–36 | 20.5 KB | child cancellation…父子 Workflow 的级联取消 |
| [rounds-0037-0045.md](walkthrough/rounds-0037-0045.md) | Round 37–45 | 21.6 KB | Action effect rece…Worker bootstrap 的 |
| [rounds-0046-0058.md](walkthrough/rounds-0046-0058.md) | Round 46–58 | 22.7 KB | Worker bootstrap 的…Prisma Outbox abor |
| [rounds-0059-0065.md](walkthrough/rounds-0059-0065.md) | Round 59–65 | 21.2 KB | Ingest Observation…真实 Node Worker dis |
| [rounds-0066-0069.md](walkthrough/rounds-0066-0069.md) | Round 66–69 | 21.9 KB | Workflow enqueue a…Workflow Run defin |
| [rounds-0070-0074.md](walkthrough/rounds-0070-0074.md) | Round 70–74 | 22.4 KB | 持久 catalog 接入 Runt…Application Comman |
| [rounds-0075-0079.md](walkthrough/rounds-0075-0079.md) | Round 75–79 | 21.6 KB | Transaction-aware …active Worker capa |
| [rounds-0080-0085.md](walkthrough/rounds-0080-0085.md) | Round 80–85 | 20.1 KB | 多 Worker admission…多 Worker availabil |
| [rounds-0086-0093.md](walkthrough/rounds-0086-0093.md) | Round 86–88、Round 92–93 | 19.9 KB | 版本化 Worker capabil…registration obser |
| [rounds-0094-0098.md](walkthrough/rounds-0094-0098.md) | Round 94–98 | 20.4 KB | checkedAt Registry…最新主线收敛基线与 Ingest p |
| [rounds-0099-0104.md](walkthrough/rounds-0099-0104.md) | Round 99–104 | 22.0 KB | 固定 Ingest Workflow…Migration squash、最 |
| [rounds-0105-0106.md](walkthrough/rounds-0105-0106.md) | Round 105–106 | 15.3 KB | Project quality au…`nb-workflow` Kern |

## Round 107 — Product Service、Worker Admin、Worker Gateway 与 DTO 草案

日期：2026-08-11

### 目标

用户确认：

1. 远程 Worker v1 使用 HTTPS request/response + bounded long-poll；
2. `ActionDefinition.executionPlacement` 使用
   `host`、`trusted_worker`、`remote_worker`；
3. 下一步深入检查原始需求和系统能力，单独形成完整 API/DTO 草案；
4. 草案允许后续实现调整；
5. 草案完成后派发多个子代理从不同链路审查和查漏补缺。

本 Round 只修改文档，不修改代码、Prisma schema、migration 或测试。目标不是把
所有 Planned API 一次实现，而是让后续 schema、Nest Controller、Worker Admin、
Gateway fake 和 conformance 有一套可审查输入。

### 工作区基线

```text
worktree:
C:\Users\notnotype\Documents\CodeRepository\GithubProjects\cosmos\
  .worktree\t04-ingest-workflow-convergence

branch: feat/t04-ingest-workflow-convergence
HEAD: dc78f0519e0320afbb27191b0d573be6cd62aedd
merge-base origin/master: 45ae918bfcfcf5dfaf90480183608007a48ee170
staged files: 0
```

开始时 worktree 已有前序 Spike 的 87 个 dirty 文件，涉及代码、migration squash、
文档和 Playwright 文件。本 Round 没有清理、覆盖或暂存这些用户/前序改动；只编辑
API 及其同步文档。

### 原始需求与能力调查

重新对照：

- `docs/requirements/0001-original-requirements.md`；
- `docs/requirements/0002-product-requirements.md`；
- 两份总体/信息模型架构；
- ADR-0001/0002；
- Task 04/05/06；
- 当前 contracts、Transport、Nest Controller、Worker Runtime、Prisma schema、
  Docker/Compose 和环境配置。

从用户场景反推的公共能力不只包括当前 Source/Feed 路由，而是：

```text
System / Capability / Protocol
Catalog / Plugin / SourceDefinition / ActionDefinition / WorkflowDefinition
Connection / Source / CollectionPlan / Trigger
WorkflowRun / Activity / Step / Job / Attempt / Receipt / Signal
Observation / Entry / Revision / Asset / Blob
Story / Topic / Entity / Relation / Proposal
KnowledgeSignal / ResearchRequest
Feed / Related / Interaction / ReadState / Spotlight
Workspace / Artifact / Agent Conversation
Board
Publication / Subscription / Delivery
Storage / Backup / Restore / Export / Delete / Integrity
```

同时确认三个 API 面：

```text
Product Service API
  -> Web / CLI / Desktop / Knowledge Manager tools

Worker Admin API
  -> health / readiness / status / capability / metrics / drain

Worker Gateway API
  -> Session / long-poll claim / Attempt heartbeat / Receipt / Result
```

Product Service 与 Gateway 初期可由同一 NestJS 宿主承载，但模块、路径和版本独立；
Worker Admin 使用单独内部端口。Admin 不提供同步 Job execute，Gateway 不持有第二
份 Job terminal。

### v0.1 独立草案

新增：

```text
docs/api/README.md
docs/api/0001-common-contracts.md
docs/api/0002-product-service-api.md
docs/api/0003-product-dtos.md
docs/api/0004-worker-admin-api.md
docs/api/0005-worker-gateway-api.md
docs/api/0006-scenarios-and-conformance.md
docs/api/0007-review-findings.md
```

v0.1 约 3,800 行，覆盖 Header、Page、ServiceError、Idempotency、ETag、SSE、
ValueRef、全部 Product 资源、Worker Admin、Gateway Session/claim/lease/
Receipt/Value/Secret/result/replacement/drain，以及产品、故障和 Transport 场景。

同步新增：

- ADR-0003：固定三个 API 面、long-poll、Direct/Gateway 混合和 placement；
- PRD v0.16：增加 Product/Admin/Gateway、remote Worker 和 placement 需求；
- 总体架构 v0.20；
- Task 06 Step 5 的 API/Host convergence 边界；
- 原始需求 append-only 追加本轮用户原话；
- `CONTEXT.md`、文档索引、项目状态和 README 入口。

### 五个隔离只读审查代理

先前一次前台尝试因单次命令 60 秒上限未产出，已清理且不计入结果。随后使用五个
隐藏、ephemeral、read-only `codex exec`，分别读取限定文件并写独立结果：

| 范围 | 结果 | 状态 |
| --- | --- | --- |
| 产品需求覆盖 | `product.final.md` | 成功 |
| Workflow/恢复 | `runtime.final.md` | 成功 |
| Gateway/分布式 | `gateway.final.md` | 成功 |
| 运维/安全/隐私 | `operations.final.md` | 成功 |
| DTO/Zod/兼容 | `dto.final.md` | 成功 |

实际成功数：5/5。代理均未修改仓库文件。结果文件和 SHA-256 记录在
[`docs/api/0007-review-findings.md`](../../../docs/api/0007-review-findings.md)。

### 主审与 v0.2 修订

主代理没有直接接受代理结论，而是逐条回查 PRD、架构和代码。主要修订：

#### 1. 实现成熟度与产品 Phase 分离

`Current/Convergence/Planned/Reserved` 是实现成熟度，不是产品 Phase。Phase 1
最小闭环已完成，但完整 Phase 1 仍缺 Source 删除、默认定时 CollectionPlan、
Source health/checkpoint、完整 Run/Step、真实 RSS/Docker/长时间恢复。

这些项目标为 `Planned · Phase 1 remainder`，不因此全部扩进 Task 06。

#### 2. Product DTO 补齐

- 最小 Story Current 与完整 Story/Topic Planned 分开；
- Run 增加不可变 Trigger reason/input/fingerprint/definition/mapping/evidence；
- CollectionPlan 增加 discovery context；
- KnowledgeSignal 使用 append-only disposition，不增加可变 status；
- ResearchRequest 增加 trigger input/depth，运行细节通过 runId 查询 Runtime；
- 协作修改统一 `MutationAuditSnapshot`；
- Story merge/split 增加用户状态 migration preview/apply/revert；
- Ranking/Spotlight 增加 policy/version/signal/adjustment/threshold；
- Workspace 增加 maintenance binding、current Step、recent result、input/budget；
- Artifact 使用严格 sandbox render profile，不再用 `executable: boolean`；
- Subscription 增加 schedule/timezone/misfire/channel capability；
- Detail 的集合改为有界 preview，完整历史走分页子资源；
- 删除会退化为纯 `unknown` 的 `ValueEnvelope | unknown`。
- 主审补充 Search/Feed/Run/List Query DTO，以及 Connection/Plan/Trigger、
  Story/Topic、Workspace/Board、Publication/Delivery 和数据运维 mutation Command
  基线，避免只靠自然语言生成 Zod/OpenAPI。

#### 3. Gateway owner 与恢复收口

v0.1 存在真实双 owner 矛盾：旧 Session 可继续 Attempt，新 Session 又可用同 token
resume。v0.2 固定：

```text
Attempt owner
= (attemptId, ownerSessionId, ownerEpoch, leaseToken, leaseExpiresAt)
```

- replacement 只停止旧 Session 新 claim；
- resume 通过 TaskStore CAS 转移 owner、递增 epoch、轮换 token；
- 旧 owner 立即失去 heartbeat/Receipt/Result 权限；
- 没有 resume 时，旧 Session 仍只能完成自己的原 owner tuple。

#### 4. external late evidence

lease 丢失后不能再使用 lease Receipt API。external claim 获得短期、
Attempt-scoped late-evidence capability；它只能追加 `external_effect_unknown`
并触发 reconcile，不能续租、提交 Result、恢复 Secret、写 checkpoint/Event 或
领域状态。

#### 5. 容量、backpressure 与 Receipt CAS

- TaskStore 原子保留 Session/lane slot；Worker `available` 只是提示；
- long-poll 有每 Session in-flight 上限；
- claim 使用 Idempotency-Key 保存 batch replay，响应丢失不再领取第二批；
- Receipt 使用 revision/baseRevision、submission fingerprint 和 server receivedAt；
- heartbeat expiry 被 Run/Action/drain deadline 截断；
- draining Session 继续 heartbeat，但不能 claim。

#### 6. Value、Secret 和身份

- JSON hash 使用 RFC 8785 canonical UTF-8；
- text/blob 使用实际原始字节；
- body limit 在 JSON 解析前执行；
- upload 增加 finalize/abort/hash/size；
- Secret material 不使用可持久化 ValueEnvelope；
- Secret resolution 保持 Reserved；
- Gateway bootstrap 固定 provider-neutral identity claims，具体 mTLS/OIDC/token
  provider 后置。

#### 7. 部署和实现 gate

审查确认当前实现有以下真实风险：

- Product API 无认证并可绑定 `0.0.0.0`，Compose 发布 4310；
- CORS 不能作为认证；
- fixture `fixturePath` 可读取绝对路径；
- Source/Job/Asset public projection 尚未证明移除内部 config/result/storageKey；
- 还没有 `/healthz`/`readyz` 分离、Worker Admin 或真实 Gateway。

v0.2 明确当前未认证模式只适用于本机/受信网络；公网、远程 Product API、Admin、
Gateway、Secret 和文件 transfer 都需要独立 release gate。本 Round 不扩张到实现
完整认证平台。

### 调整或未采纳的建议

- 不把全部 Phase 1 项标成 Task 06 `Convergence`；
- 不把 KnowledgeSignal 改成可变 status；
- 不因 DTO 有 Attempt 就提前强制独立 Prisma Attempt 表；先要求独立语义、
  projection 和 conformance，无法证明再迁移；
- 不在 ResearchRequest 复制第二份 Activity/Job 状态；
- 不把当前代码单 Entry Story projection 误报成 v0.1 草案错误；草案已有多成员
  Membership，当前代码属于实现迁移；
- 不在本轮实现完整公网认证、Secret 平台或不可信插件沙箱。

### 同步文件

v0.2 修订同步到：

- `docs/api/` 全部草案与审查记录；
- ADR-0003；
- 总体架构 v0.21；
- Task 06 fake Gateway/conformance gate；
- `PROJECT-STATUS.md`；
- 根 `README.md`。

PRD 已有 Trigger/Research/Story/推荐/Artifact/运行恢复需求，不为每个协议字段再
制造一批重复技术型 ID。原始需求文件只保留此前 append-only 追加。

### 当前未实现

- v0.2 Zod schema 和 package 拆分；
- Product Controller/Application Port/HTTP Client 迁移；
- canonical route、Header、Page、ETag、ServiceError 和 SSE wire 收敛；
- Worker Admin HTTP Server；
- Gateway fake、owner CAS、late evidence、Receipt CAS、slot reservation、
  backpressure 和 claim replay；
- bootstrap provider、Secret Broker、PostgreSQL/S3 多主机；
- Connection/CollectionPlan/Knowledge/Research/Workspace/Publication 产品实现；
- 公网认证、Docker 生产安全模板和完整数据生命周期。

### 验证

已运行：

- `git diff --check`：通过；
- 全仓 48 个 Markdown：相对链接错误 0、未闭合围栏 0、EOF 缺失 0、尾随空白
  0、conflict marker 0；
- PRD 定义型需求 ID：164 个、重复 0；
- 原始需求相对 HEAD：新增 22 行、删除 0 行；当前 SHA-1
  `74f785a572ecedf150e2ad12ecf0f758f7278671`，HEAD SHA-1
  `c94f7a89f97640dbde5a9bffeee948d6a04a1aec`；
- 8 份 API 文档共 5,158 行，37 个 TypeScript 围栏合并后以 strict/noEmit 做
  syntax + semantic 检查：0 diagnostics；
- Product DTO TypeScript：敏感 lease/session/storage/path 字段 0，
  `ValueEnvelope | unknown` 退化联合 0，mutation Command 无 owner `unknown` 0；
- Product API 自动提取 185 个 method/path key，文件内重复 0；Worker Admin
  9 个，重复 0；
- 旧 `Flow` 只保留在总体架构 3 处明确迁移/历史说明；
- staged files 0，五个审查进程均已退出；
- branch/HEAD/merge-base 仍分别为
  `feat/t04-ingest-workflow-convergence`、
  `dc78f0519e0320afbb27191b0d573be6cd62aedd`、
  `45ae918bfcfcf5dfaf90480183608007a48ee170`。

本轮没有运行代码测试、typecheck、build、Node production、migration、browser、
Docker、真实来源、长时间恢复、Gateway 多主机、真实认证、Secret Broker 或
Harness/Agent。既有 Spike 证据仍是历史基线，不能替代 API v0.2 后续实现的
schema/Transport/conformance 验收。

## Round 108：Worker Registry 主线/归档边界纠偏

日期：2026-09-01

目标：核对 `PROJECT-STATUS.md`、ADR-0001、总体架构和 Task 04 当前摘要中的 Worker Registry 描述，避免把归档 WIP 当作当前 `master` 能力。

事实核对：

- 当前 `master` 核对基线为 `9c6f513`；主线没有 `WorkflowWorkerRegistration`、对应 Prisma migration、`GET /api/v1/workflow-workers`、capability evaluator 或独立 capability projection 源文件。
- 当前 `packages/worker-admin` 只提供 Worker 进程内的管理/观测服务；`WorkerStatusSnapshot.registrationGeneration` 固定为 `null`，当前 Prisma schema 只有 `WorkerHeartbeat`，没有持久 Worker Registry。
- 完整注册表、TTL/heartbeat、能力投影和查询实现存在于归档标签 `archive/t04-workflow-runtime-spike-wip-20260818` 的 `b8a1701`；`b8a1701` 不在当前 `master` 祖先链中。
- 当前实现规格 [`docs/spec/runtime/0003-worker-admin.md`](../../../docs/spec/runtime/0003-worker-admin.md) 已准确描述进程内 Worker Admin；归档 Round 78–97 保留为历史 WIP，不作为当前实现证据。

实际修改：

- 修正 `PROJECT-STATUS.md`、`CONTEXT.md`、总体架构、ADR-0001、Task 04 README 和 Product API 草案中的当前/目标边界；保留归档 walkthrough 的历史原文，并明确其来源与状态。
- 本轮不恢复归档代码，不修改运行时、数据库、migration、依赖或 Product API 实现。

验证命令与结果：

- `git show master:packages/storage-prisma/src/workflow-worker-registry.ts`：当前主线不存在该文件。
- `git show b8a1701:packages/storage-prisma/src/workflow-worker-registry.ts`：归档提交包含该文件；同一归档提交也包含 registration migration 和 Runtime registration 测试。
- `git merge-base --is-ancestor b8a1701 master`：不成立；归档实现未进入当前主线。
- 当前工作区代码与文档搜索确认：注册相关命中只剩进程内 Worker Admin 类型/字段及文档中的目标或历史说明。

偏差：发现活跃状态文档曾把归档 WIP 的验证结果写成当前主线证据，已在本轮纠正。

leader 判定：当前主线状态已与代码一致；若未来恢复 Worker Registry，必须在当前基线上重新实现持久模型、生命周期、API 和行为验收，不能直接把归档提交合并当作完成证明。

## Round 109：用户真相保护 v1（P2-1 / §12 Phase 2 第 4 条 / LIB-003 / ADR-0028）

日期：2026-09-24

**复用本 Task 的理由**：本切片要冻结的是「自动写入方在人工结果面前如何降级」，这正是 Phase 3 Knowledge Workflow 的入口硬前置，落在本 Task 的 Knowledge/Research 边界职责内。候选 Task 10（Story 域）、12（Entity/关系）、13（用户组织）各自只覆盖一个真相面，任一单点 Task 都会把合同写窄。

**目标**：把 P2-1 从「无法判定」变成有判据、有数据、有回归测试。

**复核结论（本轮第一个发现）**：`Phase-2-UNDO.md` 的「Phase 2 里没有任何自动重分析写入路径，所以只是结构上成立」**不成立**。Knowledge 路径确实不存在，但 ingest 的 Entry→Story 投影（`helpers-4.ts`）已经是一条自动写入路径：来源发布内容修订时它无条件改写 `Story.kind`，用 Entry 的标题/摘要新建 StoryRevision 顶掉 `currentRevisionId`，新 Revision 的时间范围与关键事实落 `NULL`。它不检查写入者身份，全仓也没有对应测试。九条 ADR 的 Revisit Gate 都指向同一个未定义合同。

**范围**：`StoryRevision.producer` + 回填 + 投影冻结与跳过事件 + DTO/Web 可见性 + 回归测试 + 稳定文档。
**不在范围**：Knowledge Workflow 与任何自动重分析；候选 Revision 模型与接受/拒绝界面（ORG-019）；字段级保护掩码；关系表的人工行守卫（按裁定只进合同，v1 不实现，因为没有自动写入方会碰那些行）。

**合同（ADR-0028）**：判据是写入者身份（服务端按写入方赋值，调用方不可传；`actorJson` 今天区分不了人工与自动，因为 Web 编辑根本不传它）；v1 保护粒度是整条当前 Revision（含 `Story.kind`）；自动结果**按写入方分两类降级**——确定性投影跳过并记事件，派生分析只能产生候选 Revision；`producer = "human"` 的关系行不可被自动方删除或改写。

**RED**：新增 `packages/storage-prisma/src/story-human-protection.test.ts`，未改实现前 **2 例失败**（人工编辑后被来源重发布、人工 merge 后成员被重发布，断言当前 Revision 未变），第 3 例（未编辑的 Story 仍跟随来源）通过——证明覆盖行为真实存在，且正常路径可作反向约束。

**GREEN**：migration `20260924100000_story_revision_producer`（加列 + 按 `story.revision_created.v1` 事件回填 `human`；该事件只由 `updateStoryRevision` 与 `splitStory` 的后继发出，投影不发）；`updateStoryRevision`/`splitStory` 写 `human`，投影写 `system` 且只在本该写入时记 `story.representation_projection_skipped.v1`；`StoryDetail.story.producer` 进公开读合同；Story 面板显示「人工已修改 · 自动更新已暂停」。

**实际修改**：26 个文件修改 + 4 个新增（`docs/adr/0028-user-truth-protection-v1.md`、migration 目录、`story-human-protection.test.ts`、`story-revision-producer-migration.test.ts`）。核心在 `helpers-4.ts`（投影冻结）、`stories.ts`（两处 `producer`）、`schema.prisma` + migration、`contracts/src/story.ts`、`story-panel/representation.tsx` 与 `story-panel.tsx`，其余是四处 spec、ERRATA、架构勘误节、ADR 索引、testing README、PROJECT-STATUS 与受影响夹具。

**验证（全部实际运行）**：

- `bun run typecheck` → 0；
- `bun run test` → **126 文件 / 731 用例全绿**（含新增 5 例；新增迁移回填测试把「有匹配事件才算人工」钉在数据上，含一条同 Story 不同 revision 的诱饵事件）；
- `bun run test:browser:component-lab` → **20 passed**（新增 `human-protected` 场景断言，并断言未受保护场景不出现标记）；
- `bun run test:browser` → **33 passed**（`story-representation.spec.ts` 新增「保存表示前无标记 → 保存后出现」）；
- `bun run docs:check` → 766 文件 0 失败；`python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` → PASS（含 warning）；`git diff --check` → 干净；`bun run build` → 0。

**偏差与代价（如实）**：

- 整条 Revision 级保护的代价是「人工改过标题后该 Story 的自动投影停更」；这是「人工优先」的定义，已用 Web 标记说明而不是静默行为变化。
- 回填依赖 DomainEvent 未被裁剪：事件缺失的库对应行回填为 `system`，即历史人工编辑要重新编辑一次才受保护（反向误判会让所有既有 Story 停止跟随来源，代价更大）。
- 首次并发跑组件实验室与产品浏览器两套 Playwright 时，`entry-relations` 场景报 1 例失败；单独重跑 20/20 通过，确认是两套运行争用同一 Web 服务，不是本切片缺陷。
- `PROJECT-STATUS.md` 已逼近文档体积警戒线（约 9.0k token）：为不触发门禁，本轮那条记录压到了最短。**下次改动该文件前应先按治理规则把更早的历史条目切进 `PROJECT-STATUS/history-*.md`。**
- 本文件追加本轮后为 22.5 KB（健康区内，门禁未拦），已越过「接近 20 KB 即滚动归档」的触发线：**下一次追加前应先把 Round 107 整段移入 `walkthrough/rounds-0107.md` 并在原位留链接**（移动时注意所有相对链接要多一级 `../`）。

**未运行**：Node 进程 E2E（`bun run test:e2e`）、真实来源验收（`test:real:*`）、Docker、发布部署。本切片不触碰连接器、Worker 运行路径与外部来源，故未跑真实来源；Node 进程 E2E 未跑属本次边界，合并前可按需补。

**合并（2026-09-24）**：分支 `feat/t04-user-truth-protection` 已 `--no-ff` 合入 `master`（合并提交 `f66ee27`）并推送 `origin`；合并后按仓库教训先 `bun run db:generate` 再重跑门禁全绿——typecheck 0、单元 126 文件／731 用例、`docs:check` 776 文件 0 失败、size 门禁 PASS、`git diff --check` 干净。worktree 与分支已清理：`git worktree remove` 注销成功但目录残留，原因是浏览器验收时从该 worktree 启动的 opencli daemon（`node_modules/@jackwener/opencli/.../daemon.js`）仍持有句柄，结束该进程后目录删除成功。**未做**：`20260924100000_story_revision_producer` 未对真实数据根执行（迁移属数据生命周期变更，需单独授权）；推送只到 `origin`，未推 `upstream`。

**下一步**：ORG-019 落地时按 ADR-0028 的 Revisit Gate 把判据细化为字段掩码，并在第一个派生分析写入方落地时实现候选 Revision 降级。
