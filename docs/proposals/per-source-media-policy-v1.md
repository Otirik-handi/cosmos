# Proposal：按来源的媒体策略 v1（图片开关 + 预算收紧）

> 状态：accepted
>
> 日期：2026-09-09
>
> 关联需求：[PRD](../requirements/0002-product-requirements.md) ING-009（关联 ING-008）
>
> 关联设计：ADR [`0005`](../adr/0005-media-boundary-v1.md)（媒体边界 v1，Revisit Gate 第一条即「进入 ING-009」）、架构 [`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §6.4
>
> 关联既有切片：Task 02（媒体边界 v1）

## 1. 问题

现在媒体下载的限额是全局写死的：单文件 10MB、单次 Run 50MB、单媒体 60 秒超时，由 Worker 启动时注入，用户改不了（ADR-0005 决策 5 明确「不引入 env、不进入 Source 配置」）。后果是：

- 一个图集来源的图片可能吃光整页 50MB 预算，把同页其它条目的图片挤成「超预算跳过」（ADR-0005 已记录并接受这个后果）；
- 反过来，只想存小图、或干脆不想存图的用户没有任何开关；
- PRD ING-009 要求的「按 SourceInstance 配置媒体类型、单文件/单次预算」没有落点（保留期与失败重试同样没有）。

ADR-0005 的 Revisit Gate 第一条就是「进入 ING-009」。本 Proposal 回答：v1 做哪几项、策略放在哪里、怎么保证「只影响后续采集」、Web 怎么配置。

## 2. 目标与非目标

### 目标（对应 ING-009 的可观察验收）

1. 用户能按来源设置三件事：是否下载图片、单文件上限、单次 Run 上限；不设置时跟随全局默认（10MB / 50MB）。
2. 改策略只影响之后的采集：已经在库里的媒体不被改写、不被删除。
3. Web 能在来源上配置并保存策略；并发修改（版本冲突）时提示并刷新。

### 非目标（v1 明确后置）

- 保留期与清理任务（删除已有媒体）；
- 失败重试与历史回填（需要「不产生新修订也能改写已存 Asset」的新写路径，ADR-0005 明确拒绝在 v1 打开）；
- 音频/视频下载实体（ADR-0005 决策 1 仍只下载图片）；
- 单条目媒体数量上限（ADR-0005 已接受「不自愈」后果）；
- 全局默认值的 env/配置化（默认仍是代码常量）。

## 3. 当前行为与证据

- 限额在 Worker 启动时注入且不可变：`createMediaAcquirer`（`packages/application/src/media-acquisition.ts:109`）默认 `maxFileBytes: 10MB`、`maxRunBytes: 50MB`、`perMediaTimeoutMs: 60s`（`packages/application/src/media-acquisition.ts:19`）；`apps/worker/src/main.ts:50` 只传 `fetch`/`allowedHosts`/`logger`。
- 下载对象固定为图片：`isImageDownloadCandidate`（`packages/application/src/media-acquisition.ts:216`）只接受 `kind === "image"` 或 `image/*` 的 enclosure；连接器把媒体统一标成 `metadata_only`（`plugins/rss/src/index.ts:440`），只有下载成功的才被改写成 `saved`。
- 预算按「一次 fetch 的一页」累计：`state.runBytes`（`packages/application/src/media-acquisition.ts:124`）在一次 `acquireItems` 调用内累加，`consumeImageBody`（`packages/application/src/media-acquisition.ts:417`）逐块计数并在超预算时中止。
- 来源配置已经能承载策略：`rssSourceConfigSchema`（`packages/contracts/src/base.ts:141`）是 strict schema；`PATCH /api/v1/sources/:id` 已支持带 `baseRevisionId` 的 CAS 配置更新（`apps/api/src/app.controller.ts:305`），配置校验走 canonical Zod schema（`apps/api/src/source-probe.service.ts:29`）。
- 「只影响后续采集」有现成机制：`SourceExecutionSnapshot` 在 Run 入队时冻结来源配置（`packages/contracts/src/base.ts:238`），fetch action 用的是快照（`packages/application/src/workflow-ingest.ts:280`），改配置不会改变已排队的 Run。
- Web 没有来源编辑入口：`readManifestFields`（`apps/web/src/components/cosmos/source-form.tsx:86`）只渲染扁平的 string/integer 字段，新建表单也不含媒体项。
- 只有真实 `rss` 连接器声明了 `media-download` 能力（`plugins/rss/src/index.ts:55`），fixture/Bilibili/AI HOT 不下载媒体。

## 4. 方案

### 决策 1：策略放进来源配置的 `media` 段，只对声明 `media-download` 的来源定义开放

`rssSourceConfigSchema` 增加可选 `media`：

```text
media?: {
  images?: "download" | "metadata_only",   // 缺省 download
  maxFileBytes?: integer,                  // 缺省跟随全局默认（10MB）
  maxRunBytes?: integer                    // 缺省跟随全局默认（50MB）
}
```

理由：放在 `config` 里能直接复用现成的 revision/CAS、入队快照与「只影响后续采集」语义，不需要新表、新 migration 或新的快照字段。v1 只加到 `source.rss@1`（唯一会下载媒体的定义）；fixture/Bilibili/AI HOT 不下载媒体，不给它们加无意义的字段。

**备选**：新建 `SourceMediaPolicy` 表。拒绝：策略就是来源配置的一部分，独立表会与 `config` 形成两个真相，还要在快照里单独冻结。

### 决策 2：来源只能收紧全局默认，不能放宽

- 有效值 = min(来源设置, 全局默认)：单文件 ≤ 10MB，单次 Run ≤ 50MB。
- 理由：全局默认是 ADR-0005 冻结的资源保护线（单次 Run 用受控内存暂存）；放宽会让内存/磁盘上限失去意义。现实需求基本是「这个来源图太大，收紧」或「不要图片」。

**备选**：允许放宽但设硬上限（例如单文件 50MB、单次 500MB）。如果维护者希望「这个来源就是要存大图」，可以选它。

### 决策 3：类型开关只控制「是否下载」，不改写连接器输出

`images: "metadata_only"` 时，媒体获取组件跳过图片候选，Asset 保持连接器给的 `metadata_only` 与原文外链，界面照常显示「仅记录元数据」。不新增状态、不改写已有 Asset。

### 决策 4：有效策略在 fetch 时从 Run 的来源快照解析

`MediaAcquirer.acquireItems` 增加可选 `policy` 参数（`{ images, maxFileBytes, maxRunBytes }`）；fetch action 从本次 Run 的 `parsed.source.config.media` 解析后传入。缺省参数保留现状，因此 legacy 泳道、Probe 与既有测试行为不变。

### 决策 5：Web 在来源行提供「媒体策略」编辑

- 新建来源表单保持现状（默认策略）。
- 来源健康行增加「媒体策略」入口：图片下载开关、单文件上限（MB，留空跟随默认）、单次上限（MB，留空跟随默认）；保存走 `PATCH /api/v1/sources/:id`（带 `baseRevisionId`），409 提示并发冲突并刷新列表。
- 界面区分「跟随默认（10MB / 50MB）」与「本来源已收紧」两种状态。

### 决策 6：v1 不做保留期与失败重试

两者都需要新写路径（删除媒体 / 在不产生新修订时改写已存 Asset），ADR-0005 已明确拒绝在 v1 打开。本 Proposal 把它们连同「历史媒体回填」列为后续切片，并在新 ADR 的 Revisit Gate 中保留。

## 5. 取舍与备选

| 备选 | 结论 |
| --- | --- |
| 类型 + 预算（推荐） | 采纳：与现有下载路径同构，无新写路径、无 migration |
| 同时做失败重试 | 拒绝（决策 6）：需要改写已存 Asset 的新路径 |
| 同时做保留期/清理 | 拒绝（决策 6）：删除用户数据需要独立的确认与清理设计 |
| 策略放独立表 | 拒绝（决策 1） |
| 允许放宽预算 | 备选（决策 2） |
| 全局默认改 env | 拒绝：默认值仍是常量，改动只发生在来源级 |

## 6. 数据、接口、安全、迁移、发布与回滚影响

- **数据**：无 Prisma schema 变更、无 migration；`Source.configJson` 多一个可选对象。
- **接口**：`rssSourceConfigSchema` 新增可选 `media`（旧配置仍合法）；`source.rss@1` 的 manifest JSON Schema 同步声明 `media`（描述用）。无新端点。
- **安全**：预算只能收紧，资源上限不放松；下载安全边界（http/https、公网地址、重定向、超时）不变。
- **迁移与发布**：不涉及 migration、版本号、发布或部署。
- **回滚**：回滚代码即回滚行为；但 `rssSourceConfigSchema` 是 strict，回滚后含 `media` 的配置会被旧代码拒绝，回滚需要先清空该字段（接受的代价，写入路径只有用户显式保存）。

## 7. 对 requirements / architecture / ADR / spec 的预期改动

- `docs/requirements/0002-product-requirements.md`：新增 Phase 2 第九切片注记。
- `docs/architecture/0001-cosmos-foundation.md` §6.4：补充 per-source 媒体策略 v1 注记。
- `docs/adr/0014-per-source-media-policy-v1.md`（新）：冻结决策 1–6；同步 ADR 索引；更新 ADR-0005 的 Revisit Gate 状态。
- `docs/spec/`：contracts（rss 配置 schema）、application（媒体获取策略参数）、interfaces（HTTP/Web）。
- `.agents/tasks/{新编号}-per-source-media-policy/README.md`：由维护者分配编号后创建。

## 8. 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-09 | 起草，状态 `reviewing`，等待评审 | Agent |
| 2026-09-09 | 按推荐默认推进实施：范围取「类型 + 预算」、来源只能收紧、策略放进来源配置。维护者评审问题未获回复，本行不是用户裁决；维护者可随时否决其中任一项并要求返工 | Agent |
| 2026-09-09 | **确认**：接受三项默认（范围取「类型 + 预算」、来源只能收紧、策略放进来源配置），并授权提交、合并与推送 | 用户（评审确认） |
