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

生命周期阶段：**切片 1–4 完成**（实现 + 规格 + 全量门禁，各自独立提交），切片 5（OPS-002 Job/Attempt 产品面）未开始。分支 `feat/t32-phase1-closure`，worktree `.worktree/t32-phase1-closure`，基线 `bdfee86`（本地 master；注意 `origin/master` 仍停在 `da7d656`，本地领先 4 个未推送提交）。

## 验证

见 [`walkthrough.md`](walkthrough.md)：逐切片的 RED→GREEN 证据、命令与结果、未运行项。

## Follow-ups

- 五个切片完成后统一跑全量门禁（typecheck / test / build / browser / docs:check / size / db:validate）。
- commit / push / 合并待维护者逐次授权。
