# ADR-0005：媒体边界 v1（RSS 媒体提取、受控下载与本地保存）

> 状态：Accepted design contract
>
> 日期：2026-09-03
>
> 关联：[`media-boundary-v1 Proposal`](../proposals/media-boundary-v1.md)、[`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §6.4、[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ING-008、[`../../.agents/tasks/02-rss-ingestion/README.md`](../../.agents/tasks/02-rss-ingestion/README.md)

## Context

Phase 1 的"尽可能保存"（PRD ING-008）此前只有元数据没有实体：RSS 管线把 enclosure 记录为 `metadata_only` Asset，正文媒体标签未提取，仓库侧虽有内容寻址 Blob 服务与受控下载端点，但没有能力产生"已保存"媒体，断网阅读不可用。已接受方向只冻结三点职责（Connector 处理媒体、仓库提供 Blob 服务、无历史回填），具体边界此前全部待冻结。

2026-09-03 需求对齐确认 v1 形态：图片下载为实体，音频/视频仅元数据与原文外链；媒体发现范围是 RSS 条目自身的 enclosure 与正文媒体标签，不抓取 `webUrl` 外部全文；全局预算默认单文件 10MB、单次 Run 50MB；per-source 媒体策略后置 ING-009。随后经 Proposal 评审补齐三项决定：降级原因进入界面（新增可空 `errorMessage`）、接受"不自愈"生命周期、`media-download` 作为公开 Connector 能力值。本文沉淀这些稳定决定。

## Decision

### 1. Connector 纯提取，Application 统一媒体获取

Connector 只把条目自身媒体投影为 `NormalizedAssetInput` 候选（enclosure、`media:content`/`media:thumbnail`、正文 `img`/`audio`/`video`/`source`），按类型给出下载意图或元数据终态，不接触网络与 Data Root。Application 拥有统一媒体获取组件，在 Worker 的 fetch 边界对图片候选执行受控下载并改写 status/content/errorMessage。durable `source.fetch@1` 与 legacy `source-ingest` 两条泳道调用同一函数，行为一致；`source-config-probe`/`source-probe` 不经过 fetch action，保持无副作用。

### 2. 媒体下载按公开 Connector 能力门控

真实 rss Connector 在 `capabilities` 中声明公开值 `media-download`，媒体获取只处理声明该能力的 Connector 输出；fixture 不声明，五类 fixture 案例与测试确定性不变。移除该能力值即整体关闭下载（回退开关）。

### 3. bytes/BlobRef 分层冻结；公共 4 态与表结构不变

数据分层冻结：domain `NormalizedAssetInput.content: Uint8Array` → Application 在 Workflow 边界映射 BlobRef（Workflow JSON 只存引用）→ Storage 保存 Asset metadata 与 storageKey → Product API 受控下载。下载成功只填充既有 `content`/`status: saved` 字段。公共 `assetStatusSchema` 4 态与 Prisma 表结构不变（无 migration）；下载安全、预算与失败都在这层合同内表达。

### 4. 降级原因以可空 `errorMessage` 透传

4 态（saved/metadata_only/skipped/failed）保持为公共语义；超预算与策略/安全拦截都映射为 `skipped`，网络/校验失败映射为 `failed`。为让界面能展示精确原因，新增可空可选 `errorMessage` 字段并做最小透传：domain 媒体输入 → ingest wire（`normalizedAssetInputSchema`）→ 存储（写入已存在的 Prisma `Asset.errorMessage` 列）→ Asset 快照（`assetSnapshotSchema`）。仅降级状态填写，上限 500 字符；saved/metadata_only 保持 null。结构化日志继续携带机器 reason code。非 saved 状态一律保留原文外链。

### 5. 预算为全局默认，执行边界固定

v1 全局默认单文件 10MB、单次 Run 50MB（Run=一次 fetch 的一页），工厂参数注入、默认值常量导出，不做 env、不进入 Source 配置。下载器对响应 body 逐块读取计数，超预算立即中止并丢弃，不完整字节不入库；v1 底层为受控内存暂存，"边下载边写盘"列为升级点且不改端口合同。顺序处理保证预算按文档顺序先到先得；同一次 Run 内相同 URL 只下载一次（页内 memo）。per-source 媒体类型/预算/保留期/失败重试归 ING-009（Phase 2）。

### 6. 下载安全边界

仅 `http`/`https`，拒绝 userinfo；DNS 解析结果必须全为公网地址（拒 loopback、RFC1918、链路本地、ULA、0.0.0.0、组播与保留段）；重定向手动逐跳且最多 3 跳、每跳复检；Content-Type 必须 `image/*`，缺失或 octet-stream 时以文件魔数兜底（PNG/JPEG/GIF/WebP）；单媒体默认 60s 超时并绑定 fetch signal；不转发 Cookie/Authorization。私网/环回默认拦截，测试与受控本地源通过 `COSMOS_MEDIA_ALLOWED_HOSTS`（默认空）显式放开。DNS rebinding 时间窗为接受的本机单用户残余风险。

### 7. 生命周期"不自愈"

Asset 附着 EntryRevision。媒体失败只降级该 Asset，不阻止条目文本入库、不影响 Run 成败，也不触发 fetch action 重试。fingerprint 不变的重复轮询不重试媒体；只有条目本身修订才重新提取与下载。与"无历史媒体回填"一致；失败重试与回填归 ING-009。v1 不加单条目媒体数量上限，接受图集帖耗尽 Run 预算后同页后排图片在本修订周期保持 `skipped` 的后果。

### 8. `local` 作用域仍未冻结

`local` 作用域键、认证替换点与跨作用域隔离仍待后续设计，不在 v1 媒体边界内。

## Consequences

### Positive

- 断网后 RSS 图片实体可读，降级状态（含原因）与原文外链真实可见，不伪造离线成功。
- 安全/预算/超时集中在一个 Application 组件，审查与测试面单一；fixture 与探测路径确定性不受影响。
- 公共面改动最小且 additive（一个可空字段 + 一个能力值），无 migration，回退只需移除能力声明。

### Costs and risks

- fetch action 执行时长随媒体数量线性增加；失败重试会整页重新下载（预算按次生效）。
- "不自愈"意味着预算饿死或下载失败的状态要等条目修订才可能恢复，运维上需靠日志 reason code 诊断。
- 允许 http 明文图片与 DNS rebinding 残余风险对多用户/云部署不成立，扩展前需重评第 6 节安全边界。
- `Asset.errorMessage` 从"已存在但从未写入"变为活跃列；读取投影需同步接通。

## Alternatives considered

### 在 Connector 内部下载媒体

拒绝。与已接受方向冲突，Connector 将接触网络下载与 Data Root，安全与预算逻辑分散到各插件，无法统一审查与门控。

### 立即扩展公共状态枚举以表达"超预算"

拒绝。改为 4 态 + 可空 `errorMessage` 的组合：状态机保持简单，精确原因由文本承载，避免枚举在 Phase 2（ING-009 per-source 策略）到来前反复膨胀。

### 每轮调度对失败/skipped 媒体重试（不自愈的对立面）

拒绝。需要不产生新修订也能改写 Asset 的更新路径，等于提前打开回填/重试口子，超出 v1 媒体边界，归 ING-009。

### 引入第二套内部 Connector 能力分类

拒绝。公开 `capabilities` 投影机制已存在，新增 `media-download` 值与现有机制一致；内部分类会造成两类能力语义并存。

## Revisit Gate

满足以下任一条件时重新评估本 ADR：

- 进入 ING-009：per-source 媒体策略、失败重试或历史回填需要改变预算/状态/生命周期语义；
- 引入多用户、远程 Worker 或云部署，安全边界（http、私网拦截、DNS rebinding 残余风险）需要按新威胁模型重评；
- 下载形态从受控内存暂存升级为"边下载边写盘"且要求公共层感知；
- `local` 作用域键与认证边界设计完成并需要改变 Asset 读取授权。
