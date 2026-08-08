# OpenCLI 获取小红书信息 — 调研报告

> 调研日期：2026-08-06
> 调研范围：OpenCLI（`@jackwener/opencli` v1.8.6 + Browser Bridge 扩展 v1.0.22）在本机（Windows / Chrome）实测获取小红书信息：匿名可用边界、登录态命令、签名 URL 前置条件、退出码语义与异常形态
> 结论预览：**小红书适配器是四渠道中匿名可用面最大的一个：feed/note/comments/download 免登录即可用（但 note/comments/download 必须传带 `xsec_token` 的完整签名 URL，纯笔记 ID 会报 exit 2 ARGUMENT）；search/user/whoami 需登录，登录后全部验证通过。核心只读链路（feed → note → comments → download）以 xsec_token 签名 URL 串联，是理想的"登录态可放宽"低频采集通道；xsec_token 的时效与来源问题是集成时的主要运维点。**

---

## 1. 前置条件与环境

| 项 | 值 |
|----|-----|
| 操作系统 | Windows 10+（Git Bash） |
| Node | v24.14.0（要求 ≥ 20） |
| CLI | `@jackwener/opencli` v1.8.6（全局 npm 安装） |
| 扩展 | opencli-extension v1.0.22（Chrome，已加载） |
| 浏览器 | Chrome（需保持运行） |
| 代理 | **不需要**（国内站点直连） |
| 登录态 | 初始未登录（`whoami` 报"登录已过期"）；用户手动扫码登录后确认（账号 `Otirik`） |

xiaohongshu 适配器共 25 个命令：只读有 `feed` `search` `note` `comments` `user` `liked` `saved` `notifications` `whoami` `download` `creator-notes` `creator-stats` 等；写入/创作者命令有 `publish` `follow` `delete-note` `drafts` 等。

## 2. 实测结果

### 2.1 免登录命令（匿名可用）

**`opencli xiaohongshu feed --limit 3 -f json`** — 首页推荐 ✅

```json
[
  { "id": "6a5421130000000007023103", "title": "小朋友现在六岁半，怎么知道他会是…",
    "type": "normal", "author": "每日一新", "likes": "3024",
    "url": "https://www.xiaohongshu.com/explore/6a5421130000000007023103?xsec_token=ABY-…&xsec_source=" }
]
```

**`opencli xiaohongshu note "<签名URL>" -f json`** — 笔记详情 ✅（匿名可用，但 title 字段误捕获登录弹窗文案"手机号登录"；登录后该字段恢复正常）

```json
[
  { "field": "title",    "value": "吃白饭的蓝色大肥鱼" },
  { "field": "author",   "value": "解语花燕归来" },
  { "field": "content",  "value": "#蓝色大肥鱼 #DeepSeek …" },
  { "field": "likes",    "value": "645" },
  { "field": "collects", "value": "213" },
  { "field": "comments", "value": "480" }
]
```

**`opencli xiaohongshu comments "<签名URL>" --limit 3 -f json`** — 评论 ✅（含楼中楼）

```json
[
  { "rank": 1, "author": "大華", "userId": "6281cbd60000000021026b79",
    "profileUrl": "https://www.xiaohongshu.com/user/profile/6281cbd60000000021026b79",
    "text": "其实大家应该感谢有这样的帖子，因为…",
    "likes": 10, "time": "07-29湖南", "is_reply": false, "reply_to": "" }
]
```

**`opencli xiaohongshu download "<签名URL>" --output <dir> -f json`** — 图片/视频下载 ✅（匿名可用，落盘 `<dir>/<note-id>/`）

### 2.2 登录态命令（登录后重测）

| 命令 | 结果 |
|------|------|
| `whoami` | ✅ `logged_in: true` / username `Otirik` / followers 0（未登录时 exit 77，报"登录已过期"） |
| `search "DeepSeek" --limit 3` | ✅ rank/author/author_url/likes/title/url（含 xsec_token）/published_at；URL 为 `/search_result/<id>` 形式 |
| `user <userId> --limit 3` | ✅ 用户主页笔记：id/title/type/likes/cover/url（含 xsec_token）；userId 可从评论区 `userId` 或 `author_url` 提取 |
| `note`（登录后） | ✅ title 字段恢复正常（不再误捕获登录弹窗） |

### 2.3 异常形态

| 命令 | 结果 |
|------|------|
| `note <纯ID>` / `comments <纯ID>` | ❌ `ARGUMENT` / exit **2**："xiaohongshu note now requires a full signed URL"——**xsec_token 是硬前置**，纯笔记 ID 不可用 |
| `liked --limit 3` / `saved --limit 3` | ⚠️ `EMPTY_RESULT` / exit **66**："No liked/saved notes found. Ensure you are logged in and this profile tab is visible"——无法区分"账号真无数据"与"profile tab 未渲染" |
| `notifications --limit 3` | ⚠️ 返回 `[{"rank": 1}]`——仅 rank 字段、其余字段全缺失（适配器瑕疵） |
| 输出流 | `liked`/`saved` 错误时同样混入 `# AutoFix: re-run with --trace=retain-on-failure` 注释行 |

### 2.4 未实测命令

`creator-notes`/`creator-stats`/`creator-profile`（创作者后台数据）、`drafts` 系列、`publish`/`follow`（写操作）、`ask`（点点 AI 问答）、`notifications` 有效数据形态（返回空结构）、`liked`/`saved` 有数据时的字段形态——需用户账号有相应数据或创作权限。

## 3. 关键观察

1. **匿名可用面最大**：feed/note/comments/download 免登录——对比 B 站（hot/search 免登录，其余需登录）、知乎（仅 user）、X（全部需登录），小红书是四渠道中匿名可采集内容最深的一个
2. **xsec_token 签名是核心前置**：note/comments/download 只认带 token 的完整 URL（explore 或 search_result 形式均可），纯 ID 报 exit 2——退出码 2（ARGUMENT）再次超出文档 sysexits 集合
3. **URL 可推导但 token 不可**：note id 可推导 URL 结构，但 `xsec_token` 只能从 feed/search/user 输出获得且有时效——采集链路必须以"先列表（带 token）→ 再详情"的方式串联，token 过期需重新取列表
4. **登录墙状态命令**：search/user/whoami 需登录；`whoami` 未登录时文案为"登录已过期"（暗示会话曾存在），登录后 fields 完整
5. **字段形态两级分化**：note 输出是 `field/value` 键值对列表（非对象），comments/user/feed 是对象数组；likes 有的为字符串（feed）有的为数字（comments）——归一化时需按命令区分
6. **适配器瑕疵**：匿名 note 的 title 误捕获登录弹窗文案、notifications 仅 rank 字段、liked/saved 的 66 无法区分原因——与 zhihu/twitter 观察一致：命令级可用性需逐命令验证

## 4. 对 Cosmos 集成的结论

1. **定位**：小红书是"登录态可放宽"的低频采集通道——匿名即可覆盖 feed/笔记/评论/媒体下载，登录态解锁 search/user/收藏；对 Cosmos 是四渠道中 Phase 1 门槛最低的登录态渠道
2. **目标命令**：`feed`（推荐流）→ `note`（正文证据）→ `comments`（互动证据）→ `download`（媒体留存）构成完整采集链，全部匿名可用且验证通过；`search`（登录后）作为关键词采集入口
3. **签名 URL 生命周期管理**：xsec_token 来自列表命令输出、有时效——Cosmos 采集流水线需把"列表 → 详情"两步绑定在 token 有效期内完成，token 失效（exit 2 或 77）时重新拉列表；这是小红书渠道独有的运维点
4. **失败判定**：exit 2（ARGUMENT，需签名 URL）、66（EMPTY_RESULT，无法区分无数据/页面问题）、77（需登录）；AutoFix 注释行同样混入输出需过滤
5. **归一化注意**：note 的 field/value 键值对需转对象；likes 类型不一致（字符串/数字）需统一；notifications 空结构按 uncertain 处理
6. **未实测**：创作者后台（creator-*）与写操作命令，留待后续或用户账号有数据时补测

## 5. 来源链接

- OpenCLI 主仓库：<https://github.com/jackwener/OpenCLI>；Releases（扩展包）：<https://github.com/jackwener/OpenCLI/releases>
- 中文 README：<https://github.com/jackwener/OpenCLI/blob/main/README.zh-CN.md>
- 前序实测（扩展安装 / 登录态链路 / 渠道对比）：<2026-08-06-opencli-research.md>、<2026-08-06-opencli-bilibili-research.md>、<2026-08-06-opencli-zhihu-research.md>、<2026-08-06-opencli-twitter-research.md>
