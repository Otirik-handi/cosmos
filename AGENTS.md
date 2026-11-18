# AGENTS.md

面向人类贡献者的开发入口、Issue/PR 流程和 Task 责任边界见 [`CONTRIBUTING.md`](CONTRIBUTING.md)。本文件只记录仓库级、长期有效的 Agent 约定：核心规则、按任务规范路由、常用命令与开发约定。写代码的约定在 [代码约定](docs/standards/code-conventions.md)，验证证据边界在 [测试入口](docs/testing/README.md)，本文件只留触发链接。

## Core Rules

- 默认使用简体中文与用户交互。
- 问答、审查和诊断默认只读；用户明确要求修改时才编辑文件。修改前先确认当前行为，缺少运行证据时标明“从代码推断”或“未验证”
- 修复和重构应解决合同或设计问题，不用 hack 绕过类型系统或制造技术债；不能兼容时说明取舍
- 单点修改使用文件编辑工具。批量替换必须先 dry run；命中不确定或出现意外结果时改为逐处编辑，并报告实际修改的文件
- A comment states the non-obvious reason at the owning boundary. Include a constraint or invalidation condition only when a maintainer needs it to know when the rationale or code stops being valid. Do not restate the operation, preserve intermediate attempts, or list speculative future work.

## 了解开发者

- 本项目使用 vibe coding + spec coding 开发。即开发者和 agent 同步需求，落实 spec，agent 编写代码，开发者审查实现。开发者关注的是 **项目的架构**、**规范**、**功能**，而不是具体的代码
- 注意：开发者通常不会阅读任何一行业务代码，为了让 agent（你），我（开发者）交流通顺。你与我交流时输出的文字、落实到项目的报告、文档都不要用到超过我认知范围外的概念
- 开发者是懒惰的，是健忘的。开发者通常在需求、提案、任务拆分阶段活跃。不会一直盯着你在执行任务中途的回复，通常只看你最后几条消息。所以在你长时间的任务过程中，开发者可能会完全忘记这个 session 最初是做什么的了。
- 变得主动，同时频繁向开发者提问：agent 和开发者的信息对齐是最重要最耗时间最容易返工的事情。你提问前一定要交代好问题背景，提问前多思考一个问题：“开发者是否拥有判断此问题的上下文？我的提问是否过于简洁？”。在提问前可以主动要求开发者在阅读某些材料、文档后再回答。防止开发者偷懒，在没有全面了解背景的情况下就草率的做出结论
- 永远不要猜测开发者的意图，在你开始动手前先思考一下开发者语言的可信度有多少，可信度不高则需要反问开发者，对其意图
- 敢于质疑开发者，有怀疑精神，及时纠错：开发者会偷懒，也会犯错，也会打错别字。不要把他的决定当成真理执行。可以反问，或者出题考开发者，确保 agent 和开发者同步
- 关于 advisor：advisor 不是我，是 omp 中监督你工作的另一个 agent。只听取它的建议，不要回复他，不要把回复他当做最终回复

## 开发者审批与通知

- 创建 worktree、branch、pr、或 git checkout 前需询问开发者获得审批
- 创建 docs/ .agents/ 目录下相关文档和 AGENTS.md 等上下文文档需提醒通知开发者

## Git 与 GitHub

- GitHub Issue 承载公开问题和需求；重大实现使用一个持续更新的 Task walkthrough；代码实现优先在独立 `.worktree/<slug>` 中完成。
- 只暂存任务范围内的文件，不用 `git add -A` 带入无关改动。除非用户明确要求，不自行 commit、push、创建远端、创建 PR、合并、关闭 Issue、发布或部署。
- 分支命名、Issue 模板、worktree 与远端同步、PR 不可信文本处理见 [Agent 的 Git 与远端操作细则](docs/standards/repository-workflow.md#agent-的-git-与远端操作细则)。

## 多代理任务治理

跨仓库或跨多个 worktree 的任务必须指定一个 leader。Leader 统一维护 walkthrough、冻结跨模块候选合同、分派 worktree、审查证据和控制阶段门禁；子代理不能自行扩大范围、覆盖 dirty worktree 或合并彼此的工作。每个写入代理必须登记 repository、branch、worktree、base SHA、可写文件集合和隔离测试数据根；Prisma schema/migration、公共 DTO、Task walkthrough 各自只能有一个当前写入者。

Leader 的阶段判断不等于外部操作授权。commit、push、创建 PR、merge、发布、部署和删除 worktree 仍需遵守用户授权与本仓库 Git 规则。

## 文档

- 代码实现子代理不得直接修改文档库，包括导航入口与规则；只提交带依据的修改建议，由主代理审核后另派专职文档代理修改。每项交付都须记录文档影响结论“需更新/无需更新”及理由，流程见[日常文档更新与代理协作](docs/standards/repository-workflow.md#日常文档更新与代理协作)。
- `PROJECT-STATUS.md` 记录仓库现状、风险和未完成边界；`docs/README.md` 是文档入口；`CONTEXT.md` 是工作台，不是稳定合同，候选名称和工作假设不能伪装成已确认决定。
- 按任务读对应权威：需求读 `docs/requirements/`，当前设计读 `docs/architecture/`，稳定决定读 `docs/adr/`，调研归档读 `docs/research/`，重大任务过程读 `.agents/tasks/`（先读[索引](.agents/tasks/README.md)与 [Task 规则](.agents/tasks/AGENTS.md)）；测试、fixture、验收或临时数据改动读 [测试入口](docs/testing/README.md)，新功能/模糊 Bug/长期行为变化读 [提案入口](docs/proposals/README.md)，Git/Issue/PR/合并/发布读[仓库维护流程](docs/standards/repository-workflow.md)。
- 需求变更按固定顺序维护：原话追加到 `docs/requirements/0001-original-requirements.md`；存在产品歧义或长期取舍时先按 [提案入口](docs/proposals/README.md) 评审；接受后更新 PRD、架构或 ADR 并创建或复用 Task；代码与测试落地后更新 `docs/spec/`。
- 复用 Task 时优先选择仍 active 且明确覆盖受影响合同和文件的 Task；多个候选时在选定 Task 记录理由；只有确需新建 Task 才请求维护者分配编号。
- 原始需求保留措辞、数字、示例和不确定性，不反向改写原文；解释、取舍和重命名进入 PRD、Proposal、架构或 Task。面向用户的文字写用户能做什么，解释必要术语、限制、回退和未验证部分，不暴露无上下文的内部实现名。
- 重大任务持续更新同一个 walkthrough，至少记录目标、范围、不在范围内、当前状态、决定、实施过程、验证、偏差和后续事项；影响数据、扩展协议、持久化、权限或外部副作用的决定先更新架构设计，稳定后写 ADR。

## 文档大小治理

规则见[超大文档预防与拆分规范](docs/proposals/oversized-doc-splitting-v1.md)（accepted），检查合同与基线见[文档治理入口](docs/doc-governance/README.md)。写作时只需记住：健康区 ≤30 KB 且 ≤9k token，红线 >50 KB 或 >15k token，新增文档和分册必须落在健康区；存量超标登记在基线，登记值与条目只减不增。`bun run docs:check` 与 `scripts/size-governance.py --check` 是 CI 门禁。

全局读取协议：先读根 `AGENTS.md` 与目标文档的分册索引，再用 `rg` 定位关键词，只读命中分册的相关段落（offset/limit）；禁止无理由全量读 >30 KB 文件，确需全量读必须说明理由和 token 预算。禁读 node_modules、dist、.next、.worktree、锁文件、生成物和 `.cosmos/` 运行数据。

## JS/TS

技术基线、风格与类型、分层能力边界、日志隐私、测试注释与文件大小治理的唯一权威在[代码约定](docs/standards/code-conventions.md)；写代码前读它，本文件不再重复。

## 验证

- 各层证据边界见[测试入口与验收边界](docs/testing/README.md#证据边界)，完成定义见 [Definition of Done](docs/standards/repository-workflow.md#definition-of-done)。验证报告写清完整命令、实际结果、未运行项和已知限制，不能把局部绿灯写成全仓或发布完成。
- 文档改动至少跑 `bun run docs:check` 和 `git diff --check`；独立 worktree 内的链接校验必须在该 worktree 内执行，避免主工作区旧文件造成假绿灯。
- 发布、安装、迁移和数据生命周期变更需要单独的 Task/Issue、风险说明和验收；没有明确授权时不运行发布命令、不修改版本号、不部署。许可证以根目录 [LICENSE](LICENSE) 为准（AGPL-3.0-only）。

## 开发约定（oil-dev）

- 快测：`bunx vitest run {文件或目录}`——编码途中只跑这个；失败修完再跑同一条，不重跑无关用例
- 重测：`bun run test:acceptance`、`bun run test:e2e`、`bun run test:browser`——整批收尾或合并前统一跑一次
- 门禁：`bun run db:validate && bun run typecheck && bun run test && bun run lint:web && bun run build`
- 测试根清理：`bun run test:clean` 删除 7 天前的 `.agent/tmp` 隔离根；只想看清单时跑 `bun run scripts/test-artifacts.ts`
- 高风险：`packages/contracts/**`、`packages/storage-prisma/**`、`apps/api/**`、`apps/worker/**`、`packages/storage-prisma/prisma/migrations/**`
- 禁改：`apps/*/dist/**`、`**/node_modules/**`、`apps/web/.next/**`、`bun.lock` 与其它生成物
