# OpenCLI 获取知乎信息 — 调研报告

> 调研日期：2026-08-06
> 调研范围：OpenCLI（`@jackwener/opencli` v1.8.6 + Browser Bridge 扩展 v1.0.22）在本机（Windows / Chrome）实测获取知乎信息：匿名可用命令、登录态门控命令、退出码语义与异常形态（含登录后重测）
> 结论预览：**知乎适配器几乎全链路依赖登录态（z_c0 cookie）。登录后 hot/search/question/answer-detail/answer-comments/followers/recommend 全部可稳定输出 JSON，是合格的登录态采集通道；但 `user-articles` 登录后仍误报 77，`pins`/`user-answers` 是独立于登录态的适配器分页 bug（exit 1），`hot` 匿名时静默返回空数组且退出码为 0。对 Cosmos 而言，知乎与 B 站同属"登录态低频采集"定位，采集层必须做"命令级可用性矩阵"，并区分"77 需登录""空数组但 0""exit 1 适配器故障"三种失败形态。**

---

## 1. 前置条件与环境

| 项 | 值 |
|----|-----|
| 操作系统 | Windows 10+（Git Bash） |
| Node | v24.14.0（要求 ≥ 20） |
| CLI | `@jackwener/opencli` v1.8.6（全局 npm 安装） |
| 扩展 | opencli-extension v1.0.22（Chrome，已加载） |
| 浏览器 | Chrome（需保持运行，扩展依赖活动浏览器） |
| daemon | 本地固定端口 `localhost:19825`，按需自动启动 |
| 知乎登录态 | 首轮匿名实测；登录后重测（Chrome 中扫码登录，账号 `Otirik` / url_token `otirik-62`） |

zhihu 适配器共 20 个命令，全部标记 `Browser: yes`（经浏览器渲染/接口），分为只读（read）与写入（write）两类：

- read：`hot` `search` `question` `answer-detail` `answer-comments` `user` `user-answers` `user-articles` `pins` `followers` `following` `collections` `collection` `recommend` `whoami` `download`
- write（需登录）：`answer` `comment` `favorite` `follow` `like` `login`

## 2. 实测结果

### 2.1 环境验证

```text
opencli v1.8.6 doctor (node v24.14.0)
[OK] Daemon: running on port 19825 (v1.8.6)
[OK] Extension: connected (v1.0.22)
Profiles:
  • vmhtnh8p: connected v1.0.22
[OK] Connectivity: connected in 0.1s
```

### 2.2 匿名可用命令（不登录）

**`opencli zhihu user zhang-jia-wei -f json`** — 用户公开主页 ✅（唯一验证通过的匿名命令）

```json
[
  {
    "url_token": "zhang-jia-wei",
    "name": "张佳玮",
    "headline": "公号：张佳玮写字的地方",
    "followers": 3463679,
    "following": 143,
    "answers": 6241,
    "articles": 1521,
    "voteup": 10122110,
    "url": "https://www.zhihu.com/people/zhang-jia-wei"
  }
]
```

输出含 url_token/name/headline/粉丝/关注/回答数/文章数/获赞数/url，`url` 可由 `url_token` 推导但不必依赖——符合 Cosmos「不依赖 URL」的结构化定位取向。

### 2.3 登录态门控命令（匿名 → exit 77）

| 命令 | 实测结果 |
|------|----------|
| `search "DeepSeek" --limit 3` | ❌ `AUTH_REQUIRED` / "Failed to fetch search results from Zhihu" |
| `question 19784360` | ❌ `AUTH_REQUIRED` / "Failed to fetch question data from Zhihu" |
| `whoami` | ❌ `AUTH_REQUIRED` / "Zhihu z_c0 cookie missing — anonymous" |
| `user-answers zhang-jia-wei --limit 3` | ❌ `AUTH_REQUIRED` / "Failed to fetch Zhihu user answers" |
| `followers zhang-jia-wei --limit 3` | ❌ `AUTH_REQUIRED` / "Failed to fetch Zhihu followers" |

统一返回结构（exit 77）：

```yaml
ok: false
error:
  code: AUTH_REQUIRED
  message: …
  help: Please open Chrome or Chromium and log in to https://www.zhihu.com
  exitCode: 77
```

### 2.4 异常形态（区别于文档的退出码语义）

**`opencli zhihu hot --limit 5 -f json`** — 热榜 ⚠️ 静默空结果

```text
[]
EXIT=0
```

匿名时热榜**返回空数组但退出码为 0**，与文档宣称的"66 无数据"不符——比 bilibili search 的空 `url` 字段更隐蔽：**"无数据"与"成功"在退出码上不可区分**，采集层必须把空数组单独视为无数据形态。

**`opencli zhihu pins zhang-jia-wei --limit 3 -f json`** — 想法 ⚠️ 适配器 bug

```yaml
ok: false
error:
  code: COMMAND_EXEC
  message: Zhihu pins pagination returned malformed next URL
  exitCode: 1
```

`pins` 暴露适配器分页解析 bug（exit 1，文档外退出码）——匿名页面结构变化或适配器缺陷都会让命令整体失效，印证官网 `autofix` 机制存在的必要性。

**`opencli zhihu download --help`** — 文章导出接口（未实测）

```text
--url <value>              文章 URL（zhuanlan.zhihu.com/p/xxx）
--output [value]           输出目录  default: ./zhihu-articles
--download-images [value]  本地下载图片  default: false
```

导出知乎文章为 Markdown（zhuanlan 域名），推测依赖登录态，未实测。

### 2.5 登录态实测结果（Chrome 扫码登录后重测）

**`opencli zhihu whoami -f json`** — 登录确认 ✅

```json
{
  "logged_in": true,
  "site": "zhihu",
  "url_token": "otirik-62",
  "name": "Otirik",
  "uid": "1423374771489280000"
}
```

**登录后可用的采集命令**（全部 exit 0，JSON 字段完整）：

| 命令 | 结果 |
|------|------|
| `hot --limit 5` | ✅ 热榜：rank/title/**heat（含"万热度"文本）**/answers/url，如"如何看待 DeepSeek 8月6日公告称即将大幅度涨价？"（727 万热度） |
| `search "DeepSeek" --limit 3` | ✅ 搜索：rank/title/type=answer/author/votes/url |
| `question <id> --limit 2` | ✅ 问题下回答：rank/**id**/author/votes/url/content（content 为正文纯文本，未分段） |
| `answer-detail <answerId>` | ✅ 单回答完整：id/author/votes/comments/question_id/question_title/**created_at/updated_at**（ISO）/content（完整多段正文） |
| `answer-comments <answerId> --limit 3` | ✅ 评论：rank/comment_rank/reply_rank/**depth**/id/parent_id/author/reply_to/likes/created_at/url/content |
| `followers <user> --limit 3` | ✅ 粉丝列表：rank/name/url_token/headline/followers/url |
| `recommend --limit 3` | ✅ 首页推荐流：rank/type=answer/title/author/votes/url（个人化 feed） |

`answer-detail` 是理想的 **Observation 原始证据**：结构化 ID（answer id、question id）＋ 双时间戳 ＋ 完整正文，URL 可由 ID 推导但不必依赖。

**登录后仍失败的命令**：

| 命令 | 结果 |
|------|------|
| `user-articles zhang-jia-wei` | ❌ 仍报 `AUTH_REQUIRED` exit 77——登录态下误判未登录，**适配器认证检测不一致** |
| `pins zhang-jia-wei` | ❌ 仍报 `COMMAND_EXEC` exit 1（pagination malformed next URL）——适配器 bug，与登录态无关 |
| `user-answers zhang-jia-wei` | ❌ 同上，`COMMAND_EXEC` exit 1——适配器 bug，与登录态无关 |

## 3. 关键观察

1. **知乎登录门控远严于 B 站**：B 站 hot/search 可匿名（<2026-08-06-opencli-bilibili-research.md>），知乎除 `user` 外全部需要 z_c0 cookie——与知乎产品策略一致（匿名几乎无法浏览内容）
2. **登录态是硬前置**：whoami 确认 `logged_in: true` 后，热榜/搜索/问题/回答/评论/粉丝/推荐流全部可用，字段完整、时间戳为 ISO 格式，无需二次解析
3. **命令级可用性不均（必须做命令级矩阵）**：`user-articles` 登录后仍误报 77（认证检测不一致）；`pins`/`user-answers` 是独立于登录态的适配器分页 bug（exit 1）——同一适配器内不同命令的可用性差异显著
4. **退出码语义与文档存在偏差**：`hot` 匿名空数据返回 0 而非 66；`pins`/`user-answers` 适配器错误返回 1 而非文档 sysexits 值——集成时不能把退出码当唯一判据
5. **错误信息不统一**：同一 `AUTH_REQUIRED` 下 message 有的写明 "z_c0 cookie missing — anonymous"（whoami），有的只有通用文案（search/question/user-articles）
6. **登录方式与 B 站一致**：`opencli zhihu login` 打开浏览器等待认证完成，凭证留在 Chrome、CLI/daemon 不接触；本轮由用户手动扫码完成

## 4. 对 Cosmos 集成的结论

1. **定位**：知乎与 B 站同属"登录态低频采集"渠道，但门槛更高——除 `user` 公开主页外，搜索、热榜、问题、回答、评论、关注关系均需登录态；PRD 的「登录态来源」待决策项应把知乎列为强依赖项
2. **匿名可用的低频能力**：`user` 可做公开主页监控（粉丝/回答数/获赞数变化），作为 Subject 级指标采集，无需登录
3. **Action 集成形态**：子进程调用 `opencli zhihu <cmd> -f json`，但状态判定必须结合退出码与结果形态，且**按命令建立可用性矩阵**（实测已证明同一适配器内命令差异大）：
   - exit 77 → 默认"需人工登录"（触发通知）；但 `user-articles` 登录后仍误报 77，须以 whoami 的 `logged_in` 为准判断登录态，不要被单个命令的 77 误导
   - **空数组 + exit 0 → 视为"无数据"而非成功**（区别于文档的 66）
   - exit 1 COMMAND_EXEC → 适配器失效（pins/user-answers 实证），按上游故障处理，可提示 `opencli autofix`
   - 目标命令：`hot`（热榜）、`search`、`answer-detail`（单回答 + 双时间戳）、`answer-comments`（评论树）、`followers`（关注关系）——本轮全部验证通过
4. **风险**：适配器解析逻辑脆弱（pins/user-answers 分页 bug 为实证），页面结构/反爬变动会静默或报错失效；知乎渠道稳定性依赖上游维护与登录态保鲜
5. **登录态重测已完成**（2026-08-06，账号 Otirik）；唯一未实测命令为 `download`（文章导出 Markdown，需真实专栏文章 URL，且 user-articles 适配器故障阻碍了程序化发现文章 URL）

## 5. 来源链接

- OpenCLI 主仓库：<https://github.com/jackwener/OpenCLI>；Releases（扩展包）：<https://github.com/jackwener/OpenCLI/releases>
- 中文 README：<https://github.com/jackwener/OpenCLI/blob/main/README.zh-CN.md>
- 前序实测（扩展安装步骤 / B 站登录态链路）：<2026-08-06-opencli-bilibili-research.md>
- 渠道生态与集成定位总览：<2026-08-06-opencli-research.md>
