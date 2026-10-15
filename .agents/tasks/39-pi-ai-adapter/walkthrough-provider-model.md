# Task 39 过程续篇：Provider/model 产品配置

> 本文件是 [walkthrough](walkthrough.md) 的顺序续篇，不是第二套 tracker。历史 Adapter 和隔离真实验收证据留在原文。
> 当前阶段：设计接受后的技术合同与实施计划；业务实现未开始。

## 本轮切片与 TaskStartSnapshot

- 用户整体接受 [Provider/model Proposal](../../../docs/proposals/connection-credential-entry-v1.md)，允许下一步；按仓库维护流程的维护者直接请求例外记录，不创建公开 Issue 或新 Task 编号。
- 复用 Task 39：新能力服务于同一 pi-ai 调用链、Worker 凭证边界与首个产品配置消费者；这是显式扩展，不反写原 Task 的无 UI/无迁移历史范围。
- 基线：工作目录为当前仓库，HEAD `f66c33135351af38460fff73d311863dc7b4ef47`；master，约 57 个 tracked dirty 文件及大量 untracked。全部视为用户改动，不清理、不覆盖、不按 HEAD 重建。
- schema 已有 Task 40 的 45 行差异及三个未跟踪迁移；Worker main、多个公共导出与 ADR 也已 dirty。当前没有取得这些共享文件的写入独占权。
- Change Necessity：最终需要 code-change，当前切片仅 documentation。ArchitectureReviewRequired：yes，涉及 Provider 凭证所有权、持久化、公开接口和调用路由。
- 当前可写集合仅为本续篇、Task README/原 walkthrough 的入口，以及已读 Proposal 的接受状态。创建本续篇已在用户可见进度中通知。
- 仍禁止默认 `.cosmos`、指定备份、现有 SecretStore、Task 40 修改、Git 生命周期、部署和外呼。迁移执行（包括新隔离验证）须单独确认。

## 目标与完成条件

1. 用户在“模型”页创建/编辑 Provider 和模型，key 只写 SecretStore；保存不外呼，读取不返回 key，编辑留空保留原值。
2. 模型型 Connection 选择一个已有模型，Worker 每次按 Connection → Model → Provider → SecretStore 解析；新路径不回退旧部署模型配置或环境凭证。
3. 显式模型发现、两种生成协议分别通过模拟传输验证；真实请求、数据库升级和实际浏览器验证分别报告，不能用单元测试或历史真实请求替代。

## 已核实差距与设计约束

- 当前 Connection DTO 只有 connectorId，没有现成模型连接类型。拟以明确登记的模型连接种类识别，不把任意 connectorId 或旧连接猜成模型连接；准确标识与创建/清空选择规则在接口冻结时确定。
- 当前 `AgentInvocationInput` 只有 provider/model，没有 connectionId。先冻结可信 Connection 选择入口及所有调用者，再决定新增版本或兼容演进；不得把路由偷偷塞进 metadata，也不承诺 `agent.invoke@1` 输入永远不变。
- 当前 Worker 按静态 profile 取 Connection.secretRef；Adapter 注入模型类型只接受 openai-completions。Responses 需要真实 SDK 合同核对与独立行为测试，不能只增加下拉选项。
- 新 Provider 持有独占 secretRef；非模型连接仍保留既有 secretRef。保留旧代码直到新路径完成验证并明确切换，保留不等于运行时 fallback。不得自动导入旧配置或读取/搬运现有 key。
- 公网 HTTPS 必须校验实际连接目标，不能只校验 URL 或 DNS 后仍让 fetch 重新解析；重定向拒绝。SDK 请求与发现必须共用同一受控目的地策略，禁止进程全局 fetch 补丁成为产品实现。
- 当前 ADR-0017 和旧 Agent Provider Proposal 描述已实现旧路径，暂不抹除。新合同冻结后记录“接受的目标/尚未实现”与准确取代段落；ADR 等代码落地后再据证据修订，不新建重复 ADR。

## 能力依赖与实施顺序

顺序为 A → B → C → D → E → F；每个切片先核对文件 dirty diff，再冻结当轮准确可写集合。以下是候选范围，不是对所有共享文件的无条件写入许可。

### A：技术合同与稳定设计（下一切片）

- 输出：Provider/model 结构、版本 CAS、脱敏错误、专用 key 写命令、删除恢复、Connection 种类、调用路由及旧路径退出合同。
- 候选文件：本续篇；`docs/api/` 的独立 Draft；PRD/架构主文档中的目标设计入口；旧 Proposal 的局部取代说明。新建文档前通知，先读各索引与大小预算。
- 验收：每个公开命令有输入/输出/错误及首个消费者；没有凭证值读取端点；目标设计不伪装成当前实现。
- 设计建议：Provider 非秘密字段含 id/name/API/baseUrl/version/credentialState；模型含本地 id/providerId/上游模型 ID/显示名/contextWindow/maxOutputTokens。模型能力不由发现结果臆测，输出上限不超过上下文窗口。
- 发现建议边界：已保存 Provider ID，GET 基础地址下的 models，10 秒、1 次、0 重试、0 重定向、1 MiB 响应上限、最多 1000 候选，不跟随任意分页 URL；返回白名单字段。准确合同在 A 中与现有协议核对后冻结。
- 凭证协调：新引用先写后 CAS 关联；冲突仅补偿本次新引用。旧引用清理失败需可观察、可重试的非秘密操作状态；Provider 删除须先阻止新关联再处理自身 key 和模型，失败不得报告删除完成。并发引用检查与提交须处于同一数据库事务，不能靠 UI。
- 安全：精确受信 Origin/Host 与 JSON、no-store、错误白名单、无请求体日志；没有 Origin 的非浏览器请求策略及代理部署假设必须明确，CORS 不是认证。

### B：Provider 持久化与凭证协调

- 候选：新的 contracts/provider-model 模块及测试、application 服务/port、storage-prisma 独立仓储模块与测试；公共导出只做必要增量。
- schema 与新 migration 属共享高风险文件：先取得写入边界，再添加 Provider/Model/关联及版本字段，保留 Task 40 原样；不覆盖 schema 或重写已有迁移。
- 验收：合成 key 创建/替换/失败补偿；并发更新/引用阻止删除；隔离 fresh 与 legacy 升级均通过后才声称迁移已验证。迁移运行必须另行批准，未批准时明确 pending，不绕过门禁。

### C：产品 API 与 transport

- 候选：新 `apps/api/src/app.controller/provider-models.ts` 及路由测试；`packages/transport-http/src/client-provider-models.ts` 及测试；仅必要的 controller/入口注册。
- 验收：写命令不接受客户端 secretRef、读响应无 key；恶意底层异常也不泄漏；保存与列表的外呼次数为零，发现只接受 Provider ID。

### D：受控模型发现与 SDK 协议

- 候选：agent-pi-ai 的受控传输/模型配置模块及测试，application 发现 port 与 API 消费者。
- 验收：Chat Completions/Responses 分别 mock 验证，不自动降级；DNS/私网/IP 字面量/IPv6/重定向/超大响应均受控；重试和日志默认值不绕过预算。
- 不新增依赖或读取被禁第三方目录来猜 API；需要第三方实现证据时先明确读取范围或使用公开官方资料。

### E：模型页面与 Connection 选择

- 候选：新 `apps/web/src/app/(shell)/models/page.tsx`、Provider 编辑/模型列表独立组件及 copy；现有 side-nav、connection-panel、transport 消费与组件实验室登记；新独立浏览器场景，不混入 Task 40 的阅读器测试。
- 验收：创建/编辑/取消/失败均清空 key，无浏览器持久化或回填；保存零 Provider 请求、发现需显式点击；模型连接才显示单选、被引用删除给出阻止原因。
- 实际浏览器验证：桌面/平板及现有视口约定、键盘/标签/焦点、错误恢复、console/pageerror/失败网络；所有 Provider 流量模拟。未授权启动服务或迁移时不声称完成此项。

### F：Worker 消费与旧配置退出

- 候选：`apps/worker/src/agent-action.ts`/测试、config/测试、main 的 Agent 注册局部、Adapter 模型 seam、调用合同与已登记生产者。
- 验收：每次读取新关联，轮换/撤销/删除/不匹配均 fail closed；缺配置不回退旧 profile/环境/Fake；两种 API、取消、预算与无泄漏通过隔离链路。
- main 混有 Task 40 repository.blobs 改动，只允许经逐行核对的 Agent 区域增量；不能整体替换。
- 退出只移除已无消费者的旧部署模型字段和注册路径，保留默认关闭及一般 Worker 行为；不删除旧凭证或验收根。若发现仍有消费者，记录阻塞，不做双轨 fallback。

## 测试路线与验证门禁

- TDD Route：mode auto，decision strict；authority 为仓库维护流程增量实现要求。公共合同、凭证、持久化和调用行为先失败测试，再最小实现、整理与实际表面验证。当前纯文档切片不制造 RED。
- 执行路线：inline，跨层合同顺序依赖强且共享 dirty 文件多；后续只读独立 review 可另行委派，不让多个代理写 schema/公共 DTO/walkthrough。
- 每个代码切片先列准确命令与隔离路径，禁止无隔离的全测试或默认数据库命令。候选验证包括 contracts/application/adapter/Worker 的聚焦 Vitest、相关 package typecheck、模拟 API/transport、隔离迁移、浏览器。
- 文档切片运行 `bun run docs:check`；对本轮文件单独检查链接、围栏、尾随空白。`git diff --check` 不覆盖未跟踪文件，不能单独作为本 Task 文档证据。
- 最终请独立 review 凭证并发/删除恢复/网络目的地及旧路径退役；修复问题后复跑受影响门禁。
- 真实发现和生成各需重新披露准确命令、Provider/model、文本、预算、绝对隔离根、费用/副作用、日志与清理，并取得该次明确批准。历史 QmVMec 成功不替代新 UI/新路径验收。

## 当前未运行与下一步

业务测试、类型检查、构建、浏览器、新迁移、真实 Provider 请求均未运行；本轮没有业务代码修改。下一步执行 A，冻结接口/稳定设计与第一个代码切片范围；B 的 schema 写入和隔离迁移执行在对应边界确认前不启动。当前计划不是 UI 已交付声明。

本轮文档验证：`bun run docs:check` 检查 1046 个文件，failures 为空；`git diff --check` 无输出。另对本轮四个文档逐文件检查，尾随空白均为零，均无代码围栏；新续篇约 10 KB。原 walkthrough 约 39 KB，历史未搬移，本轮只加续篇入口，不声称已完成其存量大小治理。
