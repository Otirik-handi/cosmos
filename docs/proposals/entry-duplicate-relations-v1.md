# Proposal：Entry 跨来源重复/转载关系 v1（duplicate_of / syndicated_from / near_duplicate_of）

> 状态：**accepted**（2026-09-16，用户接受六项默认建议并裁定四项开放项）
>
> 日期：2026-09-16
>
> 需求真相源：[`../requirements/0002-product-requirements.md`](../requirements/0002-product-requirements.md) ING-006（Phase 2）：「跨来源重复、转载和同事件报道要建立关系，不粗暴合并来源身份」，验收「官方公告与转载仍是两个 Entry，可以标记重复或归入同一 Story」
>
> 关联：稳定决定见 ADR [`0022`](../adr/0022-entry-duplicate-relations-v1.md)；信息模型 [`../architecture/0002-information-model.md`](../architecture/0002-information-model.md) §4.1/§4.2/§9（§4.2 已冻结三个关系词与候选信号）、总体架构 [`../architecture/0001-cosmos-foundation.md`](../architecture/0001-cosmos-foundation.md) §5；ADR [`0008`](../adr/0008-entity-relation-v1.md)（类型化关系 + 依据形态）、[`0011`](../adr/0011-entry-story-evidence-v1.md)（一关系一语义、自关联拒绝）、[`0006`](../adr/0006-story-domain-v1.md)（主归属单外键）

## 一句话

同一篇稿子出现在好几个来源时，你能**标记它们之间的关系**（重复 / 转载 / 近似），而**不是把它们合成一条**。

## 为什么需要它（举例）

同一篇发布会稿件，三个来源：

```text
阿里官网    《Qwen 3.8 Max 正式发布》                  ← 原发
某门户      《阿里发布 Qwen 3.8 Max，对标 GPT-5》        ← 基本照搬，加了导语
某公众号    《Qwen 3.8 Max 发布，我整理了 10 个要点》     ← 摘编改写
```

现在这三条在系统里是**三条毫无关系的记录**。于是：

1. **要读三遍才知道是同一件事**——三条内容九成重合，系统不会告诉你。
2. **传播路径丢了**——谁先发、谁转载、谁只是改写蹭热度，查不出来。而这恰恰是有用的信号：官方原发、门户转载、公众号「独家解读」，可信度和信息量完全不同。
3. **两个不同的概念被混成一件：**
   - 「**这是同一件事**」——官方公告、测评视频、网友讨论属于同一件事 → Story 管这个；
   - 「**这是同一篇稿子**」——原文、转载、改写属于同一篇内容 → **没人管**。
     同一篇稿子必然属于同一件事，但同一件事里有很多**不同**的稿子。现在只有前者。
4. **将来 Agent 无处下笔**——Phase 3 即使算出「这两条是同一篇稿子」，也没有地方写这个判断，只能再设计一遍。

需求本身拆成两半，现状是「一半做了一半没做」：

| 需求里的说法 | 现状 |
| --- | --- |
| 「……或归入同一 Story」 | **已有**：人工归并、移入 |
| 「可以标记重复」 | **完全没有**：不存在「条目 A 是条目 B 的转载/重复」这种关系 |

## 目标

1. 条目之间能标记三种关系：**完全重复**、**转载**（有方向）、**近似重复**（摘编/改写/翻译）。
2. 关系**两侧都能看到**，并且能分辨方向（谁转载谁）。
3. 标记**只做标记**：不合并条目、不删内容、不改 Feed 顺序、不改搜索结果、不改 Story 归属。
4. 为 Phase 3 的自动判定预留好位置（字段齐备，将来不用迁移）。

## 非目标

- 自动判断相似度 / LLM 判定（属 ORG-021）。
- 合并条目、自动隐藏重复、Feed 去重（属 Phase 4 推荐体系；与「不合并来源身份」冲突）。
- 传播路径可视化（A 转 B、B 转 C 的多跳链条）；v1 只做单跳关系。
- Story 之间的「同一事件」提示（人工归并 + 引用关系已覆盖，再加会与 Phase 3 自动聚类重复）。
- 正文片段字符级锚点、Artifact/Workspace 目标、多用户权限、embedding。
- Phase 1 后置债：Docker/Compose、发布部署、真实公网长时定时、非 Windows smoke、长时故障恢复。

## 方案（大白话）

### 1. 三种关系，用架构文档早就冻结好的词

| 关系 | 什么情况 | 有没有方向 |
| --- | --- | --- |
| `duplicate_of` | 原样照搬（完全重复） | 无方向（互相） |
| `syndicated_from` | 转载：后发的抄先发的 | **有方向**：转载方 → 原发方 |
| `near_duplicate_of` | 近似：摘编、改写、翻译 | 无方向（互相） |

### 2. 标记之后长什么样

```text
阿里官网（原发）
   ↑ 转载自
某门户
   ↑ 近似重复
某公众号
```

两边都看得到：门户那边显示「转载自 阿里官网」，官网那边显示「被某门户转载」。

### 3. 行为规则

- **一对条目只保留一个关系**：改类型就是替换，不会同时挂着「重复」和「近重复」（避免界面上两个标签互相打架）。
- **不能标自己**。
- 反过来重复提交（先说「A 转载自 B」，又说「B 转载自 A」）会被拒绝——它俩本来就是同一对。

### 4. 它只是一张标签，不改别的东西

不改 Feed 顺序、不改搜索结果、不删内容、不合并条目、不改 Story 归属；也不做「自动隐藏重复」。理由是 Feed 去重和排序属于 Phase 4 推荐体系，现在耦合会同时冻结两边的设计。

### 5. 为什么 v1 要人工标、不自动判

「两条不同来源的内容是不是同一篇稿子」需要判断（标题规范化、正文指纹、相似度计算），这套属于 Phase 3 的 Agent 活。v1 先让你手动标——反正现在你读到重复内容时，除了记忆没别的办法。

### 6. 界面上

- 条目详情能看到它的重复/转载关系，可以标记与解除；
- Story 详情里，成员那一行标注「转载自 / 重复于」（只显示对端条目和来源，不带对端 Story 链接，避免详情页为标注多取一次数据）。

## 已裁定的决定

| # | 决定 | 说明 |
| --- | --- | --- |
| 1 | 关系族只用信息模型 §4.2 已冻结的三个词 | 不发明新词；翻译暂用「近似重复」 |
| 2 | `syndicated_from` 有向，另两个对称 | 对称的按条目 id 排序存储，读取时双向可见 |
| 3 | 一对条目只保留一个当前语义 | 改类型 = 覆盖写，命令可重复提交 |
| 4 | 关系挂**条目内容身份**，与 Story 归属解耦 | Story 合并/拆分时不动它；条目删除时跟着删 |
| 5 | 只人工写入 | 自动判定留给 ORG-021；字段形态与既有关系表一致，将来不用迁移 |
| 6 | v1 只标记与展示 | 不参与 Feed 排序、搜索、去重，不折叠来源身份 |
| 7 | 不做跨 Story 的「同一事件提示」 | 2026-09-16 裁定：已由人工归并与引用关系覆盖 |
| 8 | 成员行标注不带对端 Story 链接 | 2026-09-16 裁定：避免额外取数 |
| 9 | 三种关系够用，不加「翻译」等新类型 | 2026-09-16 裁定：需要时再按 Revisit Gate 加 |
| 10 | 关系数量不设硬上限，界面折叠显示 | 2026-09-16 裁定 |

## 实现细节（附录，给实现者）

### 表、字段与校验

- 新表 `EntryRelation`：`fromEntryId`、`toEntryId`、`relationType`、`producer`（v1 固定 `human`）、`producerVersion`、`confidence`（缺省 1.0）、`evidence`、`actorJson`、`reason`、`createdAt`、`updatedAt`；唯一键 `(fromEntryId, toEntryId)`；两个外键 `onDelete: Cascade`；`Entry` 加两条反向关系字段。全新表、migration forward-only、无 backfill。
- 方向归一化：对称类型按 `fromEntryId`/`toEntryId` 的字典序存放；`syndicated_from` 按语义方向存放。反向重复提交与自关联均返回 409。
- domain 增受管枚举 `entryRelationTypes = ["duplicate_of", "syndicated_from", "near_duplicate_of"]` + 未知值降级读取（沿用既有枚举模式）。

### 公开边界

- 写命令：`POST /api/v1/entry-relations`（两个条目 id + 类型 + 可选 `confidence`/`evidence`/`actor`/`reason`，覆盖写幂等）与 `POST /api/v1/entry-relations/removals`，沿用 `entry-story-links` 的端点形态。
- 读取：`EntryDetail` 增关系数组（类型、方向说明、对端条目 id/标题/来源、provenance）；Story 详情的成员行增标注字段。均为向后兼容新增。
- 校验：两个条目都必须存在；自关联与反向重复 → 409；`relationType` 写侧受管、读侧放宽。

### 一致性

- `mergeStories`/`splitStory` **不涉及本表**（关系挂条目身份）——这一条必须有行为测试保护，避免后续切片顺手把它塞进 merge 事务。
- 条目删除级联删除关系；Story 详情读取的标注在条目被删后自然消失。

### 受影响合同与预计核心文件

- Prisma（`schema.prisma` + migration）、domain（`packages/domain/src/index.ts`）、contracts（新枚举/命令/`EntryDetail` 字段）、storage（新表写入 + 两个读取投影）、api（`apps/api/src/app.controller/`）、transport（`packages/transport-http/src/`）、web（Story 面板成员行 + 条目关系入口）。
- 按「域 + 持久化 → 合同 + API → Web」三步走，每步可独立合入。

### 验证层级（验收草案）

- **domain focused**：枚举校验与未知值降级；对称类型的归一化顺序稳定性。
- **storage/迁移**：fresh + 隔离库 upgrade 两态；同一对重复提交幂等；反向重复提交 409；自关联 409；条目删除后关系消失；**`mergeStories`/`splitStory` 后关系保持不变**（回归断言）。
- **API 集成**：命令校验、错误映射（400/404/409）、`EntryDetail` 投影含方向与对端摘要。
- **浏览器**：标记一条转载 → 两侧详情都能看到关系与方向；Story 面板成员行出现「转载自」标注；解除后消失；标记后 **Feed 顺序与搜索结果不变**。
- **明确不运行**：Docker/Compose、发布部署、真实公网长时定时、非 Windows 平台 smoke、长时间故障恢复。

## 对稳定文档的预期改动（已执行）

- `docs/adr/0022-entry-duplicate-relations-v1.md`（新增）；`docs/adr/README.md` 索引加 0022。
- `docs/requirements/0002-product-requirements/part-07-1.md`：§7.4 增加本切片注记。
- `docs/architecture/0002-information-model/part-02-04.md` §4.2：增加 v1 实现边界注记。
- **新建 Task（编号待维护者分配）**记录实施切片。
- `docs/spec/`：**行为落地后**再按实现同步（domain/0001、contracts/0001、storage/0001、interfaces/0002 与 0005）。

## 决策记录

| 日期 | 决策 | 决策者 |
| --- | --- | --- |
| 2026-09-16 | Phase 2 尾巴第二切片选定为 ING-006 的跨来源重复/转载关系；与 ORG-017 分成两份 Proposal；Task 需新编号 | 用户 |
| 2026-09-16 | **接受六项默认建议**：① 只用信息模型已冻结的三个关系词；② `syndicated_from` 有向、另两个对称并按 id 归一化；③ 一对条目一个当前语义（改类型=覆盖写）；④ 关系挂条目内容身份、Story merge/split 不迁移；⑤ 只人工写入；⑥ v1 只标记与展示，不参与排序与去重 | 用户（评审接受） |
| 2026-09-16 | **裁定四项开放项**：不做跨 Story 的「同一事件提示」；成员行标注不带对端 Story 链接；三种关系够用（翻译暂用近重复）；关系数量不设硬上限、界面折叠 | 用户 |
