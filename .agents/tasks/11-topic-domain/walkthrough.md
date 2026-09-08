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
