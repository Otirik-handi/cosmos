# `nb-memory` 调研

> 调研日期：2026-08-08
> 本地仓库：`C:\Users\notnotype\Documents\CodeRepository\GithubProjects\nb-memory`
> 目的：确定它是否适合作为 Cosmos 知识管理者的共享长期记忆与知识库。

## 结论

`nb-memory` 适合作为知识管理者共享的长期记忆/知识库，但不应被当作 Cosmos 的 Workflow、Job 或领域事实运行时。

建议的边界是：

```text
Knowledge Manager
    ├─ 读取/写入 nb-memory
    ├─ 读取 Cosmos 信息库
    ├─ 读取 Cosmos 行为观察
    ├─ 生成程序可读的个性化配置
    └─ 参与 ingest / research / Workflow
```

Cosmos 仍负责 Observation、Entry、Story、Source、Run、Step、Job、DomainEvent、用户行为观察和外部能力调用。`nb-memory` 负责知识管理者跨聊天、研究和 ingest 分身共享的记忆与知识表达。

## 已验证信息

- 仓库工作树在调研时干净，分支为 `master`。
- `bun test` 通过：86 个测试、464 个断言。
- `bunx tsc --noEmit` 通过。
- 包本身是 TypeScript/Bun 原生、零第三方依赖，LLM、embedding、存储和索引都通过可注入 port 接入。
- README 明确说明 JSONL 是事实源，BM25、embedding 和 SQLite index 是可以删除后重建的派生物。

## 核心模型

`nb-memory` 将记忆拆成几种不同生命周期的材料：

- `episode`：原始叙事，append-only，可以重新抽取。
- `facts`：已经发生过的事实，append-only，不因为后续认知变化而失效。
- `registry`：主体、别名和 ontology 版本。
- `state`：可变认知，通过 `invalidate + set` 表达状态替换。

它支持双时间轴：

- `tick` 表示摄入序和知识边界，单调递增。
- `instant` 表示事件或有效时间，可以回退。

查询可以使用 `as-of`，并在缺失时间轴时 fail-closed。这使它适合保存“知识管理者当时知道什么”和“某个事件时间点是什么状态”这类长期记忆问题。

## 写入、检索与降级

- 原文可以先落库，再进行抽取、主体归一和状态提案。
- 联合消解失败时，事实仍可落库，只跳过语义消解。
- `deferEmbedding` 允许先落库、先使用字面检索，再由后台补齐 embedding。
- 查询计划可以由启发式规则、便宜 LLM 或手写计划生成；三者共用同一份结构化计划 schema，执行器不依赖 LLM。
- LLM 规划失败时可以降级到朴素检索计划。

这与 Cosmos 的“确定性路径优先、LLM 作为增强、模型不可用时仍可工作”原则一致。

## 适合 Cosmos 的用途

第一阶段不需要把 `nb-memory` 嵌入所有领域对象。它更适合先承担：

1. 知识管理者在不同聊天、CLI、ingest 和研究分身之间共享的长期记忆。
2. 用户与知识管理者共同维护的自然语言偏好、事实、主体和知识上下文。
3. 知识管理者生成程序可读个性化配置时使用的记忆来源。
4. 研究过程中的主体、别名、时间边界和可回溯知识查询。

个性化配置的当前方向是：

```text
Agent 记忆 + Cosmos 观察到的用户行为 + 未来可能的其它信号
    -> 程序可读的配置
```

这不是要求每个配置字段都保存独立的 producer/version/evidence 账本。一般 Story、关系、推荐特征和 Agent 产物仍需要 provenance；个性化程序配置当前只需要保持可读、可编辑、可重新生成，并在更粗粒度上知道最近由谁或什么流程更新。

## 不直接复用的部分

- `nb-memory` 不是 Cosmos 的 Job 队列、租约、重试、checkpoint 或 Worker heartbeat 实现。
- `nb-memory` 的 episode/fact/state 不能替代 Cosmos 的 Observation、EntryRevision 和外部来源证据。
- `nb-memory` 不负责 Source、Connection、Secret、Connector、Blob、Asset 或 Service Endpoint。
- `nb-memory` 的检索计划不是 Cosmos 的 Workflow Runtime；知识管理者请求外部平台搜索或创建研究任务时，仍必须通过 Cosmos 的 Capability、Workflow、Run、Step 和 Job 边界。
- 当前没有把 Agent Session 展开成 Cosmos 的完整记忆模型；知识管理者是共享记忆之上的系统角色，可以有多个运行分身。

## 后续接入边界

后续可在 Cosmos 中增加一个 `NbMemoryPort`/Adapter（名称待定），至少隔离：

- `nb-memory` 存储根目录和生命周期；
- tick/instant 的宿主时间映射；
- Cosmos Entry/Story/Behavior Observation 到 memory episode/fact 的映射；
- LLM、embedding 和索引依赖；
- Node 生产运行时兼容性。

这项接入不属于当前 Phase 1 RSS 垂直切片，也不应通过直接共享 `nb-memory` 内部文件来绕过 Cosmos 的 Service/Workflow 边界。
