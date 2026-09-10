---
parent: PROJECT-STATUS.md
range: 无日期 ~ (7 节)
sealed_at: 2026-09-11
tags: [project-status, history]
tokens_est: 2539
---

## Task 09 本地实现证据

- 登记门禁覆盖 `components/ui/*.tsx` 与 `components/cosmos/*.tsx`：8 + 5 个模块；registry 聚焦测试通过；
- `/dev/components` 开发路由、URL/history、props、Light/Dark、token 草稿/JSON 和五个产品 fixture 已实际浏览器验证；
- token 覆盖只在预览根节点，实验室无 Product API/SSE 请求；生产 Web 对 `/dev/components` 返回 HTTP 404；
- 既有 `bun run test:browser` ingest 流程通过：来源创建、录入、Feed、Story；
实现提交 `c130be8fba412dfdb1f5e2272ba3a579d30e63a8` 已 commit 并 push；分支已按用户授权合并（merge commit `b08f72d`），`master` 已按授权推送至远端（2026-08-23 首次推送 `1a258f0`），PR #10 已被 GitHub 标记为 MERGED；发布、部署未执行。

## 历史本地验证记录（2026-08-21）

```text
bun run docs:check
  passed；checkedFiles=283，failures=[]
bun run typecheck
  passed；packages 与 API/Worker/Web 全仓 TypeScript
bun run test
  passed；30 个测试文件 / 217 个测试
bun run test:property
  passed；3 个 property 文件 / 4 个测试
bun run lint:web
  passed
bun run build
  passed；packages、API、Worker 与 Next Web 生产构建完成
bun run test:browser
  passed；1 个 Playwright ingest 流程（来源创建、录入、Feed、Story）
bun run test:browser:component-lab
  passed；4 个开发态 Playwright 回归（SourceForm 双 props 同步、SourceForm 提交阻断、FeedBrowser 搜索提交阻断、token 无操作失焦保留）
bun run test -- apps/web/src/component-lab/draft.test.ts apps/web/src/component-lab/registry.test.ts apps/web/src/component-lab/snapshot.test.ts
  passed；3 个文件 / 24 个合同测试，覆盖 13 个公共模块登记、控件 schema、token 边界
git diff --check
  passed；无输出
```

门禁现在额外要求 canonical workflow 的准入表同时保留安全漏洞的私密路由和非安全局部 Bug 的公开 Issue 路由，并独立验证安全政策链接；反转表格语义会由文档行为测试拦截。`vitest.config.ts` 通过 `configDefaults.exclude` 保留 Vitest 默认排除项并追加 `**/*.property.test.ts`；`vitest.property.config.ts` 独立收集 `packages/**` 与 `apps/**` 下的 property 文件。原 CI 失败路径不再依赖预先存在的 `packages/worker-admin/dist/index.js`。

## 远端 CI 与治理边界

- 远端 `a3b962f` 的 CI run `32241661044` 仍为 failure：Linux clean install 后 `apps/worker/src/runtime.test.ts` 无法解析 `@cosmos/worker-admin`，后续 Node process E2E、Browser E2E 和 Windows Node smoke 因依赖 Quality 被跳过。
- 2026-08-20 通过 GitHub API 核验：`master` 没有 branch protection，仓库 rulesets 为空。用户选择本轮只修改仓库内流程；未创建或修改 branch protection/ruleset。
- 因此 `.github/workflows/ci.yml` 定义了检查内容，但当前远端没有强制这些检查阻止直接 push 或合并。是否改变远端治理需要单独决策。
- 治理提交已 commit、快进合并到本地 `master` 并清理对应任务 worktree；本轮流程演练优化没有 commit、push、PR、Issue 关闭、远端保护修改、发布或部署授权，这些操作均未执行。
组件实验室额外真实浏览器证据：开发路由 URL/history、props、Light/Dark、token 作用域/恢复/非法
导入、五个产品 fixture、P1 修复回归、320/768/1024/1440 视口和无 Product API/SSE 请求均通过；生产
`/dev/components` 通过 `curl` 返回 HTTP 404。测试数据使用隔离 `.agent/tmp`，本轮导入样本已清理。
工具链保留的 `vitest.config.ts` / `vitest.property.config.ts` 分层收集合同未改变。
修复后五轴审查结论：Correctness、Readability、Architecture、Security、Performance 均通过；SourceForm 与 FeedBrowser fixture 提交阻断均由专用浏览器回归覆盖；`fixturePath` 任意路径属于 HEAD 既有基线风险，未纳入本轮 patch findings。

## 历史 NeuroBook 主题系统切片（2026-08-22，本地）

已接受的 [`neurobook-theme-system`](docs/proposals/neurobook-theme-system.md) Proposal 在
`feat/t09-react-component-lab` worktree 以 Task 09 Slice 7 实施：全局 `neurobook` 主题 ×
`macos-light|macos-night` 配色、三态偏好（system/显式，持久化 key
`cosmos.theme.preference.v1`）、`<head>` 首帧引导脚本与 React Provider、首页与实验室
chrome 的三态切换器、实验室 URL preview 独立配色，以及 Button/Card/Input/Textarea/Badge
对主题 token 的消费迁移。治理侧同步：原始需求追加、BRD-010、架构 §3.8 两轴 token、
react-component-lab Proposal 反转决策行、Task 09 偏差与切片、Web spec“外观主题”章节、
testing README 回归边界。

本地门禁：`bun run test`（31 文件/224）、`test:property`（3/4）、`typecheck`、`lint:web`、
`build`、`test:browser`（8/8，含无存储系统明/暗两分支、storage 抛错与 matchMedia 抛错均
强制浅色回退、Night 持久化、390/1440 溢出）、`test:browser:component-lab`（12/12，含
390/768/1024/1440 溢出）、聚焦单元 34 测试、`docs:check`、`git diff --check` 全部通过；
生产 `/dev/components` 复验 HTTP 404。视觉验收
（1440/390 × 明/暗 × 首页/实验室）computed 背景前景逐项等于 macOS Light
`rgb(246,248,250)/rgb(17,24,39)` 与 Night `rgb(28,28,30)/rgb(250,250,250)`，hydration 过滤后
console/page error 为 0；截图存于被忽略的 `test-results/theme-visual/`。既有未提交 hydration
回归保留并通过。

历史记录：当时未运行 Node process E2E、Windows smoke、Docker、真实来源；发布与部署未执行。后续 Task 02 配置优先切片已补充本地 Node/Browser/Windows smoke 证据；`fixturePath` containment 仍是 Connector 内部遗留安全债务，未作为 Product API 输入。

## 远端 CI 与治理边界

- PR #10 的前一轮远端 run `32459370422`（head `7d8257b67f3c701f055cfd0b4c44f60ea7984fec`）曾失败：三个下游 job 在 `packages/storage-prisma` 构建链缺少生成后的 Prisma Client；该 run 仅作为历史失败证据保留。
- 当前分支已为每个隔离下游 job 在构建前加入 `bun run db:generate`，并为 Browser E2E job 增加 `bun run test:browser:component-lab`。已验证远端 CI run `32464307892` attempt 2（head `e3b75d132b086c57472035d0cd093a07594e05bc`）已 completed/success：Quality、Node process E2E、Browser E2E 和 Windows Node smoke 全部通过，且 Browser E2E 已执行专用 component-lab 门禁；attempt 1 曾因 5 个 Vitest 测试超出 5 秒超时而失败，重跑后通过。
- 远端 CI 检查通过后，用户已授权将分支合并进本地 `master`（已完成，merge commit `b08f72d`）并清理 worktree（已完成）。2026-08-23 用户进一步授权推送：`master` 快进推送至远端（`a3b962f..1a258f0`），GitHub 将 PR #10 自动标记为 MERGED（GitHub 记录的 merge commit 为分支头 `52a2535`）。2026-08-20 通过 GitHub API 核验：`master` 没有 branch protection，仓库 rulesets 为空；本轮未创建或修改远端治理。
- 分支实现、CI 修复和状态记录已 commit 并 push；本地合并、master 推送均已完成。发布和部署未执行。

## 历史 runtime 基线（实现基线 `3af886a`）

2026-08-18 已验证：数据库/类型、属性/单元、构建、4 个 Node process E2E、1 个 Playwright browser test 和 Windows smoke。该证据保留为历史基线；本轮 Task 02 的更新证据见文档顶部与 `.agents/tasks/02-rss-ingestion/README.md`。

## 历史 Task 09 流程演练未运行项

- Task 09 流程演练阶段未运行 Node process E2E、Playwright 浏览器、Windows smoke、Docker、真实 RSS/AI HOT/Bilibili、长时双 Worker 压力、真实 Agent、发布和部署；这些历史边界不代表当前 Task 02 验证状态。
- Docker、真实来源、生产部署、多主机、Gateway、Redis 和远程 Worker 仍不由当前默认门禁证明。
- 远端 CI run `32464307892` attempt 2 已 completed/success；该远端证据与当前工作树未提交状态分开记录。

