## 状态

当前实现规格；后续代码变化应同步更新本文。

## 最后更新

2026-08-16

## 组件定位

`packages/logging/src/index.ts` 实现 Node.js 进程内结构化日志组件，负责日志上下文传播、级别过滤、字段清洗、JSONL 编码、标准输出写入、文件轮转、容量保留和失败降级。

application 层通过 `LoggerPort` 使用日志能力。logger 为可选依赖；未注入时 wiring 提供 noop 实现，使 application 用例无需条件分支。noop 不写文件、不写标准流、不缓冲记录，也不拥有任何日志存储。

日志记录是运行与诊断信息，不是 `DomainEvent`，不构成业务事实、审计账本或可重放状态。


### 在系统中的位置与作用
它是 Node 进程内的共享日志基础设施，为 API、Worker 和 application 层提供 `LoggerPort` 实现。

### 解决的问题
它统一上下文传播、级别过滤、字段清洗、JSONL 输出、文件轮转和失败降级，使诊断信息可关联且不把日志误当业务事实。

### 使用方式
组合根创建 logger 并注入 `LoggerPort`，在请求/Worker scope 中传播 context；未注入时使用 wiring 提供的 noop logger，不需要业务代码到处判断。

### 典型情景
本地或部署进程需要按级别输出结构化 API/Worker 日志、保留滚动文件，或在可选日志依赖缺失时保持 application 正常运行时，选择本组件。

## 概念与定义

- **Schema 版本**：`logSchemaVersion` 固定为 `log.v1`。
- **级别**：`debug`、`info`、`warn`、`error`，权重依次为 `10`、`20`、`30`、`40`。
- **输出模式**：`stdout`、`file`、`both`。
- **LogContext**：仅承载可选关联标识 `requestId`、`runId`、`jobId`、`sourceId`、`connectorId`。
- **LogRecord**：必须包含 `schemaVersion`、`timestamp`、`level`、`service`、`instanceId`、`pid`、`hostname`、`event`；可包含关联标识、经过清洗的 `fields`、序列化错误信息和 `truncated` 标志。
- **RuntimeLogger**：执行上下文合并、级别过滤、记录构造、清洗和输出分派。
- **RotatingFileSink**：通过串行 queue 管理目录创建、追加、轮转、裁剪和关闭。
- **noop LoggerPort**：满足 application 日志端口但不产生副作用的默认实现。

## 外部行为

- `child(context)` 创建子 logger，将新 context 合并到已有 local context；同名字段以子 context 为准。
- `withContext(context, operation)` 使用整个模块共享的一个 module-global `AsyncLocalStorage`。有效上下文按 current store、logger local context、新 context 的顺序合并，后者覆盖前者，并限定在 operation 的异步调用链内。
- `debug`、`info`、`warn`、`error` 构造结构化记录；低于当前最低级别的记录直接丢弃。
- `error` 可接收并序列化 `Error`，包括受深度限制的 cause 链。
- `close()` 先将文件 sink 标记为 closed，再等待已有 file queue 完成。closed 后文件写入被忽略；RuntimeLogger 的 stdout 路径仍可被调用，因此 close 不代表禁止所有 stdout 写入。
- application 使用 `LoggerPort` 而非日志文件实现。可选 logger 未注入时绑定 noop；注入真实 logger 时，application 仍不负责日志存储、轮转或保留策略。

## 输入

- `LoggerOptions` 提供 `service`，并可覆盖 `level`、`output`、`logRoot`、`fileName`、`instanceId`、`retentionDays`、`maxBytes`、`rotateBytes`。
- 环境输入包括 `NODE_ENV`、`COSMOS_LOG_LEVEL`、`COSMOS_LOG_OUTPUT`、`COSMOS_LOG_ROOT`、`COSMOS_DATA_ROOT`、`COSMOS_LOG_RETENTION_DAYS`、`COSMOS_LOG_MAX_BYTES`。
- 日志调用输入包括事件名、可选 fields、可选 `Error`，以及 local context 和当前 `AsyncLocalStorage` context。
- 运行时输入包括当前时间、`hostname`、`pid`、active 文件状态及 `logRoot` 中已有 `.jsonl` 文件。

## 输出

每条保留记录编码为单行 JSON，并以换行符结束，即 JSONL。stdout 或 both 模式同步调用 stdout writer；file 或 both 模式将记录提交给 `RotatingFileSink` queue。

字段清洗规则如下：

- 任意层级 key 匹配 `secret|token|password|cookie|authorization|api-key|prompt|payload|content|body|headers|stdout|stderr|query|requesturl|responsebody` 时，值替换为 `[REDACTED]`。
- 文本内容通过正则清除 Bearer/Basic 凭据、`token=` 参数、authorization/cookie header，以及 JSON-like secret fields。
- string 上限为 4 KiB；object 最多保留 64 个 key；array 最多保留 64 个 item；深度大于 5 时替换为 `[TRUNCATED]`。
- `undefined` 省略，`bigint` 转为 string。
- `Error` cause 深度大于 3 时替换为 `[CAUSE_TRUNCATED]`。
- 单条记录 JSON 的 UTF-8 编码超过 64 KiB 时，重建为仅含核心 metadata、关联标识和 `truncated: true` 的记录。

## 状态与持久化

RuntimeLogger 持有解析后的配置、service、instanceId 和 local context；module-global `AsyncLocalStorage` 持有当前异步调用链的上下文。

文件 sink 持有 closed、failed、当前 active UTC 日期和串行 queue。持久化目录为 `logRoot`，active 文件为 `${fileName}.jsonl`；轮转文件为 `${fileName}-${date}-${Date.now()}-${pid}.jsonl`，其中日期采用 `YYYYMMDD` 形式。

首次使用已有 active 文件时，以其 mtime 对应的 UTC 日期初始化 active 日期。保留与总容量检查仅在成功 append 后执行，不是定时任务。

## 状态转换

1. 日志调用先比较 level weight；低于阈值时结束，不创建输出。
2. 保留的调用合并 context、构造 LogRecord、清洗 fields、序列化 Error，并执行 64 KiB 整记录约束。
3. stdout/both 同步写 stdout；file/both 将文件操作加入 queue。
4. 文件操作确保 `logRoot` 存在。active 非空且 UTC 日期变化，或追加后将超过 `rotateBytes` 时，先 rename active，再 append 新记录。
5. 每次 append 后执行 prune：先删除 mtime 早于 retention cutoff 且名称符合轮转模式的文件；随后计算目录内全部 `.jsonl` 文件总字节数，若超过 `maxBytes`，按 mtime 从最旧轮转文件开始删除。
6. active 文件永不由 prune 删除；即使仅 active 或不可删除的 `.jsonl` 已使总量超限，也允许继续超限。
7. `close()` 将文件 sink 转为 closed 并等待 queue；closed 状态忽略后续 file writes。

## 副作用

组件读取环境变量、主机名、进程号和时间；写 stdout/stderr；创建 `logRoot`；读取目录和文件 metadata；追加、rename、删除 `.jsonl` 文件。文件 queue 串行化单进程内的文件副作用，但 stdout 与 file 不是事务性双写。

application noop wiring 无 I/O、无文件、无事件发布、无内存日志积累。

## 错误与降级

文件 sink 首次失败后永久进入 failed 状态，并仅向 stderr 报告一次 `logging.file_sink_failed`。`output=file` 时，当前失败记录及后续记录 fallback 到 stdout；`output=both` 不执行额外 file fallback，因为原记录已经写过 stdout。

stdout writer 失败时向 stderr 报告 `logging.sink_failed`。stderr 写入失败被吞掉。目录创建、文件操作、轮转、裁剪、stdout 和 stderr 的失败均不得使日志调用向应用抛错。

## 依赖

实现依赖 Node.js 的 `AsyncLocalStorage`、文件系统、路径解析、主机信息、进程信息、时间和标准流能力。单个 module-global `AsyncLocalStorage` 被该模块创建的 logger 共享。

application 依赖 `LoggerPort` 抽象及 noop wiring，不依赖文件布局、轮转命名、保留算法或 `RotatingFileSink`。

## 配置

配置按“有效的 `LoggerOptions` 值 → 有效的环境变量值 → 默认值”解析。

| 配置 | 解析规则 |
| --- | --- |
| `level` | option 优先；其次 `COSMOS_LOG_LEVEL`。仅接受四个 level；否则 production 默认 `info`，非 production 默认 `debug`。 |
| `output` | option 优先；其次 `COSMOS_LOG_OUTPUT`。仅接受 `stdout`、`file`、`both`；否则为 `both`。 |
| `logRoot` | nonblank `option.logRoot` 优先，其次 nonblank `COSMOS_LOG_ROOT`；否则为 `resolve(COSMOS_DATA_ROOT 或 ".cosmos", "logs")`。 |
| `fileName` | 对 option 值取 basename 后仅保留 `A-Za-z0-9._-`；结果为空时依次使用同样可用的 service、`cosmos`。 |
| `instanceId` | 使用 option；未提供时为 `${hostname}:${pid}`。 |
| `retentionDays` | option 优先，其次 `COSMOS_LOG_RETENTION_DAYS`；仅接受正整数，否则为 `7`。 |
| `maxBytes` | option 优先，其次 `COSMOS_LOG_MAX_BYTES`；仅接受正整数，否则为 256 MiB，即 `268435456`。 |
| `rotateBytes` | 仅来自 option；仅接受正整数，否则为 16 MiB，即 `16777216`。 |

## 重建验收

- 给定：option、环境变量和默认值同时存在或包含非法值 → 观察：按既定优先级得到 level、output、root、容量及保留配置 → 且不发生：非法枚举、空 root 或非正整数进入运行配置。
- 给定：嵌套 child、local context 和 `withContext` 异步调用 → 观察：关联标识按 current store、local、新 context 合并且跨 await 保持 → 且不发生：上下文泄漏到无关异步调用链。
- 给定：阈值为任一级别并依次记录四级事件 → 观察：仅等于或高于阈值的 JSONL 被写出 → 且不发生：被过滤记录进入 stdout 或 file queue。
- 给定：敏感 key、敏感文本、超长 string、宽 object/array、深层结构、bigint、undefined 和深 cause Error → 观察：按清洗与边界规则得到稳定可序列化记录 → 且不发生：凭据明文、undefined 字段或无界 Error cause 出现在输出。
- 给定：记录 UTF-8 JSON 超过 64 KiB → 观察：输出仅保留核心 metadata、关联标识并带 `truncated: true` → 且不发生：原始超限 fields 继续写入 sink。
- 给定：active 文件非空且 UTC 日期变化，或下一次 append 将超过 `rotateBytes` → 观察：active 按规定名称轮转后再追加 → 且不发生：空文件无意义轮转或 active 被 prune 删除。
- 给定：存在过期轮转文件且全部 `.jsonl` 总量超过 `maxBytes` → 观察：先按 retention 删除，再从最旧轮转文件按容量删除 → 且不发生：active 或不匹配轮转命名的文件被删除。
- 给定：file sink 首次失败且 output 分别为 file 与 both → 观察：stderr 仅报告一次，file 模式 fallback stdout，both 模式不重复 stdout → 且不发生：日志失败向应用抛出异常。
- 给定：stdout writer 和 stderr reporter 均失败 → 观察：`logging.sink_failed` 被尝试报告且调用正常返回 → 且不发生：日志错误改变 application 控制流。
- 给定：application 未注入 `LoggerPort` → 观察：noop wiring 接收日志调用且不产生记录 → 且不发生：用例因 logger 缺失失败或获得日志存储所有权。
- 给定：执行 smoke-node 验收并指定 `logRoot` → 观察：API 与 Worker records 存在、requestId 完成 bridge、敏感 key 被脱敏且 undefined 被省略 → 且不发生：smoke-node 被视为该日志组件本身。

## 实现与测试锚点

- `packages/logging/src/index.ts`：schema、类型、配置解析、module-global `AsyncLocalStorage`、RuntimeLogger、清洗与截断、RotatingFileSink、失败降级和 close。
- `packages/logging/src/index.test.ts`：config root、context/level、redaction/error bound、size/date rotation、retention/max total、record truncation、file fallback、stdout failure。
- application 代码中的 `LoggerPort` 及其 noop 默认 wiring：验证可选注入与无存储所有权边界。
- `smoke-node`：仅作为端到端验收锚点，覆盖指定 `logRoot`、API 与 Worker records、requestId bridge、敏感 key 和 undefined 检查。

## 非目标/边界

- 不提供跨进程 rotation lock；多个进程共享同一 active 文件时不保证轮转互斥。
- 不提供强一致 retention；prune 发生在 append 后，且 active 永不删除，因此总量可持续高于 `maxBytes`。
- 不构建审计账本，不承诺不可篡改、不可抵赖、完整历史或业务重放。
- 日志不是 `DomainEvent`，不能替代领域事件发布、持久化或消费。
- 容器运行、browser 运行和真实来源验证不在当前测试的已验证范围内；`sourceId`、`connectorId` 等仅为调用方提供的关联值，不证明来源真实性。
