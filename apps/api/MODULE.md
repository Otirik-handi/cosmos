# api 模块地图

Cosmos HTTP API 进程(NestJS):把产品 Command/Query 以 `/api/v1` 暴露给 Web 与 Worker,并承载 run 控制、SSE 事件流与运维接口。

## 入口与启动

- `src/main.ts` —— bootstrap:初始化 Prisma、创建 Nest 应用、全局前缀 `api/v1`、CORS、请求上下文中间件、日志拦截器与异常过滤器。
- `src/app.module.ts` —— 依赖装配(Prisma 仓储 / 日志 / catalog / workflow control / workflow store / media cleanup / SourceProbeService)与 `controllers: [AppController]`。

## 路由入口契约(冻结)

- `src/app.controller.ts` 是 8 行门面:`@Controller() export class AppController extends AppControllerOrganization {}`;类名与构造签名不变,`app.module.ts` 与 25 处测试实例化零改动。
- 114 条路由(method + path)冻结。`src/app.controller.route-table.test.ts` 按 Nest 元数据枚举并与 `.agents/tasks/governance/G03-api-controller/route-snapshot-app.controller.txt` 比对;改路由表必须同步更新快照。

## 子模块地图(2026-09-13,G03 切片 3/4 后)

| 文件 | 职责 | 约 token |
| --- | --- | --- |
| src/app.controller.ts | 门面:继承链收口 + `@Controller()` | 0.06k |
| src/app.controller/base.ts | 7 个注入字段 + constructor + 4 个 protected helper | 0.9k |
| src/app.controller/internals.ts | 模块级 helper(错误映射、游标、公开投影)+ productRunSchema | 2.0k |
| src/app.controller/sources.ts | health / definitions / capabilities / sources / probes / connections / storage / backups(27 路由) | 3.6k |
| src/app.controller/runs.ts | runs / workflow-runs / media-cleanups / jobs / attempts / events(12 路由) | 3.0k |
| src/app.controller/content.ts | story / topic / entity / relation / evidence / subtype / revision / asset / feed / search(33 路由) | 4.7k |
| src/app.controller/organization.ts | label / collection / favorite / annotation / saved-view / board / section / block / spotlight(42 路由) | 4.3k |
| src/app.controller.*.test.ts(5 个) | 按资源的控制器行为测试 | — |
| src/source-probe.service.ts | 源配置的同步校验与探测 | — |
| src/request-logging.ts | 请求上下文中间件、日志拦截器、异常过滤器 | — |

继承链:`AppControllerBase` → `Sources` → `Runs` → `Content` → `Organization` → 门面;跨资源 helper 只在 `internals.ts` 或 base 的 protected 方法里。

## 阅读顺序

1. 本文件;
2. 改某资源:读对应分册 + 同名测试分册(单册 ≤18.5 KB,可整读);跨资源 helper 在 `internals.ts` / `base.ts`;
3. 改启动或中间件:读 `main.ts` 与 `request-logging.ts`;
4. 改路由表:改分册 + 同步快照,跑 `app.controller.route-table.test.ts`。

## 禁区

- 不直接依赖 Prisma / Data Root / Blob Root,经注入的端口访问;
- 分册之间不横向 import;新增路由放所属资源分册,跨资源 helper 放 `internals.ts`;
- 路由表冻结,任何增删改都要同步快照并说明理由;
- 不动 Prisma schema;测试使用隔离数据根。

更新:2026-09-13(G03 切片 5)
