# Task 39 历史记录（二）：真实终端入口与隔离验收（2026-10-14 至 2026-10-15）

> 由 `walkthrough.md` 按文档大小治理拆出；内容原样保留，不重写。前一篇见[历史记录（一）：接线、凭证合同与基线](walkthrough-history-01.md)。
## 真实终端入口准备（2026-10-14）

- 用户批准下一步：仅准备入口、无外呼验证与准确请求清单；不构成 Provider 请求授权。只改 Task 39 的 runner/test/README/walkthrough，不改产品、Task 40 或真实库。
- TaskStartSnapshot：master，HEAD=`f66c33135351af38460fff73d311863dc7b4ef47`；Git status 仍包含既有 57 项 tracked dirty 与 Task 39/40 等 untracked，全部保留。
- Slice：复用冻结 snapshot 和隔离 Prisma 初始化；新增无凭证 prepare-real 路径与 TTY-only 单次 real 路径。prepare 生成准确隔离根与请求计划，real 必须展示计划并在终端单独确认，再无回显读取凭证；写一次性标记，SDK 调用不得由测试触发真实网络。任何真实调用本轮均不运行。
- Change Necessity：现 runner 只有 offline CLI，无法提供准确隔离路径和真实终端请求入口。既有验收 owner 内增加门禁，不增加产品能力。ArchitectureReviewRequired=no：生产合同不变。TDD Route=off；补充门禁/离线行为测试。
- 验证与停止：聚焦测试、类型检查、无外呼 CLI 准备与重定向拒绝检查、文档检查；汇报准确命令/路径/文本/费用/日志/清理后停止，等待该次真实请求授权。

### 准备验证结果及待批准请求

- `bun run vitest run .agents/tasks/39-pi-ai-adapter/connection-smoke.test.ts apps/worker/src/agent-action.test.ts packages/agent-pi-ai/src/index.test.ts packages/application/src/agent-invocation.test.ts`：31 tests / 4 files passed，exit 0；含无外呼 prepare-real、重定向 real 拒绝、未知参数拒绝及既有离线链路。未测试真实终端输入或真实 SDK 请求。
- `bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node .agents/tasks/39-pi-ai-adapter/connection-smoke.ts .agents/tasks/39-pi-ai-adapter/connection-smoke.test.ts`：exit 0。runner 305 行，test 118 行；复用初始化 owner，无产品变更。
- `bun run .agents/tasks/39-pi-ai-adapter/connection-smoke.ts prepare-real`：exit 0，prepared-no-request，37 项冻结迁移。拟用根 `D:\Otirik\Workstation\cosmos\.agent\tmp\task39-real-253XRy`，当前只有 schema-snapshot、jiti 缓存、SQLite、迁移日志、manifest、路径清单与 request-plan.json，无凭证。测试另有自己的隔离根，全部保留。
- `bun run .agents/tasks/39-pi-ai-adapter/connection-smoke.ts real 'D:\Otirik\Workstation\cosmos\.agent\tmp\task39-real-253XRy'`：在重定向工具中 exit 1，按预期在 TTY 守卫拒绝；未读取凭证/外呼，目录 attempted.json 不存在。本命令在用户真实终端运行仍须以下独立授权。
- 拟批准范围：用户在仓库根的真实终端执行上条命令，核对展示计划后输入 APPROVED，再无回显输入凭证。Provider/model=`jijiapi/gpt-6-luna`，API=`openai-completions`，baseURL=`https://api-slb.jiji.cc/v1`，唯一 user 文本=`Reply with exactly: OK`；无 system prompt、工具、历史业务数据，metadata={}，SDK metadata 包含 idempotencyKey=`task39-offline`（复用现有 seam）。maxOutputTokens=64，maxDurationMs=30000，signal=35000ms。runner/Adapter dispatch 一次且不重试；SDK/服务端内部 HTTP 重试次数未在本轮核实，不能保证恰好一个 HTTP 请求或绝对费用上限。
- 副作用：Provider 按其费率收费并可能保留请求；尚无可信费率，不能报价。只在指定隔离库新增合成 Connection，凭证暂写该根 FileSecretStore 明文文件；正常/finally 路径删除该 SecretRef，崩溃/强杀可能残留。attempted.json 在凭证读取前独占创建，之后禁止复用该根，失败也不自动重试。JS 引用清除/文件删除不保证物理擦除；Windows 文件 mode 不提供足够权限保证。
- 输出与日志：不输出凭证或响应正文；只白名单 result（状态/provider/model/usage/输出是否 OK/读取次数/日志计数）。real logger 丢弃任意字段与 provider payload，不序列化正文；错误仅固定消息，底层 SDK 自行日志未实际运行核实。不使用 transcript/重定向原始输出。查看结果时只读 result.json 和 attempted.json，列 SecretStore 文件元数据不读内容；保留 migration.log 与 manifest。unexpected 输出需停止并脱敏处理。
- 清理方法（本轮未执行）：先确认绝对路径恰为上述唯一根，列出目录；核查无活动 runner，确认该根全部为本次验收产物，再单独取得清理确认后 `Remove-Item -LiteralPath 'D:\Otirik\Workstation\cosmos\.agent\tmp\task39-real-253XRy' -Recurse -Force`，随后 `Test-Path -LiteralPath 'D:\Otirik\Workstation\cosmos\.agent\tmp\task39-real-253XRy'` 应为 False。绝不使用宽泛 cleanup 或删除默认库/备份。
- 默认库与指定备份重新 SHA-256 均为 `04DAD5C99812446B14AB09B5EAFFC0C2DF7A94D22D0174745B5CEF793C006CFB`。未运行 build/全仓检查/真实 Provider/生产生命周期；没有 Git 生命周期操作。Checkpoint：入口准备完成，真实终端与 Provider 仍未验证，等待该次独立明确确认。

### 两层验收重启：纯离线行为补证

- 本轮基线：57 个 tracked dirty 文件及多项 untracked，全部保留为用户改动；Task40、默认数据库、备份、根 Vitest 配置和生产接线均不修改。
- 纠正此前分析：Worker 已在 `apps/worker/src/agent-action.ts` 实现 Connection active/SecretRef 校验和 SecretStore callback；不能因 Proposal 签名差异直接要求重写 adapter。先补缺失证据。
- 本轮切片：仅追加 Worker 行为测试和本 walkthrough，验证每次调用重新读取/撤销、SecretStore 异常脱敏、读取期间取消。使用内存合成 Connection/SecretStore 和 fake SDK，不创建数据库、不迁移、不外呼。
- runner 现有集成测试会部署 37 条冻结迁移，本轮不运行；不将纯行为测试通过写成隔离数据库链路通过。真实 Provider 与 UI 凭证录入仍未完成。
- 新鲜验证：`bun run test apps/worker/src/agent-action.test.ts packages/agent-pi-ai/src/index.test.ts apps/worker/src/config.test.ts`：3 文件 32/32 通过，其中新增 4 例；未改生产代码，未声称存在 RED→GREEN 修复。`git diff --check` 通过；`bun run docs:check` 检查 1044 文件，failures=[]。
- 本轮实际只改 `apps/worker/src/agent-action.test.ts` 和本 walkthrough。未运行 runner 集成、数据库迁移、typecheck/build、全仓测试、浏览器或真实 Provider；未读取真实 SecretStore、业务数据库或响应正文。
- 下一步门槛：重新审查 runner 的隔离/快照和当前数据库兼容性，在明确允许仅对新建隔离库初始化后刷新集成证据；产品凭证录入入口另需确定范围。不得把 runner 临时写入凭证视为 UI 流程完成；真实请求仍需完整披露与新的单独明确确认。

### 第二轮：刷新隔离集成证据

- 沿用此前批准的新建隔离库/冻结迁移离线边界，不修改 runner 或生产代码。`bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node .agents/tasks/39-pi-ai-adapter/connection-smoke.ts .agents/tasks/39-pi-ai-adapter/connection-smoke.test.ts apps/worker/src/agent-action.test.ts` 退出 0。
- `bun run vitest run .agents/tasks/39-pi-ai-adapter/connection-smoke.test.ts -t 'deploys only frozen migrations'`：1 通过、8 跳过；隔离根 `.agent/tmp/task39-offline-RxZTsG`。随后为覆盖准备和输入保护运行完整该测试文件：9/9 通过；隔离根 `.agent/tmp/task39-offline-CtNFe2`，另创建无请求的准备根 `.agent/tmp/task39-real-g1TlQ4`。均保留，不清理。
- 新鲜链路证据：真实 Prisma repository/Connection/FileSecretStore → Worker Action → adapter → fake SDK；冻结 commit `f66c33135351af38460fff73d311863dc7b4ef47`、37 条迁移、secretReads=1、missingSecretRejected=true、outputMatchesExpected=true。合成凭证未出现在结果/应用日志/迁移日志；fetch spy 未被调用。不能推广为 Task40 新字段或所有网络通道已验证。
- 目标测试后默认库和指定备份 SHA-256 均保持 `04DAD5C99812446B14AB09B5EAFFC0C2DF7A94D22D0174745B5CEF793C006CFB`；未读取业务记录或真实 SecretStore。`git diff --check` 通过。
- 离线层证据已刷新；真实 Provider 层未完成。准备根仅作候选，不代表外呼授权；未运行 real，不读取旧失败目录凭证或响应。真实终端凭证输入、SDK 外部日志/重试、费用与实际模型响应尚未验证；产品 UI 凭证录入另属未完成项。

### 第三轮：外呼次数与 SDK 日志边界只读核查

- 本地源码确认：`packages/agent-pi-ai/package.json` 声明 `@mariozechner/pi-ai: ^0.55.0`；adapter 默认 client 直接调用 pi-ai complete，传 apiKey/maxTokens/signal/metadata，没有明确重试或日志设置。runner `maxDispatches: 1` 仅描述 Action 次数，不能作为 HTTP 请求次数保证。
- 上游参考（不是已安装版本验证）：https://raw.githubusercontent.com/badlogic/pi-mono/v0.55.0/packages/ai/src/providers/openai-completions.ts 的 createClient 未指定 maxRetries/logger/logLevel，错误正文可进入内存 errorMessage；https://github.com/openai/openai-node#retries 描述默认重试 2 次；日志可受 OPENAI_LOG 影响。当前主线文档与本机版本可能不同，不据此断言本机最多 3 次或日志安全。
- 规则边界：仓库禁止读取 node_modules 和锁文件；本轮未读取它们、未安装依赖、未外呼 Provider。要准确披露单次请求范围，需先取得仅限依赖版本/相关 SDK 重试与日志源码的只读例外，或由用户提供等价已安装版本证据。尚不提交真实请求执行审批，不复用旧授权。
- 本轮仅追加本 walkthrough；生产代码/runner/Task40/数据未改。上游网络读取是公开源码获取，不是模型请求；没有发送凭证或业务文本。
- 用户通过定向问题明确批准只读依赖例外：仅 pi-ai/OpenAI package.json 和实际加载的重试、日志、请求构造源码；不含凭证、锁文件、安装或 Provider。新鲜版本证据：本机 pi-ai 0.55.4，依赖 openai 6.10.0；只解析模块路径的 `bun -e` 命令确认 pi-ai 入口为 node_modules/@mariozechner/pi-ai/dist/index.js、其 OpenAI 解析为 node_modules/openai/index.js。未执行 complete。
- 本机源码核查：pi-ai dist/providers/openai-completions.js:303-308 创建 OpenAI 时没有设置 maxRetries/logLevel/logger；OpenAI client.mjs:104-113 使用 console、OPENAI_LOG、默认 warn、默认 maxRetries=2；client.mjs:376-426 对可重试状态/响应头执行退避重试。故一次 Action 可产生最多 3 次 SDK 请求尝试，不能宣称只发一次 HTTP；自动重定向尚未验证，也不能视为已限制目的地。
- 日志：OpenAI internal/utils/log.mjs:56-77 仅遮蔽部分头，不能作为不泄漏正文的完整保证；开启 debug 时风险高于应用 logger。当前 runner 不设置 SDK 日志级别，旧 request-plan 的 maxDispatches=1 和 providerBodyRecorded=false 不能证明传输层无重试/日志。未修改旧计划或执行 real。
- 下一步必须先选择并实现可验证的请求边界：优先在批准的 runner 范围内保证最多一次实际发送、拒绝跨目的地重定向并关闭 SDK 日志，使用 fake transport 验证；不能通过扩大默认 Provider 重试次数偷偷沿用一次请求授权。真实请求准确命令与清理披露待该边界核实后另行提交。

### 第四轮：验收 runner 传输边界

- 仅修改本 Task 四文件；生产 adapter、Worker、Task40 均未改。本轮新增 withBoundedProviderTransport，仅 standalone real CLI 的一次 dispatch 期间接管 global fetch 和 OPENAI_LOG，finally 恢复。限定 `https://api-slb.jiji.cc/v1/chat/completions` POST、最多调用底层 transport 一次、redirect=error、OPENAI_LOG=off。SDK 重试仍可在内存发生，但不会再次传输。不是生产重试策略或产品凭证入口。
- 计划新增 maxTransportSends=1、redirect=error、sdkLogLevel=off；旧 prepared plan 不匹配会拒绝。本轮测试生成准备根 `.agent/tmp/task39-real-wFUDBz`，没有执行 real。
- 新鲜 fake-transport 测试使用真实 installed defaultPiAiClient + pi-ai/OpenAI SDK、合成凭证：返回 500 后底层 transport 只调用 1 次；console debug/info/warn/error 均无调用；fetch 与原 OPENAI_LOG 在失败后恢复；非批准目的地在传输前拒绝。无真实网络；未模拟原生 fetch 的重定向实现，仅验证传入 redirect=error。
- 聚焦两例 2/2 通过；runner/test 类型检查退出0；`bun run vitest run .agents/tasks/39-pi-ai-adapter/connection-smoke.test.ts apps/worker/src/agent-action.test.ts apps/worker/src/config.test.ts packages/agent-pi-ai/src/index.test.ts`：4 文件43/43通过。新隔离离线根 `.agent/tmp/task39-offline-5sfW6r` 保留。没有真实请求；产品 UI 凭证录入和生产生命周期未验收。
- 文档检查1044文件无失败，git diff --check通过；默认库和指定备份哈希仍为 `04DAD5C99812446B14AB09B5EAFFC0C2DF7A94D22D0174745B5CEF793C006CFB`；候选根 attempted.json 不存在。
- 用户通过独立确认批准本次 `task39-real-wFUDBz` 请求：命令 `bun run .agents/tasks/39-pi-ai-adapter/connection-smoke.ts real 'D:\Otirik\Workstation\cosmos\.agent\tmp\task39-real-wFUDBz'`；jijiapi/gpt-6-luna、唯一 user 文本 `Reply with exactly: OK`、输出64 tokens、30秒、最多一次底层POST、拒绝重定向、SDK日志off。已披露流式usage/store:false、价格未知/可能计费、服务端留存未知、隔离明文SecretStore/finally删除单一SecretRef但不安全擦除、白名单结果且无正文、目录保留且后续删除需另批。该批准不授权重试、旧目录、默认库或UI验收。等待用户真实终端无回显输入；agent工具没有TTY，未启动real或接收凭证。

### 失败后的安全诊断补齐

- 用户报告 wFUDBz 真实尝试报固定脱敏错误；只读检查 attempted.json 存在、result.json 不存在、无 Bun 进程；secrets 目录仅零字节 secret 文件，流元数据仅默认零字节数据流。未读取凭证或数据库业务记录；未重试、删除或改写该目录。不能判断请求是否发出或计费。
- 用户批准补齐 runner 安全诊断。Change Necessity: code-change；owner 为本 Task runner，原错误抑制丢失阶段且清理可能覆盖首错。仅改原四文件，不改变生产合同/Task40。增加固定阶段记录与首次失败保留，finally 独立记录 secret_delete/disconnect；输出及 diagnostic.json 不序列化错误消息、堆栈、cause、凭证或正文。transportSends 仅统计进入底层 fetch，不能证明网络送达。强制终止仍可能无诊断。
- 测试以合成错误/凭证与 fake transport 验证不泄露、首次失败不被清理错误覆盖、失败发送计数及各阶段分类；无真实 Provider。类型检查通过；完整聚焦回归第一次45/45通过，后增加8个固定阶段案例，最终4文件53/53通过；最终严格类型检查退出0。离线根 task39-offline-yBpmPv、新准备根 task39-real-fqNgDe 均保留；新根尚未 real，必须另行明确批准，不复用 wFUDBz 授权。
- 用户批准并执行 fqNgDe 后，`diagnostic.json` 新鲜记录 `firstFailure.stage=dispatch`, `category=operation_failed`, `transportSends=1`, cleanup `secretDelete=completed`, `disconnect=completed`，无 result.json；说明请求进入底层 fetch 且返回/异常仍需更细区分，不能证明服务商收到或计费。未读取响应正文或凭证。
- 用户要求继续离线诊断增强。仍仅改本 Task 四文件：withBoundedProviderTransport 增加安全 HTTP status/returned 回调；诊断增加受管 Action 错误码白名单分类和 response 元数据，禁止正文/异常文本。替代传输测试验证 401 状态可记录且正文不落盘。类型检查通过，4文件54/54回归通过；新离线根 `task39-offline-RD4AVi` 保留。真实请求尚未重新批准。

## 最终隔离真实 Provider 验收（2026-10-15）

### 修复与重新验证

- 复核 `task39-real-g2UFeJ` 失败证据后确认 runner 的 `ActionRegistry.dispatch()` 外层 `AbortSignal.timeout(35_000)` 仍为 35 秒，而请求计划与 Adapter 预算已为 300000ms；该不一致会在 Provider 尚未返回时提前取消调用。
- 仅在本 Task runner/test 文件内将外层信号调整为 `AbortSignal.timeout(305_000)`，并增加请求计划包含 `300000` 的离线断言；未修改 Worker 生产合同、Task 40、默认数据库或备份。
- 修复后聚焦回归为 4 个文件、54/54 测试通过；严格类型检查通过。`prepare-real` 创建 `.agent/tmp/task39-real-QmVMec`，部署冻结快照中的 37 个迁移，未读取凭证、未访问 Provider。

### 新鲜真实验收结果

- 用户对该准备根单独确认一次真实请求后，在真实交互终端执行 `bun run .agents/tasks/39-pi-ai-adapter/connection-smoke.ts real 'D:\Otirik\Workstation\cosmos\.agent\tmp\task39-real-QmVMec'`；本记录不保存凭证或响应正文。
- `.agent/tmp/task39-real-QmVMec/result.json` 记录：`status=completed`、Provider `jijiapi`、model `gpt-6-luna`、`responseStatus=200`、`responseReturned=true`、`outputMatchesExpected=true`、`secretReads=1`、`credentialAbsentFromOutput=true`、`providerBodyRecorded=false`、`retained=true`。Provider usage 摘要为 input 1134、output 10、total 9021 tokens。
- `.agent/tmp/task39-real-QmVMec/diagnostic.json` 记录：`status=completed`、`transportSends=1`、`response.returned=true`、`response.status=200`、`firstFailure=null`、`cleanup.secretDelete=completed`、`cleanup.disconnect=completed`。
- 该证据证明一次保留的隔离根目录真实链路 `Connection → SecretStore → Worker Action → pi-ai Adapter → jijiapi` 成功；不覆盖 UI 凭证录入、其它 Provider、OAuth、流式结果、工具执行、常驻 Worker/Workflow 调度或生产部署。默认数据库、指定备份、Task 40 与 Git lifecycle 均未触碰。
