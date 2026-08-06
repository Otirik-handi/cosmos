# OpenCLI 获取 Twitter/X 信息 — 调研报告

> 调研日期：2026-08-06
> 调研范围：OpenCLI（`@jackwener/opencli` v1.8.6 + Browser Bridge 扩展 v1.0.22）在本机（Windows / Chrome）实测获取 Twitter/X 信息：代理配置、登录态命令、数据形态、退出码语义与内容安全策略
> 结论预览：**Twitter 适配器全部命令均需登录态（无免登录命令，比知乎更严），且代理是硬前置——本机 `127.0.0.1:10808` 通过 `HTTP_PROXY`/`HTTPS_PROXY` 环境变量注入 daemon 即生效（浏览器侧复用 Chrome 自身代理）。登录后 trending/search/tweets/thread/followers/download（含扫描模式）/timeline/bookmarks/likes 均稳定输出 JSON；`notifications` 返回空数组（exit 0）；`profile` 统计字段未填充（全 0）、用户名解析存在空壳账号陷阱；`66` 无数据语义实测一致；`article` 未找到样本。实测样本中部分内容敏感，报告以 `***` 遮掩。**

---

## 1. 前置条件与环境

| 项 | 值 |
|----|-----|
| 操作系统 | Windows 10+（Git Bash） |
| Node | v24.14.0（要求 ≥ 20） |
| CLI | `@jackwener/opencli` v1.8.6（全局 npm 安装） |
| 扩展 | opencli-extension v1.0.22（Chrome，已加载） |
| 浏览器 | Chrome（需保持运行） |
| **代理** | **本地 `http://127.0.0.1:10808`（硬前置）**：直连 x.com 失败（curl 000），走代理 200 |
| 代理注入 | 命令级环境变量：`HTTP_PROXY=http://127.0.0.1:10808 HTTPS_PROXY=http://127.0.0.1:10808 opencli twitter <cmd>`——daemon 以 `EnvHttpProxyAgent` 读取（每次运行输出 `[UNDICI-EHPA] experimental` 警告，不影响功能） |
| 登录态 | Chrome 中手动登录 https://x.com（账号 `Notnotype1`，用户操作，CLI 不接触凭证） |

twitter 适配器共 50 个命令，全标记 `Browser: yes`；核心只读命令：`trending` `search` `tweets` `profile` `followers` `following` `likes` `thread` `article` `timeline` `notifications` `bookmarks` `download` 等。

## 2. 实测结果

### 2.1 登录态探测

**`opencli twitter whoami -f json`** — 登录确认 ✅

```json
{
  "logged_in": true,
  "site": "twitter",
  "username": "Notnotype1",
  "url": "https://x.com/Notnotype1"
}
```

登录前所有命令（含 `trending`）均返回 `AUTH_REQUIRED` / exit 77（"Twitter/X auth cookies are missing" / "Not logged into x.com (no ct0 cookie)"）——**无任何免登录命令**。

### 2.2 公开内容采集命令（登录态下，全部 exit 0）

**`opencli twitter trending -f json`** — 趋势 ✅

```json
[
  { "category": "Sports · Trending", "rank": 1, "topic": "Rodri" },
  { "category": "Trending in United States", "rank": 3, "topic": "mRNA" },
  ...
]
```

**`opencli twitter search "DeepSeek" --limit 3 -f json`** — 搜索 ✅

```json
[
  {
    "id": "2083084415157022911",
    "author": "deepseek_ai",
    "text": "🚀 DeepSeek-V4-Flash Official API is now LIVE in public beta! …",
    "created_at": "Fri Jul 31 06:56:41 +0000 2026",
    "likes": 29815,
    "views": "9137912",
    "url": "https://x.com/i/status/2083084415157022911",
    "has_media": true,
    "media_urls": ["https://pbs.twimg.com/media/HOiZba2aYAAozFz.jpg"],
    "media_posters": ["…jpg"],
    "card": null,
    "quoted_tweet": null
  }
]
```

**`opencli twitter tweets deepseek_ai --limit 2 -f json`** — 用户最近推文 ✅（字段比 search 更全）

```json
{
  "id": "2083084415157022911",
  "author": "deepseek_ai",
  "name": "DeepSeek",
  "text": "…",
  "likes": 29815,
  "retweets": 3521,
  "replies": 1652,
  "views": 9137988,
  "is_retweet": false,
  "created_at": "Fri Jul 31 06:56:41 +0000 2026",
  "url": "https://x.com/deepseek_ai/status/2083084415157022911",
  "has_media": true,
  "media_urls": ["…"],
  "media_posters": ["…"],
  "quoted_tweet": null
}
```

**`opencli twitter thread 2083084415157022911 --limit 3 -f json`** — 推文线程 ✅（原推 + 回复，回复带 `in_reply_to` 父推 id）

**`opencli twitter followers deepseek_ai --limit 3 -f json`** — 粉丝列表 ✅（仅 bio/name/screen_name 三字段，较简）

**`opencli twitter download --tweet-url <url> --output <dir> -f json`** — 媒体下载 ✅（3 个媒体 4s 完成）

```json
[
  { "index": 1, "tweet_id": "2083084415157022911",
    "url": "https://pbs.twimg.com/media/HOiZba2aYAAozFz?format=jpg&name=large",
    "type": "image", "status": "success", "size": "196.8 KB" }
]
```

输出目录为 `--output` 下按来源建子目录（实测 `.agent/tmp/twitter-dl-test-*/tweets/tweet_1.jpg|tweet_2.jpg|tweet_3.mp4`）。

### 2.3 命令级陷阱与异常

| 命令 | 结果 |
|------|------|
| `profile DeepSeek` | ⚠️ 解析到 `@deepseek`（2010 年注册的空壳账号，0 粉丝）而非官方 `@deepseek_ai`——**用户名解析陷阱**，须以 search 结果交叉验证账号身份 |
| `profile deepseek_ai` | ⚠️ `verified: true` + created_at 正确，但 **followers/following/tweets/likes 统计字段全为 0（未填充）**——profile 统计不可作为指标来源 |
| `tweets DeepSeek`（空壳账号） | ✅ 语义正确：`EMPTY_RESULT` / exit **66**（与文档一致）；同时输出 `# AutoFix: re-run with --trace=retain-on-failure` 注释行（混入输出流，程序化解析需过滤） |
| 进度条 | `download` 的进度条（`[1/3] tweet_1.jpg █…`）混入 stdout，与 JSON 交错——集成时需尾部截取或过滤 |

### 2.4 个人 feed 与书签命令（登录态）

**`opencli twitter timeline --limit 5 -f json`** — 个人时间线（for-you）✅ 输出结构同 `tweets`（id/author/bio/text/likes/retweets/replies/views/created_at/url/has_media/media_urls/media_posters/card/quoted_tweet）；实测样本中部分条目含敏感内容，报告以 `***` 遮掩：

```json
[
  { "id": "2085051620988240268", "author": "Lady_saleh", "text": "***",
    "likes": 3408, "views": 366501, "has_media": true },
  { "id": "2085379173254877244", "author": "***", "bio": "***", "text": "***",
    "likes": 0, "views": 0, "has_media": true }
]
```

**`opencli twitter notifications --limit 3 -f json`** — 通知流 ⚠️ 返回 `[]` + exit 0（空数组形态，从退出码无法区分"无数据"与"成功"）

**`opencli twitter bookmarks --limit 5 -f json`** — 书签 ✅ 结构与 `tweets` 略异：带 `bookmarks` 计数、无 `views`/`card`；实测 2 条均为纯链接推文

```json
[
  { "id": "2075751792403767340", "author": "chimto59444053",
    "text": "https://t.co/kazlinZado", "likes": 1595, "retweets": 79,
    "bookmarks": 1081, "created_at": "Sat Jul 11 01:19:27 +0000 2026",
    "has_media": false, "media_urls": [], "media_posters": [] }
]
```

**`opencli twitter likes --limit 5 -f json`** — 本人点赞 ✅ 结构同 bookmarks（含 `bookmarks` 计数、无 `views`）；实测样本中部分条目文字属擦边/低俗内容（`text` 已以 `***` 遮掩）

**`opencli twitter download deepseek_ai --limit 3 --output <dir> -f json`** — 按用户名扫描模式 ✅（与单推文模式互补）

```text
<dir>/deepseek_ai/deepseek_ai_1.jpg|deepseek_ai_2.jpg|deepseek_ai_3.jpg
```

### 2.5 未实测命令

`article`（长文导出）未实测：需长文推文 ID；经 search 检查 `card` 字段（仅见 `summary_large_image` 链接卡片）与 URL 模式搜索均未定位到 Article 推文样本。

## 3. 关键观察

1. **全命令登录门控，无免登录命令**：ct0 cookie 必需（比知乎更严——知乎至少 `user` 可匿名）；登录态复用浏览器，凭证不落 CLI
2. **代理是硬前置且注入方式已确认**：`HTTP_PROXY`/`HTTPS_PROXY` 环境变量对 daemon 生效（EnvHttpProxyAgent），浏览器侧走 Chrome 自身代理——修正 <2026-08-06-opencli-research.md> §3.5 "opencli 不处理代理"的说法为"opencli 无代理配置项，但尊重 env 代理变量"
3. **`tweets`/`search`/`thread` 输出是理想的 Observation 证据**：tweet id + ISO 时间戳 + 互动计数 + 媒体 URL 列表 + 回复父子关系，URL 可由 id 推导
4. **`profile` 统计字段未填充**（全 0）——与知乎 `user`（粉丝/回答/获赞齐全）形成对比，X 侧 Subject 指标不能依赖 profile 命令
5. **输出流污染是集成障碍**：进度条、AutoFix 注释行混入 stdout——JSON 解析必须容错（取最后一段合法 JSON 或过滤非 JSON 行）
6. **个人 feed 命令可用**：timeline/bookmarks/likes 输出结构与 tweets 一致（bookmarks/likes 带 `bookmarks` 计数、无 `views`）；实测样本中部分条目含敏感内容，报告以 `***` 遮掩；`notifications` 返回空数组且 exit 0（与 zhihu `hot` 匿名空结果同型）

## 4. 对 Cosmos 集成的结论

1. **定位**：X 是"全登录态 + 代理硬前置"的低频采集渠道，门槛为三渠道之最（知乎有 `user` 免登录，B 站 hot/search 免登录，X 全无）；PRD「登录态来源」待决策项应把 X 列为强依赖 + 需代理
2. **代理策略**：Cosmos 的 Worker/Action 需统一注入 `HTTP_PROXY`/`HTTPS_PROXY`（本机 `127.0.0.1:10808`），并纳入配置而非硬编码；浏览器路径复用 Chrome 代理——代理配置成为 X 渠道的部署前置条件
3. **目标命令**：`trending`（热点）、`search`（关键词）、`tweets`（账号推文）、`thread`（事件聚合）、`download`（媒体留存）——本轮全部验证通过；`profile` 统计不可用，Subject 指标需另找来源
4. **失败判定**：77 需登录（触发人工登录通知）、66 无数据（EMPTY_RESULT 实测一致）、解析层需过滤进度条/AutoFix 注释；用户名须先经 search 交叉验证身份再采集
5. **未实测**：`article`（长文导出，搜索未能定位 Article 推文样本）；个人 feed 命令（timeline/notifications/bookmarks/likes）与 `download` 扫描模式已补测，见 §2.4

## 5. 来源链接

- OpenCLI 主仓库：<https://github.com/jackwener/OpenCLI>；Releases（扩展包）：<https://github.com/jackwener/OpenCLI/releases>
- 中文 README：<https://github.com/jackwener/OpenCLI/blob/main/README.zh-CN.md>
- X 渠道生态背景（twitter-api-v2 / Nitter 断档分析）：<2026-08-06-opencli-research.md>
- 前序实测（扩展安装 / 登录态链路）：<2026-08-06-opencli-bilibili-research.md>、<2026-08-06-opencli-zhihu-research.md>
