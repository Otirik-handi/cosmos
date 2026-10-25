# Task 39 Provider/model 配置续篇（九）：`agent.invoke@2` 连接作用域 smoke

> 2026-10-25，本册承接 `walkthrough-provider-model.md` 的完成条件 ③，记录 `agent.invoke@2` 的真实请求证据。
> 由 `walkthrough-provider-model.md` 按文档大小治理拆出，内容原样保留、不重写。
> 同系列：`walkthrough-provider-model.md`（本篇）、`walkthrough-provider-model-02.md`、`walkthrough-provider-model-04.md`、`walkthrough-provider-model-06.md`、`walkthrough-provider-model-07.md`、`walkthrough-provider-model-08.md`、`walkthrough-provider-model-09.md`。

## `@2` 连接作用域 smoke（已外呼四次，最后一次通过）

完成条件 ② 的调用链路（Connection → Model → Provider → SecretStore）此前只有隔离端到端测试覆盖，没有可复跑的 runner。本轮补了三个 `@2` 模式，`@1` 的计划与根字节保持不变：`connection-smoke-harness.ts`（隔离根、TTY 守卫、无回显读入、`prepareDatabase`、受控 transport、诊断；不 import 另两个）、`connection-smoke-v2.ts`（`@2` 段）、`connection-smoke.ts`（`@1` 段与 `runCli`，`export *` 转发另两个）。拆分的直接原因是合体时 37.65 KB 触发代码门禁「新增警戒区」——那属于本轮新引入，不能登记进台账绕过。

- `offline-v2`：在隔离库按产品路径造数（`ModelProviderCredentials` 写凭证 → `ConfiguredModels` 建模型 → `createConnection` 建 `cosmos.agent` 连接），再用假 SDK 跑 `agent.invoke@2`。实测 `.agent/tmp/task39-offline-v2-SWT7cG/result.json`：`migrationCount=42`、`sdkCalls=2`、`secretReads=1`、`resolvedFromConnection=true`、`maxOutputTokensClamped=true`、`missingSecretRejected=true`、`revokedRejected=true`，各产物不含合成凭证。
- `prepare-real-v2`：只生成隔离根与 `request-plan-v2.json`（`mode: "real-v2"`），不读凭证、不联网、42 条冻结迁移。
- `real-v2 <prepared-root>`：与 `real` 同级保护（TTY + 手打 `APPROVED` + 无回显凭证、单次传输、`redirect=error`、SDK 日志 off、300000ms 调用预算、305000ms 信号预算、诊断只记固定阶段与状态码）。

两个前缀重叠（`task39-real-` 也是 `task39-real-v2-` 的前缀），所以 `@1` 的 `validatePreparedRoot` 显式排掉 `v2-` 而不是靠「缺 plan 文件」失败关闭；反向由 `validatePreparedRootV2` 拦住，两者都有交叉根的拒绝测试。

### 三次 400：一个真缺陷与一次误判

前三次真实外呼（两次 `real-v2`，根 `.agent/tmp/task39-real-v2-35s4PY` 与 `.agent/tmp/task39-real-v2-hfdrrF`；一次隔离用的 `real`，根 `.agent/tmp/task39-real-ppWAKt`）各 1 次传输、服务商均 **HTTP 400**、凭证均已删、都没有 `result.json`，分类依次是 `malformed_payload`（映射缺陷未修）与两次 `invalid_configuration`。

第一次失败暴露了一个真缺陷：pi-ai 在非 2xx 时**不抛错**，而是把状态码与正文拼进 `errorMessage`、以 `stopReason: "error"` 正常 resolve；两个适配器只按 `stopReason` 推结束原因，推不出就一律报 `malformed_payload`，于是 401、429、5xx 全被写成「协议错误」且标成不可重试。修复：新增 `mapPiAiResponseFailure`（`packages/agent-pi-ai/src/pi-models.ts`），在 `mapResponse`/`mapResponseV2` 里先按 `errorMessage` 归因；`mapPiAiError` 增加 400/422 与 404 → `invalid_configuration`（不可重试），认证与限流的判断排在这些状态码之前。

离线验证（假 `fetch`，无网络）：`@1` 与 `@2` 实际发出的请求**逐字节相同**（URL、`{"model":"gpt-6-luna","messages":[…],"stream":true,"stream_options":{"include_usage":true},"store":false,"max_completion_tokens":64,"tools":[]}`、`Authorization: Bearer <凭证>`），故请求形状不是原因。

### 真实原因：粘贴损坏的凭证

维护者用同一条 URL 直接请求得到 **HTTP 200** 与正常 SSE 流，并确认「是我复制粘贴出了问题」。前三次 400 全部是**粘进终端的凭证不是那把 key 的原始字节**；那条「拒绝在服务商侧」的中间结论是错的。两个一次性探针（`.agent/tmp/`，不写文件、不碰隔离根）佐证：`credential-probe.ts` 只回显长度、`sha256` 前 8 位与字符类别；`minimal-request-probe.ts` 只发 `{model, messages, stream:true}` 且手打 `SEND` 才发，拿到 `status: 200`、`contentType: text/event-stream`——说明网关接受网页控制台那套字段，pi-ai 额外塞的 `stream_options`/`store`/`max_completion_tokens`/`tools` 从未被证明有问题。

由此得到真实加固点：**形状不对的凭证必须在发请求前失败**。`connection-smoke-harness.ts` 新增 `assertUsableCredential(value)`，在两个 runner 的 `credential_input` 阶段替换 `if (!value.trim())`——空串、含空白、含非 ASCII/控制字符一律抛错，坏粘贴停在 `credential_input`、`transportSends: 0`，不再花一次真实请求换回一个无法解释的 400。

### 第四次外呼：`@2` 拿到 200

用正确凭证在新根 `.agent/tmp/task39-real-v2-YQqFPF` 重跑 `real-v2` 成功。`result.json`：`status: "completed"`、`provider: "provider-task39-v2"`、`model: "gpt-6-luna"`、`usage: {inputTokens: 0, outputTokens: 5, totalTokens: 5}`、`outputMatchesExpected: true`、`credentialAbsentFromOutput: true`、`secretReads: 1`、`responseStatus: 200`、`responseReturned: true`、`providerBodyRecorded: false`、`retained: true`。`diagnostic.json`：`transportSends: 1`、`firstFailure: null`、`secretDelete`/`disconnect` 均 `completed`；根内 `secrets/model-provider` 为 0 字节。

- **证明**：调用方只给 `connectionId`，模型、地址与凭证全部按 Connection → Model → Provider → SecretStore 在服务端解析（`secretReads: 1`、`credentialAbsentFromOutput: true`、Provider 记配置行而非上游品牌名）。
- **不覆盖**：UI 凭证录入、其它 Provider、OAuth、工具执行、流式结果（适配器只取 `complete()` 的最终消息）、常驻 Worker/Workflow 调度、生产部署。
- `usage.inputTokens` 为 0 而 `totalTokens` 为 5，与 10-23 那次 `@1` 的 1134 不一致；这是服务商返回的计费字段，适配器原样透传，只记现象不推断网关行为。

至此完成条件 ③ 的两半都有真实请求证据：`@1`（`task39-real-QmVMec`，200）与 `@2`（`task39-real-v2-YQqFPF`，200）。

一处既有不一致，只记录不修改：`.agent/tmp/task39-real-QmVMec/request-plan.json` 记 `snapshotCommit = f66c3313…`，而 `4e10172` 把常量改成 `62c8624d…`，按当前代码 `validatePreparedRoot` 会以 `Request plan changed.` 拒绝该根；它已含 `attempted.json`、本就不可重跑，README 记为已完成证据仍成立，但「按当前 HEAD 复跑同一根」已不可行。
