# Task 43 Walkthrough

本文件是 Task 43 唯一 append-only 过程与验证记录；当前摘要和下一步见 [README](README.md)。后续记录向末尾追加，不覆盖本轮事实。

## 2026-11-19：接受方案并建立实施入口

- 生命周期：方案接受 → 实施计划；本轮切片只整理文档，不写业务代码或测试。
- 工作区：repository `cosmos`；branch `feat/story-artifact-v1`；worktree `.worktree/story-artifact-v1`；base SHA `9b35d60`。只在此 worktree 操作，未修改主工作区。
- 用户授权：维护者选择功能 B（Story 深入阅读 + Artifact v1），确认独立 worktree/分支、Task 43、本地 commit 可在实现收尾执行，合并前需再次确认。本轮明确不 commit、不合并、不 push、不部署。使用 oil-plan 子 Agent 模式：Leader 只做决策，探索、实现、审查由官方子智能体插件委派 gpt-6-luna / medium；本轮文档代理不再派发子 Agent。
- 探索与挑刺：Leader 报告探索与独立挑刺两轮已完成，入队原子性另行核实；本代理逐项抽查源码锚点并按裁决修订，没有把独立审查记录伪造为自己的运行证据。
- 接受：维护者 Otirik 批准范围与实施方式，Leader 接受修订技术合同；[Proposal](../../../docs/proposals/story-deep-read-artifact-v1.md) 与 [ADR-0034](../../../docs/adr/0034-artifact-revision-v1.md) 改为 accepted；API 目标由 [Draft 0010](../../../docs/api/0010-story-deep-read.md) 承载，仍未实现。
- 冻结摘要：三表；Artifact 活动槽与 envelope/永久请求账本同事务；同键同 hash 返回原 Run，活动期不同键409，无别名，跨 kind 键唯一由 WorkflowRun 约束保证；helper 保留事务外 P2002 重读，竞争最多3次尝试/50、150ms退避；终态槽下一次入队惰性自愈；Worker host 发布，Revision 成功才写，最大 revision 为当前；原 Story 归属与 Restrict；prompt 单份正文+allowlist，8来源/12k单源/60k总计；结构块/引用/确定编号/200KiB，length失败；调用既有maxAttempts=2、发布1；只成功报告展示费用。
- 本轮仍有后果的假设：共享事务 helper 的可行结论来自源码核实，仍须隔离并发测试证明；Kernel 值阈值未验证，不能以 Worker Admin 限额代替；旧来源可能不可读，抽屉必须固定降级。
- 文档影响结论：需更新。本轮建立 Proposal/ADR 接受状态、Task、API Draft 和导航；PRD/架构/spec/PROJECT-STATUS 留 slice 4，不提前声明已实现。
- 本轮验证计划：只运行 `bun run docs:check`、`git diff --check`、`py -3 scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new`；完成后在本文件末尾追加实际结果。此前最后一次仅键合同修订未重跑 size，不能作为本轮末版结果。
- 下一步：派发 slice 1，先登记唯一写入者及隔离根，再冻结 DTO/持久化命令与可共享事务 helper；不跨片顺手修复旧 Story Agent 或 runtime。
- 未验证：没有实现代码、RED/GREEN、类型、迁移、单元/属性/进程/浏览器或真实 Provider 证据；未运行任何数据库命令，未改用户数据，未 commit 或部署。

### 本轮收尾验证

- `bun run docs:check`：PASS，failures=[]；比较基线为HEAD `9b35d604eb6b310f3d52a26d82fe1f774cdcd96c`，工作树含untracked；changedFiles仅本轮7份授权文档，链接与导航检查未发现断链。
- `git diff --check`：PASS，无空白错误。
- `py -3 scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new`：本轮已重新运行，PASS；仅既有 [CONTEXT.md](../../../CONTEXT.md) 37.37KB高于登记37.24KB的非阻断warning，本轮未改此文件。新增Task/API及两份接受文档均在健康区。
- Task与API索引已登记；Proposal/ADR与Task/API互链。本轮未修改PRD、架构、spec或PROJECT-STATUS；这些属于slice4。无运行/测试层验收结论。

## 2026-11-19：Slice 1 拆为 1a / 1b，1a 开始

- Leader将slice 1拆为1a/1b：先冻结公共合同、表与共享事务helper，再派发仓储enqueue/publish/read，降低单片风险，避免合同/迁移/业务并发命令同时变化。
- 1a连贯目标与范围：公共DTO/上限/确定编号；Artifact、ArtifactRevision、DeepReadRequest三表schema/迁移；envelope同事务helper与既有wrapper边界。1b仓储业务尚未派发。
- 写入代理：`721a951c-c213-4143-a537-5b689aa8de49`；repository/branch/worktree/base仍为cosmos / feat/story-artifact-v1 / .worktree/story-artifact-v1 / 9b35d60。
- 允许文件：contracts `story-deep-read.ts`、对应测试与导出；storage-prisma的schema.prisma、新migration；envelope-store.ts与对应测试、migration测试。除此以外不写入；公共DTO/schema/migration/helper当前唯一写入者为1a代理。
- 隔离测试数据根：`.agent/tmp/task43-s1a-*`；不得使用真实.cosmos或用户数据库。仍有后果的假设：helper保持现有envelope identity/queued事件与事务外P2002重读语义，fresh/upgrade不改旧数据，均待行为验证。
- 预期验证命令（尚未运行）：`bunx vitest run packages/contracts/src/story-deep-read.test.ts`，以及 `bunx vitest run {本片envelope/migration测试文件}`；`bun run typecheck:contracts`、`bun run typecheck:storage`。若需`bun run db:validate`/`bun run db:generate`，先由实施代理配置隔离COSMOS_DATA_ROOT/DATABASE_URL并记录；本轮文档代理不运行这些命令，不运行实现快测或全量门禁。
- 当前未运行任何本片实现验证，不记录RED/GREEN或测试通过结论；本条仅记录派发与预计验证。文档影响：需更新，本轮只同步Task摘要/登记与append-only记录。
- 下一步：收齐1a合同/表/helper冻结与验证证据，Leader验收后派发1b仓储enqueue/publish/read，填入具体文件与隔离根，不提前声称slice 1完成。

## 2026-11-19：Slice 1a 审查闭环，1b 仓储派发

- 记录来源：以下1a交付、验证和独立审查结果由Leader提供；文档代理本轮仅补记，不宣称亲自运行实现验证。分支/worktree/base沿用前条登记，无commit。
- 1a交付：contracts公共合同及37+测试，entry-surface 621；三表schema与迁移；envelope同事务helper及8测试；迁移测试。聚焦4文件48/48通过，`bun run typecheck:contracts`、`bun run typecheck:storage`通过。
- 独立审查发现两项P2：①cost币种允许任意字符串；②unknown预检中的getter/Proxy/toJSON可抛裸异常并影响字节预算。
- 1a修复：费用币种复用USD/CNY；用descriptor复制纯数据，异常转malformed_payload，并补getter/Proxy/toJSON与字节预算负例。修复后contracts两文件44/44通过、类型检查通过；审查员定点复核PASS，Leader放行1b。上述为聚焦证据，不能推断为全量或产品链验收完成。
- 1b代理：`9e43ca0a-e3dc-451e-8b23-752b49f60c77`，进行中；目标为仓储enqueue/publish/read。允许文件仅storage-prisma中新repository `story-deep-read.ts`、必要时 `story-deep-read-source-status.ts`、storage `index.ts`一行导出及对应测试；不得改写1a冻结合同/schema/helper。
- 隔离根：`.agent/tmp/task43-s1b-*`，所有数据库/文件根明确指入隔离路径，不读用户.cosmos，不真实外呼。
- 1b预期命令（本条不记录为已执行）：先配置隔离COSMOS_DATA_ROOT/DATABASE_URL后 `bun run db:generate`；`bunx vitest run {新仓储测试文件}`；`bun run typecheck:storage`。失败修复只重跑同条聚焦测试，不反复空跑全量门禁。
- 未验证：全量test/build、API/Worker/Web与真实Provider均未运行；无commit。下一步收齐1b仓储证据及独立审查后推进slice2，不提前声称完整功能可用。
- 文档影响：需更新；本轮仅更新Task43摘要/写入登记与本append-only记录，不改代码或其它文档。本轮文档检查限 `bun run docs:check` 与 `git diff --check`。

## 2026-11-19：Slice 1b 完成，工具链修复与 2a 派发

- 记录来源：本条交付、测试、审查和工具链结果均由Leader提供；文档代理只补记，不重新执行实现验证。worktree/分支/base仍为前述登记，无commit。
- 1b交付4文件：新repository `story-deep-read.ts`约18.5KB、source-status约1.5KB、仓储测试约24.3KB、storage index一行。使用真实SQLite与仓库已提交迁移链验证，聚焦37/37通过，`bun run typecheck:storage`通过；不表示本轮新增迁移已commit。
- 独立审查两轮共5项P2：错误分类、fence存储异常、入队字段上限、重放先于新快照校验、非Artifact P2002重试，均已修复。最后两项由Leader定点核对代码与37/37测试确认；审查员未再单独出具最终PASS。不得记录为“审查全绿”，后续全量diff仍有独立审查。
- 工具链修复由Leader执行，仅限worktree本地依赖/生成物：`bun install --frozen-lockfile`约36秒，bun.lock未变；建立 `@cosmos/contracts` 本地junction并重建contracts dist；`bun run db:generate`生成本地Artifact/ArtifactRevision/DeepReadRequest client。原因是worktree嵌套导致模块解析到主checkout旧dist/client；这是本地工具链纠偏，不是改产品合同或用户数据库的证据。
- 2a代理：`dba56891-0aa0-49c9-83ff-1450fbd10960`，进行中；目标为精简输入准备、控制层、Workflow、host发布Action及Worker装配。允许文件：application preparation/control/workflow/publish/index及聚焦测试，Worker main注册与测试；不触碰API/Transport/Web或1a/1b冻结持久合同，发现冲突返回Leader。
- 隔离根：`.agent/tmp/task43-s2a-*`；预期命令（本条不记作已执行）：`bun run typecheck:application`、`bun run --cwd apps/worker typecheck`、`bunx vitest run {本片application/Worker聚焦测试文件}`。用受控模型替身与隔离数据根，不真实Provider外呼。
- 未验证：API/Transport/Web、全量test/build、真实Provider均未运行；无commit。下一步收齐2a证据与审查后派发2b，再进入Web，依赖顺序1a→1b→2a→2b→3→4。
- 文档影响：需更新，本轮只同步Task43 README与本记录，不改代码或其它文档；文档检查限 `bun run docs:check` 与 `git diff --check`，不跑size或实现验证。

## 2026-11-19：不可用来源的 nullable 合同同步

- 合同缺口与Leader裁决：不可用来源可能没有精确representationVersion，不能伪造1；omitted=true时版本允许null作为不可引用哨兵，或保留已知正整数；块为空、字符0、reason必填。omitted=false仍须正整数版本、非空块与正字符数；evidence永不可引用omitted项。
- 以下实现证据由Leader提供，非文档代理本轮执行：1a合同调整后45/45通过；1b nullable同步后39/39通过。发布allowlist只收omitted=false且版本正整数、块非空的来源，sourceStatus只看实际纳入来源/块，omitted统计不影响状态。
- 统计需在发布、current、指定版本与按Run查询完整往返；evidence若引用omitted+null来源应受控malformed_payload，不产生Revision/事件、槽不变。API Draft已同步上述目标合同与conformance，不据此宣称HTTP实现完成。
- `typecheck:storage`当前9条诊断全部来自2a application文件，已转交2a处理，storage自身0条；不能记录为本轮全局类型通过。2a仍进行中，无commit。
- 文档影响：需更新；本轮仅修改API Draft0010与本append-only记录，不动README/代码/其它文档。本轮只运行 `bun run docs:check` 与 `git diff --check`，不运行实现测试、类型、size或数据库命令。

## 2026-11-19：Slice 2a 已交付，独立审查进行中

- 证据来源：本条2a交付/验证与reader扩展结果由Leader提供，文档代理仅补记，未执行实现测试；无commit。2a代理为 `dba56891-0aa0-49c9-83ff-1450fbd10960`，2b待审查结果。
- 2a交付：5个application文件（store/preparation/workflow-control/workflow/publish）+3测试、application/index导出，application entry-surface 266；Worker main注册+1注册测试。
- 冻结与调用：快照正文单份，最多8来源/单源12k/总60k，omitted允许null；requestHash只含原始modelId或null，resolvedModelId单独冻结；maxOutputTokens=6000。Workflow仅在finishReason=stop、无toolCalls、严格JSON且normalize成功后调用publish，不发布length或坏结构半成品。
- 发布Action为host、maxAttempts=1、actionKind=artifact。限制：Workflow自行抛出的JSON/length错误目前走generation_failed安全回退，不能记录为已具备精确malformed/length公开失败码；不显示原始异常。
- 验证：`bun run typecheck:application`与 `bun run --cwd apps/worker typecheck`通过；聚焦5文件26/26通过。独立审查仍进行中，不据聚焦通过宣称审查完成或产品链已验收。
- 失败码reader扩展：仅storage `story-agent-failure-code.ts`及测试，增加可选definitionKey，默认cosmos.story-agent，deep-read传cosmos.story-deep-read；聚焦2/2与 `bun run typecheck:storage`通过，无storage合同/schema变更。此条更新前条9条跨包类型诊断的当前结论，不覆盖历史记录。
- 未验证：API/Transport/Web、全量test/build、完整Kernel值阈值与真实Provider均未运行；无commit。下一步收齐审查、解决阻断项后派发2b，依赖1a→1b→2a→2b→3→4。
- 文档影响：需更新，本轮仅Task43 README与本记录，不改代码/其它文档；检查只跑 `bun run docs:check` 与 `git diff --check`，不跑实现测试/类型/size/数据库命令。

## 2026-11-19：Slice 2a 复审 PASS，2b 派发

- 记录来源：本条实现验证与复审结论由Leader提供，文档代理只补记，未亲自执行实现验证；无commit。
- 2a三项P2已修：顶层块allowlist、活动期不同键前置409、Story不存在404。复审PASS；聚焦5文件29/29，`bun run typecheck:application`与 `bun run --cwd apps/worker typecheck`通过。前条独立审查进行中的状态以本条复审结论更新，不回改历史。
- 1b新增只读能力 `findStoryDeepReadRequest`（返回run envelope）与Story404支持；仓储42/42、`bun run typecheck:storage`通过。该能力支持同键恢复优先于新快照校验及活动期前置冲突，仍受原冻结持久化合同约束。
- 2b代理：`fb1296c2-eb8c-401e-b0a6-c1663754a347`，进行中；隔离根 `.agent/tmp/task43-s2b-*`。范围为装配控制（store/workflows/stories/content/systemConfig/failureCodes）、四路由、严格投影/错误与transport四方法。
- 允许文件：API app.module、新deep-read controller、route-table与新controller测试；transport client-content/types/index及测试。不改application/storage/contracts已冻结合同或Web；若接线发现合同缺口先回Leader。
- 2b预期命令（尚不记为结果）：`bunx vitest run {本片transport/client与API controller测试文件}`、`bun run --cwd apps/api typecheck`、`bun run typecheck:transport`；使用隔离数据与模型替身，不真实Provider外呼。
- 未验证：真实API/Worker/Web链路、全量test/build、真实Provider均未运行；无commit。下一步收齐2b证据与独立审查再派slice3，依赖1a→1b→2a→2b→3→4。
- 文档影响：需更新；本轮只Task43 README与本append-only记录，文档检查仅 `bun run docs:check` 与 `git diff --check`，不改代码或其它文档、不跑实现验证。

## 2026-11-19：Slice 2b 复审 PASS / 末项收尾，Web 派发

- 记录来源：下列2b交付、聚焦验证与复审结论由Leader提供，文档代理仅补记，不重新运行实现验证；无commit。
- 2b交付四路由、局部strict filter与transport四方法。聚焦从51/51到73/73，包含module reader 9、request-logging 7、controller 39；API与Transport类型检查通过。各数字为各次/各范围证据，不能与其它片相加作为全仓结果。
- 装配reader只用detail.entries，首来源不重复。畸形JSON路径窄归一仅作用于deep-read POST，400/413返回固定安全envelope，其它路径保持原合同；transport各路由strict payload及污染负例覆盖。
- 2b复审PASS；仍有P2 follow-up：解析错误code应为validation_failed，已回2b修补中，不能把末项修补写成已通过或把复审结论扩为整条产品链验收。
- 2b实际文件范围：app.module、新controller、route-table、新controller测试、新module reader测试、main.ts、request-logging与transport4文件；无commit。
- slice3代理：`9d51acfa-344d-4960-bd06-8fa4931e1682`，进行中；隔离根 `.agent/tmp/task43-s3-*`。允许文件为Web阅读页、新深读组件/hook/copy/component-lab/browser e2e，不改后端/Transport/公共合同。范围为左栏入口、状态/轮询/同键恢复、版本切换、精确证据抽屉与观点/费用呈现。
- 预期命令（不是执行结果）：`bunx vitest run {Web深读聚焦测试文件}`、`bun run --cwd apps/web tsc --noEmit`、受影响Web文件lint；聚焦component-lab与browser e2e沿现有Playwright配置运行。使用隔离栈/端口/模型替身，不能以组件替身通过代替真实产品栈。
- 未验证：真实API/Worker/Web全链路、全量test/build、真实Provider均未运行；无commit。下一步确认2b末项code修补并收齐slice3证据/审查，再推进slice4。
- 文档影响：需更新，本轮仅Task43 README与本记录；检查仅 `bun run docs:check` 与 `git diff --check`，不动代码/其它文档，不跑实现测试、size或数据库命令。

## 2026-11-19：Slice 3 交付、完整门禁与文档收尾（Leader 兜底）

- 记录来源：最终审查、spec、状态文档与 Web 窄审查子 Agent 在完成前连续失败（无产出、无文件改动）；为避免交付停摆，完整门禁、spec/API/架构/状态与 Task 收尾由 Leader 直接完成。这是对“子 Agent 模式”的一次明确偏离，后续若继续使用该模式需先修复子 Agent 通道。
- slice 3 Web 交付：阅读页左栏关键事实后入口；幂等键/sessionStorage 先存后 POST；1s 轮询、刷新同键恢复；409 固定文案并读活动 generation；current/≤50 版本切换、旧版只读；ContentBlockReader `assets=[]`；证据抽屉精确 `revisionContent(entryRevisionId, representationVersion)` + blockId 定位/高亮/降级；sourceStatus/观点标记/费用/模型/时间；失败保留旧版、重试新键；组件实验室 10 场景。聚焦 unit/copy/registry 68/68（Leader 复跑）、component lab 8/8、真实 browser 1/1（35s，Leader 复跑），fixture 扩展仅测试专用（保留 story.summarize，hold/fail；无 page.route）。
- 2b 末项：解析错误 code 改为 `validation_failed`；request-logging/controller 46/46、api typecheck 通过。
- 完整代码门禁（隔离根 `.agent/tmp/task43-gate`，工作区 TEMP 规避系统 Temp EPERM）：`db:validate=0`、`typecheck=0`、`lint:web=0`（20 条既有 warning）、`build=0`；全仓 `test` **1595/1598**，239/240 文件通过。唯一失败 `prisma-cli.test.ts` 3 条为 fresh `bun install` 的 hoisted 布局（`node_modules/prisma`）导致路径测试误命中；worktree 与正常 checkout 均复现，主工作区（已有 `.bun` 布局）同一文件 **7/7 通过**，与功能无关；其余 10 条迁移边界失败已通过更新 6 个测试文件的边界/计数（Task 42 → Task 43）修复。
- 重测层：`test:acceptance` **7 文件 / 90 用例通过**；`test:browser:component-lab` **64/64 通过**；`test:e2e` 首轮因 helper `spawnSync("bun")` 在 Node 下 ENOENT，设置 `BUN_BINARY=C:\Program Files\nodejs\node_modules\bun\bin\bun.exe` 后 **7 文件 / 13 用例通过**。
- 完整 browser 套件（正常 checkout `D:\Otirik\Workstation\cosmos-browser-gate`，commit `3a3d85d`）：**72 passed / 2 skipped / 0 failed（4.6m）**。此前 55 条通过后 6 条阅读页用例在共享栈上约 3.1 分钟超时，根因是深读 spec 的测试隔离缺陷：fixture 的 `-hold` 永不释放，spec 在 409/刷新断言后立即删除 Provider/model，挂起的 Run 长时间占用 Worker，后续 ingest 排队超时。修复（`3a3d85d`）：hold 改为有界 20s，清理前轮询该 Run 到 `completed|failed|cancelled`；组合验证 `story-deep-read` + `story-live-refresh` 3/3（1.2m），随后正常 checkout 完整套件 72/2/0。2 skipped 为既有的 `story-reading-degradation` 用例。
- 文档门禁：`docs:check=0`、`git diff --check=0`、size（含既有 CONTEXT warning）=0。
- 未验证：真实 Provider 外呼/结算、部署迁移、Kernel 值阈值、失败调用费用、文件包/HTML/Workspace/Knowledge/Research/编辑/批注/导出/定时刷新。
