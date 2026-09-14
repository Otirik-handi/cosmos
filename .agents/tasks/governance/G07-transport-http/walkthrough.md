# G07 过程记录（append-only）

本文件是 G07 的过程、偏差与验证的唯一记录位置；README 只维护当前摘要、范围、门禁与下一步。追加规则与文档大小治理见根 `AGENTS.md`。

## 2026-09-14 立项

### 指令

维护者 2026-09-14：G06 收尾完成后开 G07，治理 `packages/transport-http/src/index.ts`；其余非红线文件暂不处理，等未来触碰红线再治理。

### 摸底

- 对象是**纯单体**：`src/` 下仅 `index.ts`（1269 行 / 42,368 B）与 `index.test.ts`（964 行 / 39,598 B），**0 处 `export *`**，解析后**仅 4 个导出**（`bun run scripts/entry-export-surface.ts packages/transport-http/src/index.ts`）。
- 因此提案固定顺序里的「桶文件模块地图化」不适用，跳过；实际执行「测试按行为拆 → 单体按聚合拆」。
- 两个文件都超红线，但**都是「行数越界、字节未越界」**：41.4 KB / 38.7 KB 均在 50 KB 之下——这正是当前门禁的盲区（见下）。

### 本轮核实到的口径问题（影响本项目全部后续选型）

G06 汇报里的「代码红线文件 3 → 0」只对**字节/token 门禁**成立。按提案 §4.1 的完整红线（源码/测试 **>800 行** 或 >50 KB 或 >15k token），仓库仍有 **10 个文件超红线**，全部为行数越界：`transport-http/index.ts`(1269)、`application/workflow-host-runtime.ts`(1205)、`worker-admin/index.ts`(1047)、`transport-http/index.test.ts`(964)、`application/media-acquisition.ts`(918)、`storage-prisma/workflow-backend.ts`(896)、`worker/workflow-ingest.test.ts`(864)、`plugins/collectors/index.ts`(818)、`component-lab/product-fixtures.tsx`(807)、`cosmos/board-view.tsx`(805)。根因是 `scripts/size-governance.py --check` 只判字节/token，行数不拦（该缺口治理索引早有记载）。维护者 2026-09-14 的指令按「红线才做」给出，因此在开工前需确认：**G07 只做维护者点名的 transport-http，其余 9 个待后续裁定**。

### 未做

worktree/分支创建（待维护者审批）；全部验证命令（尚无代码改动）。
