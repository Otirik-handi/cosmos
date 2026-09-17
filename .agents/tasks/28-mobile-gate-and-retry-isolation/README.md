# Task 28：移动端门禁后置 + 浏览器重试幂等

## User Request / Topic

2026-09-17 维护者裁定：**产品当前不做移动端适配，优先开发 PC 端；移动端等 PC 端做好后再适配**。据此维护者批准本 Task（编号 28）与 worktree/分支 `test/t28-mobile-gate-and-retry-isolation`，做两件事：

1. 把 CI 里为「移动端 390px 页面级横向溢出」设置的门禁**暂停**（PC/平板宽度继续执行），并同步写着该口径的文档与不稳定用例登记表；
2. 修复浏览器套件**重试不幂等**造成的失败放大——它与移动端无关，是独立缺陷。

## Goal

- CI 不再为「产品当前不承诺的移动端宽度」变红，且该检查的意图与恢复条件不丢失；
- 浏览器用例第一次失败后，重试恢复「安全网」语义，不再被上一次尝试留下的数据二次击穿。

## Scope / Non-goals

Scope：

- 新增 `e2e/support/viewports.ts`：单一开关 + 暂停原因 + 恢复条件（写在注释里）。
- 三处 390px 检查：`e2e/browser/theme.spec.ts`、`e2e/component-lab/theme.spec.ts`、`e2e/browser/ingest.spec.ts`（第三处在一条长用例内部，无法用 `test.skip` 定点跳过）。
- `e2e/browser/ingest.spec.ts` 重试幂等：来源名唯一化 + 健康卡片按来源限定，照同目录既有约定（`media-policy.spec.ts:28` 的 `healthSection.locator("li").filter({ hasText: sourceName })`）。
- 文档同步：`docs/testing/README.md`（当前标准里的 390px 口径）、`PROJECT-STATUS.md`（当前运维边界）、`docs/testing/known-unstable-cases.md`（第 2/3 条改标暂停）、`docs/proposals/ui-surface-ownership-v1.md` 决策记录一行。

Non-goals：

- **不放宽阈值**（例如改 `<= 400`）、不把断言改宽松当修复、不以重跑结案——登记表明确禁止。
- 不删掉 390px 检查的意图：代码与理由保留，只由开关关闭。
- 不改产品代码、Prisma、公共接口；**不新增来源删除接口**（来源本就没有 DELETE，本任务复用既有命名约定）。
- 不动 `phase2-organization.spec.ts` 的间歇失败（另案；本轮隔离修复可能顺带缓解，但不作为验收）。
- 不处理 `e2e/**` 无 typecheck 覆盖的缺口（记入 Follow-ups）。

## 权威合同

- 维护者 2026-09-17 裁定「移动端适配后置」（本轮口头指示）；PRD/架构**没有**移动端承诺，故不改需求原文。
- [`docs/testing/README.md`](../../../docs/testing/README.md)：当前测试标准（含 390px 口径）。
- [`docs/testing/known-unstable-cases.md`](../../../docs/testing/known-unstable-cases.md)：登记规则（不以重跑结案、不把断言改宽松当修复）。
- 实现参照：`e2e/browser/media-policy.spec.ts`（唯一命名 + 按来源限定卡片的既有约定）。

## 实施切片

| # | 切片 | 可观察验收 | 状态 |
| --- | --- | --- | --- |
| 1 | 重试幂等（B） | 同一应用与数据根下连跑两遍 ingest spec：修前第二遍因重复来源报 strict mode violation；修后两遍都通过 | **达成**：修前 `1 failed / 1 passed`（`:49` strict mode，与 CI 同点）；修后 `2 passed (23.0s)`；完整 `test:browser` 与 `test:browser:component-lab` exit 0 |
| 2 | 移动端门禁暂停（A） | 390px 检查不再执行（两个循环只输出 768/1024/1440；ingest 的 390 段被开关关闭），PC/平板宽度仍执行；`docs/testing/README.md`、登记表与实现口径一致 | **达成**：`--list` 只剩 1440px（浏览器）与 768/1024/1440px（实验室）；四处文档已同步 |

## Current State

- 生命周期阶段：**两个切片均已完成**（2026-09-17）；待 commit / push / 合并（另行申请）与合并后 master CI 复核。
- 连贯目标：CI 不再为当前不承诺的移动端宽度变红；重试恢复「安全网」语义。
- 依赖：无（与 Task 26 无文件交叠；G08 已收口）。
- 受影响合同：浏览器套件验证宽度集合（390 暂停）、`ingest.spec.ts` 的来源命名与定位、测试标准里的宽度口径。
- 验证层级：本机 `--repeat-each=2` → 完整 `test:browser` + `test:browser:component-lab` → 合并后 master CI。

## Decisions and Deviations

- 走「唯一命名 + 限定作用域」而不是「测试前清理」：来源没有 DELETE 接口，而同目录 4 个 spec 已用该约定，复用既有模式比新增产品接口更小。
- 用单一开关（`MOBILE_WIDTH_VERIFIED`）而不是 `test.skip`：`ingest.spec.ts` 的 390 检查在长用例内部，`test.skip` 无法定点跳过；同一开关同时驱动两个宽度循环与这一段。
- 暂停 390px 属**产品范围决定**（维护者裁定），不是对 flaky 的妥协；登记表第 2/3 条因此标「暂停（产品决定），未修」，将来移动端开工要重新面对。

## Verification / Gate

过程、命令、实际结果与未运行项的唯一记录见 [`walkthrough.md`](walkthrough.md)。

## Follow-ups

- `e2e/**` 不被任何 tsconfig 覆盖（`bun run typecheck` 只跑 packages + apps），新模块 `e2e/support/viewports.ts` 只由运行时验证；与 `scripts/**` 同类缺口。
- 移动端适配开工时：把开关置回 true，并**先**给两处溢出断言补失败现场打印（最宽的溢出元素 + viewport/clientWidth/scrollWidth），见登记表第 2/3 条；否则恢复后仍会重现「只有两个数字、无法定位」的困境。
- `phase2-organization.spec.ts` 的间歇失败与 SQLite WAL/busy_timeout 仍待处理（登记表第 1 条）。
