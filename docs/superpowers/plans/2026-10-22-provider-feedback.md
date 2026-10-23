# 服务商写入反馈修复 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 让服务商创建/编辑结果在模型页按成功、待处理、失败和过期配置给出可见且安全的反馈。

**Architecture:** 复用现有 Toast API 和现有写入结果/错误码判定。纯模块负责把写入失败分类映射到固定原因文案键；服务商面板根据结果关闭或保留表单，并将错误留在对话框内。所有面向用户的文案集中在 models copy 中。

**Tech Stack:** Next.js 16.3.0 App Router、React 19、TypeScript、Vitest、项目现有 Toast 与 Cosmos transport。

---

## 执行前提交门禁（必须先完成）

- [ ] 检查 `git status --short` 和相关文件差异，辨明现有未提交改动；本仓库目前已有大量与本次无关的 Task 39/API/文档等改动，禁止将它们纳入本次提交。
- [ ] 为避免覆盖或混入并行改动，确认本次涉及的四个业务文件在开始实现前没有他人正在写入；若发现相关文件已包含未提交的他人改动，暂停并与维护者对齐，不重置、不 stash、不覆盖。
- [ ] 实施与验证完成后，仅暂存并提交本次修复的四个文件：`apps/web/src/components/cosmos/provider-model-draft.ts`、`apps/web/src/components/cosmos/provider-model-draft.test.ts`、`apps/web/src/copy/areas/models.ts`、`apps/web/src/components/cosmos/model-provider-panel.tsx`。提交前审阅 staged diff，确保不含任何无关文件；不提交设计/计划文档或既有 dirty 改动。
- [ ] 若这四个文件存在先前已由用户确认应提交的改动，先区分基线与本次补丁；无法安全拆分时停止，不做提交。

---

## 文件与职责

- Modify `apps/web/src/components/cosmos/provider-model-draft.ts`：增加纯函数，把 `WriteFailureNotice` 分类为可供 copy 文案查找的原因键；不读取服务端正文。
- Modify `apps/web/src/components/cosmos/provider-model-draft.test.ts`：覆盖所有失败通知到原因键的映射。
- Modify `apps/web/src/copy/areas/models.ts`：集中维护失败原因、失败说明及成功/待处理/过期说明文案。
- Modify `apps/web/src/components/cosmos/model-provider-panel.tsx`：成功/待处理使用 toast；错误内联在对话框；过期编辑关闭并刷新。
- 不改 `provider-models-section.tsx`、服务端契约、数据库或模型调用行为。

## Task 1: 建立失败原因映射的纯逻辑合同

**Files:**
- Modify: `apps/web/src/components/cosmos/provider-model-draft.test.ts`
- Modify: `apps/web/src/components/cosmos/provider-model-draft.ts`

- [ ] **Step 1: 先写映射测试**

新增导入 `writeFailureReason`，添加一个测试断言所有键映射：`versionConflict → versionConflict`、`credentialMissing → credentialMissing`、`operationInProgress → operationInProgress`、`cleanupPending → cleanupPending`、`credentialWriteFailed → credentialWriteFailed`、`notFound → notFound`、`payloadTooLarge → payloadTooLarge`、`unavailable → unavailable`。

```ts
it("为每类写入失败提供独立的固定原因文案键", () => {
    expect([
        writeFailureReason("versionConflict"),
        writeFailureReason("credentialMissing"),
        writeFailureReason("operationInProgress"),
        writeFailureReason("cleanupPending"),
        writeFailureReason("credentialWriteFailed"),
        writeFailureReason("notFound"),
        writeFailureReason("payloadTooLarge"),
        writeFailureReason("unavailable"),
    ]).toEqual([
        "versionConflict",
        "credentialMissing",
        "operationInProgress",
        "cleanupPending",
        "credentialWriteFailed",
        "notFound",
        "payloadTooLarge",
        "unavailable",
    ]);
});
```

- [ ] **Step 2: 运行目标测试确认 RED**

Run: `bunx vitest run apps/web/src/components/cosmos/provider-model-draft.test.ts`
Expected: 因 `writeFailureReason` 尚未导出而失败；若报错是别的原因，先排除测试调用/导入问题。

- [ ] **Step 3: 增加最小纯映射函数**

在 `WriteFailureNotice` 定义之后添加：

```ts
export type WriteFailureReason = WriteFailureNotice;

export function writeFailureReason(notice: WriteFailureNotice): WriteFailureReason {
    return notice;
}
```

此映射保持类型可扩展性，组件用它定位 copy 层的原因句；错误码与实际原因文案仍由 copy 显式配对。

- [ ] **Step 4: 运行目标测试确认 GREEN**

Run: `bunx vitest run apps/web/src/components/cosmos/provider-model-draft.test.ts`
Expected: 目标文件所有测试通过。

## Task 2: 集中补全原因文案

**Files:**
- Modify: `apps/web/src/copy/areas/models.ts`

- [ ] **Step 1: 为每个失败通知补一条原因句**

在 `models.notices` 中增加 `failureReasons`，使用可执行的恢复方向：

```ts
failureReasons: {
    versionConflict: "请以列表中的最新配置为准，重新打开后再提交。",
    credentialMissing: "请编辑服务商并填写 API Key 后重试。",
    operationInProgress: "请等待当前保存完成，再重新打开服务商检查结果。",
    cleanupPending: "请重新打开服务商并再次保存，以继续清理旧凭证。",
    credentialWriteFailed: "请检查本机凭证存储位置是否可写，再重试保存。",
    notFound: "请从刷新后的列表重新选择仍存在的服务商。",
    payloadTooLarge: "请缩短提交内容后重试。",
    unavailable: "请检查网络或服务状态，稍后再试。",
},
```

同时在 `models.notices` 增加说明提示 `staleProvider`（版本冲突/目标不存在后的刷新说明）和 `pending` 的信息 toast 文案；复用现有 `saved`、`stillPending` 时可不重复增加同义项。

- [ ] **Step 2: 检查文案结构和类型推导**

Run: `bun run --cwd apps/web tsc --noEmit`
Expected: 类型检查通过；若 `as const` 推导出额外约束，按 copy 结构调整，不添加类型断言绕过。

## Task 3: 让面板按结果正确反馈

**Files:**
- Modify: `apps/web/src/components/cosmos/model-provider-panel.tsx`

- [ ] **Step 1: 导入现有 toast 与纯原因映射**

从 `@/components/ui/toast` 导入 `useToast`，并在面板组件内调用。将失败主句和原因句分别由 `messages.models.notices` 映射得到，移除仅用于外部错误 notice 的重复 `failureText` 映射（若列表加载错误仍需文案，可继续使用局部映射）。

- [ ] **Step 2: 调整写入成功和待处理回执**

`outcome.kind === "saved"` 时执行 `closeEditor()`、`await loadProviders()`、`toast.success({ title: messages.models.notices.saved })`。`pending` 时同样关闭和刷新，但用 `toast.info({ title: messages.models.notices.stillPending })`；不得使用 success。

- [ ] **Step 3: 调整写入失败回执**

`outcome.kind === "failed"` 时保留 editor 与 values，设置表单级错误为 `outcome.notice`。catch 中非 stale 的 `CosmosTransportError` 同样设置表单级错误；一般异常设置 `unavailable`。普通失败不设置面板 notice，也不关闭对话框。确保 `finally` 仍恢复 `saving`。

- [ ] **Step 4: 调整 stale 提交分支**

对 `versionConflict` 与 `notFound`：关闭对话框、重新加载列表、使用 `toast.info` 显示说明；不在关闭的对话框设置错误，也不在面板显示重复提示。

- [ ] **Step 5: 清理错误并把两段错误显示在按钮附近**

每次 `submit()` 刚开始且存在 editor 时先清空上一次 `errors.form`，但不要丢弃字段值；草稿校验失败仍用现有字段错误返回，不发送请求。将表单错误区放在提交按钮附近，保留 `role="alert"`，内容由失败主提示和 `failureReasons[writeFailureReason(errors.form)]` 两段组成；`unchanged` 仍显示现有文案。saving 时提交按钮保持 disabled。

- [ ] **Step 6: 检查差异范围**

Run: `git diff -- apps/web/src/components/cosmos/model-provider-panel.tsx apps/web/src/components/cosmos/provider-model-draft.ts apps/web/src/components/cosmos/provider-model-draft.test.ts apps/web/src/copy/areas/models.ts`
Expected: 只出现上述 UI、纯映射、测试、文案变化；不改模型列表组件或服务端。

## Task 4: 验证与手工验收记录

**Files:**
- Test: `apps/web/src/components/cosmos/provider-model-draft.test.ts`

- [ ] **Step 1: 运行指定 TypeScript 检查**

Run: `bun run --cwd apps/web tsc --noEmit`
Expected: exit 0。

- [ ] **Step 2: 运行 Web lint**

Run: `bun run lint:web`
Expected: exit 0；若失败，区分本次文件问题与工作区既有问题并报告。

- [ ] **Step 3: 运行聚焦测试**

Run: `bunx vitest run apps/web/src/components/cosmos/provider-model-draft.test.ts`
Expected: 全部通过。

- [ ] **Step 4: 检查空白与非预期改动**

Run: `git diff --check`
Expected: exit 0；通过 `git status --short` 确认无关 dirty 文件均保留且未纳入修改。

- [ ] **Step 5: 浏览器验收可执行场景并记录边界**

在现有 `/models` GUI 中手动检查成功、字段校验无请求、重试错误清空与 saving 防重复；如没有可用真实服务端条件，不伪造 202/失败/版本冲突结果，明确标记这些场景未手工验证及原因。浏览器验收和纯逻辑测试分开报告。

## 规格覆盖自审

- 成功关闭、清空、刷新、success toast：Task 3 Step 2。
- 202 关闭、刷新、非 success toast：Task 3 Step 2。
- 失败保留草稿、恢复按钮、双段 alert、无外部重复 notice：Task 3 Steps 3、5。
- 冲突/不存在刷新、关闭、说明：Task 3 Step 4。
- 字段校验不发请求：保留原 `submit()` 草稿验证早退，Task 3 Step 5 不改变此路径。
- 重试清理旧错误、saving 禁用：Task 3 Step 5。
- 错误原因只按固定键，服务端正文不显示：Task 1、Task 2；`writeFailureNotice` 现有合同不变。
- 保存不调用模型、编辑空 Key 保留：不触碰现有行为，Task 3 不新增上游调用。
