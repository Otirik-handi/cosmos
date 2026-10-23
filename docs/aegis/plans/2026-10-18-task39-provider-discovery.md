# Task39 Provider 模型发现实现计划

## Goal

在 Task39 已批准的设计边界内，实现 Provider 模型发现：用户点“获取模型列表”时，API 用已保存的 Provider 配置和凭证同步执行一次受控的 OpenAI `/models` 请求，返回经过限制的 `{modelId,name}` 候选供用户确认。随后才进入 UI/Connection、正式 Worker @2/full execution 和产品 E2E；这些不属于本计划的实现范围。

## Architecture

- `application` 持有发现命令、Provider version 校验、候选解析和 Snapshot 映射，并定义唯一的目录外呼端口。
- 发现是**同步只读**请求：没有队列、幂等键、任务 ID 或轮询端点。`GET /models` 幂等且无副作用，重复发送的代价只是多一次请求，因此不引入 Workflow/Job/Attempt/Lease 流水线，也不引入“结果未知”恢复与重试警告。
- `Worker` 负责生成请求；Host 的持久 dispatch fence 作为通用能力保留，服务于未来 `agent.invoke@2` 这类有副作用的外呼，不参与发现。
- 受控 HTTPS transport 是唯一发现外呼 owner，负责公网 HTTPS 校验、每次 DNS 答案审核、审核地址绑定、原主机 TLS/SNI、超时与响应预算。
- `agent-pi-ai` 当前只提供 SDK 协议适配；生成调用只有在当前 pi-ai 版本经本地源码和行为测试证明支持逐请求 transport 注入后才评估接入，不通过全局 fetch patch 或未验证升级解决。

## Tech Stack and Baseline

- Bun + TypeScript；应用、API、transport、Prisma 存储按既有 Service Endpoint/Command/Query/Transport 边界接线。
- API 设计基线：`docs/api/0009-provider-model-configuration.md` 的发现与网络边界章节。
- 产品基线：`docs/proposals/connection-credential-entry-v1.md` 的显式发现、凭证归属、候选确认与手动录入回退。
- 运行基线：`docs/adr/0017-connection-secret-state-v1.md`（SecretStore 所有权）。
- 过程记录：`.agents/tasks/39-pi-ai-adapter/walkthrough-provider-model-02.md`；该记录继续 append-only。

## Compatibility Boundary

首版只为明确声明兼容 OpenAI `GET <baseUrl>/models` 的 Provider 启用发现。`openai-completions` 和 `openai-responses` 生成类型不自动证明目录协议兼容；其它 Provider 保留手动模型录入。发现结果不自动写入 ConfiguredModel。当前已完成的 Provider/模型 CRUD、凭证写入、Responses adapter 和既有非模型 Connection 行为保持兼容。

## Change Necessity

仅更新文档不能产生可执行的候选解析、实际地址绑定、响应预算或同步失败映射，因此需要新增发现应用执行器、受控 transport 和发现 API 路由。最小代码边界应复用现有 Provider 查询、SecretStore 和 ConfiguredModel 创建入口，不新增状态 owner，不修改生成 adapter 的网络行为。

## TDD Route

`TDD Route: auto`; decision `strict`; authority: repository rules require behavior tests for shared contracts, deduplication, capability boundaries and external side effects. Each implementation slice starts with a focused failing behavior test where the existing test structure permits it, then implements the minimum behavior and runs the focused regression set. No real Provider request is part of the test route.

## Execution tasks

### 1. Freeze contracts and synchronous discovery execution (done)

Files: `packages/contracts/src/provider-model.ts` and entry surface; `packages/application/src/provider-discovery.ts`, `provider-model-catalog.ts`, `provider-model-directory.ts` and their tests.

- Strict discovery command (Provider ID + expected version only; no key, URL or idempotency key), candidate schema, fixed error-code enum, and a two-state Snapshot (`succeeded`/`failed`).
- Runner reads the saved credential once, performs exactly one directory request, maps transport/HTTP/parse failures to fixed safe codes, and never puts the key into a snapshot.
- Catalog parser accepts only `{modelId,name}`, deduplicates, defaults a missing name to the id, and rejects malformed, empty and over-cap listings.
- Verified: 15/15 focused tests, contracts and application typecheck clean.

### 2. Implement the controlled discovery transport (done)

Files: the smallest existing shared network/transport owner selected after ownership inspection, plus isolated transport tests and entry contract updates; `packages/application/src/provider-model-directory.ts` implementation adapter.

- Inject DNS resolver, dialer/TCP-TLS connector, clock and byte reader so tests use synthetic addresses and no public network.
- Enforce HTTPS, host/URL restrictions, public DNS answers, IPv4/IPv6 bypass checks, actual approved-address binding, original hostname/SNI, no redirect/proxy/re-resolution, 10-second total budget, 1 MiB response limit and one request.
- Sanitize errors and logs; never expose key, authorization headers or raw response.

Stop if the platform/runtime cannot prove actual destination binding through the selected seam; do not substitute pre-resolution plus ordinary fetch.

### 3. Expose the discovery API route (done)

Files: existing model-configuration API module/controller, body parser rules, `packages/transport-http` discovery client/tests.

- `POST /model-providers/:id/discoveries` accepts only Provider ID plus `expectedVersion` and returns the finished snapshot synchronously; a version or Provider mismatch is a 4xx conflict/not-found, not a snapshot.
- Reuse origin/host trust, strict body parsing and existing fixed error mapping; never return key, URL, raw payload or upstream正文.
- Verify the route performs at most one directory request, returns candidates on success, and returns fixed codes on failure.

### 4. Document the implemented behavior and update the walkthrough (done)

Files: `docs/api/0009-provider-model-configuration.md`, `docs/spec/application/*` only for behavior actually implemented, Task39 walkthrough.

- Record that discovery is synchronous and read-only, why the queue/fence design was retired for it, and that the fence remains for side-effecting dispatch.
- Update the walkthrough with exact commands and results. Keep the API document's Draft status until the route is verified.
- Keep the Host dispatch-fence implementation and its migration as a separate, already-verified capability.

## Verification

Per slice, run focused Vitest tests and strict NodeNext TypeScript checks for changed packages. For the complete discovery slice run the contract, application, transport and API tests together; run `bun run docs:check` and `git diff --check`. Report unrun migrations/build/browser/real-provider checks and remaining limitations separately. Browser acceptance belongs to the later UI slice; real Provider acceptance requires separate per-request authorization.

## Risks and retirement

- Real directory requests remain unauthorized until separately approved; all transport tests use synthetic sockets.
- The existing pi-ai generation path remains intentionally retained and explicitly outside the controlled discovery proof. Retirement/connection to the shared transport is triggered only by local evidence of per-request injection support; no global monkey patch or silent fallback is allowed.
- A transport that cannot bind the audited destination is a blocker, not a degraded mode.
- The retired queue design must not leave dead code: `ProviderModelDiscoveryService`, its duplicate error and the `queued`/`running`/`outcome_unknown` states were removed with the simplification.

## Pressure test and handoff

Owner fit is coherent: application owns contract and parsing, transport owns egress, API owns the synchronous invocation and credential-scoped read, Worker owns generation. The main verification pressure is actual address binding; it is an explicit synthetic test. The plan is executable in ordered slices, with no migration or real external request implied.

Authorization status: the user approved the offline contracts/application-port slice, separately approved the Host dispatch fence plus its migration, and on 2026-10-20 approved simplifying discovery to a synchronous read-only request. Those approvals do not authorize real Provider requests, unrelated migrations, or Git lifecycle actions.
