# OpenCLI 与数据获取生态 — 调研报告

> 调研日期：2026-08-06
> 调研范围：OpenCLI（jackwener/OpenCLI）项目定位、功能与实操验证；Cosmos 六大采集渠道（RSS、Bilibili、X、Telegram、邮箱、网页公告）的开源工具生态；OpenCLI 对 Cosmos 的集成定位
> 结论预览：**OpenCLI 是"登录态采集"的正确补位方案，但不是主通道。Cosmos 第一阶段以 RSS/RSSHub 为主通道，用 OpenCLI 做 Bilibili / 微信 / X 等必须登录态渠道的低频采集执行器；Bilibili 自研爬虫有律师函关停先例，务必规避。**

---

## 1. OpenCLI 是什么

**jackwener/OpenCLI**（"Make Any Website into CLI & Use your logged-in browser by AI agent"）：把任何网站变成 CLI 命令，让 AI Agent 通过**用户已登录的浏览器**操作网站并获取数据。

| 项目 | 值 |
|------|-----|
| GitHub | <https://github.com/jackwener/OpenCLI>（中文 README：<https://github.com/jackwener/OpenCLI/blob/main/README.zh-CN.md>） |
| npm | `@jackwener/opencli`（scoped 包；**裸名 `opencli` 在 npm 上不存在**，PyPI 上另有 2019 年已废弃的同名包，勿混淆） |
| 维护状态 | 极活跃（约 2.8 万 star，2026-08-06 仍有更新；实测安装版本 v1.8.6） |
| 系统要求 | Node.js >= 20 |
| 技术原理 | Chrome 扩展（Browser Bridge）+ 本地 daemon（固定端口 `localhost:19825`），通过 CDP 操控已登录 Chrome；daemon 按需自动启动 |

### 1.1 命令体系（v1.8.6 实测）

- **150+ 站点适配器**：bilibili、twitter、xiaohongshu、zhihu、weixin、douyin、weibo、youtube、github(-trending)、arxiv、pubmed、hackernews、reddit、v2ex、juejin、v2ex、bbc、bloomberg 等；另有桌面 App 适配器（Cursor、Codex、ChatGPT、Claude、Trae 等，Electron/CDP）
- **34 个 browser 原语**：`open` `state` `click` `type` `fill` `select` `extract` `network` `tab list/new/select/close` `bind` `unbind` `screenshot` `eval` `scroll` `wait` `upload` 等，用法如 `opencli browser <session> open <url>`
- **扩展机制**：`opencli plugin install github:user/repo` 装第三方插件；`opencli external register <cli>` 把本地 CLI（gh、docker、tg、discord 等）接入作为命令
- **媒体下载**：B站视频（yt-dlp）、小红书图片/视频、X 图片/视频、知乎文章 Markdown、微信文章 Markdown、小宇宙音频/转录等

### 1.2 输出与退出码（对程序集成友好）

- 输出格式 `-f table/json/yaml/md/csv/plain`（默认 table），**JSON 可直接进录入管线**（实测四种格式均正常）
- 退出码遵循 Unix sysexits.h：`0` 成功、`66` 无数据、`69` Browser Bridge 未连接、`75` 超时、`77` 需要认证、`78` 配置错误、`130` Ctrl-C

### 1.3 浏览器依赖边界（实测）

| 命令 | 标记 | 实测结果 |
|------|------|----------|
| `hackernews top` | public | ✅ 成功（真实数据） |
| `github-trending repos` | public | ✅ 成功 |
| `arxiv search "agent memory"` | public | ✅ 成功 |
| `bbc news` | public (RSS) | ❌ 网络超时（外网访问问题，见 §3.4） |
| `v2ex hot` | public | ❌ 网络超时（连接 CDN 超时） |
| `bilibili hot` | cookie/ui | ❌ exit 69，需 Browser Bridge |
| `weixin search` | cookie/ui | ❌ exit 69，需 Browser Bridge |

规律：约 338 个 `[public]` 命令免浏览器（走 API/RSS）；`[cookie]`/`[ui]` 命令必须装 Chrome 扩展并保持登录态。**Cosmos 需要的 Bilibili / 微信 / X 全部落在"需浏览器"一侧。**

### 1.4 MCP 与 Agent 生态

- 官方**无** MCP server；社区包 `opencli-mcp-http`（v0.1.1，MIT，面向 Claude Desktop 3p 的 HTTP MCP 包装，带持久工具授权，2026-06 发布，成熟度一般）
- 官方 Agent 接入方式是 skill：`npx skills add jackwener/opencli`（装 `opencli-browser`、`opencli-adapter-author`、`opencli-autofix`、`opencli-sitemap-author`、`opencli-usage` 等；属 Codex CLI skill 机制）
- 中文社区衍生：`qiaomu-opencli-skills`（978 star，Bilibili/知乎/X 数据获取命令集）、`opencli-admin`（可视化采集/AI 打标/推送，116 star）、`opencli-weixin-album`（公众号合集抓取，235 star）

### 1.5 本机安装要点（Windows / npmmirror）

```bash
npm install -g @jackwener/opencli
# npmmirror 镜像下 postinstall（拉取适配器数据）会被拦截，需：
npm install -g --allow-scripts=@jackwener/opencli @jackwener/opencli
opencli doctor   # 验证：Daemon 正常 / 扩展未连接（需装 Chrome 扩展）
```

---

## 2. 数据获取生态调研（对照 Cosmos 六渠道）

| 渠道 | 推荐方案 | 维护状态 | 备注 |
|------|----------|----------|------|
| **RSS** | RSSHub（路由模式可抄）；rss-parser / fast-xml-parser 自研归一化 | ✅ 活跃 | RSSHub 同栈 TS，`lib/routes/<platform>/<sub>.ts` 平台隔离 + 统一缓存抽象 |
| **Telegram** | **mtcute**（TS，明确支持 Bun） | ✅ 活跃 | Telethon（Python）、GramJS（TS）均已归档，新项目勿入坑；第一阶段可先抓 `t.me/s/<channel>` 公开预览页免账号（RSSHub 同法） |
| **邮箱** | **imapflow + mailparser**（纯 JS，Bun 兼容） | ✅ 活跃 | imapflow 支持 IDLE 实时 + 增量同步；node-imap 已停滞 |
| **网页公告** | 自研"轮询 + selector 归一化 + diff"，参照 changedetection.io 模式 | ✅ 活跃 | changedetection.io：fetch → 归一化（CSS/XPath/JSONPath/jq/regex）→ diff → 通知（Apprise/ntfy/webhook）；FreshRSS 的 XPath 抓取可做无 RSS 站点兜底 |
| **Bilibili** | RSSHub `/bilibili/*` 路由 + OpenCLI 登录态低频补充 | ⚠️ 高危 | **bilibili-API-collect 2026-01 因 B 站律师函永久关停**（"系统性收集传播非公开 API"），原 Python 库 bilibili-api 已归档，TS 侧空白；自研爬虫有法律风险 |
| **X/Twitter** | twitter-api-v2（付费）或 OpenCLI/Nitter（自备账号） | ⚠️ 最贵 | 免 Key 方案已断档：agent-twitter-client npm 已标记废弃、Nitter 需真实账号；RSSHub `/twitter/*` 也需官方 token |

### 2.1 正文提取与通用抓取

- **mozilla/readability**（JS，11k star）：Firefox Reader Mode 同款正文提取，可直接嵌入 Bun——"网页公告抓取后清洗"的标配
- Crawl4AI（Python，76k star，LLM 友好）、Firecrawl（TS，162k star，可自托管）、Playwright（浏览器自动化基础设施层）
- 同类新项目 **Agent-Reach**（Python CLI，67k star，2026-08-06 仍更新）："零 API 费用读 Twitter/Reddit/YouTube/Bilibili/小红书"，与 Cosmos 第一阶段渠道重合度高，值得盯住

### 2.2 自托管聚合项目可借鉴的设计

- **Miniflux**（Go）：抓取器契约最值得抄——条件请求全套（ETag/Last-Modified/If-None-Match）、后台调度 + cron 双模式、Readability 全文抓取、UA/cookie/proxy 可配
- **readflow**（Go）：webhook 进出 + JS 脚本引擎 + 外部导入矩阵 + CLI 带 MCP server——"工作台集成层"样板
- **yarr**（Go）：单二进制 + 嵌入式 SQLite 极简哲学；**FreshRSS**（PHP）：WebSub 推送接收

---

## 3. OpenCLI 对 Cosmos 的集成定位（结论）

1. **定位**：低频、登录态渠道的采集执行器（Action 级），**不是主通道**。Bilibili 动态、微信文章、X 时间线 → 适合；HN/arXiv/GitHub Trending → 可用但没必要（Cosmos 自写 RSS 更可控、无外部依赖）
2. **集成形态**：Action 以子进程调用 `opencli <site> <cmd> -f json`，把退出码映射为采集状态——`66` 无数据、`69` 需浏览器桥、`75` 超时、`77` 需人工登录（触发通知）
3. **前置条件**：用户必须装 Chrome 扩展并保持浏览器登录态——长期运维成本，PRD 应作为"登录态来源"待决策项
4. **风险**：`[public]` 命令依赖上游 API/RSS 稳定性（实测 v2ex/bbc 超时）；适配器由社区维护，命令签名随上游变动；版本升级需纳入 Cosmos 依赖管理
5. **网络**：opencli 不处理代理；BBC/v2ex 在本机超时而 GitHub/HN/arxiv 正常——代理策略需在 Cosmos 侧统一（浏览器登录态路径天然复用浏览器自身代理设置）

---

## 4. 来源链接

- OpenCLI 主仓库：<https://github.com/jackwener/OpenCLI>；中文 README：<https://github.com/jackwener/OpenCLI/blob/main/README.zh-CN.md>
- opencli-mcp-http：<https://github.com/duanmuq/opencli-mcp-http>
- 中文生态：<https://github.com/joeseesun/qiaomu-opencli-skills>、<https://github.com/xjh1994/opencli-admin>、<https://github.com/SlowGrowth1314/opencli-weixin-album>
- Agent-Reach：<https://github.com/Panniantong/Agent-Reach>
- RSSHub：<https://github.com/DIYgod/RSSHub>；Miniflux：<https://github.com/miniflux/v2>；FreshRSS：<https://github.com/FreshRSS/FreshRSS>；yarr：<https://github.com/nkanaev/yarr>；readflow：<https://github.com/ncarlier/readflow>
- mtcute：<https://github.com/mtcute/mtcute>；imapflow：<https://github.com/postalsys/imapflow>；mailparser：<https://github.com/nodemailer/mailparser>
- changedetection.io：<https://github.com/dgtlmoon/changedetection.io>；ntfy：<https://github.com/binwiederhier/ntfy>
- mozilla/readability：<https://github.com/mozilla/readability>；Crawl4AI：<https://github.com/unclecode/crawl4ai>；Firecrawl：<https://github.com/firecrawl/firecrawl>
- bilibili-API-collect（关停公告，含律师函说明）：<https://github.com/SocialSisterYi/bilibili-API-collect>；BACNext：<https://github.com/BACNext/BACNext>
- twitter-api-v2：<https://github.com/PLhery/node-twitter-api-v2>；Nitter：<https://github.com/zedeus/nitter>
