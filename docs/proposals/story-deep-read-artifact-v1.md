# Story 深入阅读 + Artifact v1

- 状态：accepted
- 日期：2026-11-19
- 决策者：维护者 Otirik / Leader
- 定位：Phase 3 第二条主线的已接受产品与架构目标；以 2026-11-19 Leader 依独立挑刺裁决修订后的方案为准，不代表已实现。
- 长期边界草稿：[ADR-0034](../adr/0034-artifact-revision-v1.md)。本次只交付两份草稿，不写代码、不建 Task、不 commit。

## 1. 问题、目标与非目标

现有 Story Agent 候选适合提议修改 Story，不适合保存一份可反复阅读、带出处且可回看旧版的长报告。本期让用户在 Story 阅读页手动生成深入阅读报告，Agent 只读取该 Story 已录入的来源，分别呈现事实与观点；成功发布形成独立产物的不可变版本，失败保留旧版。

[PRD §7.7](../requirements/0002-product-requirements/part-07-3.md) 的 AGT-003、AGT-005、AGT-009 已覆盖本期，不新增需求行，也不声称完成这些需求的全部范围。

不做 Workspace、HTML/可执行页面及沙箱、图片加载、定时刷新、编辑、批注、导出、分享、看板/Feed/搜索接入、跨 Story 调研、取消 UI、移动端或真实外网新验收。不新增自动重试机制、Action 版本或 Host 特殊分支，沿用现有调用声明。Artifact Root 文件包明确后置，不新增联网检索或抓取工具。

## 2. 当前行为与证据

以下为基线 `9b35d60` 的源码抽查结论，未运行功能测试。

| 当前事实 | 已核实锚点与含义 |
| --- | --- |
| 候选生成、进度查询、列表三路由已存在 | [content.ts:134](../../apps/api/src/app.controller/content.ts#L134)、[146](../../apps/api/src/app.controller/content.ts#L146)、[154](../../apps/api/src/app.controller/content.ts#L154)；报告另立合同 |
| Worker 注册，Workflow 定义在 Application | [main.ts:161](../../apps/worker/src/main.ts#L161)、[story-agent-workflow.ts:45](../../packages/application/src/story-agent-workflow.ts#L45)；现有链是调用后保存候选 |
| 候选保存受 fence 保护，接受会写 StoryRevision | [story-agent-candidates.ts:38](../../packages/storage-prisma/src/repository/story-agent-candidates.ts#L38)、[122](../../packages/storage-prisma/src/repository/story-agent-candidates.ts#L122)；复用 fenced save，不复用接受语义 |
| envelope 创建自行开启事务，无外部事务参数 | [envelope-store.ts:10](../../packages/storage-prisma/src/workflow-host-store/envelope-store.ts#L10)、[24](../../packages/storage-prisma/src/workflow-host-store/envelope-store.ts#L24)；原子入队必须先抽共享事务 helper |
| Agent 调用已有重试声明 | [agent-invocation-v2.ts:45](../../packages/application/src/agent-invocation-v2.ts#L45)；trusted_worker、maxAttempts=2，最多两次尝试 |
| 精确来源表示读取已有 HTTP 入口 | [content.ts:76](../../apps/api/src/app.controller/content.ts#L76)；支持 entryRevisionId 与 representationVersion |
| 块、证据和阅读器可复用 | [content-representation.ts:57](../../packages/contracts/src/content-representation.ts#L57)、[122](../../packages/contracts/src/content-representation.ts#L122)、[ContentBlockReader:56](../../apps/web/src/components/cosmos/content-block-reader.tsx#L56)；块要求非空 id，需另做无 id 模型输入预检 |
| 阅读页布局与生成恢复已有模式 | [story-reading.tsx:210](../../apps/web/src/app/(reading)/stories/[id]/story-reading.tsx#L210)、[289](../../apps/web/src/app/(reading)/stories/[id]/story-reading.tsx#L289)、[320](../../apps/web/src/app/(reading)/stories/[id]/story-reading.tsx#L320)、[generation hook:94](../../apps/web/src/components/cosmos/story-panel/use-story-agent-generation.ts#L94)；关键事实后接候选，右栏编辑，sessionStorage 与 1 秒轮询 |
| 来源状态是实时投影 | [story-agent-source-status.ts:8](../../packages/storage-prisma/src/repository/story-agent-source-status.ts#L8)；缺失不可用，revision/representation 取代为 superseded |
| Artifact 已有架构定义与目录规划 | [架构 §10.1](../architecture/0001-cosmos-foundation/part-07-12.md#101-artifact可追溯的工作产物)、[storage-root.ts:18](../../packages/storage-prisma/src/storage-root.ts#L18)；建议文件包不是本期正文落盘义务 |

被修正锚点：背景中的 Worker Workflow 定义文件不存在，实际为上表 Application 路径；来源状态文件实际在 repository 子目录。另据 [控制层:37](../../packages/application/src/story-agent-workflow-control.ts#L37) 与 [45](../../packages/application/src/story-agent-workflow-control.ts#L45)，现有代码解析默认模型后仍把请求原值传给准备层；这是从代码推断、未验证的旧链路疑点，不顺带修复，新链路必须冻结解析后的值。[既有输入准备:26](../../packages/application/src/story-agent-preparation.ts#L26) 的 100 个显式来源和不可用即失败不适用于本期预算。

## 3. 用户体验

入口在 Story 阅读页左栏关键事实之后、Agent 候选之前；含生成按钮、进行中/失败/成功状态。默认读已发布最大 revision，提供版本选择、生成时间、实际冻结/调用的模型与成功发布费用；失败调用费用不可见是已登记限制，不能显示成零。生成中和失败后仍可阅读旧版。

每节标事实或“Agent 观点”；fact 至少有一条证据，opinion 可无证据。来源引用存在不等于结论已被自动证明，宿主只能校验来源范围与引用身份。

点击 evidence 打开键盘可操作的只读“来源证据”抽屉，通过既有 `GET /revisions/:id/content?representationVersion=...` 读取精确版本并定位 blockId，无 blockId 则定位来源内容起点。抽屉只显示该次引用版本；StorySourceReader 继续负责最新版本，不承担历史切换。不新建历史读取 API；版本/来源缺失固定显示“该来源证据暂不可用，报告正文仍可阅读。”；块缺失显示“该证据位置暂不可用，可阅读此版本来源内容。”，均不阻塞报告正文。

进行中每 1 秒轮询，终态停止；sessionStorage 保存请求、原幂等键和 runId，刷新/响应丢失后用原键恢复。活动期不同键一律409“该 Story 已有进行中的深入阅读”，不写别名、不返回既有 Run、不新建 Run；客户端读取产物/活动 generation 展示已有生成。只有同键且 hash 一致才返回原 Run，终态也返回。页面显示实际冻结模型，默认设置变化不改旧 Run；新付费生成必须新键。恢复存储不可用时沿用安全提示，不把未知响应变成新付费意图。

按钮、版本选择与抽屉支持键盘操作、焦点管理和可理解名称；状态用可访问区域表达。沿用 1024/1440 桌面约束：80vw、≥1024 两栏 3:1、右栏至少 240px，长文本/代码不得撑破左栏；右栏编辑面板不动。

## 4. 数据、归属与版本

新增 Artifact、ArtifactRevision 和请求账本 DeepReadRequest 三张表及索引，不再限定为绝对两张表。

| 对象 | 保存内容与约束 |
| --- | --- |
| Artifact | Story 的稳定产物身份；kind=story-deep-read，唯一 `(storyId, kind)`；入队时 get-or-create，含可空 activeRunId、activeStartedAt；首次发布前也可存在 |
| ArtifactRevision | 归属、递增 revision，以及 headline、sectionsJson、inputJson、contentHash、producer、producerVersion、provider、model、usageJson、costJson、workflowRunId、createdAt；唯一 `(artifactId, revision)`，workflowRunId 唯一作为额外幂等保护 |
| DeepReadRequest | idempotencyKey 唯一、storyId、workflowRunId、requestHash、createdAt；仅记录真正创建过 Run 的请求键，每键对应 WorkflowRun 唯一键，不存别名 |

“无草稿行”仅指 Revision：发布成功才创建，运行状态由 Workflow/Job 保存；Artifact 身份及活动槽可在首次成功前存在。当前版本是已发布的最大 revision，不维护 currentRevisionId 指针。发布事务读取 N 并分配 N+1，以 `(artifactId, revision)` 唯一约束、事务内归属/活动槽校验保护并发，不能单靠 workflowRunId 唯一兜底。

正文保存在 SQLite 文本/JSON，单条 JSON 按 UTF-8 ≤200 KiB；超限失败，不裁结论冒充完整报告，不写 Artifact Root。inputJson 记录输入身份和覆盖范围，不保存/返回来源正文。contentHash 对规范化后的 headline、确定性编号后的 sections 及 input 计算，同 Run 重放稳定；相同内容的新 Run 仍保留独立生成事实。费用与用量按当次成功发布持久化，缺失与零分开，历史不重算。

Artifact 永远留在原 Story，merge/split 不迁移、不聚合到 canonical 或后继。历史壳旧报告可读，禁止历史壳新生成；生成中发生 merge，Run 仍向原 Story 发布。Story 当前没有删除能力，外键采用 Restrict，不写 Cascade。

## 5. 原子入队与发布

### 5.1 活动槽与请求账本

requestHash 为 sha256，规范化范围只含 storyId + 原始请求 modelId（缺省为 null），不含来源正文或解析后的默认模型；仅为真正创建 Run 的请求键保存 hash。解析后实际模型只保存于 Run 冻结输入与 Revision provenance。

同键先查 DeepReadRequest：hash 一致返回原 Run，即使终态也不新建 Run、不新收费；hash 不一致409。活动期不同键一律409“该 Story 已有进行中的深入阅读”，不写别名、不返回既有 Run、不新建 Run；客户端读取产物/活动 generation 展示已有生成。账本仅记录真正创建 Run 的键，均在 WorkflowRun 有对应唯一键；跨 kind 全局键唯一由 WorkflowRun.idempotencyKey 唯一约束与 deep-read 入队前检查共同保证，其它功能无需读新账本。新付费生成必须新键。

同一事务可行。实现前置是在 storage-prisma 内把 [envelope-store.ts:25](../../packages/storage-prisma/src/workflow-host-store/envelope-store.ts#L25) 至创建/queued 事件部分抽成 `createWorkflowEnvelopeInTransaction(tx, input)`；公开 wrapper 继续在事务外执行 P2002 重读，不能把该重读吞入外层业务事务。新增应用存储命令拥有以下事务：

1. 先查永久请求账本，同键 hash 一致直接返回原 Run，不一致409；未命中再查全局 WorkflowRun 键，被其它定义占用或跨 Story/跨 kind 同键409；不得扫描 input JSON 找活动 Run。
2. 对新请求校验 Story 可生成，get-or-create Artifact，读 activeRunId；引用 Run 活动则409，不写账本；终态/缺失则以 expected=旧 runId CAS 清槽，非终态不按超时释放。
3. 无活动时，在本事务先用 helper 创建 envelope（WorkflowRun + queued DomainEvent），再 CAS `activeRunId=新 runId` 并设 activeStartedAt，再写请求账本；任一步失败整体回滚。CAS 失败必须回滚新 Run，事务外有界重试并重读，不留“已建 Run 未占槽”。

SQLite 锁冲突/事务冲突没有现成重试，整个入队命令在事务外最多尝试3次，间隔50ms、150ms；仅对可识别的锁/事务/CAS竞争重试，业务409不重试，耗尽返回可重试的安全错误（如503 dependency_unavailable）。禁止无限重试，不重新执行模型；P2002 的已提交赢家重读也在事务外进行。

activeStartedAt 只作显示/诊断，不按超时盲释放。读投影按 Run 状态判断，不把终态 Run 当活动；失败/取消/崩溃遗留槽由下一次入队命令核对 Run 终态（或缺失）后 CAS 清槽，expected=旧 runId。若实现可安全接入完成监听，可更早释放，但不是本期前置。账本 v1 永久保留、不清理，同键始终先查账本。WorkflowRun 没有 storyId 列，活动定位只依靠 Artifact 槽与账本。helper 若无法维持原语义必须停回 Leader，不降级为跨事务部分成功。

### 5.2 Workflow、调用与持久发布

新增 `cosmos.story-deep-read@1`，先 `agent.invoke@2`，再 `artifact.publish@1`。发布 Action 使用 `host`，由 Worker 宿主执行，API 不执行；复用既有 lease fence/fenced save，不扩 runtime，不新增 Action 调用版本或 Host 特殊分支。

`agent.invoke@2` 沿用声明的 maxAttempts=2（最多两次尝试），新发布 Action 自身 maxAttempts=1。本期不依赖自动重试作为成功保证；已知 retry fence 疑点可能导致 Run 失败，留后续修复。失败后用户以新键发起新 Run；幂等恢复不等于重新调用。只有成功发布展示费用，失败调用已发生费用不可见属于限制。

发布事务先按 workflowRunId 查既有 Revision，同内容幂等返回、内容冲突409，无需重新占槽；不存在才验证 lease fence、Artifact/原 Story/Run 归属与 `activeRunId === workflowRunId`。结构/引用按冻结 allowlist 校验，满足200 KiB后分配 max(revision)+1、写 Revision、原子清槽并写 DomainEvent。未发布旧 owner/槽不匹配拒绝。同 Run 不重复版本或事件。进程死亡时提交前全部回滚；提交后 Revision/槽变更/事件、已有 Run 与永久账本共同持久，完成标记可随后恢复。

成功以持久 Revision 为准，读取时先查归属匹配的 published revision：即便发布后进程死亡、Workflow 完成标记未写回也优先显示成功。只有模型输出或 Workflow completed 而无 Revision 不能报成功。调用失败、结构失败、`finishReason=length` 或发布失败均不发布半成品，保留旧版。

## 6. 输入、块与引用预算

### 输入冻结

入队时读取 Story 当前 revision 与按原顺序最多 8 个来源的精确版本，构造 prompt 并冻结；正文只在 prompt 出现一次，不冻结完整 prepared.views，不在多个 input 字段复制正文。另冻结来源 allowlist：entryId/entryRevisionId/representationVersion/已纳入 blockIds；Worker 不重读来源正文，发布校验只用 allowlist，入队后来源变化不影响本次生成。

按规范化纯文本字符计数，单来源≤12k、总计≤60k。按来源顺序整块纳入，不切半个块；若首个可用块已超剩余预算则整源省略并记录。单来源超限按块边界截断并标 truncated；无可用块或入队读取不可用即省略，记录每来源 truncated/omitted、原因及 omittedSourceCount，不补位；0 个可用来源或 0 字失败。Revision 的 inputJson 只记录实际来源 refs、已纳入块与统计，不含正文。

采用精简冻结是因为现有 Story Agent 的 views 与 prompt 会重复携带正文，不能直接扩大至150k；Kernel 值阈值尚未验证，12k/60k 是本期保守产品预算，不宣称已验证全部执行阈值，不把 Worker Admin 的 maxInlineValueBytes 当执行门禁。实现验收须测完整快照体积与正文只存一份。

入队解析请求 modelId 或 defaultModelId，把解析后的 modelId 冻入 Workflow input；记录实际 provider/model。复用 storyAgentTimeoutSeconds，maxOutputTokens=6000、maxToolCalls=0，不新增设置，不把单次调用超时说成 Workflow 总截止时间。来源内容是不可信证据，不能当系统指令。

### 报告结构

发布结构为 headline + sections，每节 `{id, heading, kind, blocks, evidence}`，kind 仅 fact/opinion。模型输出不带 id：独立、有界的“报告块输入”形状先预检，宿主按章节编号 `s{n}` 和该节深度优先块序号 `s{n}-b{m}` 确定性编号，再用现有 contentBlockSchema 与递归白名单校验；不承诺跨 Revision 的块语义对齐。

| 内容 | 冻结上限与白名单 |
| --- | --- |
| sections / blocks | sections≤8；全报告 blocks≤60，包含嵌套块 |
| 报告/章节标题与证据 | headline 为纯文本≤300 字符，heading 为纯文本≤200 字符；每节 evidence≤30；fact 至少 1 条，opinion 可 0 |
| 块类型与深度 | 仅 paragraph/list/quote/code；quote/list 嵌套≤2 层 |
| inline | 仅 text/link/strong/emphasis/code；链接仅 http(s) |
| 禁止项 | heading/image/media/embed/table 块、原始 HTML、source、warnings，递归一并拒绝 |
| JSON | 单条≤200 KiB；超限或 length 结束失败，不发布半成品 |

evidence 复用 `entryId/entryRevisionId/representationVersion/blockId?`，宿主校验冻结身份、实际使用范围与可选块。产品称 Markdown 级别纯文本，实际是结构化块，无 Markdown 依赖；章节 heading 单独渲染，ContentBlockReader 只收校验后块及 `assets=[]`，不加载图片、不执行代码。

## 7. 新增公共 HTTP 合同

相对于既有 Product API 前缀，请求与响应 DTO 均 zod strict；未实现前保持 Draft，不暴露内部 ORM、Secret、lease token、原始服务商响应或来源正文。

| 方法与相对路径 | 响应 |
| --- | --- |
| `POST /stories/:storyId/deep-reads` | Idempotency-Key 必填；请求可显式 modelId；202 新建或同键 hash 一致返回原 Run 及实际冻结模型；活动期不同键409 |
| `GET /stories/:storyId/deep-reads/generations/:runId` | 200 状态与发布关联；只有摘要，不含报告正文 |
| `GET /stories/:storyId/deep-reads` | 200：artifact 元数据 + 活动 generation（如有）+ revisions 摘要（≤50 条、不分页、revision 降序）+ current 完整一版；首次入队前 `{artifact:null}`；有身份无发布时 current=null、revisions=[] |
| `GET /stories/:storyId/deep-reads/revisions/:revision` | 200 指定完整已发布版，校验 Story 归属 |

正文仅在 current 和单版本 GET 出现，其余投影只给摘要。DTO 按上节 headline/sections/blocks/heading/evidence/深度/200 KiB 上限校验；revisions 最多50条，旧版仍可由已知 revision 单独读取；版本摘要不夹带 sections/input 正文。inputJson 公开投影仅来源身份、块引用与计数/标记，不含来源正文。

状态码：404 为 Story/版本不存在（含不匹配归属的 Run）；400 为非法输入/历史壳，历史壳生成使用 invalid_configuration 或现有安全错误；409 为同键不同 hash、跨 kind 键占用或活动期不同键；202 仅新建或同键恢复原 Run。旧键重放是恢复既有操作，历史壳上也不能借此新建生成。客户端始终看到实际冻结模型。

生成失败复用 [ADR-0033](../adr/0033-story-agent-timeout-and-error-codes.md) 的七类安全码，未知用 generation_failed，Web 映射固定文案；不公开原始异常。sourceStatus 读取时计算 current/superseded/unavailable，不回写 Revision；来源更新或不可用不阻止旧正文阅读。

## 8. 安全、迁移、发布与回滚

报告不改写 StoryRevision、Observation 或来源正文；沿用单用户内容读取策略，只把批准的本 Story 输入送给配置模型。日志与 DTO 不含来源正文、密钥、内部路径或原始错误；报告正文与证据抽屉按各自受控合同返回，不能混入输入来源快照。费用只对成功发布可见，不能把失败费用缺失解释为未扣费。

只新增三张表与索引，无 backfill、无旧数据改动；外键 Restrict。迁移沿用 `YYYYMMDDHHMMSS_snake_case`。实现阶段隔离验证命令为 `bun run db:validate`、`bun run db:generate`、`bun run db:migrate`；本次只写命令，不执行，[prisma.ts:16](../../scripts/prisma.ts#L16) 显示 validate 也可能建库。

回滚顺序：先停止新入队，排空或显式终止活动 deep-read Run，核对其终态并释放/自愈活动槽，再回退代码。禁止靠时长强行释放仍运行的槽。旧 Worker 遇到未知定义应安全失败，不执行错误动作；升级/回退路径必须验收。表和已发布报告保留，旧版 UI 不可达不等于数据丢失；再次升级后仍能读取旧版。不删表、不逆向修改用户数据，本次不迁移或部署。

## 9. 验收边界

下列为实现阶段目标，本次未执行功能测试。

| 场景 | 必须观察到的结果 |
| --- | --- |
| 原子入队与自愈 | 槽/envelope/请求账本同成同败；崩溃不留常规孤槽；仅终态/缺失 Run 可释放；共享事务 helper 保留原 envelope 语义 |
| 不同键并发 | 仅一个请求创建 Run，另一个409；受控成功路径模型调用计数为1；活动期不同键不写账本、不返回既有 Run |
| 同键重放与全局键 | 同键 hash 一致终态也返回原 Run，不新增 Run、Revision 或费用；同键不同 hash409；不同键活动期409；跨 kind 同键409 |
| 不可变与发布崩溃 | N+1、唯一约束、lease/槽/CAS 拒旧写者；同 Run 只一版一事件；发布后进程死亡仍可读且显示成功 |
| 冻结与预算 | 8来源、12k/60k规范化字符、首块超限整源省略、整块截断、0字/不可用、omitted/truncated/不补位可验证；入队后来源/模型设置变化不改冻结输入 |
| 快照体积 | 实测运行快照体积与模型输入字符数满足冻结预算；来源正文只在 prompt 存一次，无 views/多字段重复副本；核对执行值阈值，不拿 Worker Admin 限额替代 |
| 输出与证据 | 无 id 输入预检、确定编号、所有上限及嵌套禁项、fact证据、allowlist、hash稳定成立；length/超限不发布 |
| 归属与历史壳 | merge/split 不迁移，历史壳禁新生成但旧版可读，生成中 merge 仍发布到原 Story，Restrict 不级联删除 |
| 费用与隐私 | 成功费用持久且缺失与零区分；失败费用不公开；日志与 DTO 不含输入来源正文/Secret/原始异常 |
| 页面与精确证据 | 恢复、轮询终止、旧版切换、精确版本抽屉/块定位及降级、键盘焦点与 1024/1440 布局成立 |
| 升级与回滚 | 升级后旧版读取；停止入队/排空或终止/清槽后 Worker 回退；未知定义安全失败，保留表与报告，再升级可读 |

分层验证 shared DTO、Application、隔离 SQLite、HTTP/Transport、浏览器；现有重试可能带来额外尝试，不能把不同键并发验收误写成所有失败场景都只调用一次。本次仅执行 `bun run docs:check`、`py -3 scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new`、`git diff --check` 三类文档检查，不跑测试、数据库或真实外网。

## 10. 文档影响与生效顺序

结论：需更新。只修改本 Proposal 与 ADR 草稿，其余预期改动由实现阶段文档工程师落实。

| 文档 | 预期改动 |
| --- | --- |
| [PRD](../requirements/0002-product-requirements.md) | AGT-003/005/009 的本期解释与验收；不新增需求行、不改写原话 |
| [架构](../architecture/README.md) | §10.1 已定义 Artifact；交付后补数据库纯文本 v1 切片、三表原子入队和文件包/Workspace 后置注记 |
| [ADR-0034](../adr/0034-artifact-revision-v1.md) | 批准前 proposed，批准后 accepted，固定身份/版本/发布/归属边界 |
| [API 草案](../api/README.md) | 新增 Draft：四路由、strict DTO/上限、键账本、活动期不同键409、sourceStatus、精确证据复用及 conformance |
| [spec](../spec/README.md) | 交付后更新 contracts、storage、interfaces（HTTP/Transport/Web）、application；分别拥有 wire shape、三表与共享事务 helper、产品面、冻结与 Workflow，仅写已实现/验证事实 |
| [项目状态](../../PROJECT-STATUS.md) | Phase 3 第二主线证据、失败费用不可见/retry fence 风险及文件包/Workspace 后置，不能凭草稿宣称交付 |

批准后才能进入稳定文档和实施 Task 流程，本次不建 Task。若共享事务 helper 或冻结合同不可行，必须停止回到 Leader，不能降级成功。

## 11. 决策记录与实现风险

| 日期 | 决策者 | 记录 |
| --- | --- | --- |
| 2026-11-19 | Leader（首次派单冻结） | 原始边界已起草，受下行修订记录替代的条款以修订为准 |
| 2026-11-19 | Leader | 2026-11-19 Leader 依独立挑刺裁决修订：host 发布、三表/原子入队、沿用调用重试、历史归属、块/输入预算、证据抽屉、DTO、回滚与验收补强 |
| 2026-11-19 | Leader（补充裁决，活动期规则已被下行替代） | 保留 requestHash；正文只在prompt冻结一次，12k/60k字符；共享事务helper、永久账本、CAS回滚与最多3次入队竞争重试 |
| 2026-11-19 | Leader（最终键合同裁决） | 取消别名归并，换取跨 kind 键唯一可证明：不同键活动期一律409，仅同键同 hash恢复原 Run，账本仅记录真正创建 Run 的键 |
| 2026-11-19 | 维护者 Otirik / Leader（待批准） | reviewing / proposed 保持不变，待最终接受 |
| 2026-11-19 | 维护者 Otirik / Leader | 2026-11-19 维护者 Otirik 批准功能范围与实施方式（oil-plan 子 Agent 模式）；Leader 依独立挑刺两轮修订后接受技术合同；实施见 [Task 43](../../.agents/tasks/43-story-deep-read/README.md)。 |

仍需实现证据的3项风险：①共享事务helper、P2002外部重读和SQLite竞争重试须保证不留孤Run/槽，不改变既有envelope语义；②runtime retry fence可能导致Run失败，失败调用费用不可见，不能以重试保证成功；③Kernel值阈值未验证，须实测精简快照体积、确定编号/计数与精确证据历史降级，不拿Worker Admin阈值代替。不可行时返回Leader，不扩大runtime或降级成功。
