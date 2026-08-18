# 受管采集器

## 状态

当前实现规格；后续代码变化应同步更新本文。

本文档仅描述当前实现中 `plugins/collectors/src/index.ts` 与 `plugins/collectors/src/index.test.ts` 可观察到的实际行为。范围限定为一个组件：受管 Bilibili/OpenCLI 采集器、AI HOT 采集器及 builtin Connector registry。

本文不是未来设计，不承诺当前实现之外的功能。

## 最后更新

按当前实现与测试校准。

## 组件定位

该组件提供两类内容来源连接器，并将它们与既有 RSS 连接器一起装入进程内 builtin registry：

- Bilibili 通过受管 `@jackwener/opencli` 进程调用获取 `hot` 或 `feed` 内容。
- AI HOT 通过固定公共 HTTP API 获取分页内容。
- builtin registry 按业务 `Source.kind` 解析连接器。
- RSS 与 `fixture-rss` 的具体行为由 [RSS Connector 规格](./0001-rss.md) 定义，本文只规定它们在 registry 中的注册关系。

组件只负责获取、解析和标准化，不直接持久化领域对象、Blob 或 checkpoint。后续持久化属于 Worker/Application 与 Connector runtime 的职责。


### 在系统中的位置与作用
它是 builtin connector registry 中的受管 Bilibili/OpenCLI 与 AI HOT 连接器，和 RSS connector 一起为 Source kind 提供来源适配。

### 解决的问题
它把外部命令或公共 HTTP API 的返回转换为共同的 connector 输出和 domain 规范化结果，让上层不需要理解各来源协议；不直接持久化。

### 使用方式
组合根加载 builtin registry；runtime 按 Source kind 解析连接器，先校验配置，再调用相应 fetch，后续写入、Blob 和 checkpoint 交给 Application/Workflow/Storage。

### 典型情景
Source 配置选择 Bilibili feed/hot 或 AI HOT 分页来源时，使用这里的 connector；RSS/fixture-rss 的细节继续遵循 [RSS Connector](0001-rss.md)。

## 概念与定义

共享类型不在本文重复定义：

- `Source`、`Checkpoint` 见 [公共 Contracts](../contracts/0001-public-contracts.md) 和 [Ingest Workflow](../application/0006-ingest-workflow.md)；本文不重复其结构。
- `Connector` 的调用与错误处理见 [Connector Runtime](../application/0001-connector-runtime.md)。
- `NormalizedIngestItem`、`Publisher`、`TemporalValue`、`ContentMetrics`、`Asset` 见 [标准化内容领域模型](../domain/0001-normalized-content.md)。
- 原始负载与资产的 Blob 持久化见 [File Blob Store](../storage/0005-file-blob-store.md)。

本文使用以下组件内概念：

- **受管 OpenCLI runner**：将 OpenCLI 命令转换为子进程调用，并返回退出码、标准输出和标准错误。
- **版本检查**：Bilibili connector 实例首次获取前执行一次 OpenCLI `--version` 验证。
- **preflight**：每次 Bilibili 获取前执行 OpenCLI `doctor`，检查 Browser Bridge 连接状态。
- **builtin registry**：仅存在于当前进程内、按注册顺序暴露 descriptor 并按 `Source.kind` 解析 connector 的 registry。

固定标识和常量如下：

| 名称 | 值 |
| --- | --- |
| `bilibiliConnectorId` | `bilibili` |
| `aiHotConnectorId` | `aihot` |
| `openCliExecutableEnv` | `COSMOS_OPENCLI_PATH` |
| `aiHotItemsUrl` | `https://aihot.virxact.com/api/v1/items` |
| `supportedOpenCliMajor` | `1` |

## 外部行为

### Connector 调用边界

两个受管 connector 都实现 `validate(source)`；该方法只校验各自的 Source config，不执行远端可达性或真实来源内容验证。`fetchItems({ source, cursor, idempotencyKey?, signal? })` 使用对象参数并返回 `items` 与 `nextCursor`；Bilibili 不消费 cursor，AI HOT 只按其 truthy 值生成 query 参数。连接器不直接持久化领域对象、Blob 或 checkpoint。

### Bilibili/OpenCLI

Bilibili connector 的 `id` 为 `bilibili`，`configVersion` 为 `v1`，capabilities 按实现暴露为：

```text
bilibili
opencli
browser-bridge
```

每次 fetch 的执行顺序固定为：

1. 解析并验证当前 `Source` 的 connector config。
2. 当 `checkVersion=true` 且当前 connector 实例尚未完成版本检查时，执行 `--version`。
3. 当 `preflight=true` 时，使用同一 profile 环境执行 `doctor`。
4. 严格以 `bilibili <mode> --limit <limit> -f json` 执行业务命令。
5. 解释退出状态。
6. 解析 JSON，逐项标准化，并返回 `nextCursor: null`。

业务命令参数不增加 cursor、endpoint、认证参数或其他隐式选项。调用方提供的 `AbortSignal` 会传递给 OpenCLI runner。

默认 runner 按以下优先级选择可执行入口：

1. 构造选项中的 `options.executable`。
2. 环境变量 `COSMOS_OPENCLI_PATH`。
3. `process.execPath`，并将 `require.resolve("@jackwener/opencli")` 得到的入口作为 Node 参数。

通过前两项选出的外部可执行文件若以 `.cmd` 或 `.bat` 结尾，则以 shell 模式执行。

默认 timeout 为 `120000` 毫秒，默认 `maxBufferBytes` 为 `4 * 1024 * 1024`。当前实现中，`maxBufferBytes` 只存在于 runner 接口和默认值中，没有传给 `execFileAsync`；源码只将 timeout 和 signal 作为对应执行控制项传入。因此，4 MiB 不是当前实际生效的子进程输出上限。

默认 `checkVersion=true`。每个 Bilibili connector 实例只进行一次版本检查。`--version` 必须以退出码 `0` 完成，且输出必须可识别为 semver major `1`；否则 fetch 以不可重试的 `unsupported_version` 失败。

默认 `preflight=true`。preflight 调用 `doctor`，并使用与业务命令相同的 `OPENCLI_PROFILE` 环境。若输出包含 `extension: not connected` 或 `connectivity: failed`，fetch 以可重试的 `dependency_unavailable` 失败。

OpenCLI 正常输出先直接执行 `JSON.parse`。直接解析失败时，解析器扫描输出中的首个可闭合数组或对象候选并再次解析。接受的顶层结构为：

- 数组，且数组中的每个元素都必须是对象；
- 对象中的 `items`、`data` 或 `results` 数组，只有该数组的每个元素都是对象时才会展开为行；
- 不含上述可用数组的对象，此时对象自身作为唯一一行。若对象带有 `items`、`data` 或 `results` 但数组含非对象元素，当前实现会回退为把整个对象作为唯一一行，而不是专门报告该数组错误。

顶层数组含非对象元素，或顶层值既不是可接受的对象也不是全对象数组时，以不可重试的 `malformed_payload` 失败。

### AI HOT

AI HOT connector 的 `id` 为 `aihot`，description 表明其为 public API connector，`configVersion` 为 `v1`，capabilities 按实现暴露为：

```text
aihot
http
public
```

每次 fetch 固定请求：

```text
https://aihot.virxact.com/api/v1/items
```

只有输入 cursor 为 truthy 时，才通过 `cursor` query 参数加入请求 URL。调用方提供的 `AbortSignal` 会传递给 HTTP fetch。

HTTP `429` 映射为可重试的 `rate_limited`。其他非 2xx 响应映射为 `dependency_unavailable`，其中仅 5xx 或 429 可重试；其他非 2xx 不可重试。

成功响应先读取 text，再执行 `JSON.parse`。顶层必须是对象且必须包含 `items` 数组；每个 item 必须是对象。缺少有效 `id` 或 `title` 的 item 也视为非法。非法 JSON、缺少 `items`、非对象 item 或缺少必需字段均以不可重试的 `malformed_payload` 失败。

`page.nextCursor` 通过实现的文本读取规则处理：非空字符串原样作为下一页 cursor，数字或布尔值会转成文本，空字符串、缺失值或其他类型得到 `null`。

### Builtin registry

`createBuiltInConnectorRegistry` 注册且仅注册以下 connector，顺序固定：

1. `rss`
2. `fixture-rss`
3. `bilibili`
4. `aihot`

`opencli` 不是独立注册的 connector kind。以 `Source.kind=opencli` 解析必须失败，不能将其隐式转发到 Bilibili。

Registry descriptor 暴露每个 connector 的：

- `id`
- `description`
- `capabilities`
- `configVersion`

Registry 按业务 `Source.kind` resolve connector，不根据 capability、可执行文件名称或 URL 推断 connector。

## 输入

### Bilibili config

| 字段 | 约束 | 默认值 |
| --- | --- | --- |
| `schemaVersion` | 正整数 | `1` |
| `mode` | 只能是 `hot` 或 `feed` | 无 |
| `limit` | `1..100` 的整数 | `20` |
| `profile` | 可选；长度 `1..100`；只允许 `A-Z`、`a-z`、`0-9`、`.`、`_`、`-` | 无 |
| `scheduleIntervalMs` | 共享的可选调度值 | 无 |

当 `mode=feed` 时必须提供合法 `profile`。无效 config 抛出不可重试的 `invalid_configuration`。

若提供 profile，OpenCLI 子进程环境包含：

```text
OPENCLI_PROFILE=<profile>
```

版本检查、doctor 和业务命令使用同一 profile 环境。

### AI HOT config

AI HOT config 只接受：

| 字段 | 约束 | 默认值 |
| --- | --- | --- |
| `schemaVersion` | 正整数 | `1` |
| `scheduleIntervalMs` | 共享的可选调度值 | 无 |

AI HOT 不允许通过 config 指定 endpoint、header 或认证信息。固定 URL 不可由 `Source` config 覆盖。

### Fetch 输入

两个 connector 都接受 Connector runtime 提供的 `Source`、cursor 和 `AbortSignal`。Bilibili 不消费 cursor，并且始终返回 `nextCursor: null`；AI HOT 只在 cursor 为 truthy 时将其发送到固定 API。

## 输出

### Bilibili 标准化

每个 Bilibili 行对象生成一个 `NormalizedIngestItem`，字段来源如下：

| 输出语义 | 输入优先级或规则 |
| --- | --- |
| external ID | `bvid`、`id`、`aid`、`video_id` |
| title | `title`、`name`；均无值时为 `Untitled Bilibili item` |
| summary | `description`、`desc`、`summary` |
| content URL | `url`、`link`、`web_url`；否则由 BV ID 推导 `https://www.bilibili.com/video/BV...` |
| published time | `published_at`、`publishedAt`、`pubdate`、`time`，按 `Asia/Shanghai` 解释 |
| kind | `hot` 模式为 `listing`；`feed` 模式为 `video` |
| raw payload | `JSON.stringify(row)` |
| raw MIME | `application/json` |

publisher 名称按 `author`、`author_name`、`author.name`、`owner.name` 选择；platform ID 按 `mid`、`uid`、`author_id`、`owner.mid`、`owner.uid` 选择；profile URL 按 `author_url`、`owner.url` 选择；publisher kind 为 `user`。没有名称时 publisher 为 `null`。

source locator 包含 provider `bilibili`、mode、从 `1` 开始的 rank 和 externalId。

图片按 `cover`、`pic`、`thumbnail`、`cover_url` 选择，生成 `metadata_only` 的 cover asset。

指标映射如下：

| 标准指标 | 输入字段 |
| --- | --- |
| likes | `likes`、`like` |
| views | `views`、`view` |
| reposts | `reposts`、`repost` |
| comments | `comments`、`comment` |
| collects | `collects`、`favorite`、`favorites` |
| score | `score` |

每个指标的 raw 保留字符串形式；可转换为数值时写入 values；reliability 为 `unknown`；capturedAt 为标准化时的当前时间。

### AI HOT 标准化

每个 AI HOT item 生成一个 `NormalizedIngestItem`，字段来源如下：

| 输出语义 | 输入优先级或规则 |
| --- | --- |
| external ID | 必需的 `id` |
| title | 必需的 `title` |
| summary | `summary`、`description` |
| content | `content`、`text`、`summary`、`title` |
| content URL | `links.original`、`links.url`、`item.url`；否则 `links.aihot` |
| kind | `article` |
| published time | `publishedAt`、`published_at`、`discoveredAt`，按 UTC 解释 |
| raw payload | `JSON.stringify(item)` |
| raw MIME | `application/json` |

publisher platform ID 按 `authorId`、`author_id`、`author.id` 选择；名称按字符串 `author`、`authorName`、`author.name`、`source.name` 选择；publisher kind 为 `unknown`。

source locator 包含 provider `aihot`、itemId、category、sourceName 和 links。

图片按 `links.image`、`links.thumbnail`、`item.image`、`item.thumbnail` 选择，生成 `metadata_only` 的 image asset。

AI HOT 使用与 Bilibili 相同的 likes、views、reposts、comments、collects、score 指标字段映射、raw 字符串保留、数值转换、`unknown` reliability 和当前时间 capturedAt。

返回 cursor 为响应中的字符串 `page.nextCursor`，否则为 `null`。

## 状态与持久化

Builtin registry 是纯进程内对象，不维护跨进程持久状态。

Bilibili connector 实例仅维护“本实例是否已经完成 OpenCLI 版本检查”的进程内状态。该状态不会写入 checkpoint，进程重启或重新构造 connector 后会重新检查版本。

AI HOT connector 不保存页游标。它只返回 `nextCursor`，由上层 Connector runtime 决定是否以及何时持久化为 `Checkpoint`。

两个 connector 都不直接写入领域存储或 Blob store。raw payload 是标准化 item 中由实现生成的 `JSON.stringify(row)` 或 `JSON.stringify(item)` 字符串；后续是否及如何转为受控 Blob、Asset 或 Observation 持久化由 Worker/Application 与 storage owner 负责。

## 状态转换

### Bilibili fetch

```text
接收 fetch
  -> 验证 config
  -> [需要时] 未检查版本 -> --version -> 已检查版本
  -> [启用时] doctor preflight
  -> 执行 bilibili mode --limit limit -f json
  -> 解释退出状态
  -> 解析负载
  -> 标准化 items
  -> 返回 items 与 null cursor
```

任一步骤失败即终止本次 fetch，不返回部分结果。通过版本检查后，同一 connector 实例的后续 fetch 跳过 `--version`；启用 preflight 时，doctor 仍在每次业务执行前运行。

### AI HOT fetch

```text
接收 fetch
  -> 验证 config
  -> 构造固定 URL 和可选 cursor query
  -> 发起 HTTP 请求
  -> 检查状态码
  -> 读取 text 并解析 JSON
  -> 验证 items
  -> 标准化全部 items
  -> 返回 items 与 page.nextCursor 或 null
```

任何 item 非法都会使整个响应失败，不返回已经标准化的前置 item。

### Registry

```text
构造 registry
  -> 按固定顺序注册四个 connector
  -> 暴露 descriptors
  -> 按 Source.kind resolve
```

Registry 构造后没有持久化或恢复阶段。

## 副作用

Bilibili connector 可能产生以下副作用：

- 启动 Node/OpenCLI 或外部 `.cmd`、`.bat`、可执行程序。
- 读取 `COSMOS_OPENCLI_PATH`。
- 向子进程传递 `OPENCLI_PROFILE`。
- 调用 OpenCLI `--version`、`doctor` 和 Bilibili 命令。
- 将调用方的取消 signal 传播到子进程执行。

AI HOT connector 向固定 HTTPS endpoint 发起 GET 请求，并传播调用方的取消 signal。

日志只记录低基数状态、字节数、item 数量、耗时和错误码，不记录原始 payload、标准化正文或响应内容。

组件不直接写数据库、领域仓库、Blob store 或 checkpoint；上述网络/子进程调用和内存中的标准化只代表 connector 执行副作用，不证明真实 Bilibili、OpenCLI、Browser Bridge 或 AI HOT 来源已验证。

## 错误与降级

| 条件 | 错误码 | 可重试 |
| --- | --- | --- |
| Bilibili config 无效 | `invalid_configuration` | 否 |
| OpenCLI 版本退出码非 0、不是可识别 semver 或 major 非 1 | `unsupported_version` | 否 |
| doctor 输出含 `extension: not connected` | `dependency_unavailable` | 是 |
| doctor 输出含 `connectivity: failed` | `dependency_unavailable` | 是 |
| OpenCLI 退出码 `66` | 不报错，返回空 items 和 null cursor | 不适用 |
| OpenCLI 退出码 `69` | `dependency_unavailable`，表示 Browser Bridge 不可用 | 是 |
| OpenCLI 退出码 `77` | `authentication_required` | 否 |
| OpenCLI 执行结果为 killed、`SIGTERM` 或 `ETIMEDOUT` | `timeout` | 是 |
| 其他 OpenCLI 执行失败 | `dependency_unavailable` | 是 |
| Bilibili JSON 或行结构非法 | `malformed_payload` | 否 |
| AI HOT HTTP `429` | `rate_limited` | 是 |
| AI HOT HTTP 5xx | `dependency_unavailable` | 是 |
| AI HOT 其他非 2xx | `dependency_unavailable` | 否 |
| AI HOT JSON、顶层结构、item 类型或必需字段非法 | `malformed_payload` | 否 |

AI HOT 的底层网络异常可以原样到达上层，并由 Connector runtime 统一归类；本文不将所有 fetch 抛出的网络异常声明为 connector 内部已映射错误。`validate(source)` 的 config parse 失败才是 connector 明确产生的 `invalid_configuration` 边界。

Bilibili 的退出码 `66` 是明确的空结果降级，不尝试解析 stdout，并且 `nextCursor` 仍为 `null`。

## 依赖

运行时依赖包括：

- Node.js `process.execPath`、环境变量和子进程 `execFileAsync` 能力。
- `@jackwener/opencli`，用于没有外部 executable 时的默认受管入口。
- OpenCLI Bilibili 扩展及 Browser Bridge，用于实际 Bilibili 获取。
- HTTP fetch 实现，用于 AI HOT 固定公共 API。
- 公共 contracts、标准化领域模型和 Connector runtime 错误模型。
- RSS connector 实现，仅用于 builtin registry 中的 `rss` 与 `fixture-rss` 注册。

Browser Bridge 是 Bilibili 运行依赖，不是独立 connector。AI HOT 不依赖 OpenCLI。

## 配置

组件级默认值如下：

| 配置 | 默认值 | 当前行为 |
| --- | --- | --- |
| OpenCLI executable | `options.executable`，其次 `COSMOS_OPENCLI_PATH`，最后 Node 加包入口 | 构造 runner 时确定 |
| OpenCLI timeout | `120000ms` | 传给 `execFileAsync` |
| OpenCLI max buffer | `4 MiB` | 仅存在于接口和默认值，未传给 `execFileAsync` |
| Bilibili version check | `true` | 每 connector 实例一次 |
| Bilibili preflight | `true` | 每次 fetch 的业务命令前执行 |
| Bilibili limit | `20` | config 未提供时使用 |
| config schema version | `1` | Bilibili 与 AI HOT 均默认 |
| AI HOT endpoint | `https://aihot.virxact.com/api/v1/items` | 固定且不可由 Source config 覆盖 |

`configVersion=v1` 是 connector descriptor 版本；config 中的 `schemaVersion` 是正整数且默认 `1`。当前实现没有在本文中建立二者必须数值相等的额外规则。

## 重建验收

1. 构造 builtin registry 后，读取 descriptor ID 序列必须严格等于 `["rss", "fixture-rss", "bilibili", "aihot"]`，且不存在第五项。
2. 使用 `Source.kind=opencli` resolve 时必须失败；使用 `bilibili` 和 `aihot` 时必须分别得到对应 connector。
3. 对 Bilibili 的非法 mode、越界或非整数 limit、非法 profile、缺少 feed profile 进行 fetch，必须得到不可重试的 `invalid_configuration`，且 runner 未执行业务命令。
4. 使用默认 Bilibili 配置获取时，业务参数必须严格等于 `bilibili hot --limit 20 -f json`；feed 配置必须只将 mode 和合法 limit 替换到相同参数结构中。
5. 同一 Bilibili connector 实例连续成功 fetch 两次且 `checkVersion=true` 时，`--version` 必须只调用一次；版本 major 非 `1` 时必须得到不可重试的 `unsupported_version`。
6. `preflight=true` 时，每次 Bilibili 业务命令前必须调用 `doctor`；doctor 输出任一已规定断连标记时，业务命令不得执行，并得到可重试的 `dependency_unavailable`。
7. 配置 profile 后，版本检查、doctor 和业务命令接收到的 `OPENCLI_PROFILE` 必须相同。
8. OpenCLI 退出码 `66` 必须产生零 items 和 `nextCursor=null`；退出码 `69`、`77`、超时状态及普通执行失败必须分别符合错误映射表。
9. Bilibili 直接 JSON、带前后噪声的首个闭合 JSON 候选、顶层数组、`items/data/results` 数组和单对象必须按规定解析；数组中出现非对象元素必须整体返回不可重试的 `malformed_payload`。
10. 给定覆盖全部字段优先级的 Bilibili fixture 行，标准化结果必须可逐字段断言 external ID、title fallback、URL fallback、`Asia/Shanghai` 时间、publisher、source locator、cover asset、metrics、raw payload、MIME 和固定 null cursor。
11. AI HOT 在 cursor 为 falsy 时请求 URL 不得包含 `cursor`；cursor 为 truthy 时必须只将其作为 query 参数加入固定 URL，并传递 signal。
12. AI HOT 对 `429`、5xx 和其他非 2xx 的错误码及 retryable 值必须符合错误映射表。
13. AI HOT 对非法 JSON、缺失 `items`、非对象 item、缺少 `id` 或缺少 `title` 必须整体返回不可重试的 `malformed_payload`。
14. 给定合法 AI HOT fixture 响应，必须可逐字段断言 content fallback、URL fallback、UTC 时间、publisher、source locator、image asset、metrics、raw payload 和 MIME。
15. AI HOT 对 `page.nextCursor` 必须按实现的文本读取规则返回：非空字符串原样返回，数字或布尔值返回其文本形式，空字符串、缺失值或对象/数组等其他类型返回 `null`。
16. 以 stub runner 和 stub fetch 完成上述验收时，只证明解析、映射和编排行为；不得将 fixture 成功表述为真实 Bilibili、OpenCLI、Browser Bridge 或 AI HOT 可用性验收。
17. 在重建实现中检查子进程调用选项时，必须确认 timeout 和 signal 已传入，同时确认 `maxBufferBytes` 没有被错误宣称为当前实现中已生效的 `execFile` 限制。
18. 对日志采集结果进行断言时，日志可包含状态、字节数、数量、耗时和错误码，但不得包含 fixture payload 正文。

## 实现与测试锚点

代码证据以当前实现中的以下文件为准：

- `plugins/collectors/src/index.ts`
  - 常量锚点：`bilibiliConnectorId`、`aiHotConnectorId`、`openCliExecutableEnv`、`aiHotItemsUrl`、`supportedOpenCliMajor`。
  - OpenCLI runner 锚点：executable 解析、Node 包入口回退、`.cmd/.bat` shell、timeout/signal 传递及执行错误归类。
  - Bilibili 锚点：config schema、单实例版本检查、doctor preflight、严格参数构造、退出码映射、JSON 候选提取和逐行标准化。
  - AI HOT 锚点：固定 URL、cursor query、HTTP 状态映射、响应结构验证、标准化和 `page.nextCursor`。
  - Registry 锚点：`createBuiltInConnectorRegistry` 的注册顺序、descriptor 暴露和 `Source.kind` resolve。
- `plugins/collectors/src/index.test.ts`
  - Bilibili hot 场景断言 `--version`、`doctor`、业务参数、标题/作者/URL/kind/cover/time 和 null cursor。
  - Bilibili feed 场景断言 owner publisher ID、views/likes/collects metrics，以及 feed 必须带 profile 的 validate 边界。
  - doctor 输出 Browser Bridge 未连接时断言 `dependency_unavailable` 且可重试。
  - AI HOT 断言固定 endpoint、输入 cursor query、合法 item 标准化、返回 next cursor，以及非法 JSON 的 `malformed_payload` 和脱敏 transport 日志。
  - builtin descriptor 顺序、四项且仅四项注册，以及 `opencli` 不受支持的场景。
  - 版本不兼容、OpenCLI exit 66/69/77、超时、其他子进程错误、Bilibili JSON 包装形态和完整 metrics 映射等其余分支虽由生产源码实现，但当前测试文件没有逐项断言；不得把它们写成已通过测试。

研究文档、外部产品说明和人工推测不是本组件行为的代码证据。发生冲突时，以当前实现中的 `index.ts` 实现和 `index.test.ts` 可执行断言为准。

## 非目标/边界

- 不定义共享 contracts、标准化领域对象、Connector runtime、Blob 或 checkpoint 的内部结构。
- 不描述 RSS 与 `fixture-rss` 的解析行为。
- 不提供独立 `opencli` connector，也不允许通过 capability 名称解析 connector。
- 不允许 AI HOT 自定义 endpoint、header 或认证。
- 不在 connector 内执行数据库、领域仓库、Blob 或 checkpoint 持久化。
- 不在 connector 内实现调度、重试循环、退避、跨进程恢复或 cursor 持久化。
- 不保证 `maxBufferBytes=4 MiB` 已限制子进程输出；当前实现没有将其传给 `execFileAsync`。
- 不将真实网络异常全部归类为 connector 内部错误；上层 runtime 可以继续归类。
- 不保证真实 AI HOT、Bilibili、OpenCLI、Browser Bridge、网络限流或认证环境可用。
- 不验证 OpenCLI 版本检查状态的跨进程恢复。
- 当前测试中的 stub、fixture 和模拟响应不构成真实来源、真实 Browser Bridge、真实限流或端到端持久化验收。
