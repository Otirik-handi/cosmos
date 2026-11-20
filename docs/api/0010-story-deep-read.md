# Story 深入阅读 API 与 DTO

- 状态：已实现；当前行为以 [实现规格](../spec/application/0012-story-deep-read.md) 为准
- 日期：2026-11-19
- 目标依据：[accepted Proposal](../proposals/story-deep-read-artifact-v1.md)、[accepted ADR-0034](../adr/0034-artifact-revision-v1.md)。
- 实施：[Task 43](../../.agents/tasks/43-story-deep-read/README.md)。本文是目标合同，不是现有路由或验收完成声明；当前事实见 [spec入口](../spec/README.md)。

## 1. 责任与通用约束

API负责校验/冻结/入队与产品读取，不执行模型或发布Action；Worker执行 `cosmos.story-deep-read@1`，调用 `agent.invoke@2` 后由 `artifact.publish@1`（host）持久发布。当前单用户内容读取策略不变，不新增权限体系。

所有下列对象（含嵌套对象）用zod strict，拒绝未知字段，公共DTO不直接透传ORM/Workflow input。除明确可空/可选字段外必填；日期为ISO datetime；revision/representationVersion为正安全整数，计数为非负安全整数；所有金额为有限非负数。ID、模型/Provider/producer/version等标识为非空字符串，产品DTO上限200字符；requestHash为64位小写十六进制sha256，不对外暴露账本。文本、集合和JSON预算同时校验，不能靠JSON字节上限绕过字段/嵌套限制。

所有路由位于既有 `/api/v1` 前缀下。响应只包含受控报告、来源refs/统计与运行投影，不包含输入来源正文快照、Secret、lease、路径、内部Blob key或原始服务商异常。来源证据内容走第7节既有读取合同，不在报告input中复制。

## 2. 路由、状态码与幂等

| 方法与相对路径 | 请求与成功响应 |
| --- | --- |
| `POST /stories/:storyId/deep-reads` | 必需Idempotency-Key，strict body `{modelId?: string}`；202返回Generation |
| `GET /stories/:storyId/deep-reads/generations/:runId` | 200 Generation；Run必须属于该Story与deep-read定义 |
| `GET /stories/:storyId/deep-reads` | 200 ArtifactRead；首次入队前严格 `{artifact:null}` |
| `GET /stories/:storyId/deep-reads/revisions/:revision` | 200 RevisionDetail；正整数revision，校验原Story归属 |

Idempotency-Key去首尾空白后非空、≤200字符；请求modelId去首尾空白后非空、≤200字符，省略表示入队时解析系统默认，不接受null/connectionId/provider/预算/来源自选/actor字段。

requestHash = sha256(规范化的 `{storyId, modelId: 原始请求modelId或null}`)。不含解析后默认模型、不含来源正文。同键账本命中且hash一致返回原Run（终态也202返回），不重新冻结、不新增Run/费用；异hash409。DeepReadRequest只记录真正创建Run的键，无别名。所有账本键都有WorkflowRun对应唯一键；全局WorkflowRun.idempotencyKey唯一约束与入队前检查共同保证跨kind同键409，其它功能无需读新账本。

活动期不同键一律409“该 Story 已有进行中的深入阅读”，不返回既有Run、不创建Run、不写账本；客户端随后GET产物与活动generation展示已有生成。即使modelId相同也409。新付费生成必须新键且无活动Run。客户端看到实际冻结的模型，当前默认设置变化不改既有Run。

| HTTP | 公开语义 |
| --- | --- |
| 202 | 新建生成，或同键同hash恢复原Run（包括终态） |
| 400 | 非法DTO/键/路径参数、历史壳新生成、无可用模型或无来源等配置/输入前置失败；历史壳用invalid_configuration或既有安全码 |
| 404 | Story/版本不存在，或Run/Revision与路径Story不匹配；不泄露其它对象细节 |
| 409 | 同键异hash、跨kind/其它定义键占用、活动期不同键、不可接受的幂等内容冲突 |
| 503 | SQLite锁/事务竞争有界重试耗尽，安全dependency_unavailable、retryable=true；用原键恢复 |

历史壳旧报告可读，已有同键同hash可恢复原Run；不借恢复新建生成。Artifact留原Story，merge/split不迁移；生成中merge仍向原Story发布。HTTP前置失败与已入队后的Run失败分开：若错误发生在Worker，只通过200 Generation的failed/errorCode表达，不能伪造成功发布。

## 3. Generation 与 ArtifactRead

### Generation

| 字段 | 形状与约束 |
| --- | --- |
| runId / storyId | 非空ID，各≤200字符 |
| status | queued / running / completed / failed / cancelled |
| modelId | 入队解析并冻结后的配置模型ID，≤200字符 |
| provider / model | 实际调用标识，各≤200字符；尚无实际调用记录时null，不用当前设置冒充历史 |
| createdAt | Run入队时间，ISO datetime |
| publishedRevision | 正整数或null；只有已发布归属匹配版才非null |
| errorCode | 失败安全码或null；非failed为null |
| cost | 可选，仅持久发布成功时出现；未知省略，不填0 |

Generation不含sections或输入来源正文。按runId找到归属匹配的已发布Revision时优先completed，不受Workflow完成标记滞后影响；没有产物的completed标记不能投影成功。取消为中性独立状态，本期无取消UI。费用不是服务商结算账单，失败调用费用不可见是已登记限制。

### ArtifactRead

响应为strict联合：`{artifact:null}`，或 `{artifact: ArtifactSnapshot}`。

| ArtifactSnapshot字段 | 形状与约束 |
| --- | --- |
| id / storyId | ID各≤200字符 |
| kind | 固定story-deep-read |
| generation | 活动Generation或null；按Run状态计算，终态Run即使槽尚未清理也不算活动 |
| revisions | RevisionSummary数组，≤50条，revision降序、不分页 |
| current | RevisionDetail或null；当前=已发布最大revision，无currentRevisionId指针 |

Artifact入队即存在；有身份无发布时generation可有值、revisions=[]、current=null。首次入队前才是artifact:null。revisions只给最近50条摘要；已知旧revision仍可单独GET。正文只在current与单版本GET出现，其它列表/Generation均不复制正文。

## 4. Revision、费用与输入投影

### RevisionSummary / RevisionDetail

| 摘要字段 | 形状与约束 |
| --- | --- |
| artifactId / storyId / workflowRunId | ID各≤200字符 |
| revision | 正安全整数，同Artifact递增 |
| headline | 纯文本≤300字符 |
| producer / producerVersion / provider / model | 标识各≤200字符，实际持久值 |
| createdAt | 发布时间，ISO datetime |
| contentHash | 64位小写十六进制；规范化headline+确定编号sections+input的hash |
| sourceStatus | current / superseded / unavailable，读取时计算 |
| usage / cost | usage按既有调用计数形状；cost可选，缺失与0区分 |

RevisionDetail为摘要加 `sections` 与 `input`，无自由JSON透传。已发布正文不可原地改写。单条持久报告JSON（含input/provenance）UTF-8≤200KiB；详情投影同样受200KiB单版上限。摘要没有sections/input来源正文。

usage复用 [agentInvocationUsageSchema](../../packages/contracts/src/agent.ts#L75)：inputTokens/outputTokens/totalTokens非负整数，cacheWriteTokens/cacheReadTokens可缺省。cost复用 [调用费用](../../packages/contracts/src/agent.ts#L89)：input/output/total有限非负数，cacheWrite/cacheRead可选，currency按已有模型币种合同；strict，不换汇、不按当前价格重算历史。未得到费用不填零。

### InputProjection

strict对象只含：storyRevisionId、sources、omittedSourceCount。storyRevisionId为≤200字符ID；sources≤8；omittedSourceCount非负安全整数。每项包含 entryId、entryRevisionId、representationVersion、blockIds、includedCharacterCount、truncated、omitted、reason（受管标记，如unavailable/no_usable_block/budget；实际纳入时可空）。ID各≤200，blockIds去重、复用既有内容表示块数量上限≤5000，每ID≤200；includedCharacterCount单源≤12000、总计≤60000，标记为布尔值。

representationVersion通常为正安全整数；当omitted=true且来源/表示不可用时可为null，null是不可引用哨兵，不能伪造版本1。omitted=false必须版本为正整数、blockIds非空、includedCharacterCount>0；omitted=true时blockIds为空、字符0、reason必填，版本可为null（不可用）或正整数（预算省略/截断但版本已知）。evidence只允许引用实际纳入来源/块，omitted项永不可引用。

sources记录冻结候选的使用/省略统计，省略统计必须在发布、current、指定版本和按Run查询中完整往返。超出8个候选的来源只累计omittedSourceCount，不展开无界数组。此input不包含prompt、views、来源正文、原始payload或模型凭证；发布校验allowlist也不公开为任意授权句柄。

入队冻结prompt只含一次纳入正文，另存精简refs/allowlist（entryId/entryRevisionId/representationVersion/纳入blockIds），不冻结完整views；Worker不重读来源正文。规范化纯文本单源≤12k/总计≤60k/最多8来源，按顺序整块纳入；首块超剩余预算整源省略，单源超限按块边界truncated，不补位。入队不可用省略记录，0来源/0字失败。Kernel值阈值未验证，需实测快照体积，不能用Worker Admin maxInlineValueBytes代替执行门禁。

## 5. Section / Block / Evidence 严格合同

| 项目 | DTO形状与上限 |
| --- | --- |
| sections | ≤8；每节strict `{id, heading, kind, blocks, evidence}` |
| id / heading / kind | id宿主分配 `s{n}`；heading纯文本≤200字符；kind仅fact/opinion，opinion显示“Agent观点” |
| blocks | 全报告≤60（含嵌套）；仅paragraph/list/quote/code；quote/list嵌套≤2层 |
| evidence | 每节≤30；fact至少1条，opinion可0 |
| EvidenceRef | strict `{entryId, entryRevisionId, representationVersion, blockId?}`，ID各≤200、版本正安全整数，只允许实际纳入的冻结refs/块 |
| inline | 仅text/link/strong/emphasis/code；link仅http(s)，URL≤4096字符；复用既有inline每数组≤100及文本≤65536字符，仍受整条JSON上限 |
| 禁止字段/类型 | heading/image/audio/video/media/embed/table/原始HTML、source、warnings；嵌套也拒绝 |

模型输出不带section/block id，先用独立有界报告块输入预检；宿主按 `s{n}` 与该节深度优先 `s{n}-b{m}` 编号，再用现有contentBlockSchema加递归白名单验证。paragraph含inlines；list含ordered/items，item为inlines与可选blocks；quote含blocks；code含text与可选language，均按既有内容合同受限并加本期限制。不得把模型任意JSON当ContentBlockReader输入。编号后sections与input规范化进入hash，保证同Run重放稳定。

ContentBlockReader传assets=[]，无Markdown依赖、不加载图片、不执行代码。`finishReason=length`、结构/引用不合规或JSON超限为失败，不发布半成品、不替换旧版。

## 6. 安全错误与持久语义

公共错误envelope strict `{code, message, retryable}`；message为固定安全文案、不含原始异常，≤500字符。HTTP输入错误使用validation_failed，配置前置使用invalid_configuration，资源不存在not_found，冲突conflict，503使用dependency_unavailable；Run失败只投影 [ADR-0033](../adr/0033-story-agent-timeout-and-error-codes.md) 白名单 timeout/authentication_required/rate_limited/budget_exhausted/invalid_configuration/dependency_unavailable/malformed_payload，未知generation_failed。不可用来源与无模型的具体发生时机决定是前置400还是已入队failed，不暴露服务商原文。

同事务顺序：永久账本同键hash检查→全局WorkflowRun键占用检查→Artifact槽活动则409、终态/缺失CAS清槽→helper建envelope/queued事件→CAS占槽→账本；任一步失败全回滚，CAS败回滚新Run。事务外最多3次竞争尝试，50/150ms退避，耗尽503。P2002赢家重读在事务外；账本永久留存、无别名。

发布先按workflowRunId查既有Revision，同内容幂等返回、异内容409；不存在才校验lease fence、原Story归属与activeRunId，写max(revision)+1、清槽与事件同事务。提交前死亡全回滚，提交后发布优先成功。终态槽按读投影排除，由下一次入队核实后惰性CAS清除，不按时长释放。调用沿用maxAttempts=2，发布maxAttempts=1，不保证自动重试成功。

## 7. sourceStatus 与证据读取

sourceStatus只按实际纳入（omitted=false）的来源/块实时计算，不回写不可变正文；omitted统计不影响状态。所有纳入refs仍当前且可读为current；旧revision/representation可读但被取代为superseded；任一纳入的必要精确证据不可读为unavailable（优先），保留报告正文。

点击evidence打开只读“来源证据”抽屉，复用现有 `GET /revisions/:id/content?representationVersion=...`，用entryRevisionId+representationVersion读取、blockId定位，无blockId定位起点。StorySourceReader只负责最新版本；不新增历史API。缺来源/版本固定“该来源证据暂不可用，报告正文仍可阅读。”；缺块固定“该证据位置暂不可用，可阅读此版本来源内容。”；键盘与焦点可用，不阻塞报告。

## 8. Conformance 场景（目标，未运行）

| 场景 | 必须观察 |
| --- | --- |
| happy /再次发布 | host持久成功才completed，N+1与旧版不可变，模型/费用可回看 |
| 同键重放/终态重放 | 相同hash原Run、原快照，无新调用/费用/版本 |
| 同键异hash | 409，无新Run或数据副作用 |
| 活动不同键/并发 | 一请求创建Run、另一409，无账本别名；受控成功路径模型调用计数1，客户端GET活动generation |
| 跨kind同键 | 409，由全局WorkflowRun键保证，反向其它定义创建也不能绕过 |
| 无模型/无来源 | 前置安全失败或已入队failed，0来源/0字不调用、不发布，不泄露设置/内容 |
| 历史壳 | 旧报告可读/旧键恢复允许，新生成400；Restrict不级联删除 |
| timeout /取消 | timeout安全码，取消独立；不覆盖旧版、不公开失败调用费用 |
| length /malformed | length或块/引用/上限违规不发布半成品，固定错误 |
| 发布失败/崩溃 | fence/槽/CAS拒旧owner；提交前全回滚、提交后读取成功；幂等不重复事件 |
| 旧版/回滚 | 最大revision为current，≤50摘要；旧单版可读，回退前停入队排空/终止/清槽，旧Worker未知定义安全失败，再升级可读 |
| 证据不可用 | sourceStatus降级、抽屉固定文案，正文可读，精确版本不偷偷换新 |
| omitted/null与统计往返 | evidence引用omitted+null来源须受控malformed_payload，无Revision/事件、槽不变；omitted统计在发布/current/指定版本/按Run查询完整往返，且不影响sourceStatus |
| merge /split | 不迁移产物；生成中merge仍原Story发布，canonical/后继不聚合旧报告 |
| 输入体积/隐私 | 12k/60k、整块/omitted/truncated/首块省略正确；prompt正文单份，快照体积实测；日志/DTO无输入来源正文/Secret |

本Draft不替代实现规格或运行证据，完成状态由Task walkthrough与交付后的spec记录。
