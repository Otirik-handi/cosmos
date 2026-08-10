# 通用信息模型与时间归一化

## 状态

2026-08-10：本研究结论已转入 `docs/architecture/0001-cosmos-foundation.md`、`docs/architecture/0002-information-model.md`、`docs/requirements/0002-product-requirements.md` 和 Task 05。本文只保留实现合同摘要；平台样本来自现有 `2026-08-06-opencli-*.md` 调研记录。

## 结论

跨平台内容都有内容身份、发布者、时间、正文/摘要、互动指标和媒体，但字段缺失是常态。URL 不能作为必需身份，作者 ID 也不能作为必需字段。

### ContentKind

Phase 1B 使用七种内容形态：

```text
post / article / video / audio / image / comment / listing
```

`ContentKind` 表达来源内容形态；`StoryKind` 表达 Cosmos 上层规范内容形态，二者通过显式映射转换。

### Publisher

```text
Publisher
├─ platformId: string | null
├─ name: string
├─ handle: string | null
├─ profileUrl: string | null
├─ kind: user | channel | subreddit | official-account | org | unknown
└─ metrics?: PublisherMetrics
```

RSS 和部分列表接口只有显示名，没有稳定平台 ID。因此空白 ID 统一为 `null`；有作者名时仍保存 Publisher，没有作者信息时保存 `null`。作者名和作者 ID 都不参与内容 external key。

### ContentMetrics

指标是时点快照，不是内容版本：

```text
values: likes / views / reposts / comments / collects / score
raw: 原始展示文本
reliability: high | low | unknown
capturedAt: 快照时间
```

指标刷新更新 Entry 当前快照，不创建 EntryRevision；平台专有指标留在原始 payload，暂不增加任意扩展持久化。

### TemporalValue

优先级固定为：

1. Connector 从证据层拿到精准时间，转为 UTC exact。
2. 没有精准时间时解析展示文本，保留 raw、lowerBound、precision、timezone 和 confidence。
3. 二者都没有时为 `null`。

fallback 到 exact 的精度提升不创建 Revision。旧 `sourcePublishedAt` 只作为现有查询/API 的 UTC 投影，不与新的 Connector 输入合同并列。

## Connector 边界

Provider/Producer 是 Bilibili、RSS、AI HOT 等外部平台。Adapter/Connector 是连接 Provider 的代码，负责配置校验、外部读取、标准化、cursor 和平台错误处理。Phase 1B 的实现按 `Source.kind` 解析 `IngestConnector`；未来 `SourceOperation` 才细分同一 Provider 下的多个操作。
