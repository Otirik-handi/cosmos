<!--
感谢你的贡献。请保留所有章节；没有内容时写“无”或“未运行”。
Thank you for contributing. Keep every section; write “none” or “not run” when applicable.
-->

## 关联 Issue / Related issue

<!-- 需要 Issue 时写 Closes #123；允许直接提交的轻量文档修正写“无 / None”。内部请求 Bug 写“无 / None”并在 Task 字段说明请求来源。安全修复写私密报告引用或“无 / None”，不得公开报告编号或漏洞细节。 -->
<!-- Write Closes #123 when an issue is required; use “无 / None” for allowed lightweight docs or an internally authorized bug and explain the source in the Task field. For security fixes, cite the private report only in an approved private channel or write “无 / None”; never expose report identifiers or exploit details publicly. -->

## 合同与生命周期 / Contract and lifecycle

- 改动分类 / Change classification: 待填写 / To be completed
- 权威合同 / Authoritative contract: 待填写 / To be completed
- Proposal / Task（不适用写“无”）/ Proposal / Task (write “none” when not applicable): 待填写 / To be completed
- 本 PR 的最小实施切片 / Minimal implementation slice in this PR: 待填写 / To be completed

## 解决的问题 / Problem

<!-- 说明用户或开发者遇到的具体问题。 / Describe the concrete user or developer problem. -->

## 本次范围 / Scope

包含 / In scope:

- 待填写 / To be completed

不包含 / Out of scope:

- 待填写 / To be completed

## 用户可见结果与实现 / User-visible result and implementation

<!-- 先写用户现在能做什么，再简要说明实现和受影响的领域、数据或扩展合同。 -->
<!-- Lead with what becomes possible, then summarize the implementation and affected domain, data, or extension contracts. -->

## 验证 / Verification

实际执行的完整命令和结果 / Exact commands and results:

```text

```

RED 证据（纯文档或无行为配置写“不适用”及理由；安全修复写脱敏边界摘要或私密报告引用，不写利用载荷）/ RED evidence (write “not applicable” with a reason for documentation-only or behavior-neutral configuration changes; for security fixes, write a redacted boundary summary or private-report reference, never the exploit payload):

```text

```

GREEN 证据 / GREEN evidence:

```text

```

实际运行表面 / Runtime surface exercised:

- 待填写 / To be completed

未运行的检查及原因 / Checks not run and why:

- 待填写 / To be completed

### 迁移证据（无迁移写“不适用”）/ Migration evidence (write “not applicable” when no migration)

- Expand/backfill/read switch/contract 阶段与当前阶段 / Phases and current phase: 待填写 / To be completed
- 迁移前备份与恢复验证 / Pre-migration backup and restore verification: 待填写 / To be completed
- 旧字段或旧消费者最后引用 / Last legacy field or consumer reference: 待填写 / To be completed
- legacy-seed 回填验证命令与结果 / Legacy-seed backfill command and result: 待填写 / To be completed
- destructive drop 是否独立部署 / Is the destructive drop a separate deployment: 待填写 / To be completed

### 性能证据（无性能目标写“不适用”）/ Performance evidence (write “not applicable” when no performance target)

- 同一 seed、环境、命令、测量口径 / Same seed, environment, command, and measurement method: 待填写 / To be completed
- 修复前后样本统计与波动 / Before/after sample statistics and variance: 待填写 / To be completed
- 原始输出隔离位置与摘要 / Isolated raw output location and summary: 待填写 / To be completed

## 界面证据 / UI evidence

<!-- 前端改动请附截图或录屏；未做浏览器验证时明确写出。 -->
<!-- Add screenshots or recordings for frontend work; explicitly say when browser verification was not run. -->

## 五轴审查 / Five-axis review

- 正确性 / Correctness: 待填写 / To be completed
- 简单性 / Simplicity: 待填写 / To be completed
- 架构 / Architecture: 待填写 / To be completed
- 安全 / Security: 待填写 / To be completed
- 性能 / Performance: 待填写 / To be completed
- 未解决 finding（没有写“无”）/ Unresolved findings (write “none” when empty): 待填写 / To be completed

## 文档与记录 / Documentation and records

- [ ] 已更新或确认不需要更新用户文档 / User documentation updated or not needed
- [ ] 已更新或确认不需要更新 Task walkthrough / Task walkthrough updated or not needed
- [ ] 已更新或确认不需要更新需求、架构、ADR 与 `PROJECT-STATUS.md` / Requirements, architecture, ADRs, and `PROJECT-STATUS.md` updated or not needed
- [ ] 本 PR 不修改版本号或发布说明，除非维护者明确要求 / This PR does not change the version or release notes unless requested by a maintainer

## 风险与边界 / Risks and boundaries

- 数据结构或迁移 / Data shape or migration: 待填写 / To be completed
- 配置、安装或发布 / Configuration, installation, or release: 待填写 / To be completed
- 安全与隐私 / Security and privacy: 待填写；安全修复可引用私密报告或脱敏摘要，不公开载荷 / To be completed; security fixes may cite a private report or redacted summary, never the payload
- 已知限制与后续事项 / Known limitations and follow-ups: 待填写 / To be completed

### 发布与部署证据（无发布写“不适用”）/ Release and deployment evidence (write “not applicable” when no release)

- 版本/tag 来源、可安装产物、渠道和目标环境 / Version/tag source, installable artifact, channel, and target: 待填写 / To be completed
- 远端必需 CI 核验结果 / Remote required-CI verification: 待填写 / To be completed
- 回滚步骤、迁移/备份状态、观察指标和停止条件 / Rollback, migration/backup state, monitoring, and stop conditions: 待填写 / To be completed
- 独立发布/部署授权与运行后证据 / Separate release/deploy authorization and post-run evidence: 待填写 / To be completed

## 提交者确认 / Contributor confirmation

- [ ] 一个连贯目标之外没有夹带其它改动 / This PR contains no unrelated changes outside one coherent goal
- [ ] 我已审查并能解释全部改动，包括开发 Agent 生成的内容 / I reviewed and can explain every change, including coding-agent output
- [ ] 验证结果真实，聚焦测试没有被描述成全量测试 / Verification is accurate and focused tests are not presented as the full suite
- [ ] 日志、截图和 fixture 不含密钥、私人信息、未授权内容或未经脱敏的外部数据 / Logs, screenshots, and fixtures contain no secrets, private data, unlicensed material, or unredacted external data
- [ ] 已按[仓库唯一 Definition of Done](../docs/standards/repository-workflow.md#definition-of-done)逐项满足或明确说明不适用 / Every item in the [single repository Definition of Done](../docs/standards/repository-workflow.md#definition-of-done) is satisfied or explicitly marked not applicable
- [ ] 我有权提交这些内容，并接受贡献内容按 AGPL-3.0-only 发布 / I have the right to submit this work and accept that the contribution is released under AGPL-3.0-only
