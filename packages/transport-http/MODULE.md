# MODULE: @cosmos/transport-http

产品 API 的 HTTP 客户端：版本化 service endpoint 的请求封装、响应 schema 校验、传输错误映射与 SSE 事件流。只依赖 `@cosmos/contracts`，不依赖 NestJS / Prisma / SQLite 与应用内部实现。

## 公共入口

`src/index.ts` 只做门面（**11 行**）：解析后 **4 个导出（2 值 / 2 类型）**——值 `HttpCosmosClient`、`CosmosTransportError`；类型 `CosmosEventSource`、`HttpCosmosClientOptions`。

- 机器可读真相源：`entry-surface.txt`，由 `bun run scripts/entry-export-surface.ts packages/transport-http/src/index.ts` 生成。
- 常驻护栏：`src/entry-contract.test.ts` 断言运行时值导出集合等于快照的 `value` 行（2 个）；增删导出必须先显式重新生成快照。
- 类仍是**单个**：实现按资源域拆在**继承链**上（G03 先例），消费方 `new HttpCosmosClient(options)` 与全部方法调用零改动。

## 子模块地图（继承链，自下而上）

| 文件 | 职责 | token |
|---|---|---|
| `index.ts` | 门面：`class HttpCosmosClient extends BoardClient {}` + 4 个导出的再导出 | ~0.1k |
| `types.ts` | `CosmosEventSource` / `HttpCosmosClientOptions` 接口与 `CosmosTransportError` | ~0.2k |
| `client-base.ts` | `HttpCosmosClientBase`：baseUrl / fetcher / eventSourceFactory 字段、构造、**唯一的请求管道 `protected request()`**、SSE 事件流 | ~0.8k |
| `client-platform.ts` | 平台面：health、connector 目录、来源定义目录、存储占用与备份、Run 历史与 Job | ~0.7k |
| `client-sources.ts` | 来源与运行：来源配置探测、媒体清理、来源 CRUD 与启用、连接、取消/恢复/重跑 | ~1.9k |
| `client-content.ts` | 内容面：feed/search、Story（含归并/拆分/子类型目录）、Topic、Entity/关系、Entry/修订 | ~3.5k |
| `client-organization.ts` | 用户组织：Label、Collection、Favorite、Annotation、Saved View | ~2.3k |
| `client-board.ts` | 看板：Board/Section/Block、Spotlight 固定 | ~1.7k |

测试与源码同级，按资源域分册（`client-*.test.ts`，6 个文件 17 用例），全部通过门面调用，同时构成继承链的行为护栏。

## 阅读顺序

1. 先读本文件与 `entry-surface.txt`，确认公共面；
2. 改某个接口调用：按上表定位资源分册（多数 ≤3.5k token），只读该文件；
3. 改请求管道（超时、头、错误映射）：只动 `client-base.ts` 的 `request()`；
4. 改导出：先看 `entry-surface.txt` 与 `entry-contract.test.ts`，再动 `index.ts`。

## 禁区

- 所有请求必须走 `this.request()`，不要在分册里直接 `this.fetcher(...)`（除基类的管道实现）；
- 新方法放进对应资源分册，不要塞回门面 `index.ts`；
- 继承链只做文件组织：方法之间**不互相调用**是当前设计前提，若引入跨分册调用需先评估链顺序；
- 接口与错误类只放 `types.ts`，避免分册与门面互相 import；
- 不重新生成 `entry-surface.txt` 就不改导出面。

更新日期：2026-09-14
