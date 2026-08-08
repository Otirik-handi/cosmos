# OpenCLI 获取微博信息 — 调研报告

> 调研日期：2026-08-06
> 调研范围：OpenCLI（`@jackwener/opencli` v1.8.6 + Browser Bridge 扩展 v1.0.22）在本机（Windows / Chrome）实测获取微博信息：匿名可用边界、登录墙形态、登录态命令、数据形态与退出码语义
> 结论预览：**微博适配器 13 个命令，仅 `hot`（热搜）免登录；搜索存在"硬登录墙"且失败形态特殊——匿名 search 返回 `NOT_FOUND` / exit 1（登录墙被适配器吞成"无结果"，而非 77），浏览器实证搜索页直接 302 到 passport SSO 登录页。登录后 search/post/comments/user/user-posts/me/feed 全部验证通过，其中 `user` 资料字段完整（对比 X 的 profile 统计全 0），`user-posts` 输出是理想的 Observation 证据。**

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
| 登录态 | 初始未登录（77）；用户扫码登录后确认（`NOTYPE55555` / uid 7516745906） |

weibo 适配器共 13 个命令：`hot` `search` `post` `comments` `user` `user-posts` `feed` `me` `favorites`（read）+ `publish` `delete`（write）+ `login` `whoami`。

## 2. 实测结果

### 2.1 免登录命令

**`opencli weibo hot --limit 5 -f json`** — 热搜 ✅

```json
[
  { "category": "互联网", "hot_value": 1182090, "label": "新", "rank": 1,
    "url": "https://s.weibo.com/weibo?q=%23ai%E6%BC%AB%E5%89%A7…%23",
    "word": "ai漫剧男主唯一塌房方式被找到了" }
]
```

### 2.2 登录墙形态（匿名 search 的失败特征）

- `whoami` 未登录 → `AUTH_REQUIRED` / exit **77**（"Not logged in to weibo.com"）
- `search` 匿名（3 个不同关键词）→ 均返回 `NOT_FOUND` / exit **1**（"No Weibo search results found. Try a different keyword or **ensure you are logged into weibo.com**"）——**登录墙被吞成"无结果"而非 77**
- 浏览器实证：`browser <session> open <搜索URL>` 后 `state` 显示 302 重定向到 `https://passport.weibo.com/sso/signin?entry=miniblog…`（SSO 登录页，title "登录 - 微博"）——搜索页对匿名用户是硬跳转

### 2.3 登录态命令（登录后，全部 exit 0）

| 命令 | 结果 |
|------|------|
| `whoami` | ✅ `logged_in` / user_id / screen_name（NOTYPE55555）/ profile_url |
| `search "DeepSeek" --limit 3` | ✅ rank/author/**id（mblogid 短码）**/time/title/url |
| `post <mblogid>` | ✅ **field/value 键值对列表**（与小红书 note 同型）：author/comments/created_at/id/likes/mblogid 等 |
| `comments <mblogid> --limit 3` | ✅ author/likes/rank/replies/text/time |
| `user <uid>` | ✅ **资料字段完整**：avatar/birthday/created_at/description/**followers**/**following**/**statuses**/gender/ip_location/location/screen_name/uid/url/verified |
| `user-posts <uid> --limit 3` | ✅ rank/id/mblogid/author/uid/text/time/**reposts/comments/likes**/pic_count/url |
| `me` | ✅ 个人资料（与 user 同结构） |
| `feed --limit 3` | ✅ 个人时间线：author/comments/id/likes/reposts/text/time/url |
| `favorites --limit 3` | ⚠️ `EMPTY_RESULT` / exit 66（"No favorites were visible on the favorites page"）——无法区分"账号真无收藏"与"收藏页未渲染" |

博文 ID 双形态：`post` 输出 `id`（数字长 ID，如 5328562737645257）与 `mblogid`（短码，如 RbZ2Vw4SB），`search`/`feed` 给的是 mblogid——URL 可由两者推导（`weibo.com/<uid>/<mblogid>`）。

### 2.4 未实测命令

`publish` / `delete`（写操作，未测——不在采集目标内）；`favorites` 有数据时的字段形态（账号无收藏）。

## 3. 关键观察

1. **登录墙的失败形态不统一**：同一登录墙，`whoami` 报 77、`search` 报 exit 1 NOT_FOUND、浏览器直连 302 SSO——集成时不能只信退出码，须结合命令与页面行为判断（weibo 是"搜索墙吞成无结果"的实证）
2. **`user` 资料是已测渠道中最完整的**：followers/statuses/verified/ip_location/description 全量可用——对比 X `profile`（统计全 0）、知乎 `user`（粉丝/回答/获赞），微博适合做 Subject 级指标采集
3. **`user-posts` 是理想的 Observation 证据**：mblogid + 数字 id + 时间戳 + reposts/comments/likes + pic_count，URL 可推导
4. **ID 双形态**：数字 id 与 mblogid 短码并存，采集层需同时保留或可互相映射
5. **输出型别**：`post` 是 field/value 键值对列表（需转对象），其余为对象数组——与小红书同型问题
6. 输出流同样混入 `# AutoFix: …` 注释行（多渠道一致）；`favorites` 的 66 歧义与小红书 liked/saved 一致

## 4. 对 Cosmos 集成的结论

1. **定位**：微博与知乎同属"登录态低频采集"渠道，但**登录墙形态更隐蔽**（search 的 NOT_FOUND 需要特殊处理）；`hot` 是唯一免登录能力，可做热点主题入口
2. **目标命令**：`hot`（热点，免登录）→ `search`（关键词发现，需登录）→ `user-posts`（账号推文）→ `post`（单条详情）→ `comments`（互动）；`user`/`me` 做 Subject 指标（字段完整）
3. **失败判定补充**：weibo 新增"匿名 search = exit 1 NOT_FOUND"的形态——Cosmos 采集状态机需区分"真无结果"与"登录墙吞结果"（可结合 whoami 登录态判断，或对 search 的 NOT_FOUND 做登录态复核）
4. **ID 归一化**：mblogid 与数字 id 需同时入库并建立映射；`post` 的 field/value 需转对象；reposts/comments/likes 计数齐全可直接做热度特征
5. **未实测**：`publish`/`delete`（写操作）、`favorites` 有效数据形态

## 5. 来源链接

- OpenCLI 主仓库：<https://github.com/jackwener/OpenCLI>；Releases（扩展包）：<https://github.com/jackwener/OpenCLI/releases>
- 中文 README：<https://github.com/jackwener/OpenCLI/blob/main/README.zh-CN.md>
- 前序实测（扩展安装 / 登录态链路 / 渠道对比）：<2026-08-06-opencli-research.md>、<2026-08-06-opencli-bilibili-research.md>、<2026-08-06-opencli-zhihu-research.md>、<2026-08-06-opencli-twitter-research.md>、<2026-08-06-opencli-xiaohongshu-research.md>、<2026-08-06-opencli-weixin-research.md>
