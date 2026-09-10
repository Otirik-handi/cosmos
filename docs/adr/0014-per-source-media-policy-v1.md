# ADR-0014：按来源的媒体策略 v1（图片开关 + 预算收紧）

> 状态：Accepted design contract
>
> 日期：2026-09-09
>
> 关联：[`per-source-media-policy-v1` Proposal](../proposals/per-source-media-policy-v1.md)、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ING-009、ADR [`0005`](0005-media-boundary-v1.md)（媒体边界 v1 与 Revisit Gate）、架构 [`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §6.4

## Context

媒体下载的限额此前是全局常量：单文件 10MB、单次 Run 50MB、单媒体 60 秒超时，由 Worker 启动时注入（ADR-0005 决策 5 明确「不引入 env、不进入 Source 配置」，per-source 策略归 ING-009）。PRD ING-009 要求用户按 SourceInstance 配置媒体类型、单文件/单次预算、保留期和失败重试；ADR-0005 的 Revisit Gate 第一条就是进入 ING-009。

2026-09-09 起草 Proposal 并列出三项裁决（v1 范围、预算方向、策略存放位置）；评审问题未获即时回复时 Agent 先按推荐默认推进实施，随后维护者确认接受这三项默认并授权提交、合并与推送。本文沉淀这些稳定决定。

## Decision

### 1. 策略写在来源配置的 `media` 段，只对声明 `media-download` 的定义开放

`Source.config.media`（可选）包含 `images`（`download`/`metadata_only`，缺省 `download`）、`maxFileBytes`、`maxRunBytes`（缺省跟随全局默认）。v1 只加到 `source.rss@1`——它是唯一声明 `media-download` 能力、会真正下载媒体的定义；fixture/Bilibili/AI HOT 不下载媒体，不给它们加无意义字段。

理由：`config` 已经拥有 revision/CAS、入队快照与「只影响后续采集」的语义，不需要新表、新 migration 或新的快照字段。

### 2. 来源只能收紧全局默认，不能放宽

公共 schema 的上界即全局默认：`maxFileBytes` 64KiB–10MB、`maxRunBytes` 1MiB–50MB；有效值再取与全局默认的最小值，防止未校验或历史数据绕过。理由：全局默认是 ADR-0005 冻结的资源保护线（单次 Run 受控内存暂存），放宽会让上限失去意义。

### 3. 类型开关只控制「是否下载」，不改写连接器输出

`images: "metadata_only"` 时媒体获取组件跳过图片候选，Asset 保持连接器给的 `metadata_only` 与原文外链。不新增公共状态、不改写已存 Asset。

### 4. 有效策略在 fetch 时从 Run 的来源快照解析

`MediaAcquirer.acquireItems` 增加可选 `policy` 参数；fetch action 从本次 Run 的 `SourceExecutionSnapshot.config.media` 解析后传入。缺省参数保留现状，legacy 泳道、Probe 与既有测试行为不变。因此「修改策略只影响后续采集」是结构性保证，而不是靠约定。

### 5. Web 在来源行提供媒体策略编辑

新建来源表单保持默认策略；来源健康行提供编辑入口（图片开关 + 两个上限，留空表示跟随默认），保存走 `PATCH /api/v1/sources/:id` 并带 `baseRevisionId` CAS，冲突提示并刷新。界面区分「跟随默认」与「本来源已收紧」。

### 6. v1 不做保留期与失败重试

两者都需要新写路径（删除媒体 / 在不产生新修订时改写已存 Asset），ADR-0005 已明确拒绝在 v1 打开。保留期与清理任务、失败重试与历史回填、音频/视频下载实体、单条目数量上限、全局默认 env 化列为后续切片。

## Consequences

### Positive

- ING-009 有了可观察落点：用户能按来源关掉图片下载或收紧预算，图集来源不再吃光整页预算。
- 无 Prisma schema、migration、回填；回滚代码即回滚行为。
- 「只影响后续采集」由既有快照机制保证，已存 Asset 与用户数据不受影响。

### Costs and risks

- 来源不能放宽预算；需要「这个来源就是要存大图」时只能改全局常量（接受的取舍，可后续以硬上限方案扩展）。
- `rssSourceConfigSchema` 是 strict：回滚到旧代码后，含 `media` 的配置会被拒绝，回滚需先清空该字段。
- 保留期与失败重试仍未实现，媒体失败仍「不自愈」；运维上只能靠日志与条目修订恢复。

## Alternatives considered

### 独立 `SourceMediaPolicy` 表

拒绝。策略就是来源配置的一部分，独立表会与 `config` 形成两个真相，还要在快照里单独冻结。

### 允许放宽但有硬上限（如 50MB/500MB）

备选，未采用。会放松 ADR-0005 的资源保护线；若确需存大图，再按新威胁模型评估。

### 同时做失败重试

拒绝。需要「不产生新修订也能改写已存 Asset」的新路径，ADR-0005 已明确排除。

### 同时做保留期/清理

拒绝。删除用户数据需要独立的确认、清理与孤儿回收设计。

### 全局默认改 env

拒绝。默认值仍是代码常量，改动只发生在来源级。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 用户需要某个来源保存比全局默认更大的媒体，评估放宽与硬上限方案；
- 失败重试或历史回填进入实施，需要定义改写已存 Asset 的写路径；（2026-09-09 更新：[`0015`](0015-media-retry-retention-v1.md) 已定义该写路径——`media.retry@1` 原地改写 Asset 行、以 `(assetId, attemptCount)` 做 CAS、不产生新 Revision；历史回填仍未决。）
- 保留期/清理任务进入实施，需要定义删除确认、引用检查与孤儿 Blob 回收；（2026-09-09 更新：[`0015`](0015-media-retry-retention-v1.md) 已定义——显式命令 + 先预览再确认、删除前引用检查、只删字节并回退 `metadata_only`。）
- 音频/视频下载实体进入实施（ADR-0005 决策 1 变更），需要扩展策略字段；
- 来源配置 schema 的 strict 回滚代价被证明不可接受，评估宽松兼容策略。
