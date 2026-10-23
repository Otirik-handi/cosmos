# Task 39 Provider/model 配置续篇（八）：B2b 落地证据

> 2026-10-16 至 2026-10-17，本册从「B2b-1：内部排他锁接入」到「B2b-2b：Provider 凭证保存协调」末尾。
> 由 `walkthrough-provider-model.md` 按文档大小治理拆出，内容原样保留、不重写。
> 同系列：`walkthrough-provider-model.md`（本篇）、`walkthrough-provider-model-02.md`、`walkthrough-provider-model-04.md`、`walkthrough-provider-model-06.md`、`walkthrough-provider-model-07.md`、`walkthrough-provider-model-08.md`。

## B2b-1：内部排他锁接入

- 用户明确批准七文件范围：新增 `model-configuration-lock.ts`、测试及 fixture，更新存储包 package.json、bun.lock、MODULE 和本续篇。Change Necessity: code-change；TDD Route: strict，沿用已记录 auto 决策；不改公开入口、FileSecretStore、schema/migration、API/UI/Worker。
- TaskStartSnapshot：HEAD `d511d799dd40d804820a27ed6a90054a23abb728`，master，ahead 1 / behind 0，单一 worktree；index 空，A/B1/B2a 的全部既有 dirty 与两份 untracked 会话导出保留。未执行 Git 生命周期操作。
- 前置隔离实验已在 Windows 本机 Node v24.14.0/Bun 1.4.2 验证四组跨运行时争用、独立操作、正常释放、退出恢复及同进程双句柄；可控 pending Promise 的取消测试不等于实际挂起内核 I/O。实验目录 `.agent/tmp/task39-provider-lock-7d754c5a59ec420da81e3d4349352498` 保留。
- `bun install --ignore-scripts` 退出 0，正式依赖固定 `fs-native-extensions@1.5.1`。bun.lock 仅增加该依赖及 require-addon、which-runtime、bare-addon-resolve、bare-module-resolve、bare-semver 闭包，无既有版本更新；未执行安装脚本或 Prisma generate。
- 内部组件校验 UUID 后才创建路径，操作文件名规范为小写；稳定锁文件不删除/替换；争用立即失败，无过期抢占或回退。await 回调结束后才 unlock/close；可信私有 storageRoot 和回调等待自身全部 I/O 是调用者合同，尚无产品调用者。
- RED：`bun run vitest run packages/storage-prisma/src/model-configuration-lock.test.ts` 首次因 `Cannot find module './model-configuration-lock.js'` 失败。初次实现后 6/7，通过的四组子进程不受影响；失败 `EISDIR: illegal operation on a directory, read` 是测试将锁目录当文件读取，修正测试路径并新增 inode 保持断言，未改变实现迁就测试。
- GREEN：同聚焦命令 1 文件 7/7，退出 0（2.13 秒测试）。覆盖非法 ID、同进程争用、不同操作、回调异常释放、正常释放、文件实体保持、调用方取消期间持锁，以及 Node/Bun 四组进程争用/正常释放/终止自有子进程后恢复。子进程仅必要环境，日志写随机隔离根，无凭证。
- 本轮 GREEN 保留根：`.agent/tmp/task39-model-lock-qwQ8pj`、`Vd6ju1`、`zupoF5`、`OR0FE0`、`YlQkYr`、`T6wZOp`、`8Bbc3m`（各后缀均属于 `.agent/tmp/task39-model-lock-`）。全部合成数据，不清理。
- 类型检查退出 0：`bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node packages/storage-prisma/src/model-configuration-lock.ts packages/storage-prisma/src/model-configuration-lock.test.ts packages/storage-prisma/src/model-configuration-lock.fixture.ts`。仅三文件，不声称 storage 全包类型检查。
- 独立只读静态审查未发现阻断本切片的 Important 问题；审查者未执行命令，不替代测试证据。根据其运行时标签意见，测试增加 Node-hosted Vitest 守卫（拒绝 Bun 承载父进程），避免把 process.execPath 未核实地称为 Node。
- 最终验证：`bun run vitest run packages/storage-prisma/src/model-configuration-lock.test.ts packages/storage-prisma/src/entry-contract.test.ts` 为 2 文件 8/8，退出 0；锁测试 7 项及公开入口 1 项通过，公开导出不变。随后重跑上述三文件严格类型检查退出 0。最终保留根为 `.agent/tmp/task39-model-lock-KsudtP`、`.agent/tmp/task39-model-lock-NMcNDE`、`.agent/tmp/task39-model-lock-1vVpuj`、`.agent/tmp/task39-model-lock-22uzg8`、`.agent/tmp/task39-model-lock-rf6QVQ`、`.agent/tmp/task39-model-lock-py4XGt`、`.agent/tmp/task39-model-lock-7HzKyS`。
- 文档检查 `bun run docs:check` 为 1054 文件零失败；`git diff --check` 通过，新增三文件和两份修改文档尾随空白为零。复杂度：组件 46 行，测试不足 200 行，无新 fallback、公开 owner 或旧逻辑退役；原生加载与结果守卫为 fail closed，不存在降级路径。置信度 B，仅本机内部组件证据。
- 剩余覆盖限制：未注入 native.tryLock 异常返回、unlock/close 失败；inode 保持只覆盖正常重入。未验证真正挂起内核 I/O、其它操作系统、网络文件系统、数据库发布/补偿/恢复代次。回调必须等待其全部 I/O，组件不约束 fire-and-forget。
- 未读写真实凭证、默认数据库、备份或 Task40，未运行迁移、全仓测试、构建、浏览器或 Provider 请求，未 commit/push。B2b-1 完成不代表完整凭证服务或 Task39 完成；下一步先提出产品凭证协调的准确范围及隔离验证，不能沿用本切片批准扩写。

## B2b-2a：隔离生成客户端验证

- 用户明确批准仅新增 `packages/storage-prisma/src/provider-model-client.test.ts` 与本续篇；产物限唯一 `.agent/tmp/task39-provider-model-client-*`，全部保留。不改工作区生成客户端、schema/migration、依赖或产品代码，不访问真实 SecretStore/default DB/备份/Task40。
- TaskStartSnapshot：HEAD `d511d799dd40d804820a27ed6a90054a23abb728`，master，ahead 1/behind 0、单一 worktree、index 空、无进行中 Git 操作；全部既有 dirty 和两份未读会话导出保留。
- Change Necessity：test-only，既有 strict 路线不产生本切片产品实现；本轮是现有结构的集成证据，不伪造 RED。通过临时 schema 显式 output、白名单子进程环境和显式数据库 URL 调用本地 CLI；不使用 scripts/prisma.ts。验收为生成成功、类型化访问编译成功、真实隔离库事务与关联断言成功。
- 命令：`bun run vitest run packages/storage-prisma/src/provider-model-client.test.ts`；测试内执行隔离 `generate --schema`、`migrate deploy --schema`、本地 tsc 与 Node harness。禁止自动安装，下载地址及代理指向不可用本机地址，以降低意外联网风险；这不是 OS 级断网证据，也未审计 CLI 是否向上查找并加载 .env。显式 datasource/output 已固定临时根，未发现默认数据库写入路径；不能据此证明全部隐式读写或网络行为均被隔离，也没有证据表明已读取真实凭证。

- 新鲜验证：`bun run vitest run packages/storage-prisma/src/provider-model-client.test.ts` 两次均 1/1（6.59 秒、5.54 秒），保留根 `.agent/tmp/task39-provider-model-client-kaphFN` 与 `.agent/tmp/task39-provider-model-client-9sCm8o`。本地 Prisma 6.19.3 生成到各根 generated-client，41 个迁移仅应用于各根 cosmos.sqlite；未生成共享 Client。
- harness 以临时生成声明做 tsc --strict --noEmit，再编译并由 Node 执行；验证 ModelProvider/ConfiguredModel/ModelConfigurationOperation 类型化 delegate、Connection→Model→Provider 关联、失败事务跨表回滚、旧版本/代次 updateMany 命中零、引用阻止删除、Provider 删除后收据保留、integrity_check 与 foreign_key_check。合成 ref 仅数据库文本，无 SecretStore 调用。顺序条件更新不证明真实竞争或恢复服务。
- 测试文件严格检查通过：`bun run tsc --noEmit --strict --skipLibCheck --target ES2022 --module NodeNext --moduleResolution NodeNext --esModuleInterop --verbatimModuleSyntax --types node packages/storage-prisma/src/provider-model-client.test.ts`。文档检查 1055 文件零失败，git diff --check 通过；未跟踪测试另行检查空白。独立静态审查已回收，未发现具体 Critical/Important；其网络隔离措辞意见已按第 181 行收窄，非全进程审计。
- 审查覆盖限制：拒绝断言未匹配 Prisma 错误码，不能单凭它确认具体 FK 失败原因；skipLibCheck 不检查生成声明内部一致性，未加负向类型探针。verification.json 的 secretStoreAccessed/providerRequested 是测试声明常量，不是运行时拦截审计。固定 41 个迁移及末尾名称是本切片冻结守卫，增加迁移后需重审。复杂度：193 行测试，无产品 fallback 或公开接口变更。
- 本轮仅 fresh ORM 证据；legacy 升级仍引用 B2a SQL 历史结果，没有重跑或声称 legacy ORM 已验证。未运行 storage 全包类型检查、全仓测试、构建、浏览器、产品凭证协调或真实请求；不 commit/push、不清理。置信度 B，Task39 整体未完成。

## B2b-2b：Provider 凭证保存协调（隔离实现与验证完成，产品未接线）

- 用户明确批准 storage/application 协调及合成凭证隔离迁移验证；未批准 API/UI/Worker、真实凭证/外呼或默认数据处理。审批选项误称“已提交迁移”，编码前已明确更正为工作区现有迁移快照。
- 基线 HEAD d511d799dd40d804820a27ed6a90054a23abb728，master ahead1/behind0、单 worktree、空 index，无 Git 操作；所有此前 dirty 与两份会话导出保留。严格 TDD 延续第77行路线；需要代码实现，不退役旧 Worker 或引入 fallback。
- 本切片文件：新增 application/src/model-provider-credential-port.ts、model-provider-credentials.ts、model-provider-credentials.test.ts；storage-prisma/src/model-provider-credential-repository.ts、model-provider-credential-repository.test.ts；必要更新 application/src/index.ts、entry-surface.txt、两包 MODULE.md 与本续篇。未改 schema/migration、依赖、共享生成客户端或现有锁实现。MODULE 更新尚待完成。
- 初始 RED 为 Cannot find module './model-provider-credentials.js'；应用4项 GREEN后补测试，发现登记前解构 apiKey，getter 断言 RED，改为先非秘密字段登记、后访问 key。当前应用8项与真实隔离ORM1项通过；后续测试桩泛型类型修正待复核。不得将此记录当最终通过。
- 隔离测试命令：bun run vitest run packages/application/src/model-provider-credentials.test.ts packages/storage-prisma/src/model-provider-credential-repository.test.ts。保留根 .agent/tmp/task39-provider-credentials-6OHedV（编译失败）、KGkvBj、RpuMG3；41迁移仅临时库，生成仅临时目录，SecretStore 为合成内存Map。代理/环境配置不构成OS断网或隐式.env审计证明。
- 最新进展（非最终结案）：应用16项、隔离ORM1项、两包入口2项，共4文件19/19；四文件严格tsc通过。最新根 .agent/tmp/task39-provider-credentials-IBgPRg；同Provider并发Promise仅一成功，publish已提交后抛错恢复保留新ref。save/retry保留白名单version_conflict/operation_in_progress，其余dependency_unavailable；错误对象getter/Proxy异常有RED→GREEN，code仅读一次。后续四文件切片获单独批准后，原生锁busy已补固定operation_in_progress；两项锁断言先RED，再实现GREEN。最新锁/协调/两包入口5文件26/26、锁相关四文件严格tsc通过，协调根 .agent/tmp/task39-provider-credentials-8eyL8I保留；Node跨进程retry准确code已断言。产品API错误映射尚未接线。应用两包入口回归曾通过。真实原生锁已在 ORM harness 接入；B2b-1 专项跨进程锁7/7在本轮通过，但尚无完整协调跨进程竞争测试。补充 registered 恢复/create占位删除、旧generation拒绝、部分put失败补偿与undefined保留旧ref，保留新根 ysK4ck、ITsZ8l、YXfH3k。
- 审查发现undefined apiKey可发布空ref，普通属性与getter两轮RED后修复：有newSecretRef时必须try读取且成功put后才publish，空值/异常补偿；getter冲突前不读。独立审查已静态关闭该项及safeFailure访问器泄漏项，不代表整体验收完成。模块地图已更新，application导出增1value/5types。最新复跑4文件19/19及显式严格tsc通过，保留根 .agent/tmp/task39-provider-credentials-dNKbCI；docs:check 1061无失败、git diff --check通过。隔离编译曾因引用工作区secret-store.ts生成 packages/application/src/secret-store.js（仅export {}），已改为复制类型文件到隔离根避免再次输出；现有产物保留未删除。跨进程补充已通过：子进程合成put保持pending，父进程新更新被拒绝、retry不能抢锁且generation不变；只终止本测试子进程后retry补偿完成、旧ref保留。首次失败因未决Promise不维持Node存活，补keepAlive后通过，最终保留根 .agent/tmp/task39-provider-credentials-s6WZ5F；4文件19/19与显式严格tsc通过。审查指出外层强杀可能留无限子进程，已加participant自身30秒安全退出上限（正常kill+await保持）；异常父死亡路径未单独注入验证。该场景仅Node↔Node、受控Promise，不代表真实内核IO或完整崩溃矩阵。B2b-2b原范围未改锁；后续已单独批准并完成锁busy固定code小切片，见上项最新证据。整体Task39未完成。续篇现超过30KB健康预算，低于50KB红线，后续停止扩写并按顺序续篇，不重写历史。无真实Provider请求或Git生命周期。

早期文档切片的 1046 文件检查为历史记录，最新切片结果见上文。原 walkthrough 约 39 KB，历史未搬移，本轮使用续篇，不声称已完成其存量大小治理。
