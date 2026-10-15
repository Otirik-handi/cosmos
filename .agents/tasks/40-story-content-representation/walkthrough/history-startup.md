# Task40 启动历史

本册保存实施前至首个合同切片的历史，当前状态和有效计划见 [walkthrough](../walkthrough.md)。封口后只读。

## 本轮过程、偏差与后续

已建立 README 与本记录，计划从架构迁入；本轮没有业务写入。此前计划待维护者分配编号的条件已满足；稳定文档同步和合同冻结仍待推进。本计划不代表实现、迁移或发布完成。

建档验证：`bun run docs:check` 检查 979 文件，无失败；`git diff --check` 通过。业务、浏览器、真实来源与真实 Agent 验证未运行。

## 子 Agent 协作启动

用户审核通过 A 内容合同/规范化、B 存储/采集、C 统一读取/阅读、D Agent 候选/接受、R 独立审查职责；要求所有子 Agent 固定 `jijiapi / gpt-6-luna`，并明确要求开始实施。

TaskStartSnapshot：工作区 `D:/Otirik/Workstation/cosmos`，分支 `master`，HEAD `f66c33135351af38460fff73d311863dc7b4ef47`。既有修改：任务索引、bun.lock、package.json；既有未跟踪：Task 39、Task 40、docs/aegis、pi-ai 实现规格与 packages/agent-pi-ai。它们不能被子 Agent覆盖；本轮未创建 worktree/branch，未获 commit/push 授权。

当前切片 0：四专项并行只读核查，协调者汇总合同与文件所有权，R 审查后进入冻结及同步。可观察验收：四角色结果包含文件证据；共享合同无相互冲突；写入集合和隔离验证明确。子 Agent 不修改文件、不操作真实数据、不递归委派；协调者唯一维护本记录和 Git 生命周期。

模型路由：workflow 内每次 agent 调用显式指定 provider=`jijiapi`、model=`gpt-6-luna`。第一次 workflow 脚本因 `SyntaxError: Unexpected token ')'` 未启动；修正脚本后后台作业 `workflow-1` 已启动。实际模型运行与专项结果尚待收集。

### 实施启动基线与补充核查

用户已要求开始实施；切片 0 的四专项结果仍在收集，下一步为汇总并独立审查冻结合同。使用 subagent-driven-development 与 long-task-continuation 组织执行，复用本 walkthrough 作为唯一过程记录；不新增并行 tracker。TDD off 保持不变。未经用户明确要求不 commit、push 或操作分支。

协调者重新读取 Domain 输入合同与 Agent Invocation owner：现有 `fingerprintEntryRevision` 仅对传入标题、摘要、正文文本、URL、kind、publisher 做 JSON hash，未涵盖声明正文及媒体顺序；现有 `agent.invoke@1` 只有通用调用合同，三项 Story 任务仍需新增，不得宣称已有。信息模型 §1 决定 30 的单用户 Agent 最大权限口径，须在正式架构同步中明确本任务候选与受管 scope 的限定关系。

新鲜验证：`bun run typecheck:domain` 与 `bun run typecheck:contracts` 均 exit 0（作业 pwsh-15）；这是修改前类型基线，不代表内容功能已实现。专项作业 workflow-1 仍在运行，未启动重复核查。

正式设计入口同步：PRD 主文档增加 Task 40 阅读/候选验收目标；信息模型主文档增加所有权、表示选择元数据、统一读取与 Agent 候选边界。已接受设计作为增量依据，均标明尚未全部实现，不改封口分册。

补充基线：`bunx vitest run packages/domain/src/index.test.ts packages/application/src/agent-invocation.test.ts` exit 0，2 文件/26 测试通过；`bun run docs:check` exit 0，979 文件无失败（该次覆盖架构入口同步，PRD 后续追加需再验证）；`git diff --check` 通过。合同包入口受 `packages/contracts/src/entry-contract.test.ts` 与导出面快照保护，新增公开导出时须同步登记并审查，不能误当拆分等价改动。业务实现和浏览器验收仍未运行。

### 分派调整与首个合同切片

四专项 workflow-1 长时间未返回输出，协调者请求取消；没有可采纳的专项报告，不能声明四专项核查通过。改为小范围顺序实施；workflow-2 使用显式 jijiapi/gpt-6-luna 路由分派 A 公共内容合同。只允许写 Domain content/content-representation/index 与 Contracts 新 content-representation 合同及测试；Contracts 入口/快照、Prisma、任务记录仍由协调者独占。仓库/分支/base SHA 沿用启动快照，不操作 Git 生命周期，隔离测试不访问真实数据。

切片目标：三格式输入和受控块/证据/读取基础合同可被校验并兼容旧输入。可观察验收：旧 NormalizedIngestItem 不声明 contentSource 仍有效；非法块/URL 被拒绝且未知读取块安全降级；聚焦测试及两包类型检查通过。预算实施候选：输入 1 MiB、节点 50000、块 5000、遍历深度 64、块文本 65536、列表 3 层、表格 200×50、URL 长度 4096。这些是实现护栏候选，合入消费方前需合同审查，不视为来源完整性保证。媒体输入 sourceUrl 与持久块 assetId 分离，资产状态不复制进块。Normalizer/存储/读取接线不在该子任务可写范围。

PRD 与架构入口全部同步后的 `bun run docs:check` exit 0，979 文件无失败（pwsh-19）。下一步收集合同切片报告，先规格审查再质量审查与协调者验证。
