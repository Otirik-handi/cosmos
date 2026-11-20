# Task 43：Story 深入阅读 + Artifact v1

- 状态：active
- 日期：2026-11-19
- Leader：`session-6e497657-84c7-4dc8-a7cf-9fea05a55d9e`（维护者 Otirik 决策授权）
- repository：`cosmos`
- branch：`feat/story-artifact-v1`
- worktree：`.worktree/story-artifact-v1`
- base SHA：`9b35d60`
- 当前生命周期：slice 1a/1b/2a/2b/3 已交付；完整代码门禁已跑（全仓 1595/1598，3 条 prisma-cli 为 fresh bun install 的 hoisted 布局环境差异（worktree/正常 checkout 均复现），主工作区 7/7 通过）；acceptance/e2e/组件实验室与正常 checkout 完整 browser（72 passed / 2 skipped / 0 failed）通过；已合并 master（`126a501`）；合并后默认环境全仓 test **1598/1598**；未 push。唯一过程/验证记录：[walkthrough](walkthrough.md)。

## User Request / Topic

1. “请你探索Cosmos下一项功能应该做什么。你只需要告诉我选项以及原因。”
2. “这个功能用 oil-plan 的子 Agent 模式做：你只做决策，探索、写代码和审查都交给子 Agent，使用官方的子智能体插件来委派子 Agent，子 Agent 模型选择 gpt-6-luna，思考等级选择 medium。”
3. 维护者确认：功能 B（Story 深入阅读 + Artifact v1）；独立 worktree + 分支；本地 commit；合并前再确认；Task 编号 43。

## Goal

用户在 Story 阅读页手动生成带精确来源引用的深入阅读报告，事实与 Agent 观点可区分，每次成功发布不可变 ArtifactRevision，失败仍能读旧版；同键恢复不重复付费，不同键活动期409，历史归属与并发发布可验证。

## Scope / Non-goals

以 [accepted Proposal](../../../docs/proposals/story-deep-read-artifact-v1.md) 与 [accepted ADR-0034](../../../docs/adr/0034-artifact-revision-v1.md) 为准，不在 Task 重复全文。三表/原子入队与发布、精简冻结/模型调用、四路由与 Transport、Story 左栏和精确证据抽屉、相应隔离验收与规格收敛在范围内。

Workspace、文件包/Artifact Root、HTML/可执行页、图片、定时刷新、编辑/批注/导出/分享、看板/Feed/搜索、跨 Story、取消 UI、移动端、真实外网新验收不在本期；不改 runtime 特殊分支、不顺手修旧 Story Agent。合并前再次确认，本轮文档不执行 commit。

## Authority

- 产品与范围：[Proposal accepted](../../../docs/proposals/story-deep-read-artifact-v1.md)。
- 长期边界：[ADR-0034 accepted](../../../docs/adr/0034-artifact-revision-v1.md)。
- API 目标：[Draft 0010](../../../docs/api/0010-story-deep-read.md)，未实现，不得标 Current。
- 当前实现事实：[spec 入口](../../../docs/spec/README.md)，代码/测试落地后由文档代理更新。
- 验证与隔离：[测试入口](../../../docs/testing/README.md)。
- 切片与完成定义：[开发生命周期](../../../docs/standards/repository-workflow.md#开发生命周期)。

## Current State / Next Step

slice 1a/1b/2a/2b/3 已交付。2b 的 validation_failed 末项已修；Web unit/copy/registry 68/68、component lab 8/8、真实 browser deep-read 1/1（35s，生成/费用/证据/版本 N+1/失败保旧版/刷新/双页 202+409）通过。完整代码门禁：db:validate/typecheck/lint:web/build 通过；全仓 test 1595/1598，唯一 3 条 prisma-cli 为 worktree 本地 install 布局环境差异，主工作区同一文件 7/7 通过；迁移边界夹具已按新增迁移更新。acceptance 90/90、Node E2E 13/13、组件实验室 64/64、正常 checkout 完整 browser **72 passed / 2 skipped / 0 failed（4.6m）** 通过；此前 6 条阅读页超时由深读 spec 的 hold/清理隔离缺陷导致，已在 `3a3d85d` 修复（hold 有界 + 清理前等 Run 终态）。spec/API/架构/PROJECT-STATUS/Task 文档已收敛。已合并 master（`126a501`）；合并后默认环境全仓 test **1598/1598**；未 push。

## 分片计划

### Slice 1：合同与持久化 / 原子入队

- 阶段与目标：定义/实现，让冻结 DTO 与报告上限、块编号、三表及事务命令成为可独立验证的持久边界。
- 可观察验收：①fresh/upgrade 只新增三表与索引，不回填旧数据，Restrict 与唯一约束成立；②同键同 hash 返回原 Run，异 hash/跨 kind/活动不同键409，并发只一 Run，CAS 失败无孤 Run/槽；③发布 fence/槽/幂等/N+1/事件事务成立，重放与惰性自愈不改旧版。
- 依赖：Authority 已冻结；需先抽共享事务 helper，不能在业务事务中嵌套旧公开 wrapper/P2002 重读。
- 核心文件：拟新增 contracts deep-read DTO、application 存储命令端口与 storage-prisma 仓储/测试；现有 [schema](../../../packages/storage-prisma/prisma/schema.prisma)、[envelope-store](../../../packages/storage-prisma/src/workflow-host-store/envelope-store.ts)、迁移目录新增 `YYYYMMDDHHMMSS_snake_case`。具体新增文件名由写入者登记，不修改生成物。
- 验证层级：contracts/Application 单元、隔离 SQLite fresh+upgrade/并发/fence/幂等/崩溃边界测试，相关包类型检查；不外呼。

### Slice 2：生成链与 HTTP

- 阶段与目标：实现从受控精简冻结到 Worker host 发布与 HTTP/Transport 读取的完整生成链。
- 可观察验收：①8来源/12k单源/60k总量、prompt正文单份与allowlist、原始请求hash/实际模型冻结可核实；②新Workflow/host发布Action接线，只有持久发布成功，调用计数证明不同键并发仅一次成功路径调用；③四路由/严格投影/安全错误/sourceStatus/成功费用成立，length或发布失败保留旧版。
- 依赖：slice 1；`cosmos.story-deep-read@1` → `agent.invoke@2`（既有maxAttempts=2）→ `artifact.publish@1`（host/maxAttempts=1）。
- 核心文件：拟新增 application preparation/workflow/control、publish action；现有 [Worker main](../../../apps/worker/src/main.ts)、[API content controller](../../../apps/api/src/app.controller/content.ts)、transport-http 相关内容客户端及聚焦测试。
- 验证层级：Application/Worker/API/Transport 单元、隔离 HTTP/Worker 进程 E2E、调用计数和安全投影、类型检查；本地模型HTTP替身，不真实Provider。

### Slice 3：Web 阅读体验

- 阶段与目标：实现 Story 左栏深入阅读入口、生成恢复和不可变报告阅读。
- 可观察验收：①生成/409后读取活动generation、1秒轮询/sessionStorage同键恢复/版本切换/费用与观点标记成立；②来源证据抽屉精确读取revision+representation并定位block，失效固定降级且键盘/焦点可用；③component lab与browser e2e验证1024/1440布局，右栏编辑不变、旧版始终可读。
- 依赖：slice 2 的 HTTP/Transport 合同与可控fixture。
- 核心文件：现有 [Story阅读页](../../../apps/web/src/app/(reading)/stories/[id]/story-reading.tsx)、[ContentBlockReader](../../../apps/web/src/components/cosmos/content-block-reader.tsx)，拟新增 deep-read panel/hook、证据抽屉、copy、component-lab场景及browser用例。
- 验证层级：Web聚焦单元/组件实验室/隔离浏览器E2E、Web类型/lint；不以组件替身通过代替真实API/Worker浏览器链。

### Slice 4：规范与门禁

- 阶段与目标：依据实现证据完成规格与项目状态收敛，统一门禁、审查和Task收尾。
- 可观察验收：①contracts/storage/interfaces/web/application规格反映已实现行为，PRD仅补AGT-003/005/009切片、架构§10.1补v1注记；②完整门禁/重测/文档门禁通过或有明确阻断，升级旧版读取/Worker回退/回滚安全有证据；③PROJECT-STATUS与walkthrough记录完成/风险/未验边界，独立审查关闭阻断项，合并前再请求确认。
- 依赖：slices 1–3与独立审查证据；实现者只提供文档影响建议，由文档代理落文。
- 核心文件：docs/spec 对应 canonical 分册、PRD主文切片注记、架构v1注记、PROJECT-STATUS、本Task摘要与walkthrough；API Draft的实现状态仅依据证据更新。
- 验证层级：全仓质量门禁、acceptance/Node进程/browser/组件实验室、文档/尺寸与独立正确性/简单性/架构/安全/性能审查；真实外网不纳入。

## 写入登记

所有写入都限同一repository/branch/worktree/base。下表是派发上界，实际代理启动前由 Leader 缩到具体文件，禁止重叠 owner。公共DTO、schema/migration和本Task各保持一个当前写入者；后片接手必须先交接。

| repository | branch / worktree / base SHA | 写入代理 | 可写文件集合 | 隔离测试数据根 |
| --- | --- | --- | --- | --- |
| cosmos | feat/story-artifact-v1 / .worktree/story-artifact-v1 / 9b35d60 | slice 1a：`721a951c-c213-4143-a537-5b689aa8de49`（已完成，独立审查通过） | contracts `story-deep-read.ts`/测试/导出；schema.prisma、新 migration；envelope-store.ts及测试；migration测试；已冻结，变更需Leader交接 | `.agent/tmp/task43-s1a-*` |
| cosmos | 同上 | slice 1b：`9e43ca0a-e3dc-451e-8b23-752b49f60c77`（已完成） | repository `story-deep-read.ts`、`story-deep-read-source-status.ts`、storage `index.ts`一行、仓储测试；变更需Leader交接 | `.agent/tmp/task43-s1b-*` |
| cosmos | 同上 | slice 2a：`dba56891-0aa0-49c9-83ff-1450fbd10960`（已完成，复审 PASS） | application store/preparation/workflow-control/workflow/publish 5文件+3测试、application/index导出与entry-surface 266；Worker main注册+注册测试 | `.agent/tmp/task43-s2a-*` |
| cosmos | 同上 | slice 2b：`fb1296c2-eb8c-401e-b0a6-c1663754a347`（已交付/复审 PASS，末项code修补中） | API app.module、新controller、route-table、新controller测试、新module reader测试、main.ts、request-logging；transport 4文件 | `.agent/tmp/task43-s2b-*` |
| cosmos | 同上 | slice 3：`9d51acfa-344d-4960-bd06-8fa4931e1682`（进行中） | Web阅读页、新深读组件/hook/copy/component-lab/browser e2e | `.agent/tmp/task43-s3-*` |
| cosmos | 同上 | 待派发：slice 4文档 | PRD/架构切片注记、API/spec/PROJECT-STATUS；Task变更建议交Leader唯一owner | 不运行应用数据；必要时 `.agent/tmp/task43-docs-<unique>/` |
| cosmos | 同上 | 待派发：Task owner（Leader） | 本Task README/walkthrough、派发登记与门禁汇总 | `.agent/tmp/task43-gates-<unique>/` |

## Gates / 命令与隔离

以下是实现阶段命令计划，不是运行证据；实际结果只追加到walkthrough。

| 时机 | 命令与要求 |
| --- | --- |
| 编码快测 | `bunx vitest run {文件或目录}`；失败修复只重跑同条，覆盖行为/副作用，不写源码字符串测试 |
| 类型 | 相关包 `bun run typecheck:contracts` / `typecheck:application` / `typecheck:storage` / `typecheck:transport`，再 `bun run typecheck`；Web按现有入口 |
| 数据库隔离 | `bun run db:validate`、`bun run db:generate`、`bun run db:migrate` 仅在后续明确隔离根与数据库URL后执行；validate也可能建库 |
| 完整门禁 | `bun run db:validate && bun run typecheck && bun run test && bun run lint:web && bun run build`；统一收尾一次，不每改几行空跑 |
| 重测 | `bun run test:acceptance`、`bun run test:e2e`、`bun run test:browser`、`bun run test:browser:component-lab`；按层报告，不能互相替代 |
| 文档 | `bun run docs:check`、`git diff --check`、`py -3 scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` |

用测试模板库/隔离SQLite，fresh与upgrade分开；COSMOS_DATA_ROOT/DATABASE_URL/Blob/Artifact/Cache/Secret/日志均指向登记的唯一临时根，动态端口，结束清理自己启动的进程。不得读取真实 `.cosmos`、模型凭证、账号或外网。需要保留失败证据时脱敏，只留登记隔离根。禁止修改锁文件、node_modules、dist、.next和生成物。运行规模、失败、跳过与未运行项不放README，统一记录walkthrough。

## Decisions / Deviations / Follow-ups

- 全部产品与技术取舍以accepted文档为准；不可行先停回Leader，不自行扩大runtime或降级跨事务。
- runtime retry fence疑点后续修复，本期不依赖自动重试保证成功；失败调用费用不可见必须如实显示为未知，不伪称未收费。
- 旧Story Agent默认模型解析后仍传原请求值的疑点从代码推断、未验证，不顺带修旧链路。
- Kernel值阈值未验证；精简冻结快照须实测，不用Worker Admin maxInlineValueBytes代替执行门禁。
- 文件包/Workspace/HTML、编辑/批注/导出/定时刷新等按Proposal后置；后续另行评审。
- 文档影响结论：**需更新**。本轮只建立接受/实施入口；slice4按真实实现更新PRD/架构/API/spec/PROJECT-STATUS，不宣称功能已交付。
