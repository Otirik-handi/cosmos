# OpenCLI 获取 Bilibili 信息 — 调研报告

> 调研日期：2026-08-06
> 调研范围：OpenCLI（`@jackwener/opencli` v1.8.6 + Browser Bridge 扩展 v1.0.22）在本机（Windows / Chrome）实测获取 Bilibili 信息：扩展安装、免登录命令、登录态命令、元数据与派生数据命令
> 结论预览：**OpenCLI 获取 B 站信息的全链路在本机验证通过。免登录（hot/search）、登录态（me/history/favorite）、元数据与派生数据（video/summary）均可稳定输出 JSON；登录态通过浏览器复用、不落任何凭证；退出码 66/69 语义实测与文档一致。可作为 Cosmos 的 B 站低频采集 Action。**

---

## 1. 前置条件与环境

| 项 | 值 |
|----|-----|
| 操作系统 | Windows 10+（Git Bash） |
| Node | v24.14.0（要求 ≥ 20） |
| CLI | `@jackwener/opencli` v1.8.6（全局 npm 安装，npmmirror 下需 `--allow-scripts=@jackwener/opencli`） |
| 扩展 | opencli-extension-v1.0.22（下载自 GitHub Releases v1.8.6） |
| 浏览器 | Chrome（需保持运行，扩展依赖活动浏览器） |
| daemon | 本地固定端口 `localhost:19825`，按需自动启动 |

### 1.1 扩展安装步骤（Chrome 137+ 不支持命令行加载，必须手动）

1. 从 <https://github.com/jackwener/OpenCLI/releases> 下载 `opencli-extension-v<ver>.zip`（扩展版本与 CLI 版本独立编号）
2. 解压到固定目录（本机：`C:\Users\Otirik\.opencli\extension`，含 `manifest.json` 那一层）
3. Chrome 打开 `chrome://extensions` → 开启「开发者模式」→「加载已解压的扩展程序」→ 选择解压目录
4. 在 Chrome 中登录 Bilibili（扫码即可，凭证留在浏览器，不经过 CLI）
5. 验证：`opencli doctor` 输出 `[OK] Extension: connected` 与 profile id

---

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

### 2.2 免登录命令（不依赖账号，走浏览器渲染或公开接口）

**`opencli bilibili hot --limit 5`** — 热门视频 ✅

```yaml
- rank: 1
  title: 导弹告急，零件共享，东大断供，美军三年五亿造不出一发炮弹？
  author: 星辰趣味屋
  play: 201457
  danmaku: 2813
  bvid: BV12Vun64ELh
  url: https://www.bilibili.com/video/BV12Vun64ELh
```

**`opencli bilibili search "DeepSeek" --limit 3 -f json`** — 搜索 ✅（JSON 输出干净）

```json
[
  { "rank": 1, "title": "DeepSeek 开放平台提示 API 即将涨价…", "author": "橘鸦Juya",
    "score": 194574, "url": "https://www.bilibili.com/video/BV19EMS6QESs" },
  { "rank": 3, "title": "【含Deepseek论文】人工智能顶会论文精讲", "author": "深度之眼官方账号",
    "score": 814066, "url": "" }
]
```

⚠️ 观察：第 3 条 `url` 为空——接口字段缺失，**采集层必须容忍空字段**。

### 2.3 登录态命令（复用浏览器会话，验证通过）

**`opencli bilibili me`** — 个人资料 ✅

```yaml
name: 我爱吃番茄酱啊啊啊
uid: 1909976659
level: 6
coins: 252
followers: 0
following: 0
```

**`opencli bilibili history --limit 3`** — 观看历史 ✅（含进度）

```yaml
- rank: 1
  title: 支持EMT喵【B萌应援】
  progress: 0:00/0:09 (0%)
  url: https://www.bilibili.com/video/BV1K8uJ6oES9
- rank: 3
  title: 理性的思维战胜了人性的恐惧
  progress: 已看完
  url: https://www.bilibili.com/video/BV186My6AEQQ
```

**`opencli bilibili favorite --limit 3`** — 收藏夹 ✅

```yaml
- rank: 1
  title: 对肾最好的三个动作，在客厅跟我一起练起来！
  author: 雷音入象
  plays: 575089
  url: https://www.bilibili.com/video/BV12HMu6tEfi
```

### 2.4 元数据与派生数据命令

**`opencli bilibili video BV12Vun64ELh`** — 视频完整元数据 ✅

```text
bvid: BV12Vun64ELh
aid: '117048009102371'
title: 导弹告急，零件共享，东大断供，美军三年五亿造不出一发炮弹？
author: '星辰趣味屋 (mid: 212345699)'
publish_time: 2026-08-06 10:18
duration: 20m25s (1225s)
view: '204374'   danmaku: '2827'   reply: '1181'
like: '22537'    coin: '9562'      favorite: …
```

**`opencli bilibili summary BV1Louc6xE2R`** — B 站官方 AI 总结 ✅（总摘要 + 分段时间戳大纲）

```text
content: 玩家在《绝了航天》中激烈对战，通过高冷操作、灵活走位和精准技能连击……
time: '00:01'  content: '# 团队战斗激烈又搞笑不断'
time: '00:21'  content: 队友展现强大防御能力形成马奇诺防线
time: '01:53'  content: 团队协作配合成功化解危机并连获战果
```

**`opencli bilibili summary BV12Vun64ELh`** — 未生成总结的分支 ⚠️

```text
ok: false
error:
  code: EMPTY_RESULT
  message: bilibili summary returned no data
  help: Bilibili has not generated an AI summary for BV12Vun64ELh.
  exitCode: 66
```

---

## 3. 关键观察

1. **登录态复用成立**：`bilibili me` 返回真实账号信息，凭证全程留在 Chrome，CLI/daemon 不接触账号密码或 Cookie 明文——符合「登录态留在用户浏览器」的架构取向
2. **退出码语义实测与文档一致**：`66` 无数据（summary 未生成）、`69` 浏览器未连接（无扩展时实测触发）——可直接映射为 Cosmos 采集状态
3. **字段缺失是常态而非异常**：search 的 `url` 可为空、summary 可能不存在——采集层必须容忍，用 aid/bvid/mid 等结构化 ID 兜底，缺失字段记为 uncertain
4. **浏览器运行时依赖**：Chrome 全关时扩展失联（exit 69）；命令共享浏览器 tab，串行调用更稳
5. **`summary` 是现成官方派生数据**：带时间戳分段大纲，生产者=Bilibili，无需自跑 LLM；但「B 站未生成」分支需按 uncertain 处理

---

## 4. 对 Cosmos 集成的结论

1. `video` 输出（bvid/aid/mid/发布时间/统计）是理想的 **Observation 原始证据**：URL 可推导但不必依赖，符合「不依赖 URL 的信息库」设计
2. `summary`/`subtitle` 可作为**派生数据源**（producer=bilibili，带官方版本），进 Cosmos 的 Artifact/分析管线
3. Action 集成形态：子进程调用 `opencli bilibili <cmd> -f json`，退出码 66→无数据、69→需浏览器桥、77→需人工登录，映射为采集状态与通知
4. **定位**：低频登录态采集执行器（B 站动态/历史/收藏/搜索），高频批量采集仍需走 RSSHub 路由或评估合规风险（见 <2026-08-06-opencli-research.md> 中 Bilibili 渠道风险）
5. **前置条件**：用户 Chrome 保持运行 + 扩展已加载 + 浏览器内登录态有效——PRD 应把「登录态来源」列为待决策项

---

## 5. 来源链接

- OpenCLI 主仓库：<https://github.com/jackwener/OpenCLI>；Releases（扩展包）：<https://github.com/jackwener/OpenCLI/releases>
- 中文 README：<https://github.com/jackwener/OpenCLI/blob/main/README.zh-CN.md>
- Bilibili 渠道风险背景（bilibili-API-collect 关停公告）：<https://github.com/SocialSisterYi/bilibili-API-collect>
