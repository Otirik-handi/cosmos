# ADR-0034：Artifact Revision v1

- 状态：accepted
- 日期：2026-11-19
- 决策者：维护者 Otirik / Leader
- 产品体验与完整验收见 [Proposal](../proposals/story-deep-read-artifact-v1.md)。本文以 2026-11-19 Leader 依独立挑刺裁决修订后的边界为准，不代表实现、迁移、部署或真实 Provider 验收完成。

## Context

Phase 3 第一切片已有 Agent Invocation、真实模型、默认模型、费用、超时、安全错误码与 Story Agent 候选。深入阅读要在 Story 阅读页手动生成可追溯报告、保留旧版本，不能复用接受候选写 StoryRevision 的动作，见 [候选接受:122](../../packages/storage-prisma/src/repository/story-agent-candidates.ts#L122)。

[架构 §10.1](../architecture/0001-cosmos-foundation/part-07-12.md#101-artifact可追溯的工作产物) 已定义 Artifact 和不可变 Revision。本期选择数据库结构化纯文本切片，后置文件包，避免跨数据库与文件系统发布成本。新增活动槽与请求账本保证同键终态重放不重新收费，不同键活动期409。取消别名归并，换取跨 kind 键唯一可证明；同一存储事务创建槽、Run 和账本，不能仅靠 UI 防重复。

## Decision

### 1. 身份、不可变版本与原 Story 归属

新增三张表及索引：

| 对象 | 边界 |
| --- | --- |
| Artifact | 每 Story 一个 kind=story-deep-read，唯一 `(storyId, kind)`；入队时 get-or-create，含可空 activeRunId 和 activeStartedAt，首次发布前可存在 |
| ArtifactRevision | 归属、递增 revision 与 headline、sectionsJson、inputJson、contentHash、producer、producerVersion、provider、model、usageJson、costJson、workflowRunId、createdAt；唯一 `(artifactId, revision)`，workflowRunId 唯一作额外幂等保护 |
| DeepReadRequest | idempotencyKey 唯一、storyId、workflowRunId、requestHash、createdAt；仅记录真正创建过 Run 的请求键，每键对应 WorkflowRun 唯一键，不存别名 |

“无草稿行”仅指 Revision，发布成功才创建；Artifact 身份和活动槽可预先存在，过程与失败由 Workflow/Job 持有。当前版本为已发布最大 revision，不设 currentRevisionId。发布事务读取 N、分配 N+1，以 `(artifactId, revision)` 唯一约束与事务内归属/槽校验防止并发错写，不能单靠 workflowRunId 唯一兜底。

Artifact 永远属于原 Story，merge/split 不迁移、不聚合到 canonical/后继；历史壳旧报告可读，禁止新生成（400 invalid_configuration 或既有安全错误）。生成中 merge，Run 仍向原 Story 发布。Story 当前没有删除能力，外键用 Restrict，不用 Cascade。

正文存 SQLite 文本/JSON，单条 JSON 按 UTF-8 ≤200 KiB；超限失败，正文不写 Artifact Root，文件包明确后置。inputJson 记录输入身份/块范围与遗漏，不存或返回来源正文。provider/model、usage/cost 为当次实际 provenance，费用仅随成功发布展示；缺失与零分开、历史不重算，失败调用费用不可见是限制。

### 2. 账本语义与事务化入队

requestHash 为 sha256，规范化范围只含 storyId + 原始请求 modelId（缺省为 null），不含来源正文，不含解析后的默认模型；每个键各自存 hash。解析后的实际模型只在 Run 冻结输入与 Revision provenance 中。

同键重放先核对账本 hash：一致返回原 Run，终态也不新建 Run/不新收费；不一致409。活动期不同键一律409“该 Story 已有进行中的深入阅读”，不写别名、不返回既有 Run、不新建 Run；客户端读取产物/活动 generation 展示已有生成。账本只记录真正创建 Run 的键，均对应 WorkflowRun.idempotencyKey；全局唯一约束与 deep-read 入队前检查共同保证跨 kind 同键409，其它功能无需读取新账本。客户端看到实际冻结模型，新付费生成必须新键。

同一事务可行：在 storage-prisma 将 [envelope-store.ts:25](../../packages/storage-prisma/src/workflow-host-store/envelope-store.ts#L25) 至99的创建逻辑抽成 `createWorkflowEnvelopeInTransaction(tx, input)`，保留 WorkflowRun + queued DomainEvent；公开 wrapper 保留事务外 P2002 重读，不把重读吞进业务事务。新增应用存储命令按以下事务顺序执行：

1. 查永久请求账本，同键 hash 一致返回原 Run，不一致409；未命中再查全局 WorkflowRun 键，被其它定义占用或跨 Story/跨 kind 同键409。
2. 校验新生成的 Story 状态、get-or-create Artifact、读槽；引用 Run 活动则409，不写账本；Run终态/缺失才以 expected=旧runId CAS清槽。
3. 无活动则同事务用helper建envelope，再CAS `activeRunId=新runId`/activeStartedAt，再写账本。任一步失败全回滚；CAS失败必须回滚新Run，在事务外有界重试并重读，不留下已建Run未占槽。

SQLite锁/事务冲突无现成重试，整个入队命令在事务外最多尝试3次，退避50ms、150ms；仅重试可识别的锁/事务/CAS竞争，不重试业务409，耗尽给可重试安全错误（如503 dependency_unavailable），不无限重试，不执行模型。P2002赢家重读在事务外。

activeStartedAt 仅显示/诊断，禁止按超时盲释放。读投影按 Run 状态判断，不把终态 Run 当活动；失败/取消/崩溃遗留槽由下一次入队命令核对 Run 终态（或缺失）后 CAS 清槽，expected=旧 runId。可安全接入完成监听时可更早释放，但不是本期前置。账本 v1 永久保留、不清理。WorkflowRun 无 storyId 列，活动定位只靠槽与账本，不扫描 JSON。helper 不可行须停回 Leader，不跨事务降级。

### 3. 块与引用先预检，再确定编号

报告为 headline + sections；每节已发布形状 `{id, heading, kind, blocks, evidence}`。kind 仅 fact/opinion，opinion 标“Agent 观点”；fact 至少 1 条 evidence，opinion 可 0。

模型输出不带 id。使用独立、有界的“报告块输入”形状预检，宿主按章节 `s{n}`、该节深度优先块序号 `s{n}-b{m}` 确定性编号后，才进入既有 [contentBlockSchema](../../packages/contracts/src/content-representation.ts#L57) 与递归白名单校验。sections≤8，全报告 blocks≤60（含嵌套），headline 纯文本≤300 字符，heading 纯文本≤200 字符，每节 evidence≤30，quote/list 嵌套≤2 层；块仅 paragraph/list/quote/code，inline 仅 text/link/strong/emphasis/code，链接仅 http(s)。递归拒绝 heading/image/media/embed/table、原始 HTML、source、warnings。

复用 [ContentBlockReader](../../apps/web/src/components/cosmos/content-block-reader.tsx#L86) 且 assets=[]，无 Markdown 依赖、不加载图片、不执行代码块。章节 heading 单独渲染，不承诺跨 Revision 块语义对齐。contentHash 覆盖规范化 headline、确定性编号后的 sections 与 input，确保同 Run 重放稳定。

evidence 复用 [evidenceRef:122](../../packages/contracts/src/content-representation.ts#L122) 的 entryId/entryRevisionId/representationVersion/blockId?，只允许实际纳入的冻结来源与块。宿主验证引用范围不等于能自动证明结论真伪。

### 4. 冻结输入与现有调用重试

入队读取 Story 当前 revision 和按顺序最多8个来源的精确版本，构造并冻结prompt，正文只在prompt出现一次，不冻结完整views。另存entryId/entryRevisionId/representationVersion/已纳入blockIds的allowlist；Worker不重读正文，发布只按allowlist验证，入队后来源变化不影响本次。

按规范化纯文本字符计数，单来源≤12k、总计≤60k，整块纳入不切半块。首个可用块超剩余预算则整源省略；单来源超限在块边界截断标truncated；无块或入队读取不可用即省略记录。每来源truncated/omitted及原因、全局omittedSourceCount持久记录，不补位；0个可用来源或0字失败。inputJson仅refs、已纳入块与统计，不含来源正文。

现有Story Agent以views/prompt重复携带正文，不可直接沿用放大输入；精简冻结减少快照膨胀。Kernel值阈值尚未验证，12k/60k是保守预算，不把Worker Admin的maxInlineValueBytes当执行门禁；验收实测快照体积与输入字符数，并证明同一正文不重复保存。

入队解析显式 modelId 或 defaultModelId，冻结解析后 modelId，记录实际 provider/model；复用 storyAgentTimeoutSeconds，maxOutputTokens=6000、maxToolCalls=0。来源只是不可信证据，不能作为系统指令，不新增联网检索、工具或跨 Story 输入。

`agent.invoke@2` 沿用 [既有声明:57](../../packages/application/src/agent-invocation-v2.ts#L57) maxAttempts=2（最多两次尝试），不新增 Action 版本、不加 Host 特殊分支。本期不依赖自动重试作为成功保证；retry fence 疑点可能使 Run 失败，后续修复；用户以新键重发。发布 Action 自身 maxAttempts=1。`finishReason=length`、超限或不合规输出失败，不发布半成品，旧版保留。

### 5. Worker 宿主发布与唯一成功判据

新增 Workflow `cosmos.story-deep-read@1`，先 `agent.invoke@2`，再 `artifact.publish@1`。发布 placement 为 `host`，由 Worker 宿主执行，API 不执行，复用 [fenced save:38](../../packages/storage-prisma/src/repository/story-agent-candidates.ts#L38) 的现有 lease fence，不扩 runtime。Workflow 复用 [Application 定义组合](../../packages/application/src/story-agent-workflow.ts#L45) 与 [Worker 注册](../../apps/worker/src/main.ts#L161)，不复用候选接受动作。

发布事务先按workflowRunId查既有Revision，同内容幂等返回、冲突409；不存在再验证fence、Artifact/原Story/Run归属与 `activeRunId === runId`，按allowlist验证结构/引用/大小，分配max(revision)+1、写Revision、原子清槽并写DomainEvent。旧owner/槽不匹配拒绝，同Run不重复版本/事件。进程死亡时提交前全回滚；提交后Revision、槽变更、事件与已有Run/永久账本共同持久，完成标记可滞后。

已发布 Revision 是成功凭据，读取优先成功，即使发布后进程死亡或 Workflow 完成标记滞后；仅模型输出或 Workflow completed 无产物不能报成功。失败不更改旧 Revision、StoryRevision、Observation 或来源正文。

### 6. 产品 HTTP、精确证据与历史读取

以下新增合同相对于既有 Product API 前缀，DTO 使用 zod strict：

| 路径 | 结果 |
| --- | --- |
| `POST /stories/:storyId/deep-reads` | Idempotency-Key 必填；202 新建或同键 hash 一致返回原 Run，返回实际冻结模型；活动期不同键409 |
| `GET /stories/:storyId/deep-reads/generations/:runId` | 200 状态、发布关联与摘要，无报告正文 |
| `GET /stories/:storyId/deep-reads` | 200 artifact 元数据、活动 generation（如有）、revisions 摘要≤50条/不分页/revision降序、current完整一版；首次入队前 `{artifact:null}`；有身份无发布时 current=null、revisions=[] |
| `GET /stories/:storyId/deep-reads/revisions/:revision` | 200 指定完整已发布版，校验 Story 归属 |

正文只在 current 和单版本 GET 出现，其余只摘要；单版沿用 headline/sections/blocks/heading/evidence/深度/200 KiB 上限，input 公开投影仅身份、块引用与覆盖统计，不含来源正文。404 为 Story/版本不存在或 Run 归属不符；400 为非法输入/历史壳新生成；409 为同键不同 hash、跨 kind 键占用或活动期不同键；202 仅新建或同键恢复原 Run。历史壳允许旧键恢复原 Run，不能借重放新建生成。

sourceStatus 读取时计算 current/superseded/unavailable，不回写正文；失败码复用 [ADR-0033](0033-story-agent-timeout-and-error-codes.md) 的受限分类与 generation_failed 回退，不公开原始异常、密钥或来源正文。日志/DTO 不得携带输入来源快照；受控报告和证据内容按自身读取合同提供。

Web 入口仍在 Story 左栏关键事实后、候选前，右栏不动。包含按钮/状态、1秒轮询、sessionStorage 恢复、版本选择、时间/实际模型/成功费用与观点标记，沿用无障碍、1024/1440 约束。

点击 evidence 打开只读“来源证据”抽屉，复用 [既有内容 API:76](../../apps/api/src/app.controller/content.ts#L76)，以 entryRevisionId + representationVersion 读取并定位 blockId，无 blockId 定位内容起点；不新建历史 API。StorySourceReader 只负责最新版本，抽屉负责精确版本。版本缺失固定显示“该来源证据暂不可用，报告正文仍可阅读。”；块缺失显示“该证据位置暂不可用，可阅读此版本来源内容。”，不阻塞正文。抽屉须键盘可操作并管理焦点。

### 7. 迁移、回滚与交付边界

只新增三张表及索引，无 backfill、无旧数据改动，外键 Restrict。回滚先停新入队，排空或显式终止活动 deep-read Run，按终态释放/自愈槽，再回退代码。旧 Worker 遇未知定义安全失败，不执行错误动作；表和已发布报告保留，旧 UI 不可达，重新升级仍能读旧版。不删表、不逆向改写旧数据。

本期不做 Workspace、HTML/可执行页面/沙箱、定时刷新、编辑/批注/导出/分享、看板/Feed/搜索、跨 Story、取消 UI、移动端、真实外网新验收或新的重试机制。Artifact Root 文件包后置。

## Consequences

- 身份可先于首次报告存在，空状态须区分“尚未入队”与“已有身份但未成功”；不可变只约束已发布 Revision。
- 三表、Workflow envelope 与 queued 事件的原子入队提高实现要求，能持续追踪真正创建 Run 的键，所有账本键均受 WorkflowRun 全局唯一约束保护；不能用客户端按钮或进程内锁冒充并发保护。
- SQLite 事务拥有发布事实，Workflow/Job 拥有过程，读取必须弥合发布与完成标记间隙。原 Story 归属换来稳定审计，但 merge/split 后报告不会自动出现在新对象中。
- 纯文本、上限与整块截断控制范围，代价是覆盖可能不足、证据未来可能不可读。length 失败保留旧版，不用半成品替换。失败费用不可见和 retry fence 是已登记限制。
- 实现验收必须证明不同键并发仅一个创建 Run、另一个409，受控成功路径模型调用计数为1；同键终态重放返回原 Run，不新增 Run/费用，跨 kind 同键409；发布后进程死亡仍可读；历史归属、升级旧版读取/Worker 回退、回滚安全、日志/DTO 不含来源正文必须覆盖。不能以局部绿灯替代这些边界。
- AGT-003/005/009 已覆盖，无新增需求行。获批后维护稳定文档，交付后由文档工程师落实 contracts/storage/interfaces/web/application 与项目状态，新 API 保持 Draft 至实现验收；本次只写两草稿，不建 Task、不跑数据库、不提交。

## Revisit Gate

1. 超过 200 KiB、文件包/图片/附件/HTML/可执行页：重审数据库/Artifact Root、原子发布、资源 containment、沙箱与清理。
2. Workspace、定时更新、跨 Story、编辑/批注/导出/分享/看板/Feed/搜索，或迁移原 Story 归属：重审身份、输入绑定、用户状态与版本关系。
3. 需要可靠自动重试、取消 UI、多主机或更强恢复：先验证 retry fence、重复付费与发布 fence，再改调用/发布重试合同；不借本 ADR 扩 runtime。
4. 需要提高12k/60k输入预算或发现Kernel值阈值不满足：先验证完整冻结快照、prompt单份正文与实际执行值边界，再评审预算或值外置；Worker Admin的maxInlineValueBytes不是执行门禁。

## 决策记录与实现风险

| 日期 | 决策者 | 记录 |
| --- | --- | --- |
| 2026-11-19 | Leader（首次派单冻结） | 初稿边界，以后续修订替代的条款为准 |
| 2026-11-19 | Leader | 2026-11-19 Leader 依独立挑刺裁决修订：host 发布、三表原子入队/活动槽、现有调用重试、归属、预算、抽屉、DTO、回滚与验收 |
| 2026-11-19 | Leader（补充裁决，活动期规则已被下行替代） | 保留 requestHash 原始请求语义与同键异 hash409；取消原异键模型语义归并 |
| 2026-11-19 | Leader（最终键合同裁决） | 取消别名归并，换取跨 kind 键唯一可证明：不同键活动期一律409，仅同键同 hash恢复原 Run，账本仅记录真正创建 Run 的键 |
| 2026-11-19 | Leader（输入与事务补充裁决） | prompt单份正文精简冻结、12k/60k预算；共享事务helper、全局幂等、永久账本、CAS回滚与最多3次竞争重试 |
| 2026-11-19 | 维护者 Otirik / Leader（待批准） | proposed，批准后才改 accepted |
| 2026-11-19 | 维护者 Otirik / Leader | 2026-11-19 维护者批准方向；Leader 依独立挑刺与入队原子性核实后接受；实施见 [Task 43](../../.agents/tasks/43-story-deep-read/README.md)。 |

仍需实现证据的3项风险：①共享事务helper/P2002外部重读/SQLite竞争重试不破坏envelope语义且不留孤Run/槽；②retry fence可能使Run失败、失败费用不可见；③Kernel值阈值未验证，精简快照体积、计数/确定编号、精确来源失效降级须实测。不拿Worker Admin阈值替代，不可行时回到Leader，不降级成功。
