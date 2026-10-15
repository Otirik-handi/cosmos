# Task 40 Walkthrough

## 历史检查点：Normalizer 阶段（已被后续实施记录替代）

协调者接收 workflow-5 后直接核查并修复了行内空白丢失、引用检索文本重复、深层强调文字丢失，以及链接/code 文本提取带入 script 内容的问题；图片说明的文本投影按来源位置排列，修正了错误的末尾排列测试。CanonicalOwner 为 Application Normalizer，PatchShape 为同一解析 owner 的文本投影修复，未新增消费方 fallback。TDD mode=off / decision=skipped。

最新验证：`bunx vitest run packages/application/src/content-normalizer.test.ts packages/application/src/workflow-ingest.test.ts`，2 文件/16 测试通过；`bun run --filter @cosmos/application typecheck` exit 0；`git diff --check` exit 0。旧 14 测试证据已由这次结果替代。所有测试为内存 fixture，无真实数据；没有活动写入子 Agent。

切片 2 尚未验收：HTML 列表仍需真正保留嵌套结构并以列表层数而非 DOM 深度计预算；structured 输入仍需执行文本/节点/字节预算和受控链接清理；输出块文本预算、未知容器内媒体顺序、音视频 source 子节点等需要行为回归。不得因当前聚焦测试通过就推进存储。下一步继续在 content-normalizer owner 完成这些合同，再由指定模型独立审查。存储/Query/阅读/Agent 均未实现，目标保持 active。

## 当前状态与本轮切片

编号由维护者分配为 40。生命周期：实施与整体验收进行中。输入/Normalizer、版本存储与重建、统一读取、阅读界面及候选决定已存在实现；图文原位、双来源切换和 saved 图片读取失败已取得隔离产品运行证据。生产 Agent 装配、完整分层验收和独立审查仍需闭合，不能以早期 Normalizer 检查点表示当前状态。

当前目标：按批准范围建立剩余验收清单并持续修复/验证，同步当前记录。维护者已授权本会话 goal（max_goal_rounds=16），取代前几轮 goal 关闭和单环节限制；旧会话 goal 不恢复。leader 唯一维护 walkthrough；子 Agent 使用已核实可用的 workflow 显式 jijiapi/gpt-6-luna 路由，最多 3 个并发，写集合隔离。真实外部调用/凭据/费用缺授权时保留必需项未完成；不操作 Git 生命周期或用户真实数据。历史过程保留在下方记录中。

## 设计依据与决定

依据：[目标设计](../../../docs/aegis/specs/2026-10-08-story-content-representation-design.md)、[架构](../../../docs/aegis/specs/2026-10-08-story-content-representation-architecture.md)。完整目标、架构与八项技术决定已确认；长期合同未冻结部分先进入切片 0。

目标：新采集正文保留图文顺序、安全可读；Web 与 Agent 共用版本化内容投影；旧数据继续可读；候选接受前不改正式事实。

技术栈沿用 Bun/TypeScript、NestJS、Prisma/SQLite、React/Next.js、Zod。RSS 外层保留现有 XML 解析，正文 HTML 采用 parse5；已批准并安装该依赖。

Change Necessity：contentText + assets 无法表示原位媒体和表示版本，单改样式不足。最小实现边界包括来源输入、Normalizer、持久子资源、Query、阅读器及候选流程。各消费方共用 Query，不新增媒体顺序表、Connector 专有阅读模型或 Web 私有解析器。

兼容：旧 contentText/Asset/Story DTO 保留，新字段 additive 增加；旧库不批量重解析。来源身份去重不使用清洗 blocks。当前来源指纹主要覆盖文本（从代码核查得出）：须验证图片替换/顺序变化生成来源修订，而解析器升级/媒体下载状态变化不生成来源修订。representation fingerprint 不替代 source fingerprint。

TDD Route：mode=off，decision=skipped；authority=此前技能路由基线。不要求先写失败测试，仍需合同、修订、权限、迁移与候选接受行为测试，每切片运行相应回归。

Plan Pressure Test：先冻结正文/节点/块/表格预算、raw retention、质量排序、重建入口、profile 路由、接受命令，并审查媒体绑定及 Blob/DB 恢复，禁止暗设长期行为。

Task 05/10/36/38 仅覆盖局部，故建立 40 作为跨模块主 Task。保留工作区 pi-ai 未提交改动。按依赖 inline 执行；公共 DTO、Prisma migration、Task 记录各一个写入者。拟新增模块先检查现有 owner。

## 实施计划

### 0. 冻结实施合同

Owner：Domain/Contracts/Application/Storage，以及 requirements/architecture/ADR。

先同步稳定文档，冻结预算、来源指纹、媒体绑定、版本格式、Query DTO 与候选接受。Observation 唯一拥有原文；current 指针为选择元数据。合同逐项审查完成才进入业务代码。

### 1. 输入与公共内容合同

文件：`packages/domain/src/content.ts`、拟新增 `packages/domain/src/content-representation.ts`；`packages/contracts/src/entry-relation.ts`、拟新增 `packages/contracts/src/content-representation.ts`，两包入口。

新增 ContentSource、strict block union、EvidenceRef、状态与 scope；旧 Connector 保留 contentText 入口；新 DTO 不泄漏内部字段。验证 Domain/Contracts 聚焦测试、旧 DTO 解码、未知块降级，以及 `typecheck:domain`、`typecheck:contracts`。

### 2. Normalizer

文件：拟新增 `packages/application/src/content-normalizer.ts` 与按格式拆分辅助模块，`packages/application/package.json`。

parse5 按节点顺序转换；三格式生成 blocks/contentText；危险结构清理、超限 partial、局部失败保留其余顺序，不联网。验证纯文本、嵌套列表≤3、表格、错误 HTML、危险链接、图文顺序、超限、同输入确定性，以及 `typecheck:application`。

### 3. 持久化与选择

文件：`packages/storage-prisma/prisma/schema.prisma`、新增 migration、repository port 与 Storage repository、Application RepresentationPolicy。

实现表示子资源、同属 current 指针、唯一版本、人工锁、审计与回退；来源事实不可变。隔离 SQLite 验证旧库迁移无回填、并发版本/指针、归属拒绝、旧证据可读、图片/顺序修订，以及 `db:validate`、`typecheck:storage`。

### 4. 采集闭环

文件：`plugins/rss/src/index.ts`；`packages/application/src/ingestion-service.ts`、`packages/application/src/workflow-ingest.ts`、`packages/application/src/media-acquirer.ts`；Storage ingest owner 与 Blob ports。

RSS 保留正文输入，文本来源走纯文本适配；媒体候选确定绑定 Asset；复用媒体策略与 lease；Blob 暂存/DB绑定可恢复。验证 RSS/Atom、只图片、轮询、解析失败不丢 Entry、媒体失败原位降级、取消/重试/中断恢复，不使用用户数据。

### 5. 统一读取

文件：Application 拟新增 content-query/content-access-policy；`apps/api/src/app.controller.ts`；`packages/transport-http/src/client-content.ts`、`packages/transport-http/src/client-story.ts`。

Web/Agent 共用 Query；current 与历史版本可读；legacy HTML 安全文本；解析状态与 evidence availability 分开；无内部 Blob key。验证 API/Transport 兼容、历史引用、范围拒绝、敏感证据、原文清理后可读，以及 `typecheck:transport`、`typecheck:apps`。

### 6. Story 阅读

文件：`apps/web/src/components/cosmos/story-reading-content.tsx`、新增统一块阅读器；`apps/web/src/app/(reading)/stories/[id]/story-reading.tsx`。

媒体原位、来源标签/切换、多来源不拼接；媒体元数据/失败原因和 partial/legacy/empty 可见；Story 语义显著。Component Lab 与隔离浏览器验证混排、来源切换、空正文、失败媒体、键盘链接、安全 HTML；完整产品遵守 ADR-0029 的 1024/1440 阅读门禁，768 验证过窄提示（组件独立窄屏不代表完整产品支持）。

### 7. Agent 与接受闭环

文件：`packages/contracts/src/agent.ts`；Application invocation/action 注册 owner、新 Story action handlers、正式 Story/relation 命令与 Web 候选面。

agent.invoke@1 下三 action：`story.summarize`、`story.extract-relations`、`story.review-content-quality`（以已接受目标设计 §3.8 为准；此前任务草案的概括标签不是公共 action 名）。默认 Story scope，来源 scope 显式申请；候选绑定版本；接受经正式命令与审计；输入变化不静默套用。

Fake Adapter 验证版本绑定、partial、旧表示、证据拒绝；接受前零正式事实写入；接受/拒绝/重复接受和用户锁保护。真实 Adapter 单独报告。

### 8. 交付与收口

文件：`docs/spec/`、`PROJECT-STATUS.md`、本 walkthrough。事实文档只记录已实现能力；报告风险、未运行项、后置范围；演示 RSS 图文阅读与候选接受全过程。聚焦、全量、类型、隔离浏览器分别验证；真实来源与真实 Agent 独立报告，Fake 不替代真实验收。

## 验证计划与退役

各切片在实施时登记准确新增测试路径，复用 entry-contract、repository-ingest、public-projection、story-domain、client-content/client-story、RSS index 回归。

计划命令（尚未运行业务检查）：

```powershell
bun run db:validate
bun run typecheck
bun run test
bun run test:e2e
bun run test:browser:component-lab
bun run test:browser
bun run docs:check
git diff --check
```

聚焦命令为 `bunx vitest run <切片测试路径>`。数据库、Blob、临时根、browser fixture 遵循测试规范隔离；不迁移或删除真实数据。真实 RSS/Agent 需明确网络、来源和 Adapter 配置，缺失则报告未运行。

完成证据覆盖图文原位、可解释降级、历史引用、Agent scope 拒绝、接受前不写正式事实、接受后审计可查；文档检查不替代实现验证。

Retirement Track：新数据 blocks 路径替代文本/媒体分开展示；旧 contentText 与 legacy fallback 为兼容保留，只经独立退役决定删除；旧数据不伪造顺序。未知块降级由统一 Query/reader 承担。

## 启动历史

实施前至首个合同切片的原始记录见 [启动历史分册](walkthrough/history-startup.md)。

API 草案已新增 `docs/api/0008-story-content-representation.md` 并加入索引，标为 Draft，覆盖首个消费者、版本/错误/范围/接受约束和 conformance 场景；尚未冻结 HTTP 端点，不宣称已上线。`bun run docs:check` exit 0，980 文件无失败（pwsh-20）。

协调者检查 `packages/storage-prisma/src/repository/helpers-4.ts:24` 的指纹调用与 `packages/storage-prisma/src/repository/helpers-4.ts:343` 的 Asset 写入：原始 payload 与资产字节目前由 Storage 在事务前写 Blob，Asset ID 在事务内生成。后续 Application 暂存编排与确定性媒体绑定必须显式适配此边界；Normalizer draft 不能预填不存在的 Asset ID，不应通过两套媒体顺序掩盖绑定问题。

首次失败合同审查与修正分派记录见 [合同审查历史](walkthrough/history-contract-review.md)。

### 公共合同修正、审查与 Normalizer 启动

workflow-3 返回 null，无可用修正报告；协调者接管 Domain/Contracts，修正上述结构偏差与递归类型。公共入口快照通过 `bun run scripts/entry-export-surface.ts packages/domain/src/index.ts --out packages/domain/entry-surface.txt` 同步新增导出；此前入口回归失败原因是冻结快照未更新，并非业务行为通过。

workflow-4 以 jijiapi/gpt-6-luna 完成只读独立合同审查：严格 12 类块、来源媒体/持久媒体分离、递归护栏符合；提出 blockId 必填与总字节预算两项意见。对照已接受目标设计 §3.3，blockId 明确可选，省略表示整个版本，因此不改为必填；补充具体块与空 ID 测试并澄清设计。输入 maxBytes 由 Normalizer 执行截断/partial，schema 不直接拒绝大文本以免阻断采集；补充大文本输入测试和 owner 注释。递归结构复杂度仍由 schema 先行保护，Normalizer 不得把结构校验拒绝变成整条采集丢失。

新鲜验证：`bunx vitest run packages/contracts/src packages/domain/src`，17 文件/120 测试通过；`bun run --filter @cosmos/domain typecheck`、`bun run --filter @cosmos/contracts typecheck` 均 exit 0（补充测试前运行）；`git diff --check` 当时通过。尚未运行 Normalizer、存储、浏览器、真实 RSS 与真实 Agent 验收，不代表 Task 40 完成。

当前切片 2：三格式 Normalizer，TDD off/skipped。批准 parse5 依赖；协调者负责依赖清单/锁文件与任务记录，A 子 Agent 仅写新增 `packages/application/src/content-normalizer*.ts`，不改公共 DTO、Prisma、入口、Git、其它文件，不递归委派。沿用启动快照与现有工作区，测试为纯内存、无数据库/真实数据。draft 使用 StructuredSourceBlock（尚未绑定 Asset），最终持久块在采集事务绑定 assetId 后生成，不能虚构资产 ID。验收为顺序、安全、不联网、预算 partial、确定性和旧文本适配；依赖安装和子报告均不替代协调者回归。

### Normalizer 协调者修正与接线前验证

workflow-5 完成初版后，协调者修复容器内媒体被吞、嵌套格式/引用文本重复、列表层级与容器深度混淆、audio/video source 子节点、可执行文本清洗和超限 inline 输出不符合合同等问题。HTML 段落/标题在输出边界统一限制 inline 数量与文本长度；新增输出通过 StructuredSourceBlock schema 的行为测试。工作流 source.fetch 响应先以 JsonValue 接收，再由 sourceFetchOutputSchema 校验，解决 readonly ContentSource 与工作流 JSON 泛型不兼容，未使用 any。补齐 Contracts 显式入口导出，并重新生成入口快照（531 exports）。

新鲜验证：`bunx vitest run packages/contracts/src packages/domain/src packages/application/src/content-normalizer.test.ts packages/application/src/workflow-ingest.test.ts`：19 文件、143 测试通过；`bun run --filter @cosmos/application typecheck`、`bun run --filter @cosmos/contracts typecheck` exit 0；`git diff --check` exit 0。测试为纯内存，不访问用户数据。该结果仅覆盖合同/Normalizer/工作流传递，存储原子绑定、读取、浏览器和真实来源/Agent 均未验收。

下一步切片 3/4：在既有 repository port 接入 Application 规范化 draft，持久化 ContentRepresentation 与 current 指针；媒体 sourceUrl 映射实际 Asset ID；来源指纹计入声明正文顺序但排除 parser/下载状态；Blob 暂存编排遵守已接受架构。尚未执行用户数据迁移。

### 来源指纹与媒体绑定准备

Domain `fingerprintEntryRevision` 保留未声明 contentSource 时的旧指纹；声明正文使用稳定对象序列化，正文媒体或顺序变化影响来源修订，parser 与下载状态不进入来源指纹。Storage 写入与下载前 `listContentUnchangedItems` 使用同一输入。新增 Domain 3 个行为测试与隔离 Storage 回归：相同文本但图片顺序变化产生第二修订，再采集同样正文不产生第三修订。

Application 新增 `content-binding.ts`，递归绑定 quote/list 内媒体到调用方提供的实际 Asset ID，生成表示版本内确定、唯一块 ID；缺失或类型不匹配的绑定拒绝，不伪造 Asset ID。该 helper 尚未接入持久化事务或公共入口。

新鲜验证：`bunx vitest run packages/domain/src/content-fingerprint.test.ts` 3 测试通过；`bunx vitest run packages/storage-prisma/src/repository-ingest.test.ts` 4 测试通过（隔离数据库/Blob 根）；`bunx vitest run packages/application/src/content-binding.test.ts packages/domain/src/content-fingerprint.test.ts` 5 测试通过；Domain、Storage、Application 包 typecheck exit 0；`git diff --check` exit 0。未完成表示 schema/migration、Application 采集准备、Blob owner 迁移、current 指针/人工锁/回退、Query/Web/Agent 验收。本次无子Agent、无 Git 生命周期操作、无用户数据迁移。

### 采集准备与初始表示原子落库

Application `prepareContentItem` 统一生成规范化文本和 draft，递归发现正文媒体并保留已有媒体状态；直接采集与 workflow ingest 已传递 draft。来源指纹在声明 contentSource 时排除 parser 派生的 contentText。Storage 同一事务保存 Observation 证据引用、EntryRevision、实际 Asset 记录、版本 1 的 ContentRepresentation 与 current 指针；块绑定使用该事务实际 Asset ID。parserVersion 由 Normalizer 提供。新增 migration 仅增加本任务表/字段/索引，不回填历史数据；未迁移用户数据库。

新鲜验证：`bunx vitest run packages/storage-prisma/src/repository-ingest.test.ts` 4 测试通过，包含正文块顺序、实际媒体归属、证据 Observation 与 current 指针断言；`bun run --filter @cosmos/storage-prisma typecheck`、`git diff --check` exit 0（pwsh-75）。此前 Application draft 传递聚焦测试和类型检查已通过。

新增 Application `representation-policy.ts`，实现状态优先、同状态显式系统推荐、人工锁保护、归属检查及不可用回退目标拒绝。质量信号算法仍不自行冻结；策略接受上游推荐决定，不按版本号推断质量。`bunx vitest run packages/application/src/representation-policy.test.ts` 3 测试通过；Application typecheck 与 diff check exit 0（pwsh-76）。该策略尚未接线到更新命令；不能宣称人工锁/回退闭环已完成。

当前切片 3/4 尚余：新版本与选择命令的原子约束/审计/并发验证、Application Blob 暂存 owner、RSS ContentSource 输入。Query/Web/Agent 与真实来源验收未实现或未运行。下一步连接表示选择与版本命令，保留全部旧表示。TDD Mode off / Decision skipped；复用本 Task 作为唯一 checkpoint。

### 统一读取与 Story 阅读检查点

后续已完成 RSS/Atom 正文声明、Application Blob 暂存与初始表示接线；表示选择 helper 已验证归属、人工锁、过期指针与审计，但重新解析/人工锁/回退的公共命令仍待接通。统一 ContentQuery 通过主机授予的读取范围检查后返回当前或精确历史表示；缺失历史不退回当前，旧 HTML 走安全文本，无原始 payload 或内部 Blob key。API 与 HTTP 客户端已接入 `GET revisions/:revisionId/content`，拒绝不合法版本和请求方扩大权限。

Web 已使用顺序块阅读器与有标签的来源切换，支持媒体原位、partial、legacy、不可用、加载、重试和空来源；旧的末尾媒体堆叠已移除。两个公共组件已注册 Component Lab。静态渲染行为验证与组件注册验证已运行；API/Transport 聚焦测试 3 文件/9 测试通过，API/Transport/Storage 类型检查通过，Web 类型检查通过。

新鲜浏览器命令：`bunx playwright test --config playwright.component-lab.config.ts e2e/component-lab/content-readers.spec.ts`。首次 4 个用例因合成来源 `webUrl: null` 与原文链接断言不匹配而失败；补齐本场景合成 HTTPS 地址后重跑，5 用例通过（pwsh-99，exit 0）。覆盖 320/768/1024/1440 正文块顺序、来源键盘切换、原文安全链接、控制台/网络错误，以及 partial/legacy/unavailable/loading/error/empty 状态。该证据仅来自隔离 Component Lab，不替代真实 RSS、真实 Agent 或全量回归。

下一步：表示版本与人工选择命令，之后 Agent 候选与人工接受闭环。Task40 仍 active，未完成；未迁移用户数据库，未提交或创建 Git 分支。TDD Mode off / Decision skipped。

### 候选持久化、人工决定与接口检查点

已接通表示锁定、解锁和回退公共命令，校验预期当前指针与锁状态，并保留审计。Story Agent 三类只读建议绑定 StoryRevision 和精确内容表示版本；候选保存在独立表中。人工接受摘要和 Entry 关系复用正式事务写入者，候选状态与审计一起提交；输入过期、重复决定或关系中途失败不会留下部分正式写入。质量检查候选当前可查看、拒绝，尚无正式写入命令，接受时明确返回 unsupported；不把检查意见直接写为事实。

已接通候选列表和接受／拒绝的 API、DI 与 HTTP 客户端。操作者及管理权限由主机提供，请求不能伪造。候选错误使用 Application 类型，缺失返回 404，已决定／输入过期返回 409；未知存储错误继续传播。新增公开导出已更新入口快照。TaskStartSnapshot：主工作区 D:\Otirik\Workstation\cosmos，master，HEAD f66c33135351af38460fff73d311863dc7b4ef47，唯一 worktree；保留 Task39 与 Task40 既有 dirty 状态，无 Git 生命周期操作。

新鲜验证（pwsh-128，exit 0）：`bun run scripts/entry-export-surface.ts packages/application/src/index.ts --out packages/application/entry-surface.txt`；`bun run scripts/entry-export-surface.ts packages/contracts/src/index.ts --out packages/contracts/entry-surface.txt`；`bunx vitest run apps/api/src/app.controller.structured-content.test.ts packages/transport-http/src/client-content.test.ts packages/application/src/story-agent-candidates.test.ts packages/storage-prisma/src/story-agent-candidates.test.ts packages/application/src/entry-contract.test.ts packages/contracts/src/entry-contract.test.ts`，6 文件／20 测试通过。覆盖隔离数据库候选保存无正式写入、原子接受、过期与重复拒绝、多关系失败回滚，以及请求权限与路径编码。`bunx tsc -p apps/api/tsconfig.json --noEmit` 和 `bunx tsc -p packages/transport-http/tsconfig.json --noEmit`（pwsh-129）通过。

仍待完成：Agent 生成入口与 Web 候选界面、声明输入保留和版本重建、全量回归及文档验收。真实来源与真实 Agent 验收未运行，本检查点不能替代它们。Task40 仍 active；TDD Mode off / Decision skipped。

### 生成界面、声明输入与版本重建检查点

Agent 生成 Application 服务、严格 API/HTTP 请求合同及 Web 候选界面已接入。默认只读取 Story 摘要；明确选择正文后绑定实际读取的表示版本。未保存编辑阻止接受，接受后刷新 Story；质量检查意见仍仅可查看或拒绝。生产主机尚未配置 Agent profile/resolver，不隐式使用 Fake：生成入口明确返回未配置 409。真实 Agent 验收仍未运行。

新鲜界面证据：`bunx playwright test --config playwright.component-lab.config.ts e2e/component-lab/story-agent-candidates.spec.ts`（pwsh-136，exit 0），4 用例通过，覆盖 320/768/1024/1440、键盘生成、脚本文字转义、未保存编辑保护、接受刷新、拒绝及控制台／网络错误。组件注册 12 测试与 Web 类型检查通过（pwsh-135）。均为隔离合成场景。

Observation 现在通过独立内容寻址 Blob 引用保留 Connector 声明的解析输入，原始 payload 仍独立保留。新增迁移只增加字段，不回填旧数据。重建使用该输入创建新的 ContentRepresentation，不创建来源修订；复用已有 Asset 绑定，校验预期指针与锁状态，人工锁阻止自动提升，保留历史与审计。旧记录缺少声明输入时明确不可重建。

重建 API/HTTP 聚焦验证：`bunx vitest run apps/api/src/app.controller.structured-content.test.ts packages/transport-http/src/client-content.test.ts packages/application/src/content-rebuild.test.ts packages/storage-prisma/src/entry-contract.test.ts packages/contracts/src/entry-contract.test.ts`（pwsh-142，exit 0），5 文件／19 测试通过；随后 `bunx tsc -p apps/api/tsconfig.json --noEmit` 与 `bunx tsc -p packages/transport-http/tsconfig.json --noEmit` 通过。

收口审查发现摘要候选接受可能清空原有时间范围：候选不拥有该字段，因此在候选到正式命令的边界保留当前时间范围，未改变正式编辑的字段清除语义。该回归验证正在运行（pwsh-143），尚不宣称通过。下一步继续跨模块审查、完整回归与规范同步；Task40 仍 active。

### 最终回归检查点（仍待产品验收）

- `bunx vitest run packages/storage-prisma/src/story-agent-candidates.test.ts packages/storage-prisma/src/story-representation.test.ts` 与 Storage 类型检查通过（pwsh-143，2 文件 5 用例）：摘要候选保留原有时间范围，正式编辑的字段清除语义不变。
- `bunx vitest run apps/api/src/app.controller.route-table.test.ts apps/api/src/app.controller.structured-content.test.ts` 通过（pwsh-153，2 文件 11 用例）。G03 历史路由基线保持不变，测试明确追加 Task40 的六个公开接口。
- `bunx vitest run --reporter=dot` 全仓通过（pwsh-153，157 文件 892 用例，退出码 0）。此前失败的公开导出快照、文案治理与新增路由合同已在各自归属处修复。
- `bunx playwright test --config playwright.component-lab.config.ts e2e/component-lab/content-readers.spec.ts e2e/component-lab/story-agent-candidates.spec.ts` 通过（pwsh-150，9 用例）；覆盖四个宽度、内容顺序、安全链接、降级状态、候选生成及人工接受／拒绝。这是隔离实验室证据。
- `bun run build:api` 与 `bun run build:worker` 通过（pwsh-151）；API/Transport/Storage 与 Web 类型检查在对应切片通过。构建不代表部署。
- 当前公开合同同步到内容表示 API、规范化内容规格与 PROJECT-STATUS。质量审查候选可查看／拒绝，接受明确不支持；生产 Agent profile/resolver 尚未装配，生成入口返回 409，未用 Fake 冒充生产能力。
- 未覆盖：真实来源、真实 Agent、完整产品运行时浏览器验收及用户既有数据升级。未迁移用户数据，未提交、推送或部署；Task40 保持 active，不将测试通过等同于全部验收完成。

### 真实来源与治理补充

- `$env:COSMOS_REAL_RSS_URL = 'https://www.nasa.gov/feed/'; bun run scripts/e2e/real-source.ts rss` 通过（pwsh-156，exit 0），隔离运行 `run_2a6f3743-67ce-4f7b-970d-22a9005c8d38`，有界采集 10 条。此证据更新上条“真实来源未覆盖”，不代表完整产品浏览器或真实 Agent 验收。
- `bun run typecheck` 全仓通过（pwsh-146）；`bun run lint:web` 与 `git diff --check` 通过（pwsh-147，19 warning、0 error）。
- 文档大小检查发现本记录及 PROJECT-STATUS 超出健康区：启动历史与 Task36 已完成历史移入各自主文档同名目录，当前计划、状态与有效决定保留。文档大小复查通过（pwsh-159，含既有基线 warning）。
- 代码大小检查还发现 `workflow-ingest.ts` 超过字节警戒线，将 BlobRef 转换原样提取到 `workflow-blob-ref.ts`，公开导出不变。`bunx vitest run packages/application/src/workflow-ingest.test.ts packages/application/src/workflow-host-runtime.test.ts` 通过（pwsh-161，2 文件 27 测试），随后 Application 类型检查、`bun run docs:check`（1035 文件）与 `git diff --check` 通过。
- 尚有独立既有治理问题：未修改的 `packages/application/src/workflow-host-runtime.test.ts` 被大小检查报告红线；未修改基线或以豁免掩盖，不能宣称全仓大小门禁通过。生产 Agent 装配、真实 Agent、完整产品运行时浏览器与用户既有数据库升级仍未验证；Task40 保持 active。

### 本轮恢复与隔离产品图文阅读验收

- 维护者本轮要求恢复当前仓库状态、执行一个授权内的验收环节后结束；不恢复旧会话、不创建或恢复自动续跑 goal。当前工作区为 master，保留已有大量未提交改动。本轮未创建分支/worktree，未 commit、push、部署或操作真实用户数据；无子 Agent。
- 记录冲突：Task 索引仍写未开始业务实现，本记录开头仍处于 Normalizer 阶段；后续检查点与当前代码已经包含持久化、统一读取、阅读和候选接口。这些开头记录不能作为当前未实现清单。历史测试与真实来源报告只作为恢复线索，本轮不重复宣称其通过。
- 当前新证据确认：本地受控 RSS 经真实 API、Worker、隔离数据库及 Blob 存储进入生产构建 Web，Story 来源正文保留段落→图片顺序，图片走站内 API 且 naturalWidth > 0；阻断非 localhost 网络并刷新后仍可解码，自动化页仍可打开。1024/1440 px 阅读区可见且页面无横向溢出，768 px 显示窗口过窄提示。
- 验收计划冲突：切片 6 的 768 px 阅读门禁与 ADR-0029 决策 6 的 1024 px 支持下限不一致。本轮沿用已批准 ADR：768 px 验证提示，不修改产品布局。Component Lab 的窄屏组件证据不能替代完整产品支持范围。
- 本轮仅修改 `e2e/browser/offline.spec.ts`：旧媒体分区定位改为来源正文，补充有序块与宽度边界断言。首轮旧用例失败（pwsh-3，exit 1，媒体分区元素不存在）；第二轮在 768 px 期待正文可见而失败（pwsh-5，exit 1，页面显示窗口过窄）。均核对失败页面后调整验收合同，未修改业务代码或增加 fallback。
- 新鲜命令：`bun run build:api; if ($LASTEXITCODE -eq 0) { bun run build:worker }`（pwsh-4，exit 0）；随后 `bunx playwright test --config playwright.config.ts e2e/browser/offline.spec.ts`（pwsh-6，exit 0，1 passed，25.0s），栈内再次构建 Web，Next.js 16.3.0。使用现有隔离栈脚本创建临时数据根并仅迁移隔离数据库。
- 已有实现但本轮未运行验证：精确表示版本读取、重建/选择、候选列表与接受/拒绝、音视频与失败媒体、多来源切换、安全 HTML、键盘与完整视觉验收。生产 Story Agent 装配从当前 API 接线检索未见配置；未配置时返回 409 是代码证据，本轮未验证该运行响应，真实 Agent 仍未验收。全仓测试、独立全仓类型检查、真实来源和既有数据库升级本轮未运行。
- 记录校验：`bun run docs:check`（pwsh-7，exit 0，1037 文件、0 failures）与 `git diff --check` 通过。当前 HEAD 为 `f66c33135351af38460fff73d311863dc7b4ef47`，master；工作区保留未提交改动，未暂存。本轮未增加业务逻辑或新的责任 owner。
- 本轮完成的是隔离完整产品栈的图文阅读环节，信心 B；不能标记 Task40 完成。下一步优先补完整产品多来源/失败媒体与候选交互验收；生产 Agent 配置及真实 Agent 验收需各自明确配置和隔离数据边界。

### 多来源切换与失败媒体交互验收

- 本轮仅验证完整产品的多来源正文/媒体归属、失败媒体提示和操作、切换与刷新后无旧内容残留。允许新增验收用例并追加本记录，业务缺陷只报告，不修改业务代码；goal 保持关闭。
- 沿用已批准设计 §3.6/3.7：来源不拼接正文，failed/skipped 显示真实原因及原文媒体链接。刷新未约定保留手动选择，按产品当前明确标注的确定性默认来源检查一致性，不新增持久化预期。隔离数据库/媒体根由现有 browser stack 管理；用例内本地 HTTP 来源提供可下载图片和固定 404 图片，未使用真实来源或用户数据。无子 Agent。
- 新增 `e2e/browser/source-media-interactions.spec.ts`：真实 RSS/API/Worker 采集两个来源，经产品归并形成双成员 Story；验证 A→B→A→B 的正文前后段、媒体状态、来源原文链接均对应选中来源且不残留另一来源正文/媒体。A 的站内图片可解码；B 的 failed 媒体显示保存失败、404 原因及尝试次数，提供指向受控媒体 URL 的安全外链（新窗口，可键盘聚焦），不显示空白播放器。来源选择器键盘切换及焦点通过；两次刷新均恢复同一明确标注的默认来源，并核对内容归属。1024/1440 px 无页面横向溢出；console error、pageerror、requestfailed 收集为空（404 由 Worker 下载发生，不是浏览器请求）。
- 新鲜命令：`bun run build:api; if ($LASTEXITCODE -eq 0) { bun run build:worker }; if ($LASTEXITCODE -eq 0) { bunx playwright test --config playwright.config.ts e2e/browser/source-media-interactions.spec.ts }`（pwsh-11）。API/Worker 构建通过；首轮浏览器 exit 1，已通过切换与 failed 媒体验证，停在用例误写“默认来源”的文字断言，实际页面是“默认按来源标识顺序选取，可切换”。核对当前 copy 和失败输出后仅修正用例文字，未调整行为要求或业务代码。
- 修正后命令：`bunx playwright test --config playwright.config.ts e2e/browser/source-media-interactions.spec.ts`（pwsh-12，exit 0，1 passed，17.5s，用例 7.6s），栈内重新构建生产 Web（Next.js 16.3.0）并使用新的隔离数据库/媒体根。
- 通过范围是双来源切换、采集下载失败的媒体降级、刷新一致性；信心 B。没有发现该覆盖范围内的产品失败。未验证：saved 媒体字节在浏览器端后来不可用、asset-missing、skipped/metadata_only、慢响应竞态、三来源以上、所有 Story kind 的默认规则、外链目标页面、人工视觉评审、全仓回归/独立类型检查。生产 Agent、真实 Agent/来源、真实用户数据和旧库升级不在本轮范围；不扩大本轮通过声明为 Task40 完成。下一步宜单独补 saved 字节不可用与 asset-missing 的恢复体验验收。
- 本轮仅新增上述验收用例并追加本记录；沿用 master/HEAD `f66c33135351af38460fff73d311863dc7b4ef47`，既有 dirty 工作区保留，未暂存或提交，不创建分支/worktree、不推送或部署，goal 保持关闭。
- 补充失败路径后修正本轮整体判断：上述 pwsh-12 的 B 级通过只覆盖采集阶段 failed 状态，不能代表所有媒体加载失败交互通过。用例追加站内 Asset 字节返回 404 的受控网络故障，保留真实来源数据与真实 Product API 响应，仅在浏览器拦截媒体字节请求。`bunx playwright test --config playwright.config.ts e2e/browser/source-media-interactions.spec.ts`（pwsh-13，exit 1，1 failed，18.4s）再次通过前述切换、下载失败降级和刷新检查，随后确认 saved 图片 `complete === true && naturalWidth === 0`，失败于页面缺少媒体不可用/失败说明。
- 记录校验：`bun run docs:check`（pwsh-14，exit 0，1038 文件、0 failures）和 `git diff --check` 通过；本轮 Markdown 追加段落/代码围栏人工检查通过。未运行全仓测试或独立全仓类型检查。
- 产品缺陷实际行为：正文前后段仍可读，DOM 保留 saved 图片元素但未解码，无媒体失败提示或媒体原文外链；页面只剩文章原文链接。预期：按设计 §3.6 的可解释降级原则，读取已保存媒体失败也应显示可理解状态并提供安全的原文媒体入口，不让不可用图片无解释留在正文。设计未要求媒体重试按钮，本轮不额外引入该预期。`apps/web/src/components/cosmos/content-block-reader.tsx:33-37` 只按 Asset saved 状态输出 img，无加载错误处理，是与运行证据一致的代码定位；业务修复尚未授权，本轮只报告并保留红色验收。
- 证据：`test-results/source-media-interactions--cd24e-failed-media-across-refresh/error-context.md:30-44` 的 DOM 记录显示来源 A、正文与图片、文章链接，缺少媒体提示/链接；同目录 trace.zip、test-failed-1.png 为失败产物。当前模型不支持图像输入，截图未成功查看，未将其算作人工视觉证据。该验收记录的总体信心 C（部分通过、明确失败），Task40 保持 active。下一步先获业务修复授权，再在统一媒体阅读边界补加载失败说明/安全链接并重跑现有红色用例；asset-missing、慢响应竞态等仍未验证。

### 已保存图片读取失败修复与验收

- 维护者授权修复并多 Agent 验收；goal 保持关闭。恢复并核对上一轮红色用例、当前实现及批准设计 §3.6。修复边界为统一内容块阅读器的浏览器加载状态，不改 Asset 持久状态、API/合同/数据，不新增重试产品要求。Decision: code-change；已有红色运行证据证明缺少本地加载错误处理，文档或配置调整不能解决。没有需要退役的协议或旧存储路径。
- 主 Agent 拥有本记录及最终验证；实现子 Agent 负责 `apps/web/src/components/cosmos/content-block-reader.tsx`、`apps/web/src/copy/areas/reading.ts` 和 `e2e/browser/source-media-interactions.spec.ts`，独立审查子 Agent 只读。二者沿用当前仓库 master、HEAD `f66c33135351af38460fff73d311863dc7b4ef47`，既有 dirty 状态保留，不创建 worktree/分支或提交。工具无法指定 `jijiapi/gpt-6-luna`，已明确报告限制。实现子 Agent 调用返回失败但留下修复产物；其完成/验证声明不算最终证据，由主 Agent重新读取产物并运行验证。
- 独立审查先发现并定位了 P2 边界：内容块合法地可以只含 `assetId`，原文 URL 可能只在 Asset 上；修复后改为 `safeContentUrl(block.data.sourceUrl) ?? safeContentUrl(asset.sourceUrl)`。复审确认两个候选分别安全过滤，无 P0/P1/P2 阻断；来源切换通过 revision/asset key 重建状态，不写回 Asset。工具无法指定要求的模型路由，本轮审查未使用 `jijiapi/gpt-6-luna`。
- 修复行为：saved 图片加载触发 `onError` 后隐藏坏图，显示“图片加载失败，正文仍可继续阅读。”，并以 block URL 优先、Asset URL 回退的安全外链保留恢复入口；不增加重试按钮，不把浏览器读取失败伪装成采集 failed 状态。更新文案位于 `apps/web/src/copy/areas/reading.ts:10-13`。
- 最新验证命令：`bunx vitest run apps/web/src/components/cosmos/content-block-reader.test.ts; if ($LASTEXITCODE -eq 0) { bunx playwright test --config playwright.config.ts e2e/browser/source-media-interactions.spec.ts }; if ($LASTEXITCODE -eq 0) { bun run docs:check; if ($LASTEXITCODE -eq 0) { git diff --check } }`（pwsh-24，exit 0）。组件测试 5 tests passed；生产构建期间的完整产品隔离浏览器验收 1 passed（22.8s）：覆盖双来源切换、采集 404、saved 图片站内读取 404、正文不残留、提示/外链/焦点/无重试按钮、Asset 仍为 saved、切换后正常图片恢复、1024/1440 无横向溢出；docs:check 1038 文件 0 failures，git diff --check 通过。
- 本轮修复与验收通过范围信心 B：原红色 saved 媒体读取失败已闭合，来源切换和采集失败回归仍绿。未验证：缺失 Asset 时按 `asset-missing` 保留媒体原文入口（当前仍只显示通用“媒体暂不可用”）、skipped/metadata_only、慢响应竞态、三来源以上、所有 Story kind 默认规则、外链目标页面、人工视觉评审、全仓回归/独立全仓类型检查、生产 Agent/真实 Agent/真实来源/旧库升级。Task40 仍 active，不能扩展为整体完成。
- 本轮更新了 `apps/web/src/components/cosmos/content-block-reader.tsx`、`apps/web/src/copy/areas/reading.ts`、`apps/web/src/components/cosmos/content-block-reader.test.ts`、`e2e/browser/source-media-interactions.spec.ts` 及本 walkthrough；无 commit/push/deploy/真实用户数据操作，goal 保持关闭。

### 本会话完整批准范围 goal 与剩余清单恢复

- 维护者新授权替代 goal 关闭/单轮单环节/仅图片修复限制；创建新 goal `goal-d676f07a-8417-4542-984e-0d4c7baca414`，max_goal_rounds=16，不恢复旧会话。workflow 路由核对实际调用指定 provider=jijiapi、model=gpt-6-luna，返回可用；后续子 Agent 均显式指定，无默认路由代替。
- leader 单独维护 walkthrough/公共文档，统一验收与构建。当前 repository `D:\Otirik\Workstation\cosmos`、branch master、worktree 主工作区、base SHA `f66c33135351af38460fff73d311863dc7b4ef47`，既有 dirty 保留。A 可写 content-block-reader.tsx/其测试、reading.ts、source-media-interactions.spec.ts；B 首阶段只读核对版本、候选、生产接线，收到明确写集合后才可写。测试隔离根采用 browser-stack UUID 或 `.agent/tmp/task40-agent-<uuid>`；DTO/Prisma 当前无人获写授权，最多3并发，无真实数据/Git生命周期操作。
- 暂定分类：已验证且相关实现未变：图文原位/离线、双来源切换/刷新、saved 图片加载失败提示与恢复。实现已有但证据需系统核对：Normalizer/存储并发及迁移/精确历史引用/锁定回退、权限与证据降级、候选接受拒绝与过期原子性、音视频与其它读取状态。已知缺陷：missing Asset 未提供原文入口。配置缺口：生产 Story Agent resolver/profile 无装配；真实外部模型调用未获明确费用/凭据/网络授权，必需真实 Agent 验收保持未完成，不冒充 Fake 完成。
- 当前索引原“未开始业务实现”和 walkthrough 当前 Normalizer 描述已修正；旧阶段记录明确标注历史。完整产品768布局门禁对齐已批准 ADR-0029，1024/1440验阅读，768验过窄提示。全仓回归和类型检查已启动，不重跑无变更的局部图文验收。
- 新鲜基础验证：`bun run typecheck`（pwsh-28，exit 0）；`bun run db:validate`（pwsh-32，exit 0，schema valid）。`bun run test`（pwsh-27）仍运行；workflow-1 A/B仍运行，未采信其完成声明。

