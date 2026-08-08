# OpenCLI 获取 GitHub 信息 — 调研报告

> 调研日期：2026-08-06
> 调研范围：OpenCLI（`@jackwener/opencli` v1.8.6）在本机实测获取 GitHub 信息：适配器覆盖范围、免登录命令、过滤参数、浏览器依赖边界
> 结论预览：**OpenCLI 对 GitHub 的覆盖很薄：仅 `github-trending repos`（免登录、Browser: no、直连可用）与 `github login/whoami` 两个命令；`gh` 适配器需本机安装 GitHub CLI。GitHub 的富数据（仓库搜索、用户资料、提交、Issue）不在适配器范围内，对 Cosmos 而言直接用公开 GitHub REST API（匿名 60 次/时限额）或安装 `gh` CLI 更划算，OpenCLI 仅承担 Trending 聚合。**

---

## 1. 前置条件与环境

| 项 | 值 |
|----|-----|
| 操作系统 | Windows 10+（Git Bash） |
| Node | v24.14.0（要求 ≥ 20） |
| CLI | `@jackwener/opencli` v1.8.6（全局 npm 安装） |
| 浏览器 | 无依赖（`github-trending` 标记 `Browser: no`） |
| 代理 | **不需要**（GitHub 直连可用——与 X/YouTube 不同） |
| 登录态 | `github whoami` → 77 未登录（github 适配器仅 login/whoami，无数据命令，登录无实测价值） |

GitHub 相关适配器：`github`（仅 `login`/`whoami`）、`github-trending`（仅 `repos`）、`gh`（外部 CLI 封装，依赖本机 `gh` CLI——本机未安装，`gh` 命令不存在）。

## 2. 实测结果

### 2.1 免登录命令

**`opencli github-trending repos --limit 5 -f json`** — Trending 仓库 ✅（直连、免登录、无浏览器）

```json
[
  { "rank": 1, "repo": "TencentCloud/TencentDB-Agent-Memory",
    "description": "TencentDB Agent Memory is a team-level memory hub for AI Agents — …",
    "language": "TypeScript", "stars": 16953, "forks": 1523,
    "starsSince": 1057, "url": "https://github.com/TencentCloud/TencentDB-Agent-Memory" },
  { "rank": 2, "repo": "addyosmani/agent-skills",
    "description": "Production-grade engineering skills for AI coding agents.",
    "language": "JavaScript", "stars": 83266, "forks": 8917, "starsSince": 593, "url": "…" }
]
```

**`--language <lang> --since daily|weekly|monthly`** 过滤 ✅（实测 `--language TypeScript --since daily` 生效）

### 2.2 登录态与边界

| 项 | 结果 |
|------|------|
| `github whoami` | ❌ `AUTH_REQUIRED` / exit 77（"Could not detect a logged-in GitHub account"） |
| `github` 适配器 | 仅 login/whoami，**无任何数据命令** |
| `gh` 适配器 | 依赖本机 `gh` CLI（未安装）；`opencli external register gh` 是接入方式 |
| 浏览器依赖 | `github-trending repos` 为 `Browser: no`（daemon 直连，不依赖 Chrome/扩展） |

### 2.3 未实测

`github login` 后的 whoami 确认（登录对数据采集无增益）；`gh` 适配器（需先安装 GitHub CLI）。

## 3. 关键观察

1. **OpenCLI 的 GitHub 覆盖极薄**：对比其他渠道 13~50 个命令，GitHub 只有 2+1 个命令——Trending 聚合是唯一数据能力
2. **Trending 是干净的结构化数据**：repo/description/language/stars/forks/starsSince/url 字段完整、数字为纯数值（对比 YouTube 的本地化文本），`starsSince`（周期新增 star）是热度信号
3. **无浏览器/无代理依赖**：`Browser: no` + 直连——是所有已测渠道中运行依赖最低的一个（对比 X/YouTube 的代理、小红书 token、知乎登录墙）
4. **富数据缺口**：仓库搜索、用户资料、star 列表、提交/Issue 均无适配器命令——这些需 GitHub REST API（公开匿名 60 req/h）或 `gh` CLI（安装后经 `opencli external register gh` 接入）

## 4. 对 Cosmos 集成的结论

1. **定位**：GitHub 渠道的 OpenCLI 集成价值有限——仅 `github-trending repos` 适合作为"开发者热点"来源（Phase 4 推荐流可参考信号），运行依赖最低（免登录、免浏览器、免代理、免 token）
2. **富数据不走 OpenCLI**：仓库搜索/用户/提交/Issue 建议直接调 GitHub REST API（Cosmos 自身已有网络层，匿名限额 60 req/h 对低频采集足够；登录态可配 PAT 提升限额），或安装 `gh` CLI 后经 external 机制接入——两者都不属于 OpenCLI 适配器职责
3. **目标命令**：`github-trending repos --language <lang> --since <period>`——语言维度可配置化（TypeScript/Python 等），作为每日开发者趋势源
4. **无特殊失败判定**：唯一数据命令直连稳定；字段全数值无需归一化
5. **未实测**：`gh` 适配器（取决于是否安装 GitHub CLI，可列为后续可选）

## 5. 来源链接

- OpenCLI 主仓库：<https://github.com/jackwener/OpenCLI>；Releases（扩展包）：<https://github.com/jackwener/OpenCLI/releases>
- 中文 README：<https://github.com/jackwener/OpenCLI/blob/main/README.zh-CN.md>
- GitHub REST API（公开仓库数据，匿名限额）：<https://docs.github.com/rest>
- 前序实测（扩展安装 / 渠道对比）：<2026-08-06-opencli-research.md>、<2026-08-06-opencli-bilibili-research.md>、<2026-08-06-opencli-zhihu-research.md>、<2026-08-06-opencli-twitter-research.md>、<2026-08-06-opencli-xiaohongshu-research.md>、<2026-08-06-opencli-weixin-research.md>、<2026-08-06-opencli-weibo-research.md>、<2026-08-06-opencli-youtube-research.md>
