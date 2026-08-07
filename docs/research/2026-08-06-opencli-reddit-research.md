# OpenCLI 获取 Reddit 信息 — 调研报告

> 调研日期：2026-08-06
> 调研范围：OpenCLI（`@jackwener/opencli` v1.8.6 + Browser Bridge 扩展 v1.0.22）在本机（Windows / Chrome）实测获取 Reddit 信息：代理前置、匿名可用边界、登录态命令、评论树形态与适配器缺陷
> 结论预览：**Reddit 是已测渠道中公开可用面最大的之一：hot/frontpage/popular/search/subreddit-info/read/user 全部免登录可用，`read` 输出 POST/L0/L1 三层评论树、`search` 含 selftext 正文、subreddit-info 带 NSFW 标记。登录态命令仅 whoami 可用；`subscribed` 因适配器直连 Reddit JSON API 端点 404 而失效；新账号的 home/saved/upvoted 返回空（语义正确）。**

---

## 1. 前置条件与环境

| 项 | 值 |
|----|-----|
| 操作系统 | Windows 10+（Git Bash） |
| Node | v24.14.0（要求 ≥ 20） |
| CLI | `@jackwener/opencli` v1.8.6（全局 npm 安装） |
| 扩展 | opencli-extension v1.0.22（Chrome，已加载） |
| 浏览器 | Chrome（需保持运行） |
| **代理** | **本地 `http://127.0.0.1:10808`（硬前置）**：命令级 `HTTP_PROXY`/`HTTPS_PROXY` 注入 |
| 登录态 | 初始未登录（77）；用户扫码登录后确认（`u/Low-Measurement1106`，新账号无订阅数据） |

reddit 适配器共 22 个命令：`hot` `frontpage` `popular` `search` `subreddit` `subreddit-info` `read` `user` `user-comments` `user-posts`（read）+ `home` `saved` `subscribed` `upvoted` `whoami`（个人）+ `comment` `reply` `save` `subscribe` `upvote` `login`（write）。

## 2. 实测结果

### 2.1 免登录命令（全部 exit 0）

**`opencli reddit hot --limit 5 -f json`** — 热门 ✅

```json
[
  { "rank": 1, "title": "bro was starving for 4 minutes", "subreddit": "r/Unexpected",
    "score": 12745, "comments": 122, "postId": "1vhr9qo", "author": "wtf_nabil",
    "url": "https://www.reddit.com/r/Unexpected/comments/1vhr9qo/bro_was_starving_for_4_minutes/",
    "post_hint": "hosted:video",
    "url_overridden_by_dest": "https://v.redd.it/g6k3vevvxvhh1",
    "preview_image_url": "https://external-preview.redd.it/…",
    "gallery_urls": [] }
]
```

**`opencli reddit search "DeepSeek" --limit 3 -f json`** — 搜索 ✅（含正文 selftext + unix 时间戳）

```json
[
  { "id": "1vbjdby", "title": "DeepSeek-V4-Flash-0731 is going to cause another market crash.",
    "subreddit": "r/LocalLLaMA", "author": "Potential_Top_4669",
    "score": 609, "comments": 232,
    "url": "https://www.reddit.com/r/LocalLLaMA/comments/1vbjdby/…",
    "created_utc": 1785481049,
    "selftext": "Beats GLM 5.2, and is the same cost as the previous one. ",
    "post_hint": "", "url_overridden_by_dest": "", "preview_image_url": "", "gallery_urls": [] }
]
```

**`opencli reddit read <postId> --limit 3 -f json`** — 帖 + 评论树 ✅（**POST/L0/L1 层级**）

```json
[
  { "type": "POST", "author": "Potential_Top_4669", "score": 610,
    "text": "DeepSeek-V4-Flash-0731 is going to cause another market crash.\n\nBeats GLM 5.2, …" },
  { "type": "L0", "author": "nuclearbananana", "score": 395,
    "text": "*in benchmarks. …" },
  { "type": "L1", "author": "Hot_Example_4456", "score": 155,
    "text": "> DeepSeek is different. …" }
]
```

**`opencli reddit subreddit-info LocalLLaMA -f json`** — 版块元数据 ✅（field/value，含 NSFW 标记）

```json
[
  { "field": "Name", "value": "r/LocalLLaMA" },
  { "field": "Title", "value": "LocalLlama" },
  { "field": "Subscribers", "value": "793730" },
  { "field": "Active Now", "value": null },
  { "field": "NSFW", "value": "No" }
]
```

**`frontpage` / `user`** ✅ — 字段同 hot（注意 frontpage 用 `upvotes`、hot 用 `score`，字段名不一致）；user 输出 Username/Post Karma/Comment Karma/Total Karma 等。

### 2.2 登录态命令

| 命令 | 结果 |
|------|------|
| `whoami` | ✅ `u/Low-Measurement1106`（field/value 列表输出，与其他适配器 JSON 对象风格不同） |
| `home` | ⚠️ `EMPTY_RESULT` / exit 66——新账号无订阅 → 个性化 feed 为空（help 同时提示"页面结构可能已变"） |
| `saved` / `upvoted` | ✅ `[]` + exit 0——新账号无数据，语义正确 |
| `subscribed` | ❌ `COMMAND_EXEC` / exit 1："HTTP 404 from `/subreddits/mine/subscriptions.json?limit=100&raw_json=1`"——**适配器直连 Reddit JSON API 端点已失效** |

### 2.3 未实测

`subreddit`（子版块帖子，未单独测——hot/frontpage 已覆盖同形态）、`user-comments`/`user-posts`（用户历史，未测）、write 命令（comment/reply/save/subscribe/upvote，非采集目标）。

## 3. 关键观察

1. **公开面最大之一**：正文（selftext）+ 评论树（L0/L1）+ karma + NSFW 标记全部匿名可得——与 YouTube 同属"免登录深度采集"阵营
2. **评论树是独特资产**：`read` 的 type 字段区分 POST/L0/L1，天然形成讨论层级结构（对 Story 归并/观点聚合价值高）
3. **适配器缺陷**：`subscribed` 直连 `/subreddits/mine/subscriptions.json` 404——Reddit 2023 后收紧 API 后端点失效，适配器未更新；错误信息暴露内部端点路径（对排障有用）
4. **字段名不一致**：frontpage 用 `upvotes`、hot 用 `score`；whoami 输出 field/value 列表（reddit 适配器风格不统一）
5. **新账号空数据语义正确**：saved/upvoted `[]`+0、home 66——与小红书 liked/saved 的歧义形成对比（Reddit 的空是可信的）
6. 输出流同样混入 `# AutoFix: …` 注释行（全渠道一致）；代理中断会以各命令不同形态失败（同 YouTube 观察）

## 4. 对 Cosmos 集成的结论

1. **定位**：Reddit 是"免登录 + 代理硬前置"的主采集渠道——r/all（frontpage/hot/popular）、子版块、搜索（含正文）、评论树全匿名，Phase 1 集成门槛低
2. **目标命令**：`frontpage`/`hot`（热点）→ `search`（关键词发现，含 selftext 正文）→ `read`（正文 + 评论树证据）→ `subreddit-info`（版块元数据 + **NSFW 标记可直接做内容过滤**）
3. **订阅版块列表不可用**：`subscribed` 适配器缺陷——Cosmos 若需"关注版块列表"，得走浏览器原语或直接调用 Reddit OAuth API
4. **失败判定**：代理探活前置（同 YouTube）；`subscribed` 的 404 按适配器故障处理（可提示 autofix）；空结果（`[]`/66）在新账号场景可信
5. **归一化注意**：字段名（upvotes/score）需映射统一；created_utc 为 unix 秒需转换；selftext 可能为空
6. **未实测**：`user-comments`/`user-posts`、write 命令、`subreddit` 命令

## 5. 来源链接

- OpenCLI 主仓库：<https://github.com/jackwener/OpenCLI>；Releases（扩展包）：<https://github.com/jackwener/OpenCLI/releases>
- 中文 README：<https://github.com/jackwener/OpenCLI/blob/main/README.zh-CN.md>
- Reddit API 政策（2023 收紧背景）：<https://www.reddit.com/r/reddit/comments/12qwagm/an_update_regarding_the_reddit_api/>
- 前序实测（扩展安装 / 登录态链路 / 渠道对比 / 代理注入）：<2026-08-06-opencli-research.md>、<2026-08-06-opencli-bilibili-research.md>、<2026-08-06-opencli-zhihu-research.md>、<2026-08-06-opencli-twitter-research.md>、<2026-08-06-opencli-xiaohongshu-research.md>、<2026-08-06-opencli-weixin-research.md>、<2026-08-06-opencli-weibo-research.md>、<2026-08-06-opencli-youtube-research.md>、<2026-08-06-opencli-github-research.md>
