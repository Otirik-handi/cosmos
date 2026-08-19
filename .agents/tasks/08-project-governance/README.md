# Task 08：项目治理目录与流程收敛

## User Request / Topic

参考相邻 `neuro-book` 的治理方式调整 Cosmos，但不照搬完整体系：将 `docs/tasks/` 迁入 `.agents/tasks/`，建立 `.local/`、`docs/proposals/`、`docs/standards/` 和 `docs/testing/`，并按 Cosmos 当前规模收敛流程。

批准的执行输入为 `local://cosmos-governance-plan.md`；本次没有关联 GitHub Issue，不伪造 Issue 编号。

## Goal

让需求、方案、工程流程、测试合同、当前实现规格、执行记录和本地资产各有唯一入口；所有活跃链接一次性切换，并由轻量文档检查阻止旧路径回流和断链。

## Scope / Non-goals

范围包括治理目录、入口文档、现有 Task 物理迁移、活跃链接切换、文档检查脚本及质量 CI 门禁。

本 Task 不引入 NeuroBook 的四角色体系、五位 Task 编号、Spec frontmatter、迁移 hash 清单或 monorepo 专属规则；不改变 Cosmos 运行时行为、产品数据、版本、发布或部署状态。

## Current State

已完成。`.local/`、`.agents/`、Proposal、工程标准、仓库流程和测试规范入口已经建立；原 `docs/tasks/` 的 11 个 Markdown 文件已迁入 `.agents/tasks/`，退休目录和 `docs/testing.md` 已删除。根文档、双语贡献指南、需求、架构、ADR、API 和当前 spec 的活跃链接已切换，文档检查脚本已接入 CI quality job；审查后又统一了 Proposal/Issue/Task 准入、Task 证据写入、动态状态真相源和文档门禁平台边界。

## Decisions and Deviations

- 采用正确拼写 `docs/standards/`，不创建 `docs/standars/` 兼容目录。
- 保留 Cosmos 现有 `docs/spec/` 当前实现模型和 `{NN}-{kebab-case-name}` Task 编号。
- `.local/README.md` 是 `.local/` 唯一入库文件；其它内容由用户管理并被 Git 忽略。
- 历史 walkthrough 中作为审计事实的旧路径纯文本保留；可点击链接切到当前目标。
- 文档门禁使用仓库内 TypeScript 和 Node 标准库，不新增 Markdown 解析依赖。
- 在 `docs/standards/repository-workflow.md` 建立 Proposal、公开 Issue、Task 和项目状态要求的唯一准入决策表；其它入口只保留链接和触发摘要。
- Task README 维护当前摘要，已有 walkthrough 时由 walkthrough 独占追加过程、偏差和验证。
- `PROJECT-STATUS.md` 独占当前提交、验证结果和未运行项；测试规范与文档索引只保留稳定合同和链接。
- 文档门禁验证目标文件或目录，不验证 fragment 内容；扫描范围包含治理用 `.local/README.md` 和 `.github/` Markdown，并拒绝 POSIX/Windows 绝对路径。

## Implementation Walkthrough

1. 建立 `.local/` 忽略边界和 `.agents/` 治理入口。
2. 建立 Proposal、工程标准、仓库流程和测试规范入口。
3. 迁移 Task 并修复因目录深度变化而失效的链接。
4. 切换根文档、需求、架构、ADR、API 和当前 spec 的活跃 Task 引用。
5. 先写文档检查行为测试，再实现脚本并接入质量 CI。
6. 根据五路只读审查统一流程合同与真相源，补齐 Windows/POSIX 绝对路径、治理文档扫描和根入口可达性回归测试。

## Verification

2026-08-19 在仓库根执行：

- `bun run test -- scripts/check-documentation.test.ts`：通过，1 个文件 / 8 个测试；覆盖必需入口、根入口可达性、文件/目录/图片/引用式链接、代码区排除、append-only 原始需求排除、`.local`/`.github` 治理文档、断链、POSIX/Windows 越界、反斜杠、URL 编码路径和退休路径。fragment 只参与目标路径分离，不校验锚点内容。
- `bun run docs:check`：通过，JSON 为 `failures=[]`、`checkedFiles=256`。
- `bun run typecheck`：通过，packages 与 apps 全部 TypeScript 检查退出码 0。
- `bun run test`：通过，29 个文件 / 193 个测试。
- `git diff --check`：通过，无输出。
- 导航核对：根 README 可达 `.agents/README.md`，`docs/README.md`、Task、Proposal、standards 和 testing 入口均可沿相对链接到达；活跃退休路径扫描为 0，移动后 Task 相对链接扫描为 0 个断链。

运行时 build、Node E2E、浏览器、Docker 和真实来源验收未运行；本次只改变治理文档、文档检查脚本和 CI 质量门禁，不改变 Cosmos 运行时行为。

## Follow-ups

无预设后续。实施中发现的范围外治理事项只记录，不在本 Task 顺带扩展。
