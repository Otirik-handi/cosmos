# Cosmos 文档体系

- `../CONTEXT.md`：产品共同语言，记录经常使用、跨模块或容易歧义的核心概念、关系和待讨论边界；不作为完整实体清单。
- `requirements/0001-original-requirements.md`：用户原始需求的 append-only 真相源。新增轮次追加原文，不修辞、不归纳、不把解释写回原文。
- `requirements/0002-product-requirements.md`：当前整理后的完整产品需求，维护需求编号、阶段、验收条件、使用场景和待决策项。
- `architecture/0001-cosmos-foundation.md`：总体架构、运行时、存储、扩展和阶段设计。
- `architecture/0002-information-model.md`：Entry、Story、Topic、相关推荐、热点、Workspace 与 Artifact 的详细模型。
- `adr/`：已经稳定且改回成本较高的架构决定。
- `research/`：外部项目、数据源、算法和技术验证材料。
- `tasks/`：重大任务的持续 walkthrough，记录计划、实现、验证、偏差和实现级后续。

读取顺序通常是：需求原文 → `CONTEXT.md` 中的产品共同语言 → 当前 PRD → 当前架构 → 对应 Task → 相关 ADR / Research。
