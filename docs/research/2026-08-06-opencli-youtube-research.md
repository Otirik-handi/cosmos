# OpenCLI 获取 YouTube 信息 — 调研报告

> 调研日期：2026-08-06
> 调研范围：OpenCLI（`@jackwener/opencli` v1.8.6 + Browser Bridge 扩展 v1.0.22）在本机（Windows / Chrome）实测获取 YouTube 信息：代理前置、匿名可用边界、登录态命令、数据形态与代理中断的失败特征
> 结论预览：**YouTube 是已测国外渠道中匿名可用面最大的：search/video/channel/comments/transcript/feed 全部免登录可用，`transcript` 提供带时间戳的官方字幕（优质派生数据源）；代理是硬前置，代理中断时各命令失败形态各异（超时/TypeError/空结果），难以直接归因。登录态命令（history/subscriptions）在浏览器 Google 账号会话下可用，`whoami` 状态检测不稳定（同会话 77 → true）。**

---

## 1. 前置条件与环境

| 项 | 值 |
|----|-----|
| 操作系统 | Windows 10+（Git Bash） |
| Node | v24.14.0（要求 ≥ 20） |
| CLI | `@jackwener/opencli` v1.8.6（全局 npm 安装） |
| 扩展 | opencli-extension v1.0.22（Chrome，已加载） |
| 浏览器 | Chrome（需保持运行） |
| **代理** | **本地 `http://127.0.0.1:10808`（硬前置）**：命令级 `HTTP_PROXY`/`HTTPS_PROXY` 注入；浏览器 tab 也依赖代理（实证：代理中断时 tab 报 `ERR_CONNECTION_TIMED_OUT`） |
| 登录态 | 浏览器会话实际已登录 Google 账号（whoami 首次 77、复测 `logged_in: true`，name "账号菜单"）——会话状态检测不稳定 |

youtube 适配器共 16 个命令：`search` `video` `channel` `comments` `transcript` `playlist` `feed`（read）+ `history` `subscriptions` `watch-later` `whoami`（个人）+ `like` `unlike` `subscribe` `unsubscribe` `login`（write）。

## 2. 实测结果

### 2.1 免登录命令（全部 exit 0）

**`opencli youtube search "DeepSeek" --limit 3 -f json`** — 搜索 ✅

```json
[
  { "rank": 1, "title": "DeepSeek V4 Flash Is INSANE – The Best Small Model Yet!",
    "channel": "Bijan Bowen", "duration": "36:57", "published": "6天前",
    "views": "79,881次观看",
    "url": "https://www.youtube.com/watch?v=PTdu0JlhGfw" }
]
```

**`opencli youtube video <watch-url> -f json`** — 视频元数据 ✅（field/value 键值对列表）

```json
[
  { "field": "category",    "value": "Entertainment" },
  { "field": "channel",     "value": "Bijan Bowen" },
  { "field": "channelId",   "value": "UCOCahKBCEUuzDJawM7yN1dg" },
  { "field": "description", "value": "Timestamps:\n\n00:00 - Intro\n…" },
  { "field": "duration",    "value": "2217s" },
  { "field": "isLive",      "value": "false" },
  { "field": "keywords",    "value": "" }
]
```

**`opencli youtube channel <channelId> --limit 3 -f json`** — 频道 ✅（**要 channelId 不要频道名**：传名字报 `HTTP 400`）

```json
[
  { "field": "channelId",   "value": "UCOCahKBCEUuzDJawM7yN1dg" },
  { "field": "description", "value": "www.bijanbowen.com\n" },
  { "field": "handle",      "value": "@Bijanbowen" },
  { "field": "keywords",    "value": "" },
  { "field": "name",        "value": "Bijan Bowen" }
]
```

**`opencli youtube comments <watch-url> --limit 3 -f json`** — 评论 ✅

```json
[
  { "rank": 1, "author": "@iZoomz", "likes": "413", "replies": "6",
    "text": "4:05 that's not 2 cents, its .28 of a cent LOL",
    "time": "6天前" },
  { "rank": 2, "author": "@laxi28", "likes": "143", "replies": "1",
    "text": "…", "time": "6天前（修改过）" }
]
```

**`opencli youtube transcript <watch-url> -f json`** — 字幕 ✅（**带时间戳的官方字幕，优质派生数据源**）

```json
[
  { "timestamp": "0:00", "speaker": "", "text": "[Chapter] Intro" },
  { "timestamp": "0:02", "speaker": "", "text": "It's not funny, but it [clears throat] is. …" }
]
```

**`opencli youtube feed --limit 3 -f json`** — 首页推荐 ✅（免登录）

```json
[
  { "rank": 1, "title": "🚀DeepSeek V4 Flash全面实测：…", "channel": "AI超元域",
    "duration": "13:12", "published": "6天前", "views": "3.4万次观看",
    "video_id": "d_5GYmICVTk", "url": "https://www.youtube.com/watch?v=d_5GYmICVTk" }
]
```

### 2.2 登录态命令（浏览器 Google 账号会话已登录）

| 命令 | 结果 |
|------|------|
| `whoami` | ⚠️ **不稳定**：首次 `AUTH_REQUIRED` / exit 77（"LOGGED_IN not true and no avatar"），复测 `logged_in: true`（name "账号菜单"）——会话状态检测与页面加载时序有关 |
| `history --limit 5` | ✅ 真实观看历史：channel/title/url（**带 `&t=` 进度**）/views（`published` 为空） |
| `subscriptions` | ✅ 订阅频道列表：rank/handle/name/subscribers（"50.1万位订阅者"） |

### 2.3 代理中断的失败形态（实证）

代理 `127.0.0.1:10808` 中途退出时，各命令失败形态**各不相同**，难以直接归因：

| 命令 | 失败形态 |
|------|----------|
| `browser <session> state`（tab 直接访问） | `chrome-error://chromewebdata/` + `ERR_CONNECTION_TIMED_OUT` |
| `video` | `UNKNOWN` / "TypeError: Failed to fetch" / exit 1 |
| `feed` | `COMMAND_EXEC` / "YouTube data not found — are you logged in?" / exit 1 |
| `search` | `[]` + exit 0（空数组静默） |

代理恢复后（curl 验证 `youtube.com → 200`）全部命令恢复正常——**根因只能通过"恢复后全通"确认**，集成时需把代理可用性作为前置检查。

### 2.4 未实测命令

`watch-later`（个人）、`playlist`（需 playlist ID，无样本）、write 命令（like/subscribe/unlike/unsubscribe，非采集目标）。

## 3. 关键观察

1. **国外渠道中匿名可用面最大**：search/video/channel/comments/transcript/feed 全部免登录——对比 X（全登录墙）、对比国内渠道（B 站/小红书部分匿名），YouTube 是唯一"正文级 + 字幕级 + 推荐流"全匿名可采的渠道
2. **`transcript` 是独特资产**：带时间戳分段字幕，是现成的高质量正文证据/派生数据源（其他渠道均无对等物；B 站有官方 AI summary 但非原文）
3. **代理中断失败形态不可归因**：同一次中断，超时/TypeError/空数组/误导性报错（"are you logged in?"）四种表现并存——代理故障必须靠前置检查（curl 探活）而不是退出码反推
4. **whoami 状态不稳定**：同会话 77 → true 复现，登录态判断需重试或结合行为（history/subscriptions 有数据即视为已登录）
5. **参数陷阱**：`channel` 要 channelId 非频道名（400）；`video`/`channel` 输出 field/value 键值对（同小红书 note、微博 post 型）
6. **本地化文本需解析**：views（"79,881次观看"/"3.4万次观看"）、published（"6天前"）、subscribers（"50.1万位订阅者"）、duration（"36:57" 与 video 的 "2217s" 两形态）、comments time 含"（修改过）"标记
7. **登录态命令与 Google 账号绑定**：history/subscriptions/watch-later 是个人数据，凭证留在 Chrome（同既有渠道模式）

## 4. 对 Cosmos 集成的结论

1. **定位**：YouTube 是"免登录 + 代理硬前置"的主采集渠道——search（发现）/ video（元数据）/ transcript（字幕正文）/ comments（互动）/ feed（推荐流）全免登录，Phase 1 集成门槛最低的国外渠道
2. **目标命令**：`search`/`feed`（发现）→ `video`（元数据证据）→ `transcript`（正文证据，时间戳分段）→ `comments`（互动证据）；`subscriptions`（登录态）可做 Subject 级频道监控输入
3. **代理策略**：与 X 同需代理，但 YouTube 公共命令在代理可用时免登录——Cosmos 的代理配置是全局前置（`HTTP_PROXY`/`HTTPS_PROXY` 注入 + 采集前探活），浏览器路径依赖 Chrome 自身代理设置
4. **失败判定**：代理故障不可从退出码归因（四种形态）——Action 前置 curl 探活；whoami 不稳定需重试；`channel` 参数需 channelId；field/value 需转对象；本地化数值文本需解析归一化
5. **未实测**：`watch-later`/`playlist`/write 命令；登录态下的 `feed`（个性化）与匿名 `feed` 的差异

## 5. 来源链接

- OpenCLI 主仓库：<https://github.com/jackwener/OpenCLI>；Releases（扩展包）：<https://github.com/jackwener/OpenCLI/releases>
- 中文 README：<https://github.com/jackwener/OpenCLI/blob/main/README.zh-CN.md>
- 前序实测（扩展安装 / 登录态链路 / 渠道对比 / 代理注入）：<2026-08-06-opencli-research.md>、<2026-08-06-opencli-bilibili-research.md>、<2026-08-06-opencli-zhihu-research.md>、<2026-08-06-opencli-twitter-research.md>、<2026-08-06-opencli-xiaohongshu-research.md>、<2026-08-06-opencli-weixin-research.md>、<2026-08-06-opencli-weibo-research.md>
