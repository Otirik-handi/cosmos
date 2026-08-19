# Cosmos 文档体系

## 职责与真相源

- [`spec/`](spec/) 与对应代码/行为测试：当前已经实现、可观察且可重建的组件行为。
- [`requirements/`](requirements/)：用户原话、产品范围、阶段和验收意图；原始需求保持 append-only。
- [`../CONTEXT.md`](../CONTEXT.md)：跨模块共同语言、当前解释和待讨论边界，不作为完整实体清单。
- [`architecture/`](architecture/)：系统分层、领域边界、运行时、存储和演进设计。
- [`adr/`](adr/)：已经接受、改回成本较高且需要长期保留的架构决定。
- [`api/`](api/)：Product Service、Worker Admin、Worker Gateway 和 DTO 的目标草案；Draft 字段与端点不自动等于当前实现。
- [`standards/`](standards/)：仓库维护和跨功能域工程流程。
- [`testing/`](testing/)：测试、fixture、验收、临时数据和验证证据合同。
- [`proposals/`](proposals/)：尚未生效、需要评审的产品或工程方案。
- [`.agents/tasks/`](../.agents/tasks/)：重大实现的范围、过程、验证、偏差和交接；Task 不替代当前实现规格。
- [`research/`](research/)：外部项目、数据源、算法和技术验证材料，不作为当前行为合同。

当前提交基线、最近验证结果、未运行项和跨任务下一步只在 [`PROJECT-STATUS.md`](../PROJECT-STATUS.md) 维护。判断当前行为时，以 [`spec/README.md`](spec/README.md)、对应代码和行为测试为准；测试命令及各层证据边界见 [`testing/README.md`](testing/README.md)。需求、Draft、历史 Spike、Gateway、Redis 或多主机目标不能作为当前能力依据。

## 读取与变更顺序

判断当前能力时，先读 [`spec/README.md`](spec/README.md) 和目标组件规格，再核对实现、行为测试与 [`testing/README.md`](testing/README.md)；需要设计背景时继续读取相关架构和 ADR，最后按需读取对应 Task walkthrough。新需求先保留用户原话；存在歧义或长期取舍时进入 [`proposals/README.md`](proposals/README.md)，接受后更新 PRD、架构或 ADR并创建或复用 Task；代码与测试落地后再更新当前 spec 和项目状态。需求、Proposal、架构、ADR、API Draft、Task 和当前实现规格不能互相替代。
