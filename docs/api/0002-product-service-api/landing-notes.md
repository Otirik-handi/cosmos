---
parent: docs/api/0002-product-service-api.md
range: 落地注记（已实现范围与目标合同的差异）
sealed_at: —
tags: [api, dtos, reference]
tokens_est: 900
---

本册是 [`0002-product-service-api.md`](../0002-product-service-api.md) 的分册，保存**落地注记**：目标合同（Draft）与当前实现之间的差异说明。主文档保留目标形状与规则；本册按时间追加，不改写已封口的注记。

主文档已超文档健康区，因此落地注记一律写在本册，主文档只留一行指针。

## 2026-09-24 · Task 35 切片 3a：读取侧标题投影与跨目标批注

**背景**：话题页、Entity 页、整理页都要直接列出对象。只有内部 id 时界面只能显示裸 ID，而 UI 文案判据 R3（[`ui-copy-review-v1`](../../proposals/ui-copy-review-v1.md)）禁止要求用户认内部标识符。四处读取侧因此补了投影。

**共性约束**（四项都适用）：

- **只补读取侧，不改写入命令、不改持久化、不新增业务语义**；`*CommandSchema` 的 diff 为零。
- 标题按**批量查询**解析，不退化为逐条查询 N+1（做法与既有 `label(id)` 的 `assignedStories/Entries/Topics` 一致）。
- 新增字段一律**可选**，扩展前的 payload 仍能解析。
- 目标没有当前 Revision 或已被删除时，标题投影为 `null` 而不是抛错。

| # | 落点 | 扩展 |
| --- | --- | --- |
| 1 | `GET /topics/{id}` 的 `TopicDetail.members`（§8.2） | 每个成员补成员 Story 的当前标题 `title` |
| 2 | `GET /entities/{id}` 的 `EntityDetail.stories`（§8.3） | 每个关联补关联 Story 的当前标题 `title` |
| 3 | `GET /favorites`（§9） | 每一项补收藏对象的当前标题 `title`（Story 与 Entry 两条解析路径） |
| 4 | `GET /annotations`（§9） | **目标变为可选**：不给 `targetType`/`targetId` 表示「列出全部批注」；两者必须成对提供，只给一半在边界处报错。带目标时行为与扩展前完全一致（含目标别名解析） |

**为什么第 4 项要改语义而不是新开端点**：`GET /annotations` 的语义就是「查批注」，限定目标是它的一个可选维度而不是它的身份；新开一个「全部批注」端点会让同一资源出现两条读取路径，调用方要自己判断该用哪条。

**行为证据**：[`packages/storage-prisma/src/read-title-projection.test.ts`](../../../packages/storage-prisma/src/read-title-projection.test.ts) 锁定五项行为——三处标题解析、收藏目标消失时标题为 `null`、以及不带目标返回全部而带目标仍然过滤。
