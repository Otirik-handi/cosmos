# Task 11 Walkthrough：Topic 域模型 v1

## 2026-09-08：切片启动——提案评审与稳定文档落地

- Phase 2 第二切片确定为 Topic/Topic Membership（Entity/关系不进本切片）。
- Proposal [`topic-domain-v1`](../../../docs/proposals/topic-domain-v1.md) 起草并评审；用户接受四项默认建议：
  1. Topic 自身走不可变 `TopicRevision`（同 StoryRevision 指纹 no-op）；
  2. Topic merge 进 v1（canonical/alias + 成员去重迁移）；
  3. 成员角色受管枚举 `core`/`update`/`background`/`analysis`/`counterpoint`/`tutorial` + 未知降级；
  4. Web 成员添加入口从 Story 侧发起（规避 Story ID 不展示的可用性障碍）。
- 稳定文档已同步：PRD §7.5 第二切片注记、信息模型 §5「v1 切片」注记、ADR-0007、ADR 索引、Task 11 README。
- 未开始实现；待维护者授权创建 worktree 与分支 `feat/t11-topic-domain` 后进入切片 1。

## 2026-09-08：实现（三切片一次合入）

维护者授权创建 worktree `.worktree/topic-domain` 与分支 `feat/t11-topic-domain`（base `ff7cc00`，含文档提交）。三个切片按 Task 11 README 的能力图实现：

**切片 1（domain + migration + storage）**：

- domain：`topicMemberRoles` 受管枚举 + `TopicMemberRole`、`TopicRevisionContent` + `fingerprintTopicRevision`（title/purpose/scope 的 SHA-256 指纹）。
- Prisma：新增 `Topic`/`TopicRevision`/`TopicMembership`/`TopicMembershipRevision`/`TopicAlias` 五张表 + migration `20260908000000_topic_domain_v1`（forward-only、只增不改、无 backfill）；`Story` 加 `topicMemberships` 反向关系。
- storage：`createTopic`/`updateTopic`（`baseRevisionId` CAS + 指纹 no-op）、`mergeTopics`（成员去重迁移 + alias）、`topic`/`listTopics`（成员列表含 removed 标记 + active 计数）、成员命令 `addTopicMember`/`updateTopicMemberRole`/`removeTopicMember`/`restoreTopicMember`（`TopicMembershipRevision` 追加 + tombstone 可恢复）；**`mergeStories` 扩展**：同一事务把指向 obsolete Story 的 membership 迁到 canonical（ADR-0007 决策 4）。
- 行为测试 `topic-domain.test.ts`（5 例，含 Story merge 的 membership 迁移 move/collision 两路径）+ domain 指纹测试。

**切片 2（contracts + transport-http + API）**：

- contracts：`topicMemberRoleSchema` + Topic DTO（`TopicDetail`/`TopicSummary`/`TopicPage`/`TopicMember`）+ 七个命令 schema（角色写入侧受管枚举、读取侧放宽字符串）。
- transport-http：Topic 读取/写入 client 方法。
- API：`GET /topics`、`GET /topics/:topicId`、`POST /topics`、`POST /topics/:topicId/revisions`、`POST /topics/merges`、`POST /topics/:topicId/members`、`/member-role-updates`、`/member-removals`、`/member-restorations`；错误沿用 `sourceCommandError`（not_found→404、conflict→409）。
- 测试：contracts 角色校验/降级 1 例、API controller 映射 3 例。

**切片 3（Web）**：

- `TopicPanel`：展示 title/purpose/scope + 成员列表（角色徽章、story id、reason、actor、removed）+ 改角色/移除/恢复 + 标题目的编辑。
- `StoryPanel`：新增「加入 Topic」（选择已有 Topic + 角色）与「创建 Topic 并加入本 Story」（seed 恒为 core）。
- `page.tsx`：侧栏 Topics 列表（`client.listTopics`）+ TopicPanel 打开/操作接线 + StoryPanel 的 Topic props。
- 组件实验室登记 `topic-panel`（3 场景），`registry.test.ts` 公共模块清单补 `components/cosmos/topic-panel.tsx`。

## 验证（2026-09-08，实际运行）

- `bun run typecheck` 全仓通过。
- 聚焦：domain 7、storage-prisma 全量 72（含 topic-domain 5）、contracts 19、transport-http 6、api controller 21、component-lab 24 全部通过。
- `bun run build`（含 Next standalone）通过；`bun run lint:web` 0 error（2 个既有 warning）；`bun run docs:check` 327 文件通过；`git diff --check` 干净。
- `bun run test` 全量 41 文件/341 用例：两轮分别有 1 例 5s 超时 + EBUSY 抖动（先是我未拆分的 topic 大测试，拆分后转为既有 `story-revision-versioning` 迁移测试），均为 PROJECT-STATUS 已记录的 Windows SQLite 并行负载环境抖动；单独重跑两者 2/2 通过。
- 未运行：浏览器产品 E2E（Topic 流程）、`test:browser:component-lab`、Node 进程 E2E、Windows smoke、Docker/Compose、发布部署——浏览器/Node/Windows/Docker 为既有边界，Topic 流程浏览器验收留待后续（自动化组件实验室与 API/存储行为测试已覆盖主路径）。
