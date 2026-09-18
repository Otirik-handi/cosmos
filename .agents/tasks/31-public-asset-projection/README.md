# Task 31：公开 Asset 投影剥离内部 Blob key

## User Request / Topic

2026-09-18 维护者复核「Phase 1 和 Phase 2 还有哪些没做完」后，选定先清文档口径、并修掉唯一一处被文档明确判定为**验收失败**的项：`docs/spec/README.md` 写着「公开 Asset 投影不得含 `storageKey`」当前未满足。

## Goal

Product API 的六条公开读路由（feed、search、entries、story、entry、revision）不再返回内部 Blob key；客户端响应校验不再要求该字段；相关当前事实文档从「未满足」改成真正成立的表述。

## Scope

- 新增 `apps/api/src/app.controller/public-projection.ts`：`toPublicAsset` 逐个挑公开字段，外加分页（`toPublicPage`）与详情（`toPublicEntryDetail`/`toPublicRevisionDetail`/`toPublicStoryDetail`）投影；六条读路由接上。
- contracts 新增 `publicAssetSnapshotSchema`（由 `assetSnapshotSchema` 省略 `storageKey`）；公开读 DTO（FeedItem / SearchResult / EntryListItem / EntryRevisionSnapshot）改用它，因此客户端解析同一份 schema 不会因字段缺失失败；重新生成 `packages/contracts/entry-surface.txt`。
- 回归测试 `apps/api/src/app.controller.public-projection.test.ts`：逐路由断言整份响应 JSON 不含该字段名，并断言公开字段仍完整。
- 同批的文档口径校准：BRD-006 口径、`docs/spec/README.md` 的 migration 顺序、`PROJECT-STATUS.md` 的基线/未实现清单、Task 14/15 的过期结论。

## Non-goals

- 不改 `assetSnapshotSchema`：仓储内部投影继续携带 `storageKey`，`readAsset`、媒体重试与保留期清理依赖它（`docs/spec/storage/0001-prisma-repository.md` 已把「公开投影另行剥离」写成该组件的承诺）。
- 不对 Source passthrough config、Job arbitrary result 做白名单收敛（仍按 [`docs/api/0007-review-findings.md`](../../../docs/api/0007-review-findings.md) §5 第 1 条保留）。
- 不创建公开 Issue、不记录可利用细节：按[准入决策表](../../../docs/standards/repository-workflow.md#准入决策表)第 25 行与 [`SECURITY.md`](../../../.github/SECURITY.md)，这条按「违反当前安全合同」处理，记录只写脱敏结论。

## 权威合同

- [`docs/spec/storage/0001-prisma-repository.md`](../../../docs/spec/storage/0001-prisma-repository.md)：仓储内部 Asset snapshot 可携带 storageKey，Product API 的公开投影另行剥离。
- [`docs/spec/README.md`](../../../docs/spec/README.md) §1.4 / §4 / §4.1、[`docs/spec/contracts/0001-public-contracts.md`](../../../docs/spec/contracts/0001-public-contracts.md)、[`docs/spec/interfaces/0002-product-api-http.md`](../../../docs/spec/interfaces/0002-product-api-http.md)。

## Current State

生命周期阶段：实现与门禁完成。分支 `fix/t31-public-asset-projection`，worktree `.worktree/t31-public-asset-projection`，基线 `da7d656`（= `origin/master`）。**未提交、未合并**，需维护者另行授权。

## 验证

完整命令、RED→GREEN 证据、未运行项与本轮偏差见 [`walkthrough.md`](walkthrough.md)。

## Follow-ups

- Source passthrough config 与 Job arbitrary result 的白名单收敛仍未做（API Draft finding §5 第 1 条的剩余部分）。
- 本分支的 commit / push / 合并 / worktree 清理均未执行，等维护者授权。
