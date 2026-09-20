# Task 32：Phase 1 收口

## User Request / Topic

2026-09-18 维护者复核 Phase 1/2 缺口后指示「先完成 Phase 1 的」。范围、四条语义裁定与执行方式见 [`PROJECT-STATUS.md`](../../../PROJECT-STATUS.md) 与本文件「已冻结的口径」。

## Goal

让 PRD §7 中仍标 `Phase 1` / `Phase 1B` / `Phase 1C` 而未闭合的需求行全部收口：要么补实现，要么按维护者裁定收窄口径并登记勘误。

## Scope

五个顺序切片，每片独立验收：

1. **LIB-001**：搜索补作者、媒体类型、录入状态三个过滤维度（合同 + 存储查询 + 客户端 + Web 表单）。
2. **ING-004**：把「内容为什么被发现」从只记触发类型扩到受管的发现渠道，并落到 Observation。
3. **AUT-003**：RSS 连接器用 ETag / Last-Modified + ConnectorStateStore 做条件请求，无变化时不重新抓取正文。
4. **AUT-001**：新增「删除来源」命令（只删来源配置与调度绑定，保留已录入 Entry/Observation）。
5. **OPS-002**：补 Job/Attempt 的产品面入口；「预算」按裁定收窄为现有媒体预算。

## Non-goals

- **RUN-010 / RUN-011 / OPS-010（Worker Gateway / 远程 Worker）**：维护者 2026-09-18 裁定排除在本次之外，单独排期。
- **ING-008**：维护者 2026-09-18 裁定不实现音视频下载实体，改走 PRD 勘误收窄验收文字（ADR-0005 已冻结「音频/视频只存元数据 + 原文外链」）。
- 不改封口分册正文；不在本 Task 内 commit / push / 合并（各自需要单独授权）。

## 已冻结的口径（维护者 2026-09-18 裁定）

| 项 | 裁定 |
|---|---|
| LIB-001「录入状态」 | = 该 Entry 当前 Revision 的**本地媒体保存状态**（资产四态），不是「读没读过」（后者属 Read State / LIB-005 / Phase 4） |
| ING-004 发现渠道 | 引入受管枚举，取需求验收列出的八类渠道；RSS 等连接器按自身 operation 声明取值 |
| AUT-001 删除语义 | 只删来源配置与调度绑定；已录入的 Entry / Observation / Revision 全部保留（与「删除凭据、停用来源、删除历史数据是三个独立动作」一致） |
| OPS-002「预算」 | 收窄为现有媒体预算；Run 级时间/token 预算随跨阶段的 RUN-006 / RUN-009 后置 |

## 权威合同

- [`docs/requirements/0002-product-requirements.md`](../../../docs/requirements/0002-product-requirements.md) §7.1/§7.3/§7.4/§7.10 与「分册勘误登记」。
- [`docs/spec/README.md`](../../../docs/spec/README.md) 与对应组件规格（interfaces / storage / connectors）。

## Current State

生命周期阶段：**已收口并合并**。五个切片全部完成（实现 + 规格 + 全量门禁，各自独立提交），分支 `feat/t32-phase1-closure` 由 `--no-ff` 合入 master `cd7f7bb`，随后以 `b9e596f` 更新 `PROJECT-STATUS.md`；worktree 与分支已按授权清理，本地 = `origin/master` = `b9e596f`。

Phase 1 需求表内不再有未闭合项（Gateway 三行按维护者裁定排除并改标 `Phase 3`、ING-008 按勘误收窄）。**2026-09-18 复核与裁定收口**：Gateway 三行改标 `Phase 3`、`EXT-008` 记为已交付（独立构建实跑并入既有生产验收清单）、AUT-001「删除凭据」补实现；三条的裁定与证据登记在勘误台账 [`ERRATA.md`](../../../docs/requirements/0002-product-requirements/ERRATA.md)。

## 验证

见 [`walkthrough.md`](walkthrough.md)：逐切片的 RED→GREEN 证据、命令与结果、未运行项（切片 1–5 的逐片证据在分册 [`walkthrough/slices-1-5.md`](walkthrough/slices-1-5.md)）。

## Follow-ups

- Gateway（RUN-010/RUN-011/OPS-010）：已改标 `Phase 3`，随插件运行时/Agent 执行位置排期；本 Task 不再承接。
- 未运行的验收按 2026-09-07 划线保留：Docker/Compose、发布部署、真实公网长时定时抓取、非 Windows 平台 smoke、长时间故障恢复；`EXT-008` 的「独立构建/部署实跑」并入其中的「manifest-only API、executable-only Worker 与独立 Migrator 完整生产验收」。
- AUT-003 的条件请求已补**真实 Worker 进程验收**（[`e2e/conditional-fetch.e2e.test.ts`](../../../e2e/conditional-fetch.e2e.test.ts)：验证器落盘、条件头真的带上、304 短路与条目数不变）；真实公网 RSS 单次验收也已通过（2026-09-18，Run `run_b562e08e…`）。
- 浏览器用例缺口已补：新增 [`e2e/browser/source-lifecycle-and-search-filters.spec.ts`](../../../e2e/browser/source-lifecycle-and-search-filters.spec.ts) 覆盖删除来源两段确认与 LIB-001 三个过滤维度；整套 **24 passed**。
- 未运行（既有后置边界）：Docker/Compose、发布部署、真实公网长时定时抓取、非 Windows 平台 smoke、长时 Worker 重启演练、AI HOT/Bilibili 真实来源。
