# Cosmos Foundation

## User Request / Topic

建立 Cosmos 仓库，保存不失真的原始需求，整理完整产品需求与项目介绍，并设计可随后续需求持续调整的灵活架构。

### Follow-up User Request

1. public 一下，和 NeuroBook 一样的 AGPL
2. workflow 先不动
3. 协作流程补足

## Goal

建立一套能指导后续实现的仓库与架构真相源。它需要覆盖可编程触发和 Flow、离线信息库、跨渠道来源、Story/Topic 与分类、Agent 生成的 Workspace/Artifact、可配置看板和后续推送，同时明确哪些设计已经确定、哪些仍可调整。

## Scope

- 本地 Git 仓库和文档工作流。
- 去领域化的 Agent、Task、worktree、Issue、PR 和安全协作流程。
- 原始需求 append-only 记录。
- 完整产品需求文档与项目介绍。
- 第一版总体架构、领域术语、数据所有权和扩展边界。
- 后续实现阶段的垂直切片。

## Non-goals

- 不实现运行时代码。
- 不安装依赖。
- 不创建额外 GitHub 远端、PR 或发布；本 Task 的后续公开基线允许创建 `notnotype/cosmos`、提交初始文档并 push `master`。
- 不验证真实平台 API、登录态、反爬限制或服务条款。

## Current State

- 仓库已在本机初始化。
- v0.9 Phase 0 架构基线已形成，本次 grilling 已结束。
- 原始需求、产品需求、项目介绍和架构文档已建立。
- `CONTEXT.md` 已精简为产品共同语言，作为核心概念、关系和真实歧义的讨论入口。
- `docs/architecture/0002-information-model.md` 已建立，集中维护 Entry、Story、Topic、相关推荐、Workspace、Artifact、Timeline 和 Spotlight 边界。
- 研究报告已原样归档到 `docs/research/`，本地与远端 SHA-256 均为 `bcec8d2698d65d6217ed067fbb8625888e7e1dfab7b65aa0096f0790d9aa930d`。

## Decisions and Deviations

- 目标位置从远端 `arch` 调整为本机 `C:\Users\notnotype\Documents\CodeRepository\GithubProjects\cosmos`。
- “BM5” 暂按全文检索常用的 “BM25” 理解；原始写法仍保留在需求文件。
- Story 是带 kind/subtype 的统一规范内容单元；event Story 表示同一现实事件，相关 Story 通过 Relation 或共同 Topic 连接。
- 原 `Feature` 已改为 Workspace；Artifact 表示版本化输出；Timeline 是视图；Spotlight 与精华是展示/策展角色。
- 每个 Entry 默认拥有一个主 Story，单 Entry Story 合法；Topic、Workspace、Spotlight 和 Feed 使用 Story，不直接使用 Entry。
- Agent 自动创建 Topic 需要至少两个不同 Story，或命中用户明确跟踪规则。
- Topic 不自动过期，人工归档后置。
- 人类、Agent 和系统按协作者记录 actor/revision。
- 第一版预算使用全局日预算、单次 Run 上限和紧急保留预算。
- 一个 Entry 只有一个主 Story，可作为证据关联其它 Story。
- Story/Topic merge 保留 canonical ID、旧 alias 和历史引用。
- Story subtype 使用受管理注册表，核心 kind 合同稳定，未知 subtype 可按核心 kind 降级读取。
- Story split 保留旧 Story 历史壳，以 `replaced_by[]` 指向全部后继，不做模糊单目标重定向。
- v1 不建立 Topic 父子层级，Topic 间使用 Relation、标签或 Workspace/Board 组织。
- 一个 `(Topic, Story)` 只有一个当前成员角色，历史变化进入 membership revision history。
- Story 当前表示使用不可变 Story Revision 和 `current_revision_id`。
- Feed 曝光和主要反馈按 Story/surface 记录，Entry 交互在展开具体信源后补充。
- Agent 不能静默移除人类明确加入或确认的 Topic 成员。
- Workspace 输入采用多对多 binding 和可选主要锚点。
- Spotlight 采用分离信号、版本化 policy、迟滞、TTL 和人工覆盖。
- Workspace Update/Run 与生命周期、内容新鲜度、Board Placement 和 Interaction State 分开。
- Workspace Update 使用六种状态，失败/取消保留上一成功版本，成功时原子发布。
- 人类接受字段优先于 Agent 候选 Revision；Read State 使用 `last_seen_revision_id`。
- merge/split 用户状态迁移采用 canonical 解析与显式 migration，不自动扇出。
- v1 和默认产品合同面向单个本地用户，未来协作保留 actor/revision 扩展位。
- Agent 可维护用户配置范围内的内部对象；新外部 Source、扩大数据范围和外部发送需要显式配置/批准。
- 第一版不建设细粒度权限 UI 或不可信插件沙箱，只运行本地可信扩展。
- Phase 1 首条真实 Connector 使用 RSS/RSSHub，并配套 fixture Connector。
- 本次 grilling 已结束，实现级问题转入后置清单。
- 第一版推荐采用显式关注、BM25、Entity/关系、时间、引用、新颖性和本地反馈，不使用 embedding。
- `CONTEXT.md` 不再预先盘点 Definition、Run、Job、Lease 等实现对象；这些概念只在真实设计和开发需要时进入架构、ADR 或代码文档。
- v0.2 中保留 Source / Trigger / Flow / Action 的产品级关系，更细的身份和运行时边界暂不冻结。
- 从 neuro-book 迁移协作机制时，只保留可跨项目复用的审计、worktree、Issue/PR、标签和验证合同；去除小说、Novel IDE、桌面产品、发布命令和子仓库专属内容；许可证按用户决定采用 AGPL-3.0-only。
- Cosmos 尚无运行时代码、依赖或可复用的 CI 脚本，因此只迁移 GitHub 协作配置，不复制 neuro-book 的应用构建、桌面、产品运行时和发布 workflow；公开远端已建立但 workflow 仍保持不变。

## Verification

- `GitDiffNoIndexCheck=PASS (29 files)`：对所有未跟踪仓库文件执行 `git diff --no-index --check`，未发现空白错误。
- `TrailingWhitespace=PASS`。
- `BlankLineAtEOF=PASS`。
- `MarkdownLinks=PASS (18 files, 53 repository-local links)`；原始需求另有 1 个指向仓库外技能文件的本地路径链接，未改写用户原文。
- `MarkdownFences=PASS`。
- `GitHubYaml=PASS (7 files)`：labels 和 Issue Form YAML 均可解析。
- `GitHubIssueForms=PASS (5 forms, 33 labels)`：默认标签引用和字段 ID 无重复或缺失。
- `License=PASS`：根目录 `LICENSE` 与 neuro-book 的许可证文件 SHA-256 相同，均为 GNU AGPL-3.0-only。
- `ContextScope=PASS (189 lines)`：产品共同语言与 958 行详细信息模型分离。
- `LatestRawRequirement=PASS`。
- `InformationModelTerms=PASS`：Entry、Story、Topic、Relation、Workspace、Artifact、Timeline 和 Spotlight 边界均存在。
- `ProductRequirementIds=PASS (125 unique IDs)`。
- `RelatedContentScenario=PASS (UC-07)`。
- 远端研究文件与本地归档的 SHA-256 均为 `bcec8d2698d65d6217ed067fbb8625888e7e1dfab7b65aa0096f0790d9aa930d`。
- Git 状态为 `master...origin/master` 且工作区干净；首个公开提交为 `1eff6c7`，远端为 `https://github.com/notnotype/cosmos`。
- `PublicRepository=PASS`：仓库可见性为 `PUBLIC`，默认分支为 `master`，Issues 和 Discussions 已开启，Wiki 已关闭。
- `PrivateVulnerabilityReporting=PASS`：GitHub API 返回 `enabled: true`。
- `BranchProtection=PASS`：`master` 未配置保护规则，符合当前阶段决定。
- `RemoteTree=PASS (29 files)`：远端 `master` 与本地首个提交一致。
- `RemoteLabels=PASS (33 expected, 6 extra retained)`：本地清单标签已同步，GitHub 默认额外标签未删除。
- 未运行类型检查、测试、构建、浏览器或真实来源验收：当前没有运行时代码和依赖。

## Follow-ups

- 用户继续提出需求后，追加原始需求并更新当前架构。
- Workspace 并发/取消/接管、候选 Revision 界面、跨 surface“有更新”投影和 state migration command 边界后置。
- 根据首个实现切片定义必要的 Source / Trigger / Flow / Action 细节。
- 架构边界稳定后，建立第一批 ADR。
- 规划并实现 RSS/RSSHub + fixture 的首条端到端切片。
