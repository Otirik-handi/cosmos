# Task 40：Story 内容表示与多模态阅读

> 状态：实施与验收进行中。内容解析、版本存储、读取、阅读界面和候选决策已实现；生产 Agent 生成服务未配置，整体验收尚未完成。
>
> 编号 40 由维护者明确分配。本 Task 承接已确认的目标设计与架构，实施计划和过程只记录在 [walkthrough.md](walkthrough.md)。

## User Request / Topic

当前 Story 将文本与图片分开显示，来源文章的图文交错顺序丢失，正文还可能泄漏 HTML 标签。用户要求设计能支持文本、文章、图片、视频、音频和混合内容的阅读模型，同时服务 Agent；完整提案已确认，本轮授权建立 Task 40。

## Goal

来源证据保持不可变，新采集内容产生有序、安全、版本化的阅读投影；Web 与 Agent 共用读取规则，旧内容保持可读，Agent 输出经用户确认后才能写入正式表示或关系。

## Scope / Non-goals

范围：ContentSource、受控内容块、Normalizer、ContentRepresentation 子资源与当前指针、RSS/现有文本来源接线、媒体引用、统一 Query/权限、Story 阅读、Agent 候选与接受流程、隔离验证与文档收口。

不在范围内：外部网页全文抓取、任意 HTML 执行、历史批量重解析、音视频下载/转码/转录、OCR、自动聚类、Agent 自动写正式数据、完整 Artifact/Workspace 产品、部署。

## Authority / Dependencies

- [已确认目标设计](../../../docs/aegis/specs/2026-10-08-story-content-representation-design.md)
- [已确认目标架构](../../../docs/aegis/specs/2026-10-08-story-content-representation-architecture.md)
- [用户真相保护 ADR](../../../docs/adr/0028-user-truth-protection-v1.md)
- [当前实现规格入口](../../../docs/spec/README.md)与[测试隔离规范](../../../docs/testing/README.md)
- [Task 38](../38-agent-invocation/README.md) 的 Invocation Port；[Task 39](../39-pi-ai-adapter/README.md) 的真实 Adapter 为独立依赖，不推断其已接入 Worker。

## Current Slice / Gates

生命周期：实施中。当前切片是完整回归、运行时验收和文档同步；实施过程及逐轮证据统一记录于 walkthrough。

已实现的可观察行为：

1. 新内容按原顺序显示受控文本和媒体，旧文本安全降级，来源可切换。
2. 内容表示可按精确版本读取、重建、锁定或回退，保留历史与审计。
3. Agent 输出只生成候选；摘要和 Entry 关系由用户接受后通过正式命令原子提交，重复或过期决定被拒绝。
4. 质量检查意见可查看、拒绝；当前没有对应正式写入命令，因此不提供接受。

验证必须区分聚焦测试、全量测试、类型检查、隔离浏览器、真实来源和真实 Agent。组件实验室覆盖 320/768/1024/1440；完整产品已验证图文阅读、双来源切换和图片加载失败恢复，阅读支持 1024/1440、768 显示过窄提示。生产生成服务未配置，未以 Fake 代替真实 Agent 验收。真实数据未迁移，未部署或提交 Git。

## Next Step

本会话由 leader 持续推进完整批准范围：补齐媒体/读取状态、精确版本和候选产品运行验收，完成生产 Agent profile/resolver 接线与独立审查，同步权威记录。真实 Agent 验收仍是必需未完成项，外部调用费用/凭据/网络需明确授权；历史 NASA RSS 证据须核对有效范围，不重复无变更验收。当前清单及证据只在 walkthrough 维护，分支/worktree、Git 外部操作和真实数据迁移继续遵守各自授权边界。
