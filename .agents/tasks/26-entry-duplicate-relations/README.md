# Task 26：Entry 跨来源重复/转载关系 v1（Phase 2 尾巴第二切片）

## User Request / Topic

2026-09-16 维护者接受 Proposal [`entry-duplicate-relations-v1`](../../../docs/proposals/entry-duplicate-relations-v1.md)（ING-006 的「标记重复/转载」半边）与 [ADR-0022](../../../docs/adr/0022-entry-duplicate-relations-v1.md)，并分配本 Task 编号 26、批准 worktree 与分支 `feat/t26-entry-duplicate-relations`。实施顺序排在 Task [`10`](../10-story-domain/README.md) 的「实施切片 4」（ORG-017 表示字段）之后——维护者 2026-09-16「按顺序来」。

## Goal

让同一篇稿件在不同来源之间的重复/转载关系有数据落点，且不合并来源身份：

```text
条目 ↔ 条目 -> (fromEntryId, toEntryId) 唯一 + 受管类型 duplicate_of / syndicated_from / near_duplicate_of + provenance
方向        -> 对称类型按 id 字典序归一化存储并双向读取；syndicated_from 有向（转载方 → 原发方）；反向与自关联 409
与 Story 解耦 -> mergeStories / splitStory 不迁移不修改；条目删除级联
读取投影    -> EntryDetail 关系列表（含方向说明与对端摘要）+ Story 成员行「转载自/重复于」标注
边界        -> 只人工写入；不参与 Feed 排序、搜索与去重；不做传播路径与跨 Story 同事件提示
```

「归入同一 Story」这半边继续由既有归并/引用关系承担，本 Task 不做。

## Scope / Non-goals

Scope：

- domain：受管枚举 `entryRelationTypes = ["duplicate_of", "syndicated_from", "near_duplicate_of"]` + 未知值降级；方向归一化规则。
- Prisma：新表 `EntryRelation`（`(fromEntryId, toEntryId)` 唯一 + `relationType` + provenance + 时间戳，双外键级联）+ migration（全新表、forward-only、无 backfill）；`Entry` 加反向关系字段。
- contracts：关系类型 schema、写命令 schema（`POST /api/v1/entry-relations`、`.../removals`）、`EntryDetail` 关系数组、Story 详情成员行标注字段。
- storage：link/unlink 幂等命令、两个读取投影；`mergeStories`/`splitStory` **不涉及本表**（需回归断言保护）。
- transport-http + API：两个端点与错误映射（400/404/409）。
- Web：条目关系入口 + Story 成员行标注；组件实验室登记。
- 文档：行为落地后同步 `docs/spec/`；PROJECT-STATUS 更新。

Non-goals（见 Proposal / ADR-0022）：

- 自动相似度判定与候选建议（ORG-021 / Knowledge Workflow）。
- Feed 去重、排序与「已隐藏重复」折叠（Phase 4 推荐体系）；不折叠来源身份。
- 传播路径可视化（多跳链条）、跨 Story 的「同一事件提示」。
- 新增关系类型（如「翻译」）；正文片段字符级锚点；Artifact/Workspace 目标；多用户权限；embedding。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke、长时故障恢复。

## 权威合同

- Proposal [`entry-duplicate-relations-v1`](../../../docs/proposals/entry-duplicate-relations-v1.md)（accepted，2026-09-16）。
- ADR [`0022`](../../../docs/adr/0022-entry-duplicate-relations-v1.md)；ADR [`0008`](../../../docs/adr/0008-entity-relation-v1.md)（类型化关系 + provenance 形态）、[`0011`](../../../docs/adr/0011-entry-story-evidence-v1.md)（一关系一语义、自关联拒绝）、[`0006`](../../../docs/adr/0006-story-domain-v1.md)（主归属单外键）。
- PRD [`0002`](../../../docs/requirements/0002-product-requirements.md) ING-006 与 §7.4 第二切片注记；信息模型 [`0002`](../../../docs/architecture/0002-information-model.md) §4.1/§4.2/§9。
- 现状 spec：domain/0001、contracts/0001、storage/0001、interfaces/0002 与 0005（Task 10–24 交付，本切片扩展）。

## 实施切片（capability map，无环依赖）

1. **切片 1：域语义 + 持久化**（domain + migration + storage，无公共面）
   - domain：受管关系枚举 + 未知降级 + 方向归一化；
   - Prisma：`EntryRelation` + migration；
   - storage 事务命令：link（存在性校验、自关联 409、反向重复 409、幂等覆盖写、领域事件）与 unlink；`EntryDetail`/Story 详情读取投影；回归断言确认 `mergeStories`/`splitStory` 不改动本表。
2. **切片 2：公共合同与 Product API**（contracts + transport-http + apps/api）
   - 关系类型与命令 schema、`EntryDetail` 关系数组与成员行标注字段；transport client；API 端点与错误映射。
3. **切片 3：Web + 组件实验室**
   - 条目关系入口（标记/改类型/解除，含方向说明）；Story 成员行「转载自/重复于」标注；组件实验室 fixture 与登记；浏览器 E2E（含「标记后 Feed 顺序与搜索结果不变」）。

## Current State

- 生命周期阶段：**三个切片均已实现并本地验证，等维护者手动点验与合并授权**（2026-09-17）。过程、偏差与完整验证记录见 [walkthrough.md](walkthrough.md)。
- 连贯目标：让两个不同来源的条目能表达「同一篇稿子的重复/转载/近似」关系，同时保留各自来源身份，且不改变既有排序与搜索行为。
- 可观察验收（≤3 条）：
  1. 标记一条转载后，两侧条目详情都能看到关系与方向（转载方 → 原发方），解除后消失；
  2. 同一对条目重复提交幂等；反向提交与自关联返回 409；
  3. `mergeStories`/`splitStory` 后关系保持不变；标记后 Feed 顺序与搜索结果不变。
- 实现事实：`EntryRelation` 表（`(fromEntryId, toEntryId)` 唯一 + 三个受管类型 + provenance，migration `20260916140000_entry_relation_v1`）；`linkEntryRelation`/`unlinkEntryRelation` 按**无序对**查找已有行（对称类型反向提交是覆盖写，有向方向相反才是 409）；`EntryDetail.relations` 同时承担条目详情与 Story 成员行标注；两个 API 端点与 transport 客户端。
- 依赖：Task 12（「当前关系 + provenance」形态参照）、Task 16（写路径/投影/错误映射形态参照）、Task 17（split 已存在 → 需要「不迁移」的回归断言）。
- 受影响合同：domain（新枚举）、Prisma（新表）、contracts（新 schema/命令/读取字段）、storage（写命令 + 投影 + merge/split 回归）、api（两个端点）、transport-http、web。
- 验证层级：focused（domain/contracts/storage）→ 隔离库 upgrade 两态 → API 集成 → 浏览器 → 全量门禁。

## Decisions and Deviations

- 关系合同放进既有 `packages/contracts/src/entry-relation.ts`（该文件已经是 Entry 相关合同的家），不新建文件。
- 方向归一化与「一对条目一个当前语义」按 ADR-0022 决定 2/3；`EntityRelation` 的 `(from, to, type)` 形态不照抄（ADR-0022 Alternatives 已记录拒绝理由）。
- 维护者 2026-09-17 开工前确认三处读法：**409 只覆盖有向类型的反向提交**（对称类型反向即覆盖写）、Web 入口放在 Story 面板来源成员行、worktree/分支/base 不变。
- 偏差（细节与理由见 walkthrough「偏差与实现取舍」）：合同改动跨了切片 1/2；成员行标注复用 `EntryDetail.relations` 不新增字段；写命令返回 `fromEntryId` 一侧；顺手清掉 `SourceMembersSection` 两个死 props；浏览器 spec 命名 `phase2-entry-relation.spec.ts`（必须排在 `ingest.spec.ts` 之后）。

## Verification / Gate

- 每切片按仓库验证层级：focused（domain/contracts/storage）→ 隔离库 upgrade 两态 → API 集成 → 浏览器；全量门禁至少 typecheck、docs:check、test、build、git diff --check。
- 迁移类改动在隔离库跑了 fresh + 旧库 upgrade 两态（本切片为全新表，仍跑两态）。
- 已通过（2026-09-17，worktree 内）：`bun run typecheck` exit 0；`bun run test` **99 文件 / 599 用例全绿**；`bun run build` 通过；`bun run lint:web` 0 error / 81 warning（改动前 83）；组件实验室 **15/15**；新浏览器用例单跑 **1 passed**。
- **未通过 / 未运行**：整套浏览器套件含本切片时 4/4 出现 `phase2-organization.spec.ts` 的失败（移走本切片 spec 后 4 次里 3 次全绿，且一个只做既有行为的诊断 spec 同样能触发）——失败归属与放行判断待维护者裁定，证据见 walkthrough。未运行：Node 进程 E2E、`test:property`、Docker/Compose、Windows Node smoke、真实公网来源验收。

## Follow-ups

- 自动判定（ORG-021）落地时，需要定义自动关系的 actor/接受边界与「人工修正不被重分析覆盖」，并复用本表的 provenance 字段（无需迁移）。
- Feed 去重与 Phase 4 推荐若需要消费重复关系，按 ADR-0022 Revisit Gate 重新评估。
- 传播路径可视化、新关系类型（翻译）、正文片段锚点，均按 Revisit Gate 评估。
- `apps/web/src/components/cosmos/story-panel.tsx` 改动前已 824 行（超 800 行红线），本切片又加约 12 行；拆出成员行/操作区需要一次行为等价重构，独立处理。
- `e2e/browser/ingest.spec.ts` 是「空信息库上的第一次录入」写法（取 Feed 第一张卡片与 `items[0]` 当自己的内容），因此浏览器 spec 的排序是隐性契约；把它改成按来源限定可在独立任务里做。
- `docs/testing/known-unstable-cases.md` 第 1 条新增了 2026-09-17 的观察，其中「搜索提示语说 0 条、列表仍留上一次内容」这一条**机制未查清**，不排除应用存在搜索状态不一致，按独立 Bug 诊断。
