# Task Walkthroughs

重大功能、数据合同、扩展协议、运行时恢复或用户主流程使用一个持续更新的 Task。

目录名使用 `{NN}-{kebab-case-name}`。同一功能后续调整继续更新原 Task，不创建碎片化记录。

每个 Task 至少记录：

- User Request / Topic
- Goal
- Scope / Non-goals
- Current State
- Decisions and Deviations
- Implementation Walkthrough
- Verification
- Follow-ups

活跃 Task 的当前实施切片还必须记录：生命周期阶段、一个连贯目标、最多三条可观察验收、依赖、受影响合同、预计核心文件和验证层级。切片规则与完成条件以[仓库开发生命周期](../../docs/standards/repository-workflow.md#开发生命周期)为准；同一 Task 可顺序追加多个小切片，不为每个切片创建新 Task。
- 复用 Task 时优先选择仍 active 且明确覆盖受影响合同和文件的 Task；多个候选时把选择理由写入当前 Task；无匹配 Task 时由维护者决定是否新建编号。

跨 Task 的产品 TODO 在建立远端 Issue 系统后迁移到 Issue；在此之前由 `PROJECT-STATUS.md` 汇总。

Task 导航：

- [`02-rss-ingestion/`](02-rss-ingestion/)：Phase 1 RSS/RSSHub、fixture 录入、离线查询与最小 Story projection。
- [`03-runtime-logging/`](03-runtime-logging/)：API、Worker、Connector、存储和 Web 服务端的结构化运行日志。
- [`04-workflow-runtime/`](04-workflow-runtime/)：Durable Workflow、Job 恢复、Connection/Adapter、Knowledge/Research 和 Harness 边界的持续研究与实现记录。
- [`05-normalized-content-model/`](05-normalized-content-model/)：`NormalizedIngestItem`、Publisher、ContentKind、ContentMetrics 和 TemporalValue 合同。
- [`06-nb-workflow-kernel-convergence/`](06-nb-workflow-kernel-convergence/)：`nb-workflow` Kernel 与 Cosmos Host 的收敛记录。
- [`07-deferred-workflow-host/`](07-deferred-workflow-host/)：Deferred Activity、Cosmos Durable Host、Activity Job、固定 Ingest parity 和 Worker Admin 实施记录。
- [`08-project-governance/`](08-project-governance/)：治理目录、Proposal、工程标准、测试流程、Task 路径和文档门禁收敛。
- [`09-react-component-lab/`](09-react-component-lab/)：React 组件实验室、组件/场景登记合同、开发态工作台和现有 Web 产品组件采用。
- [`10-story-domain/`](10-story-domain/)：Phase 2 首切片 Story 域模型 v1——多 Entry 主归属、版本化 Story Revision、人工 merge canonical/alias 与多来源 Story 详情。
- [`11-topic-domain/`](11-topic-domain/)：Phase 2 第二切片 Topic 域模型 v1——Topic 不可变 Revision、Membership 角色 + revision/tombstone、Topic merge canonical/alias 与从 Story 侧发起的成员编排。
- [`12-entity-relation/`](12-entity-relation/)：Phase 2 第三切片 Entity/关系 v1——Entity 不可变 Revision + 名称别名、Story↔Entity 关联、Entity↔Entity 类型化关系（手动优先 + provenance）。
- [`13-user-organization/`](13-user-organization/)：Phase 2 第四切片用户组织 v1——Label 分类标签、Collection 命名收藏夹 + 轻量收藏、Annotation 批注、Saved View 持久查询视图。
- [`14-board-section-block/`](14-board-section-block/)：Phase 2 第五切片可配置看板 v1——Board/Section/Block 三层展示配置、四类 Block（Feed 绑定 SavedView/Spotlight/来源健康/Topic 与 Collection 列表）、多 Board 实体 + 默认 Board seed、Spotlight 人工固定。
- [`15-phase2-acceptance/`](15-phase2-acceptance/)：Phase 2 验收补完——Web 分类（Label）/Topic 浏览与 Saved View 条件、Story 时间线、Story 相关内容（REC-008 v1），无 Prisma/合同/API 变化。
- [`16-entry-story-evidence/`](16-entry-story-evidence/)：Phase 2 第六切片 Entry↔Story 证据关系 v1——`(entryId, storyId)` 唯一当前关系 + 受管类型 `evidence_for`/`mentions` + provenance，Story/Entry 双向读取投影与 merge/move 一致性。
- [`17-story-split/`](17-story-split/)：Phase 2 第七切片 Story split v1——`StoryReplacement` 历史壳 + `replaced_by[]` 投影、单命令显式迁移主成员/证据链接/Story↔Entity/Topic 成员、用户状态留在历史壳、壳写边界（编号待维护者确认）。
- [`18-story-subtype-registry/`](18-story-subtype-registry/)：Phase 2 第八切片 Story subtype 受管注册表 v1——代码内静态注册表（kind/version/label/status/identityPolicy/owner）、写入侧只接受该 kind 下 `active` 注册项、既有未知值继续降级、只读目录接口与 Web 下拉。
- [`19-per-source-media-policy/`](19-per-source-media-policy/)：Phase 2 第九切片按来源的媒体策略 v1——`Source.config.media` 的图片下载开关与单文件/单次预算（只能收紧、缺省跟随全局默认）、fetch 时从来源快照解析、Web 来源行编辑；保留期/清理与失败重试后置。

当前提交基线、验证结果和未完成边界只在 [`../../PROJECT-STATUS.md`](../../PROJECT-STATUS.md) 维护。

实现规格入口：[`../../docs/spec/README.md`](../../docs/spec/README.md)。先读 spec 索引与公共合同，再按组件读取
spec 和测试锚点；Task walkthrough 记录过程与偏差，不替代已合入实现规格。
