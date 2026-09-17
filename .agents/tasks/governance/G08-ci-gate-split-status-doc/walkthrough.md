# G08 walkthrough：CI 门禁分区 + 状态文档减负

基线：`origin/master` = `aab0748`。分支：`chore/g08-ci-gate-split-status-doc`，worktree `.worktree/g08-ci-gate-split-status-doc`（未装 `node_modules`，本任务的验证命令都不需要依赖）。

## 切片 1：CI 门禁分区

### 本轮假设与预期

- 假设（仍有后果）：现有遮蔽的**唯一**成因是 job 内的步骤顺序与 job 依赖，不是 GitHub 侧规则；因此把文档步骤移出 `quality` 即可解除遮蔽。
- 预期（改前即为红）：改前若文档门禁失败，`quality` 停止 → 三个 `needs: quality` 的 E2E job 与 `quality` 里的代码步骤全部不执行。这条不用制造事故来证明：2026-09-15 的体积门禁与 2026-09-17 的 `db:validate` 两次事故就是同一路径。
- 预期（改后）：文档门禁失败时，`Docs` job 红，而 `Quality` 与三个 E2E 照常执行。

### 基线门禁（worktree 内，改动前）

| 命令 | 结果 |
| --- | --- |
| `bun run docs:check` | 656 文件 0 失败（**无 `node_modules`**，证明文档门禁不依赖依赖安装） |
| `python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` | PASS（243 文件、基线 11 条、豁免 1 条） |
| `python scripts/size-governance.py -c code tests --check --baseline docs/doc-governance/code-baseline.json --fail-on-new` | **FAIL（2 项既有违规，与本任务无关）**：`e2e/browser/phase2-organization.spec.ts`（32.64 KB / 约 9.0k token）与 `apps/web/src/component-lab/product-fixtures.tsx`（31.17 KB / 约 8.2k token）越警戒区未登记。该门禁不在 CI 中 |
