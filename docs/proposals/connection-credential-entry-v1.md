# Proposal：Provider/model 配置与 Connection 选择 v1

> 状态：accepted（用户已整体评审通过；目标设计已接受，尚未实现）
>
> 关联：原始需求 [`0001-original-requirements.md`](../requirements/0001-original-requirements.md)；[`ADR-0017`](../adr/0017-connection-secret-state-v1.md)；[`Agent Provider 凭证合同`](agent-provider-connection-credential-v1.md)；[`Task 39`](../../.agents/tasks/39-pi-ai-adapter/README.md)

## 问题与当前证据

当前连接面板可创建 Connection 并编辑非秘密配置。Connection 创建/更新 DTO 接受不透明 secretRef，但没有独立的 Provider/model 产品配置入口。现有 Agent Worker 使用部署配置指定单个 Provider/model 与 Connection，调用时通过 Connection.secretRef 读取 SecretStore。

旧版小规格把目标缩成了“给现有 Connection 添加 API key 保存入口”，与用户预期不符。本修订替换这一目标及其接口方案；不再计划让用户在 Connection 卡片上单独录入模型 API key，也不沿用“首版仅首次保存”的限制作为已确认决定。

## 已确认的目标与产品关系

1. 提供独立的 **Provider/model 配置入口**。用户先配置 Provider、其 API key 及可用模型，再到现有连接面板为 Connection 选择 Provider/model。
2. Provider 的普通配置与凭证分开：**SecretStore 保存真实 API key，Provider 配置只关联不透明凭证引用**。“Provider 关联凭证”不表示把 key 明文存入 Provider 配置或数据库。
3. 一份 Provider 配置可有多个模型；这些模型，以及选择它们的多个 Connection，共用该 Provider 配置关联的 API key。
4. Connection 保存所选 Provider/model 的关联，不复制 API key、不维护另一份模型凭证引用。其它类型 Connection 的既有 secretRef 合同不因本提案自动废除。
5. 保存 Provider、模型、凭证或 Connection 选择均不调用模型，不执行模型发现、登录探测或 Agent Action，不创建模型调用 Job。
6. API key 不进入 configJson、URL、浏览器持久存储、普通读取 DTO、Job、Event 或日志，不回填到页面。

关系示例：用户创建“我的 DeepSeek”Provider 配置，保存一把 API key，添加模型 A、B；连接甲选择模型 A、连接乙选择模型 B，两者调用时使用同一份 Provider 凭证。需要不同 key 的账号可用不同 Provider 配置表达；具体命名与重复配置校验在实现设计中确定。

## 范围与非目标

设计范围包括独立 Provider/model 管理入口、专用凭证写入、Connection 选择与校验，以及消费该关联所需的服务端/Worker 接线设计。独立配置只是录入与关联；实际模型执行继续经过既有 Agent invocation 边界。

不新增自动模型调用或保存后自动验证，不实现 OAuth、工具执行、动态负载均衡、远程 Worker、多用户权限系统或 SecretStore 加密改造。不把临时验收 runner 当产品入口，不处置旧验收根或现有凭证。

用户已整体接受本提案并允许进入下一阶段：先冻结技术合同与实施切片，再按 Task 门禁推进。数据库迁移执行、现有数据/凭证处置和真实 Provider 请求仍需分别授权；本次接受不代表这些操作已获批准，也不代表 Worker 新接线已经实现。

## UI 小规格

### 独立 Provider/model 配置入口

- 入口为**左侧导航栏 → 模型**，与连接管理分开。列表按 Provider 配置展示，每项可展开其模型；不要求用户先创建 Connection 才能配置 Provider。
- 首版先支持 **OpenAI 兼容协议**，允许自定义 Provider 名称和基础地址；不纳入 Anthropic、Gemini 原生协议。模型发现使用该 Provider 基础地址下的 OpenAI 兼容模型列表接口；首版生成接口同时支持 **Chat Completions 和 Responses**，两条路径分别验证，不因一条失败自动切换另一条。生成 API 类型在 **Provider 级统一选择 Chat Completions 或 Responses**，其下所有模型共用，不提供模型级覆盖；需要使用另一种生成接口时，另建 Provider 配置。地址拼接与发现请求限制仍需明确。兼容协议不保证每家服务商都实现模型列表接口，不支持发现时仍可手动添加模型。
- Provider 非秘密字段拟包括配置名称、协议/API 类型、基础地址。模型归属于 Provider，拟包括模型 ID、显示名称及调用所需能力/预算字段。准确字段与受支持协议从现有 adapter 合同收敛，不将任意 JSON 编辑器作为常规入口。
- API key 在 Provider 编辑流程填写，使用有明确标签的 password 输入框。普通读取只返回凭证配置状态，不返回值、尾号或可复制内容；编辑已有配置不得回填 key。
- 创建时，用户填好 Provider 信息和 API key，点击**“创建提供商”**，同时提交普通配置与 key；服务端将两者分别存入配置存储与 SecretStore，完整完成后才显示创建成功。
- 编辑已创建的 Provider 时，用户点击**“保存”**提交修改；填写了新的 API key 则一并保存并替换凭证关联，未填写则保留原凭证，不隐式删除。不另设要求用户单独点击的“保存 key”动作。编辑不回填旧 key，以占位提示说明留空保留原值。
- 保存提示只写：**“保存不调用模型”**。明文存储、权限保护等实现限制保留在技术文档中，不追加到这条界面提示，也不宣称加密。
- 提交期间阻止重复操作；成功、失败、取消、关闭及卸载清空凭证输入。失败只显示固定脱敏提示，非秘密字段可保留以便恢复。键盘可操作，焦点与状态提示沿用现有可访问组件。
- **本次包含模型发现功能**：Provider 项提供独立的“发现模型”动作，从该 Provider 获取模型列表。创建、保存、页面加载或打开编辑框都不自动触发发现。用户也可手动添加模型。
- 发现使用已保存的 Provider 地址、协议与 SecretStore 凭证；若表单有未保存修改，先提示保存，不暗中提交配置或使用另一份临时 key。尚未创建的 Provider 先完成“创建提供商”，再执行发现。
- 点击发现前明确告知会向该 Provider 请求模型列表；这不是模型生成请求。显示加载、空列表、失败与重试状态；重复点击不得并发发送。发现结果作为候选供用户选择添加，未经确认不自动覆盖已配置模型或 Connection 选择。
- 发现返回模型 ID 不代表已有完整能力参数；缺少调用必需字段时要求补充，不凭空推断上下文或输出上限。协议支持范围、列表端点与结果分页/上限需在服务端合同评审中确定。

### 现有连接面板

- 对使用模型的 Connection 提供 Provider 与其模型的选择；先选 Provider，再选属于它的模型。更换 Provider 时清除不匹配的模型选择。
- 列表展示选择结果与配置缺失提示，不显示 API key 或凭证引用作为用户操作字段。无 Provider/model 时给出前往配置入口的明确路径。
- 保存选择只改变关联，不表示认证成功，不自动改变连接状态、lastError 或 lastCheckedAt，也不触发探测。
- 由 Connection 类型决定是否显示 Provider/model：只有明确支持 Agent/模型调用的类型显示并要求选择一个 Provider/model；Webhook、RSS 等不支持模型调用的类型不显示这些字段。模型连接不支持多选或按调用临时切换模型；同一 Provider 仍可配置多个模型供不同 Connection 选择。具体类型清单需与现有 Connection 合同核对。

## 服务端小规格

### 所有权与接口职责

- Provider 配置拥有协议、地址及凭证引用；模型配置拥有模型字段并归属于 Provider；Connection 只选择已有配置。SecretStore 是真实凭证内容的唯一存储边界。
- 提供 Provider 创建/编辑写入接口、Provider/model 的非秘密读取与模型管理接口、独立模型发现接口，以及 Connection 选择接口；准确路由与 DTO 待合同评审，不保留旧版 `POST /api/v1/connections/:connectionId/credential` 方案。
- Provider 创建命令接收普通字段与 API key；编辑命令允许可选的新 API key。凭证字段只允许在这两个明确写入命令中出现，不接受客户端指定 secretRef；普通读取、模型命令及 Connection 命令均不含凭证值。严格校验并拒绝额外字段，响应不包含值，相关响应设置 `Cache-Control: no-store`。
- 配置状态仅表示是否已配置凭证，不代表认证有效；需先定义状态如何产生，不通过普通 API 读取/返回 key。服务端执行协调，UI 不直接访问 Prisma、SecretStore 或文件路径。
- 允许修改已被 Connection 使用的 Provider 地址、生成接口与 API key；保存前提示受影响的连接，成功保存后所有引用它的 Connection 在后续调用中统一使用新配置，无需逐个重新关联。已发出的请求不承诺中止、切换或撤回，保存不调用模型。
- Connection 关联保存须验证 Provider/model 存在、模型确实属于该 Provider；调用前重新校验引用和可用状态，缺失、不匹配或无法读取凭证时拒绝调用，不回退到环境变量或其它连接的凭证。

### 凭证写入与失败恢复

- 创建和编辑保存只能关联目标 Provider 的凭证，不能覆盖另一配置或现有 Connection 的凭证。首次写入及编辑时替换已纳入本次范围；不提供独立的“移除 API key”动作，保留 Provider 即保留其凭证，编辑留空保留原值，填写新 key 才替换，删除 Provider 时清理其本地凭证副本。共享该 Provider 的模型和 Connection 后续调用使用更新后的凭证，正在执行的请求不承诺切换或撤回。
- 删除未被 Connection 引用、允许删除的 Provider 时，同时清理该 Provider 在 SecretStore 中拥有的本地 key 副本；不撤销服务商端 API key，不发起 Provider 请求。只删除模型不删除 Provider 的共享凭证。清理失败须明确显示未完成，不得宣称凭证已清理；跨数据库与文件的删除顺序、可重试状态及恢复合同在实现设计中明确，不扫描或删除无关凭证。此处确认的是产品行为，不授权现在删除现有配置或凭证。
- 推荐每次写入生成新的独占引用，先写 SecretStore，再条件更新 Provider 关联，避免原地覆盖影响正在使用的值；并发版本校验、旧引用保留/清理及引用唯一性须在实现合同中明确。
- 写入失败、配置提交失败或并发冲突不能返回成功，不得将 key 写入 configJson 作为回退。补偿只处理该次新建引用，不能扫描或删除无关文件。
- 文件与数据库不具备跨存储事务；崩溃可能留下孤立文件。补偿失败使用固定错误类别与非秘密操作标识记录，不记录异常原文；不得承诺自动清除全部孤立值。
- 请求体和校验错误不回显 key。响应丢失时不自动重传凭证；需要可观察的配置状态与明确恢复路径。

### 模型发现

- 发现是显式独立的外部请求，使用已保存 Provider 配置和服务端按次读取的凭证。客户端只提交 Provider 标识，不携带 key、任意目标 URL 或自定义认证头。
- 发现仅请求模型目录，不发送聊天文本、不调用生成接口、不执行工具，不改变连接状态；候选确认添加与发现请求分开。
- 服务端需限制受支持协议、目标 URL、重定向、超时、请求/分页次数及结果大小，防止配置地址被用来访问非预期资源或把 key 转发到另一目标；准确限制随协议合同一起评审，尚不虚构所有协议都支持发现。
- 只返回校验后的模型候选字段，不透传原始响应、认证头或上游错误正文。认证失败、不支持发现、超时、空列表分别用固定提示表达；不自动重试外呼，失败后由用户明确重试。
- 本轮规格修改不授权真实发现请求。开发验证使用模拟 HTTP；任何真实 Provider 模型目录请求同样受已有逐次外呼确认约束，即使它不是生成请求。

### 调用路径与既有合同影响

目标路径为 **Connection → 所选模型所属的 Provider 配置 → 凭证引用 → SecretStore → 可信 SDK**。多个 Connection 复用同一 Provider 配置，不复制 key。

这与当前 Worker 单 profile 部署配置、从 Connection.secretRef 取模型凭证的合同不同，也超出已接受 Agent Provider 提案的“无 Product API/Web profile UI”边界。接受完整设计后需明确更新这些稳定合同，不能假装新链路已经存在。

仍保留每次 invocation 重新校验和读取、不缓存凭证、失败拒绝调用、不记录值的原则。旧 Worker 配置采用手动配置后切换：用户在新页面创建 Provider、重新填写 key、添加模型，并为 Connection 选择模型；不提供一次性导入，不自动读取或搬运旧凭证。切换后的新路径缺少配置时明确提示并拒绝调用，不回退到旧部署配置。此决定不授权现在停用旧实现、迁移数据或读取现有凭证；具体代码退出范围须在完整设计接受后冻结。调用输入如何与所选模型匹配仍需技术合同明确。Provider 修改已确认保存后统一影响后续调用，已发出的请求不承诺中止或切换。

## 持久化备选与待决事项

| 方案 | 收益 | 代价与状态 |
| --- | --- | --- |
| 数据库保存 Provider/model 与 Connection 关联 | 便于引用校验、并发更新、跨 API/Worker 共享 | 用户已选择；需要 schema/迁移及旧数据策略，尚未授权执行迁移 |
| 服务端管理本地配置文件 | UI 同样可通过 API 修改，可能减少数据库字段 | 未采用：配置与数据库 Connection 的一致性需额外协调 |

已确认 Provider/model 普通配置、凭证引用及 Connection 选择关系保存到数据库；API key 真实内容仍只在 SecretStore。此决定确认持久化设计方向，不批准执行迁移。尚需确定：精确字段、生成 API 类型在 Provider 级统一选择（Chat Completions 与 Responses 均纳入首版）、发现端点及请求限制、连接适用类型（每个使用模型的 Connection 选择一个模型已确认）、凭证替换及 Provider 删除的并发/清理合同。旧 Worker 衔接已选择手动配置后切换、不自动导入、不回退旧配置；准确退出范围仍待技术设计。已确认：被 Connection 引用的 Provider 或模型禁止删除，并提示正在使用它的连接；用户须先更换或解除关联。删除 Provider 时也检查其下模型是否被引用，不静默级联解除 Connection 选择；服务端须在删除提交时校验引用，不能只靠 UI 禁用按钮。删除未被引用 Provider 时，确认后一起删除其下模型配置并清理该 Provider 的本地凭证副本；确认框说明将删除的模型配置。删除前须重新检查 Provider 及其下模型均无 Connection 引用，不允许留下失去 Provider 的模型配置。此操作只删除 Cosmos 本地配置与凭证副本，不删除服务商模型、不撤销服务商 key、不发外部请求。

## 安全、数据与执行边界

API 默认监听本机，但当前 CORS origin 默认 true，不等同受信任来源限制。新增配置与凭证写入入口需定义并验证精确 Origin 和 JSON 媒体类型约束；不得靠反射式 CORS 放行宣称安全。远程/多用户认证不在本次范围。首版 Provider 地址仅支持公网 HTTPS 服务商，不支持 HTTP、本机回环、局域网及其它非公网目标；本机 Ollama、LM Studio 等不在本次范围。创建 Provider 仍要求填写 API key，不引入无凭证模式。配置保存不探测地址；模型发现与生成调用均须执行地址及实际连接目标校验，防止 DNS 解析变化、重定向等绕过公网限制或向非预期目标发送凭证，具体实现与模拟测试由技术设计明确。

验证使用合成凭证、模拟 SDK 和唯一隔离数据根；不读取/写入默认 `.cosmos`、现有 SecretStore 或指定备份，不触碰 Task 40。若最终选择迁移，仅在另行确认的隔离验证范围内执行；真实数据库迁移不得由本提案推定授权。真实 Provider 请求仍需逐次说明准确范围并获明确确认。无部署、发布或 Git 生命周期操作。

## 预期文件与稳定文档影响

预计涉及 Provider/model 新合同、应用服务/仓储、存储适配、API、transport、独立配置 UI、ConnectionPanel、Worker 配置消费及对应测试；准确可写文件集合须在设计接受后冻结。Prisma schema/migration 不再声称“不需要”，也未获本轮文档修改授权。

后续需同步需求、ADR-0017、Agent Provider 提案/相关架构及 Task 39 边界，明确哪个合同被取代；实现后才更新当前 API/UI/adapter 规格。当前只改写本小规格，不把候选设计写成当前已实现事实。

## 验收方案

- Provider/model 可独立配置；一个 Provider 下多模型共享一份凭证，多个 Connection 可选择并复用。
- UI 创建/编辑与保存选择不发 Provider、模型发现或探测请求；无 key 回填或浏览器持久化，包含提交、成功、失败、取消和焦点验收。
- 创建提供商和编辑保存分别验证配置与 SecretStore 协调成功；编辑不填 key 保留原值、填新 key 替换关联。非秘密配置存储和读取响应均不含 key。
- 模型发现用模拟 HTTP 覆盖成功、候选确认、空列表、不支持协议、认证失败、超时、恶意/超大响应及重定向；仅显式点击时请求模型目录，保存不触发发现，不发送生成文本、不自动导入或覆盖模型。
- 合同拒绝模型归属不匹配、未知引用和凭证出现在不允许的命令中；非模型 Connection 行为不受影响。
- 删除被 Connection 引用的 Provider/model 时拒绝并提示使用它的连接；覆盖 Provider 下模型被引用以及选择关联与删除并发的情况，不自动解除关联。
- 删除 Provider 的隔离验证覆盖本地凭证清理成功、清理失败与恢复状态；只删除模型保留共享凭证，不请求服务商撤销 key，不影响其它 Provider 的凭证。
- 隔离存储验证值只存在于 SecretStore，普通配置仅有关联；覆盖写入失败、并发冲突、补偿失败和响应丢失恢复。
- API/transport 验证错误脱敏、no-store、来源和媒体类型限制；包含 key 的模拟底层异常也不得泄漏。
- 调用链用模拟 SDK 验证按所选 Provider/model 取 key、按次重读、配置缺失时拒绝、不使用旧环境凭证回退。真实模型验收单独授权，不能用保存成功代替。
- 分别报告聚焦测试、类型检查、浏览器验收及未运行项；涉及迁移时另报隔离迁移证据。

## 决策记录与自审

- 用户已确认：独立 Provider/model 配置入口；API key 在此录入、真实值由 SecretStore 保存；同 Provider 配置下多个模型及选择它们的 Connection 共用该 key。
- 用户进一步确认：入口为“左侧导航栏 → 模型”；“创建提供商”和编辑后的“保存”均保存已填写的 key；保存提示只写“保存不调用模型”；本次任务包含模型发现。
- 维护者最初要求只更新小规格；随后整体评审通过，允许进入技术合同与实施计划阶段。此批准不包含数据库迁移执行、现有数据/凭证处置或真实 Provider 外呼。
- 旧目标“现有 Connection 单独保存 key”、对应接口和首次保存限制已撤换；没有将本轮纠正反写为历史上已接受的设计。
- 用户已选择数据库保存 Provider/model 普通配置、凭证引用与 Connection 关联；真实 key 留在 SecretStore。此项不授权执行数据库迁移。
- 用户已确认首版先支持 OpenAI 兼容协议，其它原生协议不在首版范围；此项不授权真实调用或模型发现请求。
- 用户已确认由 Connection 类型决定 Provider/model 字段；只有明确支持 Agent/模型调用的类型显示并要求选择，其他类型不显示。
- 用户已确认生成接口同时支持 Chat Completions 与 Responses；支持范围不代表已经实现或通过验收，也不授权外呼。
- 自审：产品关系与生命周期选择已获整体接受；精确公共接口、安全传输及旧配置退出的技术合同在 Task 39 中冻结，当前实现事实仍以代码和已实现规格为准。
- 维护者整体评审结论：accepted；实施计划与后续门禁见 [Task 39 过程续篇](../../.agents/tasks/39-pi-ai-adapter/walkthrough-provider-model.md)。
