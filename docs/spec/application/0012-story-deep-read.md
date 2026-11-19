# Story 深入阅读与 Artifact v1

> 当前实现规格。产品意图、范围与非目标见 [Proposal](../../proposals/story-deep-read-artifact-v1.md)；长期边界见 [ADR-0034](../../adr/0034-artifact-revision-v1.md)；公共 HTTP/DTO 目标见 [API Draft 0010](../../api/0010-story-deep-read.md)。本文只写已实现、可观察的行为；未验证项单列在文末。

## 1. 组件定位

Story 深入阅读让用户在 Story 阅读页手动触发一次 Agent 读取，Agent 只读取该 Story 已录入的来源内容，生成一份带精确来源引用的结构化报告；每次成功发布形成不可变 ArtifactRevision，失败或取消不覆盖上一成功版本。

本组件拥有从“准备冻结输入 → Workflow 调用 Agent → 宿主发布 Revision → 产品读取”的应用层合同。它不拥有公共 DTO（contracts）、三表持久化（storage）、HTTP 路由（API）、Web 呈现或 Workflow/Job durable 执行（runtime）；这些边界由各自 canonical owner 定义，本组件只组合它们。

调用方是 Product API 与 Worker 宿主：API 负责入队与读取，Worker 执行 `cosmos.story-deep-read@1` 并调用 `artifact.publish@1`；Web 只通过 Product API/Transport 访问，不直接触碰数据库、Blob 或模型。

## 2. 概念与定义

- **深入阅读报告**：一个 Story 的 `kind=story-deep-read` Artifact；身份稳定，内容由不可变 Revision 表达。当前版本是已发布的最大 revision，不维护 `currentRevisionId` 指针。
- **Run 快照**：入队时冻结的 `{kind, storyId, resolvedModelId, input, messages, budget}`。正文只出现在 `messages`；`input` 是公共投影，不含来源正文。
- **InputProjection**：`{storyRevisionId, sources, omittedSourceCount}`；每个 source 记录 `entryId`、`entryRevisionId`、`representationVersion`、`blockIds`、`includedCharacterCount`、`truncated/omitted/reason`。`omitted=true` 且来源/表示不可用时版本为 `null`，该来源与块永不可被 evidence 引用。
- **EvidenceRef**：`{entryId, entryRevisionId, representationVersion, blockId?}`；只允许实际纳入的顶层文本块。
- **SourceStatus**：读取时计算 `current/superseded/unavailable`；只看 `omitted=false` 的实际纳入来源，不回写历史。
- **Generation**：一次 WorkflowRun 的产品投影；成功以持久 Revision 为准。

## 3. 外部行为

1. **入队**：`POST /api/v1/stories/:storyId/deep-reads` 带 `Idempotency-Key`，body 可选 `{modelId}`。
   - 同键且同请求 hash：直接返回原 Run（终态也返回），不准备、不重新冻结、不重复计费。
   - 同键但 Story/hash 不一致：409。
   - 同 Story 存在活动 Run（`queued/running/waiting`）而键不同：409“该 Story 已有进行中的深入阅读”，不准备模型/来源、不新建 Run。
   - 没有活动 Run：解析模型与来源，冻结快照，原子创建 Run/Artifact/账本；202 返回 Generation。
2. **生成读取**：`GET /stories/:storyId/deep-reads/generations/:runId` 返回 200 Generation；Run 必须属于该 Story 与 deep-read 定义。Run 失败仍返回 200 `failed` + 安全 `errorCode`，不伪装 HTTP 失败；已发布 Revision 优先于 Workflow 完成标记。
3. **产物读取**：`GET /stories/:storyId/deep-reads` 返回 `{artifact:null}`（Story 存在但从未生成）或 ArtifactSnapshot：元数据、活动 generation（如有）、最近 50 条 revision 摘要、current 完整版。Story 不存在是 404。
4. **单版本读取**：`GET /stories/:storyId/deep-reads/revisions/:revision` 返回该 Story 的完整已发布版本；不存在/不匹配 404。
5. **生成过程**：Workflow `cosmos.story-deep-read@1` 先调用 `agent.invoke@2`（工具为空、输出上限 6000、超时来自 `storyAgentTimeoutSeconds`），只接受 `finishReason=stop`、无 toolCalls、严格 JSON 且 `normalizeReportInput` 成功的输出；随后调用 `artifact.publish@1` 持久发布。任何解析/结构/长度/发布失败都不产生半成品。
6. **Web**：Story 阅读页左栏关键事实后显示入口；生成中每 1 秒轮询、sessionStorage 同键恢复；409 读活动 generation；成功显示报告/证据/费用/模型/版本；失败保留旧版并用新键重试；证据抽屉精确读取指定 revision/representation 并定位 block。

## 4. 输入

- `Idempotency-Key`：trim 后非空、≤200；缺失/超限 400。
- `modelId`：可选，trim 后非空、≤200；省略时解析系统默认模型。显式模型必须存在且可用，否则 400 `invalid_configuration`。
- Story 必须存在且不是历史壳（`StoryReplacement` 存在即拒绝新生成）；历史壳已有报告仍可读、旧键仍可恢复原 Run。
- 来源：Story 当前成员（`detail.entries`，不重复追加 `detail.entry`）；按顺序最多 8 个、单来源 ≤12k 字符、总计 ≤60k；只整块纳入，首块超剩余预算则整源省略，单源超限按块边界截断并标 `truncated`；无 revision/无表示/读取不可用即省略并记录；0 个可用来源或 0 字失败。
- 快照：`{kind:"story-deep-read", storyId, resolvedModelId, input, messages, budget}`；`messages` 只存一份正文；`budget={maxDurationMs: timeout*1000, maxToolCalls:0, maxOutputTokens:6000}`；`inputProjectionSchema` 校验 refs/上限。
- 请求 hash：`sha256(canonicalJson({storyId, modelId: 原始请求 modelId 或 null}))`；不含解析后的默认模型、来源正文或时间。
- 幂等：账本 `DeepReadRequest(idempotencyKey 唯一, requestHash, storyId, workflowRunId)`；同键重放返回原 Run；别名不写入。

## 5. 输出

- Generation：`runId/storyId/status/modelId/provider/model/createdAt/publishedRevision/errorCode/cost?`；不包含 sections 或来源正文。
- ArtifactRead：`{artifact:null}` 或 ArtifactSnapshot（`id/storyId/kind/generation/revisions/current`）；revisions 最多 50、revision 降序。
- RevisionDetail：摘要 + `sections` + `input`；section 为 `{id, heading, kind: fact|opinion, blocks, evidence}`；blocks 仅 paragraph/list/quote/code，经 `ContentBlockReader` 安全渲染；`input` 只含 refs/统计，不含正文。
- 费用/用量：成功发布时来自当次调用；缺失与 0 分开；失败调用费用不可见（已登记限制）。

## 6. 状态与持久化

三张表：

- `Artifact`：`(storyId, kind)` 唯一；`activeRunId/activeStartedAt` 是活动槽；身份可在首次发布前存在；Story 关系 Restrict。
- `ArtifactRevision`：`(artifactId, revision)` 唯一；`workflowRunId` 唯一；保存 headline/sectionsJson/inputJson/contentHash/producer/producerVersion/provider/model/usageJson/costJson/createdAt；不可原地修改。
- `DeepReadRequest`：`idempotencyKey` 唯一；只记录真正创建 Run 的键；不存别名。

入队在一个存储事务内完成：查账本（同键 hash）→ 查全局 WorkflowRun 键 → 校验 Story/shell → get-or-create Artifact → 读活动槽（活动→409；终态/缺失 CAS 清槽）→ `createWorkflowEnvelopeInTransaction` 建 Run/queued 事件 → CAS 占槽 → 写账本。任一步失败整体回滚；事务外最多 3 次锁/事务/CAS 竞争重试（50/150ms），耗尽返回可重试 `dependency_unavailable`；P2002 在事务外重读赢家，只有 Artifact `(storyId,kind)` 的 P2002 可重试，其它 P2002 永久冲突。

发布事务：先按 `workflowRunId` 查既有 Revision（同内容幂等返回，异内容 409）；否则校验 host lease fence、Artifact/原 Story 归属、`activeRunId === runId`、结构与 allowlist、200 KiB 上限；分配 `max(revision)+1`，写 Revision、清槽、写 DomainEvent，同一事务。生成中 Story 被 merge 成历史壳仍发布到原 Story。

读取：Artifact 不存在且 Story 存在→null；Story 不存在→not_found；current=最大 revision；坏 JSON 受控 `malformed_payload`；sourceStatus 读取时计算，不回写。

## 7. 状态转换

- Run：`queued → running → completed|failed|cancelled`；`waiting` 视为活动；终态 Run 不再算活动 generation，槽由下一次入队 CAS 清除（不按超时盲释放）。
- 发布：同一 Run 只产生一个 Revision；成功发布后清槽；同 Run 重放返回既有 Revision；旧 owner/槽不匹配拒绝。
- 失败/取消：不产生 Revision，不覆盖旧版；同键重放仍返回原失败 Run，新生成必须新键。
- 历史：Revision 只追加；merge/split 不迁移 Artifact；Story 删除能力当前不存在，外键 Restrict。

## 8. 副作用

- 数据库：三表写入与 DomainEvent 在同一事务；不写 StoryRevision/Observation/来源正文。
- 外部网络：只有 Worker 通过已配置 Provider 调用模型；API/Web 不直接调用模型；无新增联网检索/抓取工具。
- Blob/Artifact Root：本期不写；正文存 SQLite 文本/JSON（≤200 KiB）。
- 日志：不记录来源正文、Secret、lease token、原始服务商响应；请求日志只记录路由/状态/耗时。

## 9. 错误与降级

- 公共错误 envelope（deep-read 路由局部）：`{code, message, retryable}`；message 固定安全文案。
- 400：非法 body/header/path、历史壳新生成、无可用模型/来源、`validation_failed`/`invalid_configuration`。
- 404：Story/版本不存在，或 Run/Version 与路径 Story 不匹配。
- 409：同键异 hash、跨 kind 同键、活动期不同键、不可归并冲突。
- 503：仅可重试的锁/事务/连接竞争耗尽（`dependency_unavailable`, retryable=true）。
- 500：非重试/未知存储故障的安全兜底。
- Run 失败码：`timeout/authentication_required/rate_limited/budget_exhausted/invalid_configuration/dependency_unavailable/malformed_payload`，未知 `generation_failed`；Workflow 自抛 JSON/长度错误无 failed Job 时回 `generation_failed`（安全回退）。
- body-parser 错误仅对 deep-read POST 归一为固定 400/413 `validation_failed`；其它路径保持原行为。
- sourceStatus：`unavailable` 优先，其次 `superseded`，否则 `current`；不阻塞旧正文阅读。

## 10. 依赖

- contracts：`story-deep-read.ts` DTO/上限/块编号/allowlist/omitted null/错误码；`agent` 的 usage/cost；`content-representation` 的 block/evidence。
- storage：三表、原子入队/发布/读取、`createWorkflowEnvelopeInTransaction`、失败码 reader（`definitionKey` 可选）。
- application：本组件的 preparation/control/workflow/publish；`agent.invoke@2` 与 `action`/`workflow` 端口。
- runtime：Workflow/Job/Attempt/Lease/fence；durable truth 在 Workflow/Host，发布成功以 Revision 为准。
- API/transport/Web：四路由、四客户端方法、阅读页/证据抽屉/版本/409。

## 11. 配置

- `SystemConfig.defaultModelId`：省略 modelId 时的默认模型；不可用即 400。
- `SystemConfig.storyAgentTimeoutSeconds`：单次调用超时（默认 300，30–1800）；不新增设置。
- 输出上限 6000 tokens、工具 0；来源/报告预算为 contracts 常量。
- 无新增环境变量/Secret/路径；模型 Provider/凭证沿用 Task 39/41/42 合同。

## 12. 重建验收

1. 同键同 hash 重放返回原 Run，Run/Artifact/Revision/账本均不新增；同键异 hash 409。
2. 活动期不同键 409，且不读取/准备模型与来源；默认模型禁用或来源不可用时仍是 409。
3. Story 不存在 404；Story 存在但从未生成返回 `{artifact:null}`。
4. 三表迁移 fresh/upgrade 只新增、无 backfill；Restrict 外键与唯一约束生效。
5. 入队事务失败/竞争回滚后无孤 Run/槽/账本；P2002 只对 Artifact 身份竞争有界重试。
6. 发布 fence/槽/幂等/N+1/清槽/DomainEvent 同事务；同 Run 重放不新增版本/事件；失败不覆盖旧版。
7. 快照正文只在 `messages` 一次；8/12k/60k、omitted+null、requestHash、resolvedModelId 冻结可验证。
8. 报告只接受 4 类块、5 类 inline、http(s) 链接、fact 至少 1 evidence、opinion 可 0；顶层块 allowlist 拒绝嵌套/媒体/空白块。
9. Workflow 只在 stop+无 toolCalls+严格 JSON+normalize 成功后 publish；length/结构失败不发布。
10. Web：生成/轮询/同键恢复/409/失败保旧版/版本 N+1/证据抽屉精确版本与降级/键盘焦点成立，无来源正文/HTML 注入。

## 13. 实现与测试锚点

- 合同：`packages/contracts/src/story-deep-read.ts` 与 `.test.ts`、`entry-surface.txt`。
- 持久化：`packages/storage-prisma/prisma/schema.prisma`、`prisma/migrations/20261119150000_story_deep_read_artifact/`、`src/repository/story-deep-read.ts`、`src/story-deep-read-repository.test.ts`、`src/story-deep-read-migration.test.ts`、`src/workflow-host-store/envelope-store.ts`。
- 应用/Worker：`packages/application/src/story-deep-read-{preparation,workflow-control,workflow,publish,store}.ts` 与测试；`apps/worker/src/main.ts` 注册与 `story-deep-read-registration.test.ts`。
- API/Transport：`apps/api/src/story-deep-read.controller.ts`、`app.module.ts`、`request-logging.ts`、`model-provider-storage-integration` 等测试；`packages/transport-http/src/client-content.ts` 与测试。
- Web：`apps/web/src/components/cosmos/deep-read-panel.tsx`、`story-panel/deep-read-evidence.tsx`、`use-deep-read.ts`、`deep-read-panel.test.ts`、`e2e/browser/story-deep-read.spec.ts`、组件实验室。

## 未验证边界

- 真实 Provider 外呼、结算与长时稳定性；本轮浏览器/仓储/HTTP 使用合成模型或隔离替身。
- 完整 acceptance/e2e/全量 browser 门禁与远端 CI（以 Task 43 walkthrough 为准）。
- Kernel 值阈值与 60k 快照在真实运行时的存储/传输上限；只在测试中实测字符预算。
- 失败调用的费用不可见；文件包/HTML/Workspace/Knowledge/Research/编辑/批注/导出/定时刷新后置。
- 旧 Story Agent 的默认模型传参疑点与 runtime retry fence 未在本功能修复。
