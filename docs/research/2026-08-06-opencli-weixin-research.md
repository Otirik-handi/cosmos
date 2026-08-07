# OpenCLI 获取微信公众号信息 — 调研报告

> 调研日期：2026-08-06
> 调研范围：OpenCLI（`@jackwener/opencli` v1.8.6 + Browser Bridge 扩展 v1.0.22）在本机（Windows / Chrome）实测获取微信公众号信息：搜狗搜索、文章 Markdown 导出、公众号后台命令；含搜狗反爬（antispider）与浏览器解析链路
> 结论预览：**weixin 适配器仅 4 个命令，是已测渠道中最小、能力最聚焦的一个。search（搜狗微信搜索）与 download（文章导出 Markdown+图片）免登录可用；download 只认 mp.weixin.qq.com 直链，搜狗跳转链接被 antispider 保护（curl 无法解析），但可用 opencli 浏览器原语打开跳转链、读取最终 URL 后喂给 download，全链路实测通过。drafts/create-draft 属公众号后台命令：小程序后台登录只能消除 77，无法提供公众号草稿箱/图文编辑器（drafts 66、create-draft exit 1）。**

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
| 登录态 | 初始未登录；用户登录微信小程序后台（mp.weixin.qq.com 域名）后，后台命令由 77 变为 66/1，但非公众号账号 |

weixin 适配器共 4 个命令：`search`（搜狗微信搜索）、`download`（文章导出 Markdown）、`drafts`（草稿箱）、`create-draft`（创建图文草稿）。

## 2. 实测结果

### 2.1 免登录命令

**`opencli weixin search "DeepSeek" --limit 3 -f json`** — 公众号文章搜索 ✅（走搜狗微信搜索）

```json
[
  { "rank": 1, "page": 1, "title": "比deepseek,更懂泰山",
    "url": "https://weixin.sogou.com/link?url=dn9a_…&type=2&query=DeepSeek&token=…",
    "summary": "这段时间“deepseek”突然爆火一度冲上热搜第一…",
    "publish_time": "3小时前" }
]
```

**`opencli weixin download --url <mp直链> --output <dir> -f json`** — 文章导出 ✅（免登录，Markdown + 图片落盘）

```json
[
  { "title": "DeepSeek宣布：计划大幅涨价", "author": "东营网",
    "publish_time": "2026年8月7日 11:26", "status": "success",
    "size": "1.6 KB",
    "saved": ".agent\\tmp\\wx-dl2-…\\DeepSeek宣布：计划大幅涨价\\DeepSeek宣布：计划大幅涨价.md" }
]
```

输出目录含 `images/`（实测 `img_001.gif`、`img_002.jpeg`）。

### 2.2 搜狗链接 → mp 直链（antispider 突破链路）

`search` 给出的 `weixin.sogou.com/link?url=…` 是跳转链接，**download 不接受**（`status: "invalid URL"`），且 curl 跟随跳转直接被搜狗反爬拦截（302 → `/antispider/`）。实测用 opencli 浏览器原语在 Chrome 中解析成功：

```bash
opencli browser wxresolve open '<搜狗链接>'     # 浏览器（带搜狗 cookie）打开，自动跳转
opencli browser wxresolve state                 # 读取最终 URL
# → https://mp.weixin.qq.com/s?src=11&timestamp=…&signature=…&new=1 （含签名与时间戳）
opencli weixin download --url '<解析出的直链>' --output <dir>
```

浏览器原语自动复用会话 cookie（同一 `search` 会话的搜狗 cookie），未被 antispider 拦截；解析出的直链为 `/s?src=11&timestamp=…&signature=…` 查询形式（非 `/s/<id>` 路径形式），download 两种形式均接受。`--download-images` 默认 true，图片一并落盘。

### 2.3 公众号后台命令（需 mp.weixin.qq.com 登录）

| 命令 | 未登录 | 小程序后台登录后 |
|------|--------|------------------|
| `drafts` | ❌ `AUTH_REQUIRED` / exit 77（"草稿箱需要已登录的 mp.weixin.qq.com 会话"） | ⚠️ `EMPTY_RESULT` / exit 66（"No structured drafts found"）——登录态被识别但**无公众号草稿数据** |
| `create-draft --title <t> <content>` | 未测（同 77） | ❌ `COMMAND_EXEC` / exit 1（"Article editor did not load. Session may have expired"）——**图文编辑器未加载** |

结论：小程序后台与公众号后台共用 mp.weixin.qq.com 域名登录，能消除 77，但小程序后台没有公众号的草稿箱/图文编辑器，因此 drafts 无数据、create-draft 无法加载编辑器。**这两个命令真正可用需要公众号（订阅号/服务号）账号登录。**

## 3. 关键观察

1. **适配器最小而聚焦**：仅 4 命令，核心是"搜索发现 + 正文导出"；`download` 是已测渠道中唯一以"导出 Markdown 全文 + 图片"为产出的命令（知乎也有 download 但需登录且未实测）
2. **antispider 是唯一硬门槛**：搜狗跳转链接 curl 无法解析（302 → antispider），浏览器原语可复用会话 cookie 解析；解析出的直链带 signature+timestamp，可能有时效
3. **URL 形式灵活**：`/s/<id>` 与 `/s?src=11&timestamp=…&signature=…` 两种形式 download 均接受，但 `weixin.sogou.com/link` 不接受（格式校验）
4. **后台命令与账号类型强绑定**：登录态（77 消除）≠ 功能可用（需公众号而非小程序账号）；create-draft 失败文案"Session may have expired"具误导性，实际是编辑器页面不存在
5. **字段观察**：search 的 publish_time 为相对时间（"3小时前"）；download 输出的 author（东营网）与浏览器 DOM 中 js_author_name（营火虫）不一致——作者字段解析可能与转载/署名展示有关，采集时需注意
6. 输出流同样混入 `# AutoFix: …` 注释行（与 twitter/xiaohongshu 一致）

## 4. 对 Cosmos 集成的结论

1. **定位**：微信渠道的"公众号文章"采集路径 = `weixin search`（发现，免登录）+ 浏览器解析搜狗链（antispider 突破）+ `weixin download`（正文 Markdown + 图片，免登录）——全链路免登录，是已测渠道中**唯一免登录的正文级（含全文）采集通道**
2. **antispider 解析是运维点**：搜狗链解析依赖浏览器会话 cookie 与 `browser <session> open/state` 原语，Cosmos 集成时需把"解析 → download"两步串成 Action 子流程；直链签名时效需在流程内及时消费
3. **后台命令价值低**：drafts/create-draft 属发布侧功能且需公众号账号，与 Cosmos 采集目标不符，不建议纳入 Phase 1
4. **证据形态**：download 产出的 Markdown + images 是完整 Observation 证据（正文全文 + 媒体），但作者字段存在解析不一致风险，需以页面 DOM 或账号名交叉校验
5. **相对时间归一化**：search 的 publish_time 是相对时间，需结合采集时间换算绝对时间或记原始值
6. **未实测**：真实公众号账号下的 drafts/create-draft（当前仅有小程序后台会话）、`download` 的 `/s/<id>` 路径形式（仅实测 `/s?` 查询形式，help 文档说明为 `/s/xxx`）

## 5. 来源链接

- OpenCLI 主仓库：<https://github.com/jackwener/OpenCLI>；Releases（扩展包）：<https://github.com/jackwener/OpenCLI/releases>
- 中文 README：<https://github.com/jackwener/OpenCLI/blob/main/README.zh-CN.md>
- 前序实测（扩展安装 / 登录态链路 / 渠道对比）：<2026-08-06-opencli-research.md>、<2026-08-06-opencli-bilibili-research.md>、<2026-08-06-opencli-zhihu-research.md>、<2026-08-06-opencli-twitter-research.md>、<2026-08-06-opencli-xiaohongshu-research.md>
