# 个性化日报 + 消息推送系统 — 调研报告

> 调研日期：2026-08-06
> 调研范围：类似开源项目、现成基础设施、去重/聚类/连续性跟踪技术参考、Meridian 源码级拆解
> 结论预览：**没有单一开源项目能完整覆盖全部需求；每一层都有成熟组件，分层自建是最优解。Meridian 是最值得抄作业的参考实现。**

---

## 1. 需求拆解

| # | 需求 | 说明 |
|---|------|------|
| 1 | 多渠道 | aihot、X (Twitter)、GitHub、各大官网、邮箱等 |
| 2 | 优先级机制 | 不吵，但紧急消息立刻推（如 DeepSeek 状态、重要邮件） |
| 3 | 收集 + 持久化 + 分类合并 | 多源报道同一件事要合并，方便 Agent 查找 |
| 4 | LLM 消费推送 | 不推重复消息，支持连续消息（如地震灾情报告跟进） |

---

## 2. 类似项目总览

### 2.1 最接近的完整项目（多源采集 + LLM + 聚类 + 推送）

| 项目 | Stars | 协议 | 亮点 | 短板 |
|------|-------|------|------|------|
| [meridian](https://github.com/iliane5/meridian) (iliane5) | 2.4k | MIT | 数百 RSS 源 → LLM 分析 → 向量聚类 → 连续性日报；**唯一明确做 continuity tracking 的项目** | 深度绑 Cloudflare；简报生成手动跑 notebook；无推送；只吃 RSS |
| [meridiano](https://github.com/lfzawacki/meridiano) (lfzawacki) | — | AGPL-3.0 | meridian 的 fork，砍掉 Cloudflare，纯 Python + SQLite + Docker + cron，适合自托管 | 同 meridian：无推送、无优先级路由 |
| [TrendRadar](https://github.com/sansan0/TrendRadar) (sansan0) | 活跃 | GPL-3.0 | **推送渠道最全**：微信/飞书/钉钉/Telegram/邮件/ntfy/bark/slack；聚合知乎/微博热点 + RSS；AI 筛选/翻译/简报；带 MCP 服务端 | 无语义聚类（关键词过滤）；无连续性跟踪 |
| [hot_news_daily_push](https://github.com/tuber0613/hot_news_daily_push) | — | — | 多平台热点 + RSS + Twitter + 去重 + 多渠道推送，形态最接近"多源→去重→推送" | 去重是标题级 |
| [auto-news](https://github.com/finaldie/auto-news) (finaldie) | — | — | 多源（Tweets/RSS/YouTube/Web/Reddit/笔记）+ LLM 过滤 80%+ 噪音 + 周报 | 偏个人阅读流，非推送系统 |
| [news-aggregator](https://github.com/tony-stark-eth/news-aggregator) | 11 | — | Symfony 8 + Postgres；AI 分类摘要 + 规则兜底；smart alerts + 定时 digest；通知支持 Pushover/Telegram/Slack/Discord/邮件 | 新、star 少 |
| [RSSbrew](https://github.com/yinan-c/RSSbrew) | 290 | — | 自托管 RSS：聚合 + 自定义过滤 + AI 摘要 + 日/周 digest，OpenAI 兼容 | 只处理 RSS |
| [precis](https://github.com/leozqin/precis) | — | — | 可扩展 RSS reader，LLM 摘要 + 通知（matrix/slack/jira/ntfy），强调及时性 | 单 RSS |
| [clawfeed](https://github.com/kevinho/clawfeed) | — | — | 多频率 digest（4h/daily/weekly/monthly）+ AI 深度分析 | — |
| [ai-news-radar](https://github.com/LearnPrompt/ai-news-radar) | — | — | 实时 AI 新闻，10+ web 源，OPML，GitHub Actions 免部署，最活跃 | 只读不推 |

### 2.2 综合索引

- [awesome-ai-news](https://github.com/taielab/awesome-ai-news)（taielab）：AI 新闻聚合工具 curated list，含 News Aggregation / RSS / Social Media Monitoring / Message Distribution 等分类，找项目先翻这个。
- 经典但较老：Huginn（agent 监控，RSS/IMAP/网页，Digest Agent 概念，无 LLM、UI 旧）、n8n（可视化工作流，AI digest 模板多，自托管较重）。

---

## 3. 现成基础设施（每层都有货）

| 层 | 组件 | 说明 |
|----|------|------|
| 万能采源 | [RSSHub](https://github.com/DIYgod/RSSHub) | 把没有 RSS 的网站（X、YouTube、官网、各平台）转成 RSS，现成路由多，自托管 Docker 即可。**"多渠道"的关键基础设施** |
| 状态监控 | [Uptime Kuma](https://github.com/louislam/uptime-kuma) | 服务状态监控（覆盖 DeepSeek 状态），90+ 通知渠道，Pushover 支持 High/Emergency 优先级、重复提醒直到确认；支持 cron push 模式 |
| 推送层 | [ntfy](https://github.com/binwiederhier/ntfy) | 自托管推送标准件：curl 一条 PUT 即推，**优先级 1-5 映射不同声音/振动**，支持静音时段、action 按钮、标签 emoji。手机 App 齐全 |
| 推送层 | Apprise | 一个 API 推 90+ 服务（Telegram/Discord/Slack/邮件/ntfy/bark 等），很多项目用它做推送层 |
| 地震数据 | [USGS GeoJSON Feed](https://earthquake.usgs.gov/earthquakes/feed/) | 实时地震接口，每分钟更新，M4.5+/M2.5+ 分档，自带 ENS 邮件/手机通知；中国地震台网也有速报接口 |
| 邮箱 | 无成熟开源件 | 标准做法：IMAP 轮询（Huginn 或自写）+ LLM 判断重要性 |
| 调度+LLM+推送 | Hermes 本身 | cron 调度 + LLM + 网关多平台推送（Telegram/Discord/QQ），官方有 [daily-briefing-bot 教程](https://github.com/NousResearch/hermes-agent/blob/main/website/docs/guides/daily-briefing-bot.md) |

---

## 4. 去重 / 聚类 / 连续跟踪的技术参考

- **[Feedly 工程博客](https://feedly.com/engineering/posts/reducing-clustering-latency)**：先去重（精确匹配、DB 直接查找）再聚类（向量、距离矩阵），能大幅降低聚类负载；Feedly 的 story 概念 = 同事件多文章归一组。
- **[arXiv 2508.08272《Real-time News Story Identification》](https://arxiv.org/html/2508.08272v1)**：BGE-M3 嵌入做新闻故事聚类，专门处理"文本相似但事件不同"（如两支足球队的赛况）的难点。**这是"多源合并 + 事件跟踪"的核心算法参考。**
- **[NEWS-COPY](https://github.com/dell-research-harvard/NEWS-COPY)**（哈佛/戴尔）：新闻去重数据集 + bi-encoder 神经去重。
- GPTrace：LLM embedding 做崩溃去重（思路可借鉴）。

---

## 5. Meridian 源码级拆解（重点参考对象）

### 5.1 定位与技术栈

- iliane5/meridian，MIT，2.4k stars / 433 forks。
- 理念："总统级每日情报简报"——抓几百个源 → AI 分析 → 聚类成事件 → 带分析视角的日报，且**连续性**：昨天 TLDR 参与今天生成。
- 栈：Turborepo monorepo（TS + Python），几乎全跑 Cloudflare（Workers / Durable Objects / Workflows / Browser Rendering / R2 / Hyperdrive / Pages），PostgreSQL + Drizzle，AI 用 Gemini + 本地嵌入模型。

### 5.2 仓库结构（131 个文件）

```
apps/backend/     Cloudflare Workers (Hono)
  durable_objects/dataSourceIngestorDO.ts   采集器（每源一个 DO）
  workflows/processIngestedItem.workflow.ts 处理管道
  lib/articleFetchers.ts                    双策略抓正文
  lib/parsers.ts                            RSS 解析 + Readability
  prompts/articleRepresentation.prompt.ts   结构化 LLM 分析
apps/briefs/      Python 简报生成器（src/events.py 拉数据, src/llm.py 调 Gemini）
apps/frontend/    Nuxt 3（简报展示 + 数据源 admin + 订阅表单）
packages/database/ Drizzle schema + 迁移（4 个）
services/meridian-ml-service/ Python FastAPI 嵌入服务（Fly.io）
```

### 5.3 数据流

```
RSS 源 → ① 采集 DO（频率分层定时抓）→ ingested_items
      → ② 处理 Workflow（fetch/浏览器渲染 → Readability → Gemini 分析 → 嵌入）
      → ③ Python 简报（拉 30h 窗口 → UMAP+HDBSCAN 聚类 → LLM 逐簇分析 → 昨日 TLDR 进上下文 → Markdown 简报）
      → ④ Nuxt 展示 + newsletter 订阅（邮件发送未实现）
```

### 5.4 关键设计细节（可直接抄）

1. **采集频率分层**：Tier1=1h / Tier2=4h / Tier3=6h / Tier4=24h，每源一个 Durable Object + alarm，抓取带指数退避重试（3 次，0.5s 翻倍）。
2. **去重**：`unique(data_source_id, item_id_from_source)` 唯一约束 + `url_to_original` 唯一 → 同源重复抓不重复入库。
3. **正文双轨存储**：>10KB 进 R2 对象存储，小文本内联 `content_body_text`。
4. **抓正文双策略**：简单 HTTP fetch（省） / Cloudflare Browser Rendering（对付 JS/付费墙/cookie 墙），注入 8 个脚本：自动点掉 cookie 弹窗、剥离 paywall、删广告/评论/侧栏、净化 DOM 属性、递归删空节点。
5. **状态机**：`ingested_item_status` 枚举 NEW → PENDING_PROCESSING → PROCESSED，失败细分 FAILED_RENDER / FAILED_FETCH / FAILED_PROCESSING / FAILED_EMBEDDING / SKIPPED_PDF / SKIPPED_TOO_OLD，带 `fail_reason`。
6. **向量检索**：embedding vector(384) + HNSW 索引（cosine）。嵌入对象不是正文，而是 LLM 分析出的结构化表示（`embedding_text`），语义更浓缩。
7. **结构化 LLM 分析字段**（`articleRepresentation.prompt.ts`，Gemini 逐篇生成，temperature=0）：
   - Topic: technology/politics/business/health/agriculture/sports/international
   - Subtopic: ai-research / elections / trade-policy …
   - Geography: global/us/china/europe/城市/地区
   - Scope: policy/technical/market/social-impact/breaking-news/analysis
   - **Urgency: breaking/developing/routine/historical ← 消息优先级雏形**
   - Source: mainstream/trade/academic/government/blog
   - Entities: ≤5 个（人/组织/产品/地点）
   - Tags: ≤5 个
8. **聚类**：multilingual-e5-small 384 维（平均池化 + L2 归一化）→ UMAP 降维 → HDBSCAN → LLM 逐簇审查 → LLM 深度分析（JSON）→ Markdown。聚类参数落库（`reports.clustering_params`）保证可复现。
9. **连续性跟踪**：README 架构图 `Previous Day TLDR DB → Final Briefing LLM`——昨天 TLDR 作为上下文参与今天生成，实现"事件跟进"。粒度是日报级，不是事件级。
10. **限流**：8 并发、跨域 1s 冷却、同域 5s 冷却（DomainRateLimiter）。

### 5.5 数据模型（schema.ts）

- `data_sources`：config jsonb（url/paywall/config_schema_version）+ config_version_hash 检测变更。
- `ingested_items`：核心表，含 item_id_from_source / url_to_original / 双轨正文 / embedding / analysis_payload jsonb / 状态枚举。
- `reports`：title / content / totalArticles vs usedArticles（聚类后实际用了几篇）/ tldr / clustering_params / model_author。
- `newsletter`：订阅邮箱（唯一）。

### 5.6 短板（README 自述 + 代码观察）

- 简报生成是手动跑 notebook，聚类主逻辑**未提交进仓库**（仓库只有 events.py 数据拉取 + llm.py 调用工具）。
- `source_type` 枚举只有 RSS；无 X/邮箱/网页监控。
- 无推送：newsletter 表只是订阅表单，邮件发送没实现；无优先级路由、无静音时段。
- 深度绑 Cloudflare（Workers/DO/Browser Rendering/R2/Hyperdrive）+ Fly.io 嵌入服务，自托管门槛高。
- 快速演进期：seed.ts 还在用旧表名 `$sources`（schema 已改名 `$data_sources`）。
- Gemini 固定 gemini-2.0-flash-001 做逐篇分析。

### 5.7 需求对照

| 需求 | Meridian 能给的 | 缺的 |
|------|----------------|------|
| 多渠道 | 仅 RSS | 邮箱 / X / 官网监控 |
| 优先级 | 有 Urgency 字段，无路由推送 | 分级决策 + 推送通道 |
| 持久化+合并 | Postgres + 向量聚类 ✅ | 故事级连续性（只有日报级） |
| LLM 整理+跟进 | 日报连续性 TLDR ✅ | 事件级跟进、推送去重 |

---

## 6. 建议路线：分层自建（全部用现成组件）

```
采集层   RSSHub + 各源适配器（X/aihot/官网/GitHub/USGS 地震/邮箱 IMAP）
存储层   SQLite 或 Postgres：raw 消息表 + story 表 + 推送状态表
分析层   embedding 聚类（新消息归入已有 story = 连续跟进）+ LLM 摘要
        story 表天然承载「不重复推送」
决策层   优先级路由：来源/关键词/震级/LLM 判断 → 分级
推送层   ntfy（低优先级进日报/静音）+ 紧急通道直接响铃
调度     cron 日报 + 实时轮询紧急通道
```

要点：
- 不要直接 fork Meridian（Cloudflare 依赖重、简报靠手动 notebook）；**它的架构、数据库设计、结构化分析字段、状态机是最值得抄的作业**。
- 优先级机制参考 Meridian 的 Urgency 字段设计（breaking/developing/routine/historical）映射到 ntfy priority 1-5 + 静音时段。
- 连续消息跟进 = story 表：新消息先做 embedding 相似度匹配归入已有 story，story 有"最近推送时间/内容指纹"，同 story 只推增量。
- 地震灾情数据源：USGS GeoJSON feed（每分钟更新）或中国地震台网速报接口，走紧急通道（超阈值直接推）。
- 邮箱：IMAP 轮询 + LLM 判断重要性，重要邮件走紧急通道。
- 若想基于现成项目起步：meridiano（AGPL fork）比 meridian 好自托管，但两者都缺推送层，改造量不小。

---

## 7. 待办 / 下一步

- [ ] 确认 aihot 是否有 RSS/API（无则 RSSHub 路由或爬虫）
- [ ] 确定自建技术栈（Bun/TS 或 Python）与方案 A/B/C（自建 / 基于 Hermes / fork meridiano）
- [ ] 深入调研具体数据源接入方式（X API vs RSSHub 路由、GitHub 通知 API、邮箱 IMAP）
- [ ] 设计 story 表 schema 与去重算法选型（embedding 相似度阈值 vs LLM 判定）

---

## 附：关键链接汇总

- 完整项目：meridian / meridiano / TrendRadar / hot_news_daily_push / auto-news / news-aggregator / RSSbrew / precis / clawfeed / ai-news-radar
- 索引：awesome-ai-news、GitHub topic: rss-aggregator
- 基础设施：RSSHub / Uptime Kuma / ntfy / Apprise / USGS Earthquake Feed
- 技术参考：Feedly clustering 工程博客 / arXiv 2508.08272 / NEWS-COPY / GPTrace
- Hermes：daily-briefing-bot 教程
