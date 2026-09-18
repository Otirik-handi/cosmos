# Task 31 walkthrough（过程、偏差与验证）

> 本文件是 Task 31 的唯一过程记录（append-only）；README 只保留摘要、范围与下一步。

## 切片 1：公开 Asset 投影剥离内部 Blob key

### 本轮假设与边界

- 权威合同已存在：[`docs/spec/storage/0001-prisma-repository.md`](../../../docs/spec/storage/0001-prisma-repository.md) 写明「仓储内部的 Asset snapshot 可能携带 storageKey，Product API 的公开投影另行剥离」，[`docs/spec/README.md`](../../../docs/spec/README.md) §1.4/§4.1 把「公开投影不得含 `storageKey`」登记为**未满足**的安全验收项。
- 归类：按[准入决策表](../../../docs/standards/repository-workflow.md#准入决策表)第 25 行（违反当前安全合同）——恢复既有合同不需要 Proposal、**不开公开 Issue**、记录只写脱敏结论（不写 key 形态与可利用细节）。维护者 2026-09-18 裁定。
- 范围冻结为「Product API 边界白名单」，不改 `assetSnapshotSchema`（仓储内部投影、`readAsset`、媒体重试与保留期清理仍依赖该字段）。

### RED（先证明缺陷存在）

新增 [`apps/api/src/app.controller.public-projection.test.ts`](../../../apps/api/src/app.controller.public-projection.test.ts)：用一个刻意带内部 Blob key 的 mock 仓储投影喂给六条公开读路由（`GET /feed`、`/search`、`/entries`、`/stories/:id`、`/entries/:id`、`/revisions/:id`），断言**整份响应 JSON** 不含该字段名，并额外断言公开字段仍完整。

```text
bunx vitest run apps/api   # 修复前
Test Files  1 failed | 10 passed (11)
     Tests  7 failed | 71 passed (78)
```

失败形态：`GET /feed` 的资产对象多了 `"storageKey": "sha256/…"`（其余五条路由同样命中），另有一条公开字段完整性用例失败。

### GREEN（实现）

- 新增 [`apps/api/src/app.controller/public-projection.ts`](../../../apps/api/src/app.controller/public-projection.ts)：`toPublicAsset` **逐个挑字段**（而不是删字段，`AssetSnapshot` 以后新增内部字段默认不外发），再由 `toPublicPage`（feed/search/entries）与 `toPublicEntryDetail`/`toPublicRevisionDetail`/`toPublicStoryDetail` 覆盖六条路由的嵌套位置（Story 的单个主成员 `entry` 与成员列表 `entries` 都覆盖，历史壳允许主成员为空）。
- [`apps/api/src/app.controller/content.ts`](../../../apps/api/src/app.controller/content.ts)：六条读路由接上对应投影函数。

```text
bunx vitest run apps/api   # 修复后
Test Files  11 passed (11)
     Tests  78 passed (78)
```

### 偏差 1（超出原批准范围，已解决）：客户端用同一份 schema 校验响应

原计划「只动 API 边界、不动 contracts」。实现中发现客户端也解析同一份 schema（`packages/transport-http/src/client-base.ts` 用 `options.schema.parse(body)`，`client-content.ts` 对 feed/search/entries 传 `feedPageSchema` 等），而 `assetSnapshotSchema.storageKey` 是**必填**（`z.string().nullable()`）——只改 API 会让客户端解析直接失败。

因此追加了一步：contracts 新增 `publicAssetSnapshotSchema`（由 `assetSnapshotSchema` 省略 `storageKey`），公开读 DTO（FeedItem / SearchResult / EntryListItem / EntryRevisionSnapshot）改用它；`assetSnapshotSchema` 本体不变。新增导出按 [`packages/contracts/MODULE.md`](../../../packages/contracts/MODULE.md) 的规则用 `bun run scripts/entry-export-surface.ts packages/contracts/src/index.ts --out packages/contracts/entry-surface.txt` 重新生成，快照恰好 +2 行（`value publicAssetSnapshotSchema` / `type PublicAssetSnapshot`）。

### 偏差 2（过程顺序）：RED 早于 API Draft 更新

[`docs/standards/repository-workflow.md`](../../../docs/standards/repository-workflow.md) 第 2 阶段要求「新增或改变公共 API/DTO 时，在 RED 前先更新 [`docs/api/`](../../../docs/api/) Draft」。本轮先写 RED 才回头更新 Draft 记录（[`docs/api/0007-review-findings.md`](../../../docs/api/0007-review-findings.md) §5 第 1 条的解决注记）。原因是 Draft 里并没有 Asset DTO 字段清单，缺口只登记在那条 finding 里；记录在此，后续同类推改动按顺序执行。

### 首轮门禁暴露的连带修改

首次 `bun run typecheck` / `bun run build` 失败在三处，都是公开形状变化的下游：

1. `apps/worker/src/workflow-ingest.test.ts` 直接用 `asset.storageKey` 判断 Blob 是否落盘——该断言与紧随其后的 `repository.readAsset()` 断言**完全等价**（`readAsset` 在 key 为空时返回 null），删除后用读取行为判定，测试反而不再依赖内部字段。
2. `apps/web/.../revision-assets.tsx` 与 `labels.ts` 的 props/索引类型从 `AssetSnapshot` 改为 `PublicAssetSnapshot`（公开面形状）。
3. `apps/web/.../story-panel.tsx` 里已无用的 `AssetSnapshot` 导入删除。

### 首轮门禁的另一处假失败（环境，非缺陷）

第一次全量 `bun run test` 出现 3 个 `packages/storage-prisma/src/prisma-cli.test.ts` 失败。原因不是代码：该用例用 `mkdtempSync(join(tmpdir(), …))` 造伪工作区，而本轮为了让 `bun install` 在受限沙箱里能写临时文件，把 `TEMP`/`TMP` 指到了 `<worktree>/node_modules/.bun-tmp`——伪工作区因此落在仓库内部，`resolvePrismaCliPath` 向上找到了真实的 Prisma CLI、不再抛错。沙箱放开后不重定向 `TEMP` 重跑，该文件全绿。

## 切片 2：文档口径校准（无行为变化）

| # | 位置 | 更正 |
|---|---|---|
| 1 | `PROJECT-STATUS.md` 首行快照 | 基线 `c308733` → `da7d656`；`.worktree/` 残留描述改为「当前为空、除 master 无任务分支」；补记 Task 31 未合并 |
| 2 | 同一文件头 | 更新日期 2026-09-17 → 2026-09-18（正文本来就含 2026-09-18 证据） |
| 3 | `PROJECT-STATUS.md` + PRD 勘误表 | BRD-006 由「未交付」改为「部分交付：Feed Block 绑定 Saved View 已落地，缺排序/推荐策略绑定」 |
| 4 | `PROJECT-STATUS.md`「尚未实现」 | 去重/Story 归并/Topic 成员/分类/关系/看板已交付，从清单移除并改写成推荐系统、看板交付边界与真实认证 Adapter 的剩余部分 |
| 5 | `docs/spec/README.md` §4 | migration 顺序补齐 5 个已应用条目（`media_retry_retention_v1` … `entry_relation_v1`） |
| 6 | Task 15 Follow-ups | ORG-017「时间范围未落地」与「Feed Block 绑定待后续切片」两句更正为已完成 |
| 7 | Task 14 README | `feed` 的 `savedViewId`「必填」改为「可选」，与代码和 walkthrough 一致 |

### 切片 2 的过程偏差：PROJECT-STATUS 首次改动把文件推进了尺寸警戒区

首版改动让 `PROJECT-STATUS.md` 从 26.8 KB 涨到 30.2 KB，触发 `docs/size-governance.py --check` 的「新增警戒区文件」（token 双轨，>9k token）。这个文档已经在预算边缘，靠加字解决不是出路：改成把过程细节留在本 Task、状态文档只保留事实与指针，并把同节里已被 `known-unstable-cases.md` 承接的浏览器不稳定叙述压成一句；最终 28.0 KB（净增 1.2 KB），门禁 PASS。**遗留提醒**：`PROJECT-STATUS.md` 已贴近 9k token 上限，下一次需要登记新状态时，先考虑把「后置决定」或「当前架构基线」整段移入分册，而不是继续加行。

## 验证

2026-09-18 在 worktree `.worktree/t31-public-asset-projection` 内实际运行（基线 `da7d656`）：

| 命令 | 结果 |
|---|---|
| `bun run typecheck` | 0 |
| `bun run test` | **100 文件 / 606 用例全绿**（新增 1 个文件、7 个用例） |
| `bunx vitest run apps/api` | 11 文件 / 78 用例全绿 |
| `bunx vitest run apps/worker` | 6 文件 / 31 用例全绿 |
| `bun run build` | 通过（API + Worker + Next standalone 三段） |
| `bun run lint:web` | 0 error / 81 warning（全部为既有 warning） |
| `bun run docs:check` | **682 文件 0 失败** |
| `python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` | PASS（另有 2 条基线内文件增长 warning，均非本 Task 改动文件） |
| `git diff --check` | 干净 |
| `bun run test:browser` | 同一 build 连跑 2 次：第 1 轮 **22 passed**（1.2 分钟）；第 2 轮 **21 passed / 1 failed** 在 `phase2-organization.spec.ts:186`（拆分场景），同 build 单跑该用例 **1 passed (3.2s)**——与 [`known-unstable-cases.md`](../../../docs/testing/known-unstable-cases.md) 第 1 条登记的「失败点在用例间漂移、单跑即过」一致，本轮证据已补进该表 |
| `bun run test:browser:component-lab` | 首轮 13 passed / 1 failed（`source-form.spec.ts:67`），单文件复跑 6 passed、整套复跑 **14 passed**；已按仓库规则登记为 [`known-unstable-cases.md`](../../../docs/testing/known-unstable-cases.md) 第 5 条 |
| `bun run db:validate` | Prisma schema is valid |

浏览器产品套件整套通过这一点对本切片尤其重要：客户端与 API 共用公开读 DTO 的 schema，若剥离字段会让 Web 解析失败，整套会自动暴露。

未运行：`bun run test:property`、`bun run test:e2e`（Node 进程 E2E）、Windows Node smoke、Docker/Compose、真实来源联网验收、发布部署——由远端 CI 覆盖或属既有后置边界，本 Task 不在本机复跑。390px 横向溢出断言按维护者 2026-09-17 决定暂停（与本次改动无关）。

## 完结（2026-09-18）

维护者同日逐文件审阅 diff 后回复「没问题」并授权「提交并直接合入 master」，本轮按该授权收尾：

- **提交与合并**：分支提交 `fa0e49e`（25 文件 / +512 −53）；`--no-ff` 合入 master = `3ded765`，合并提交的树与分支 tip 逐字节相同（`git diff` 为空，master 期间无新提交）。
- **合并结果上重跑全量门禁**（实际运行）：`bun run typecheck` 0、`bun run test` **100 文件 / 606 用例全绿**、`bun run build` 通过、`bun run db:validate` 通过、`bun run lint:web` **0 error / 80 warning**（比改动前少 1 条，即被删掉的无用导入）、`bun run docs:check` **682 文件 0 失败**、size 门禁 PASS、`git diff --check` 干净、`bun run test:browser` **22 passed**、`bun run test:browser:component-lab` **14 passed**。
- **清理**：`.worktree/` 已为空（Git 注销后残留的空目录在确认路径内清除）；分支用 `git branch -d` 删除——初次被拒是因为 `worktree add -b` 自动挂了 `origin/master` 跟踪，不是未合并，整合关系先用祖先检查与空 diff 证明，再取消跟踪后非强制删除。
- **未推送**：`master` 领先 `origin/master` 两个提交（`3ded765`、`fa0e49e`）。推送需要单独授权，且本机 `schannel` 取不到凭证。
