# Webhook 入口 HTTP 面

## 组件定位

外部自动化调用 Cosmos 触发某个采集计划的入口，由 API 进程提供。它**不在 `/api/v1` 下**（ADR-0024 决定 2）：调用方是用户自己的脚本或工具，不是产品客户端，所以它不带产品 API 的版本语义，也不使用产品 API 的 `ServiceError` 枚举。

它解决的是「外部发生了一件事，立刻抓一次」：入口只负责体积上限、速率上限、常量时间凭证校验、幂等与入队，真正的采集由 durable Workflow 执行。典型情景是用户在本机 cron 或其它工具里 POST 入口地址，Cosmos 立刻为该计划排一个 webhook Run，并留下这次触发的原因。

与相邻组件的边界：入口不抓取、不解析、不写领域数据；它只创建 queued 的 WorkflowEnvelope。计划与触发器的读写归 [Product API](0002-product-api-http.md) 与 [Prisma 仓储](../storage/0001-prisma-repository.md)。

产品面把 `/hooks/*` 透传给 API（`apps/web/next.config.ts` 的 rewrite），所以计划面板给出的入口地址与用户当前访问的地址同源、复制即可用；入口本身仍由 API 进程提供，Web 只是透传。

## 概念与定义

- **入口标识**（`TriggerBinding.webhookToken`）：URL 路径里的不可猜随机值，定位到某条 `kind = webhook` 的触发器。它会出现在 URL 与日志里，所以**它不是凭证**。
- **入口凭证**（credential）：另一份随机值，保存在 SecretStore（ADR-0017），只在生成/轮换响应里回显一次；读投影只回答 `credentialConfigured`。
- **外部事件标识**（`X-Cosmos-Event-Id`）：调用方为这次外部事件给出的标识，直接作为入队幂等键；它同时进触发证据。
- **触发证据**（`TriggerEvidence`）：见 [contracts](../contracts/0001-public-contracts.md) 的定义，`bindingId` 用触发器行的稳定 id（不是会随轮换改变的入口标识）。

## 外部行为

`POST /hooks/collection-plans/{token}` 按以下顺序处理：

1. `content-length` 声明超过 16 KB，或实际 body 序列化后超过 16 KB：413 `payload_too_large`，不入队。
2. 该入口在最近一分钟内已超过 30 次请求：429 `rate_limited`（`retryable: true`），不入队。
3. 解析入口并按 `SecretStore` 里的凭证做常量时间校验；**入口不存在与凭证不对返回同一个 404**（`not_found`，`message` 固定为 `Webhook entry not found.`），否则这个端点会成为枚举入口的工具。
4. `X-Cosmos-Event-Id` 缺失或超过 300 字符：400 `validation_failed`，不入队。
5. 计划或触发器停用：409 `conflict`；durable Workflow host 未启用：409 `conflict`（legacy 泳道记不下触发原因，所以拒绝而不是降级）。
6. 入队 `cosmos.ingest@1`，`triggerKind = "webhook"`，幂等键 = 外部事件标识，触发证据含绑定 id、外部事件标识与入口收到时间；成功返回 202 与 Product Run 投影。
7. 同一外部事件标识重复投递：返回**同一个** Run，不产生第二个（幂等由入队路径的幂等键保证）。

## 输入

| 位置 | 名称 | 约束 |
| --- | --- | --- |
| path | `token` | trim 后非空；对应 `TriggerBinding.webhookToken` |
| header | `x-cosmos-credential` | 必需；缺失直接 404，不调用凭证校验 |
| header | `x-cosmos-event-id` | 必需；trim 后 1–300 字符 |
| body | 任意 JSON | 内容不被读取，只受 16 KB 体积上限约束 |

## 输出

成功（202）返回 Product Run 投影（`runSnapshotSchema` 形状：`id`、`sourceId`、`triggerKind`、`triggerEvidence`、`status`、时间与计数）。

失败返回 `{ code, message, retryable, requestId }`，`code` 取 `payload_too_large`、`rate_limited`、`not_found`、`validation_failed` 或 `conflict`。这些码是本入口自己的错误面，不加入产品 API 的 `ServiceError` 枚举。

## 状态与持久化

入口自身**无持久状态**：

- 入口标识与凭证引用在 `TriggerBinding` 的 webhook 行上（`webhookToken`、`secretRef`）；
- 凭证字节在 SecretStore，公开面只有不透明引用；
- 触发证据随 Run 的输入快照持久化；
- 速率窗口是 API 进程内存（每入口一个滑动窗口，桶数上限 512），**进程重启后清零**——限流只保护进程与来源平台，不承担配额或计费语义。

## 状态转换

入口不改变计划或触发器的状态，只创建 Run。可判定的转换只有：`无 Run → queued Run`（首次投递）与 `queued Run → 同一个 queued Run`（重复投递同一事件标识）。

## 副作用

- 写一条 queued 的 durable WorkflowEnvelope（含触发证据）；
- 写结构化日志 `collection_plan.webhook.accepted`（含 `planId`、`bindingId`、`runId`、`status`）；**不记录凭证与请求体**；
- 不写领域数据、不发外部请求。

## 错误与降级

| 情况 | 结果 |
| --- | --- |
| body 超过 16 KB | 413 `payload_too_large`，不入队 |
| 一分钟内超过 30 次 | 429 `rate_limited`，不入队 |
| 入口不存在 / 凭证不对 / 凭证缺失 | 404 `not_found`，响应体一致，不入队 |
| 事件标识缺失或超长 | 400 `validation_failed`，不入队 |
| 计划或触发器停用 | 409 `conflict`，不入队 |
| durable host 未启用 | 409 `conflict`，不入队 |
| 幂等键命中但 source 或触发类型不同 | 409 `conflict`（由入队路径判定） |

没有静默降级路径：所有拒绝都不产生 Run。

## 依赖

- `CosmosRepository.resolveCollectionPlanWebhookEntry(token)`：按入口标识解析计划、触发器与凭证引用，墓碑来源的计划视为不存在；
- `CosmosRepository.verifyCollectionPlanWebhookCredential(secretRef, credential)`：常量时间比较（两侧先取等长 SHA-256 摘要），只回答对与不对；
- `IngestWorkflowControlService.enqueue`：见 [Ingest Workflow Control](../application/0005-ingest-workflow-control.md)；
- SecretStore：见 ADR-0017 的边界（受限权限明文文件、不加密-at-rest）。

## 配置

上限是代码常量而不是环境变量：`WEBHOOK_MAX_BODY_BYTES = 16384`、`WEBHOOK_MAX_REQUESTS_PER_MINUTE = 30`（`apps/api/src/hook.controller.ts`）。入口路由的声明路径与 `main.ts` 的全局前缀排除项共用 `WEBHOOK_ENTRY_ROUTE_PATH` 常量，两处必须一致。

## 重建验收

- [ ] `POST /hooks/collection-plans/{token}` 在正确的凭证与事件标识下返回 202 与 queued Run，且 Run 的 `triggerKind` 为 `webhook`、`triggerEvidence.externalEventId` 等于请求的事件标识。
- [ ] 同一事件标识投递两次：第二次返回同一个 Run，且该来源的 webhook Run 只有一个。
- [ ] 错误凭证与不存在的入口：状态码与响应体（除 `requestId`）完全一致，且都不产生 Run。
- [ ] 缺少 `X-Cosmos-Event-Id` 返回 400；body 超过 16 KB 返回 413；两者都不产生 Run。
- [ ] 计划停用时返回 409，不产生 Run。
- [ ] 同一路径挂在 `/api/v1` 下时返回 404（入口不在产品 API 版本前缀内）。
- [ ] 撤销入口后，原入口地址与凭证返回 404。
- [ ] 结构化日志中不出现凭证明文。

## 实现与测试锚点

- 实现：[`apps/api/src/hook.controller.ts`](../../../apps/api/src/hook.controller.ts)、[`apps/api/src/webhook-rate-limiter.ts`](../../../apps/api/src/webhook-rate-limiter.ts)、`apps/api/src/main.ts` 的 `setGlobalPrefix` 排除项、`apps/api/src/app.module.ts` 的控制器注册。
- 行为测试：[`apps/api/src/hook.controller.test.ts`](../../../apps/api/src/hook.controller.test.ts)（路由声明、202、鉴权不可区分、体积/速率/事件标识/停用、证据）、[`apps/api/src/webhook-rate-limiter.test.ts`](../../../apps/api/src/webhook-rate-limiter.test.ts)。
- 端到端：[`e2e/webhook-entry.e2e.test.ts`](../../../e2e/webhook-entry.e2e.test.ts)（真实 API 进程、真实 HTTP、隔离数据库与日志根）。
