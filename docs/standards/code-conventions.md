# 代码约定

本文是编写 Cosmos 代码的唯一权威约定；根 [`AGENTS.md`](../../AGENTS.md) 只保留触发链接，不复制正文。产品行为、架构决定与仓库协作流程分别由 [`requirements/`](../requirements/)、[`architecture/`](../architecture/)、[`adr/`](../adr/)、[`spec/`](../spec/) 与 [`standards/`](README.md) 的其它文档负责。

## 技术基线与依赖边界

- 当前初步技术基线是 Bun + TypeScript、React + Next.js App Router、NestJS、Prisma + SQLite；UI 使用 Tailwind、shadcn/ui、React Hook Form 和 Zod。具体版本和可替换边界以[架构设计](../architecture/0001-cosmos-foundation.md)与实现 Task 为准。
- 开发使用 Bun，生产使用 Node；共享包和 Worker 运行路径保持 Node-compatible。
- 先看 `package.json`、现有模块和测试，优先复用已有能力；不为单次调用制造抽象，不为未提出的旧合同保留兼容代码。

## 风格与类型

- 使用 4 个空格缩进、严格类型和项目别名导入。
- 外部输入在边界处以 `unknown` 接收并立即校验，避免 `any` 和无约束类型逃逸。
- 公开合同、复杂逻辑和容易回归的路径补充行为测试；注释解释原因、合同和约束，不描述显然代码。

## 分层与能力边界

- UI、Worker、Connector 和扩展通过版本化 Service Endpoint/Command/Query/Event/Transport 访问应用能力，不直接依赖 Prisma、SQLite、Data Root 或 Blob/Artifact Root。
- 日志使用结构化字段和自然语言消息，不记录 Secret、完整私信/邮件正文或未经脱敏的外部 payload。

## 文件大小治理

依据 [`code-size-governance-v1`](../proposals/code-size-governance-v1.md)（accepted），由 [`scripts/size-governance.py`](../../scripts/size-governance.py) 与 [`code-baseline.json`](../doc-governance/code-baseline.json) 执行 CI 门禁：

- 红线：源码/测试单文件 >800 行或 >50 KB；入口文件 >300 行；单函数 >100 行；圈复杂度 15。
- ≤400 行且内聚不拆，产物 100~600 行为佳。
- 拆分顺序固定为桶文件 → 测试 → 单体。
- 行为等价底线 = 现有测试全绿 + 入口契约测试 + 导出签名 diff 为零。
