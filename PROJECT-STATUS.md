# Cosmos Project Status

> 截至 2026-08-07。

## 一句话结论

Cosmos 已建立公开 GitHub 仓库和 v0.9 Phase 0 架构基线，并确认个人本地优先、Agent 内部自主维护与外部副作用显式配置、第一版后置复杂权限、RSS/RSSHub + fixture 首条实现切片；此前的信息模型、推荐和 Workspace 状态边界继续成立。本次 grilling 已结束，项目仍没有运行时代码、依赖、数据库、前端或发布物。

## 已完成

- 初始化本地 `master` 分支。
- 建立需求、架构、ADR、研究和 Task 文档体系。
- 逐字保存项目初始需求与本轮需求。
- 整理完整产品需求文档，建立需求编号、阶段范围、验收条件、主要界面和原始需求追踪。
- 完善根目录 README，作为项目介绍、能力概览、使用场景和路线入口。
- 形成 Source / Trigger / Flow / Action、信息库、Story、Topic、Workspace、Artifact、看板和后续投递的架构草案。
- 新增独立信息领域模型，拆开同一事件聚类、宽泛相关推荐、Topic 组织和 Workspace 持续体验。
- 明确 Timeline 是视图、Spotlight 是展示决定、“精华”是 Board 策展角色。
- 整理本地单用户阶段的混合召回、可解释排序和多样性推荐基线。
- 接受 `Subject -> Topic` 与 `Feature -> Workspace`。
- 确认每个 Entry 默认拥有一个主 Story，Story 以 event/document/media/thread 等 kind 表达规范内容，允许单 Entry Story。
- 确认 Agent 自动创建 Topic 需要至少两个不同 Story，或命中用户明确跟踪规则。
- 确认 Topic 不自动过期，人工归档后置。
- 确认人类、Agent 和系统按协作者记录 actor/revision。
- 确认 Workspace UI 按 kind 使用栏目、专题、学习计划或工作区。
- 确认核心 Story kind 保持稳定，media 等内容通过 subtype 细分。
- 确认 Topic、维护、Board 放置、Spotlight 和订阅使用独立关系。
- 确认自动 Spotlight 使用可续期 TTL，人工固定可以不设 TTL。
- 确认第一版权限与预算保持简单，只保留 actor/revision、全局日预算、单次 Run 上限和紧急保留预算。
- 确认一个 Entry 只有一个主 Story，但可以关联多个其它 Story。
- 确认 Story/Topic merge 保留 canonical ID、旧 alias 和历史引用。
- 确认 Story subtype 使用受管理注册表，核心 kind 合同保持稳定，未知 subtype 可降级读取。
- 确认 Story split 保留旧 Story 历史壳，以 `replaced_by[]` 指向全部后继，不做模糊单目标重定向。
- 确认 v1 不建立 Topic 父子层级，使用 Relation、标签或 Workspace/Board 组织。
- 确认一个 `(Topic, Story)` 只有一个当前成员角色，历史修改保存在 revision history。
- 确认 Story 当前标题、摘要、关键事实和时间范围使用不可变 Story Revision 与当前指针。
- 确认 Feed 曝光和主要反馈按 Story/surface 记录，Entry 交互在展开具体信源后补充。
- 确认 Agent 不能静默移除人类明确加入或确认的 Topic 成员。
- 确认 Workspace 输入使用多对多 binding 和可选主要锚点。
- 确认 Spotlight 使用分离信号、版本化 policy、迟滞、TTL 和人工覆盖。
- 补充 Workspace Update/Run：用户应能看到 Agent 更新状态、操作者、步骤和最近结果，运行态不与生命周期或 Board 状态混写。
- 确认 Workspace Update 使用六种状态，失败/取消保留上一成功版本，成功时原子发布。
- 确认人类接受的 Story/Workspace 字段可以保护，Agent 先生成候选 Revision。
- 确认 Read State 保存 `last_seen_revision_id`，新 Revision 派生“有更新”。
- 确认 merge 将当前用户状态解析到 canonical；split 不自动扇出状态和 Topic membership。
- 确认 Spotlight 人工覆盖绑定具体 Placement，直到用户解除；不同 kind 共用 policy 合同。
- 确认 v1 和默认产品合同面向单个本地用户，未来协作只保留 actor/revision 扩展位。
- 确认 Agent 可维护用户配置范围内的内部对象；创建外部 Source、扩大数据范围和外部发送需要显式配置/批准。
- 确认第一版不建设细粒度权限 UI 或不可信插件沙箱，只运行本地可信扩展。
- 确认 Phase 1 首条真实 Connector 使用 RSS/RSSHub，并配套 fixture Connector。
- 结束本次 grilling；实现级未决问题转入后置清单。
- 确认第一版聚类和相关推荐不使用 embedding。
- 将 `CONTEXT.md` 收缩为产品共同语言，只维护经常使用、跨模块或容易歧义的核心概念；实现级对象留待真实开发需要时再定义。
- 迁移并精简适用于 Cosmos 的 Agent、Task、worktree 和验证约定。
- 将 neuro-book 的通用协作流程去领域化迁移到 Cosmos：补充双语贡献指南、Issue 分流、标签清单、PR 模板和安全报告入口；未复制依赖 neuro-book 运行时代码、发布脚本或产品专用 CI 的 workflow。
- 确认 Cosmos 按 GNU Affero General Public License v3.0 only（AGPL-3.0-only）发布，并复制许可证全文到根目录 `LICENSE`。
- 补足协作主路径、远端同步、Windows worktree 清理、RSS/RSSHub 首条切片和公开贡献权利说明；GitHub Actions 仍按本阶段决定保持不变。

## 当前架构基线

以下是 v0.9 的 Phase 0 基线；后续需求仍可通过记录理由调整：

- 模块化单体优先；逻辑角色可拆进程，但第一阶段不引入分布式基础设施。
- Bun + TypeScript 为当前实现基线，Vue/Nuxt 为看板候选前端。
- SQLite 保存核心元数据、关系、任务与用户状态；文件系统保存内容寻址的 Blob 和版本化 Artifact。
- 原始 Observation 不可变，外部 URL 可选；派生分析和索引可重建并保留 provenance。
- Entry 是稳定信息条目；每个 Entry 默认拥有一个主 Story，Story 使用稳定 kind 和受管理 subtype 注册表；Topic 只组织 Story。
- Workspace 保存长期体验、维护策略和交互状态；Artifact 保存不可变的版本化输出。
- Topic、Workspace、Spotlight 和 Feed 等上层体验以 Story 为内容单位，不直接使用 Entry。
- Story 聚类与相关推荐使用不同判定；第一版推荐以显式关注、BM25、Entity/关系、时间、引用、新颖性和本地反馈为主，不使用 embedding。
- Agent 自动创建 Topic 需要两个不同 Story 或明确跟踪规则；Topic 不自动过期。
- 人类、Agent 和系统均作为协作者，每次修改记录 actor、revision、理由和关联 Run。
- 第一版预算只限制全局日额度、单次 Run 的时间/token/工具调用和紧急保留预算，超预算时降级。
- TopicMaintenanceBinding、BoardPlacement、SpotlightPlacement 和 Subscription 相互独立；自动 Spotlight 使用可续期 TTL。
- Entry 可通过 evidence_for/mentions 关联多个其它 Story；Story/Topic merge 保留 canonical ID 与 alias。
- Story split 保留旧历史壳和 `replaced_by[]`；Topic v1 不使用父子层级，Topic membership 只有一个当前角色并保存 revision history。
- Story 当前表示由不可变 Story Revision 和 `current_revision_id` 维护；历史产物引用精确 Revision。
- Feed 反馈与被排序的 Story/surface 对齐；Agent 对人类确认的 Topic 成员只能提出移除建议。
- Workspace 输入是多对多 binding，可有主要锚点；Workspace Update/Run、生命周期、内容新鲜度、Placement 和 Interaction State 分开。
- Spotlight 自动策略保存分离信号、policy/version、迟滞和 TTL，人工覆盖优先。
- Workspace Update 失败/取消不替换上一成功版本；人类保护字段优先于 Agent 候选 Revision。
- Read State 使用 `last_seen_revision_id`；merge/split 的状态迁移保持 canonical 与历史壳边界。
- v1 和默认产品合同是个人本地优先，不实现多人同步、多租户或复杂权限系统。
- Agent 内部维护受用户配置范围约束；新增外部来源、数据范围和发送行为需要显式配置/批准。
- 第一版扩展按本地可信代码处理，但继续使用 SDK/Command/Query/Event；Phase 1 从 RSS/RSSHub + fixture 开始。
- 看板优先于推送实现；推送边界仍在架构中保留。

## 后置决定

- “分类”是稳定导航分区、自由标签，还是二者的上位概念。
- 同一 Workspace 的并发更新、重复触发合并和取消/接管语义。
- Agent 候选 Revision 的接受/拒绝界面和字段保护最小实现。
- `updated_since_last_seen` 在不同 surface、Story split 和 merge 后的投影规则。
- 显式 state migration command 的批量操作、撤销和用户确认边界。
- 文本、图片、视频、私信和历史修订的默认保留预算。
- BiliBili、X、Telegram、公众号、QQ群和 AIHOT 的合法、稳定接入方式。
- 多 Board、公网摘要链接、推送渠道和跨平台发布策略。
- Source、Trigger、Flow、Action 的产品关系已暂定，更细的实现边界等待真实用例推动。

## 尚未实现

- Source、Trigger、Flow、Action 和持久执行引擎。
- SQLite schema、Blob Store、全文/实体/关系索引和查询 API；向量索引后置。
- 去重、Story 归并、Topic 成员、分类、关系和推荐系统。
- Agent 分析、Artifact、Workspace 和交互状态。
- 看板、推送、摘要图片和网页发布。

## 验证边界

本轮为文档、协作流程与仓库初始化，已完成以下检查：

- 29 个仓库文件通过 `git diff --no-index --check`、尾随空白和文件末尾空行检查。
- 18 份 Markdown 的 53 个仓库内本地链接全部有效，代码围栏成对；原始需求另有 1 个指向仓库外技能文件的本地路径链接，未改写用户原文。
- 7 个 GitHub YAML 文件解析通过；5 个 Issue Form 的字段 ID 与默认标签引用检查通过，标签清单包含 33 个标签。
- `CONTEXT.md` 为 189 行，只维护产品共同语言；958 行的算法与实体细节已下沉到独立信息模型。
- Grilling Round 1 至 Round 6 的回答已逐字追加到原始需求；Q30–Q33 明确后置，未被伪装成已确认决定。
- Entry、Story、Topic、Relation、Workspace、Artifact、Timeline 与 Spotlight 的关键边界均存在。
- 产品需求包含 125 个唯一需求编号，并新增个人本地边界、Agent 外部副作用授权、可信扩展和 RSS/RSSHub 首条切片要求。
- 远端研究文件与本地归档 SHA-256 一致：`bcec8d2698d65d6217ed067fbb8625888e7e1dfab7b65aa0096f0790d9aa930d`。
- Git 状态为 `master...origin/master` 且工作区干净；首个公开提交为 `1eff6c7`，远端为 `https://github.com/notnotype/cosmos`。

没有可运行代码，因此未运行类型检查、测试、构建、浏览器或真实来源验收。
