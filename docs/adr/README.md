# Architecture Decision Records

ADR 只记录已经稳定、需要长期保留的决定。仍在探索或会随下一轮需求调整的内容保留在 `docs/architecture/` 和对应 Task。

文件名使用四位编号，例如：

```text
0001-durable-workflow-runtime.md
```

每份 ADR 至少包含 Context、Decision、Consequences 和 Revisit Gate。

## 当前 ADR

- [0001 Durable Workflow Runtime](0001-durable-workflow-runtime.md)：固定
  `Job + Workflow`、Cosmos/Harness durable truth、lease fencing 和领域恢复边界；
  “Cosmos 自有脚本内核”和 Step 底层原语部分已由 ADR-0002 取代。
- [0002 `nb-workflow` Kernel 与 Cosmos Durable Host](0002-nb-workflow-kernel-cosmos-host.md)：
  固定规范脚本 Kernel、可选 Backend、Cosmos Host、`TaskStore + WakeupBus`、
  多宿主和 Agent Extension 边界；实施先稳定 `nb-workflow`，再进入 Cosmos
  Worker/Host convergence。
- [0003 Product Service、Worker Admin 与 Worker Gateway 边界](0003-service-worker-api-boundaries.md)：分离产品、运维和远程执行协议；远程 Worker v1 使用 HTTPS long-poll，并由 Action execution placement 控制执行位置；Attempt owner handoff、late evidence 和 Gateway capacity 由 TaskStore fencing/CAS 裁决。Worker Admin 后于本地 Worker 收敛，远程 Gateway 再后置实施。
- [0004 SourceInstance 身份与 revision 并发边界](0004-source-instance-identity-and-revision.md)：固定版本化 `sourceDefinitionRef`、manifest 到 Connector 的显式映射、迁移预检、默认停用和 revision CAS；不覆盖 CollectionPlan、未保存 Probe 或媒体实现。
- [0005 媒体边界 v1](0005-media-boundary-v1.md)：固定 RSS 媒体提取/受控下载与本地保存的 v1 边界——Connector 纯提取、Application 统一媒体获取、公开 `media-download` 能力门控、4 态 + 可空 `errorMessage` 降级原因、10MB/50MB 全局预算、下载安全边界与"不自愈"生命周期；per-source 策略与 `local` 作用域后置。
- [0006 Story 域模型 v1](0006-story-domain-v1.md)：固定 Story 从最小投影升级为可编排内容单元——主归属由 `Entry.storyId` 单外键表达、Story Revision 版本化（展示字段实质变化才递增）、merge 提供 canonical/alias、split 与自动聚类/Knowledge Workflow/`evidence_for` 后置；Phase 2 首切片实施顺序与边界。
- [0007 Topic 域模型 v1](0007-topic-domain-v1.md)：固定 Topic 自身走不可变 `TopicRevision`、Membership 用“当前关系表 + 不可变 revision 链”（受管枚举角色 + tombstone 可恢复）、Topic merge canonical/alias + 成员去重迁移、Story merge 同步迁移 membership、人工 command 路径而自动创建/维护后置；Phase 2 第二切片实施顺序与边界。
- [0008 Entity/关系 v1](0008-entity-relation-v1.md)：固定 Entity 本体（受管类型枚举 + 名字走不可变 `EntityRevision` + 名称别名）、Story↔Entity 关联与 Entity↔Entity 类型化关系用“当前关系 + provenance”而非 revision 链、关系类型受管枚举 + 未知降级、手动优先而自动识别/merge/dedup 后置；Phase 2 第三切片实施顺序与边界。
- [0009 用户组织 v1](0009-user-organization-v1.md)：固定 Label（命名注册表 + 多态附加）、Collection（成员为 Story）+ Story/Entry 独立轻量收藏标记、Annotation 用可编辑笔记而非不可变 revision 链、Saved View 只存查询条件不存快照并扩展 `search` 的 `labelIds`/`topicIds`；自动分类/Artifact 目标/正文片段锚点/Read State/Feed Block 绑定后置；Phase 2 第四切片实施顺序与边界。
- [0010 可配置看板 v1](0010-board-section-block-v1.md)：固定 Board/Section/Block 三层纯展示配置（Block type 受管枚举 + 按 type 判别白名单 config，Section 不设 kind）、多 Board 实体 + 预置默认 Board（消化 PRD 待决定事项 3）、Spotlight v1 只有 manual Placement（绑定具体 Board、物理解除，与 Phase 4 自动 policy 共用合同）、引用悬空降级与 merge 重定向；拖拽/Workspace Block/snapshot 后置；Phase 2 第五切片实施顺序与边界。
- [0011 Entry↔Story 证据关系 v1](0011-entry-story-evidence-v1.md)：固定 `(entryId, storyId)` 唯一当前关系 + 受管关系类型 `evidence_for`/`mentions` + provenance、关系挂 Entry 稳定身份不锁 Revision、禁止指向自己的主 Story、merge 同事务重定向与 move 删除冗余关系、手动优先而自动抽取/文本片段锚点/Story↔Story 关系后置；Phase 2 第六切片实施顺序与边界。
- [0012 Story split v1](0012-story-split-v1.md)：固定历史壳由 `StoryReplacement` 关系表表达（状态派生、旧 ID 不写 alias、不静默重定向）、`StoryDetail.entry` 可空 + `status`/`replacedBy[]` 投影、split 单命令显式映射四类内容身份关系（主成员/证据链接/Story↔Entity/Topic 成员，未列出的留在壳）、用户状态留在历史壳不迁移、审计靠领域事件、历史壳拒绝 merge/改 Revision/再 split；用户状态迁移与撤销、Read State 投影、自动拆分后置；Phase 2 第七切片实施顺序与边界。
- [0013 Story subtype 受管注册表 v1](0013-story-subtype-registry-v1.md)：固定 subtype 走代码内静态注册表（id 按核心 kind 命名空间化、kind/version/label/description/status/identityPolicy/owner，不建表不写 migration）、写入侧只接受该 kind 下 `active` 注册项且既有未知值不改写继续降级、新增只读目录接口与 Web 下拉、首批只注册 `media.comic`/`media.anime`/`media.video`、`identityPolicy` 只声明不执行；插件运行时注册、subtype 重命名/合并/迁移后置；Phase 2 第八切片实施顺序与边界。
- [0014 按来源的媒体策略 v1](0014-per-source-media-policy-v1.md)：固定策略写在 `Source.config.media`（图片下载开关 + 单文件/单次预算，全部可选、缺省跟随全局默认，v1 只对 `source.rss@1` 开放）、来源只能收紧不能放宽（schema 上界即全局默认）、类型开关只控制是否下载不改写连接器输出、有效策略在 fetch 时从 Run 的来源快照解析（只影响后续采集）、Web 在来源行编辑并走 CAS；保留期/清理、失败重试与历史回填、音视频下载实体、全局默认 env 化后置；Phase 2 第九切片实施顺序与边界。
- [0015 媒体失败重试与保留期清理 v1](0015-media-retry-retention-v1.md)：固定重试在常规采集 Run 内自动发生（`media.retry@1`，手动入口复用既有手动采集，不新增端点）、可重试性由机器可读 `Asset.errorCode` 决定（只重试 timeout/network/http_error/budget_run）、每来源 `media.retry.maxAttempts` + `Asset.attemptCount` 上限、重试只改写 Asset 行不产生新 Revision 且与本次 Run 共享预算、每来源 `media.retentionDays` 缺省永久保留、清理是显式命令且先预览再确认、只删 Blob 字节并把 Asset 回退 `metadata_only`（不新增公共状态枚举）、删除前做引用检查、清理由 durable 维护 Workflow 承载；历史回填与清理后自动重下后置；Phase 2 第十切片实施顺序与边界。
- [0016 Run 控制 v1](0016-run-control-v1.md)：固定取消是用户覆盖式终态化（不要求持有当前 lease，`cancelled` 终态 + fence 掉 Worker 后续写入）、重新运行复用采集入队并产生全新 Run（新幂等键 + `manual`）、恢复把失去活动 lease 的非终态 Run 送回恢复队列（`resumeRequired` + 清 lease，由 Kernel `rerun()` 从安全步骤续跑）、解释字段（复用/新副作用）进 Run 控制响应 DTO 而不改公共 Run 投影五态；零数据迁移、仅 durable `WorkflowRun`；Step 级选择性重放、legacy Run 控制、多主机 fence 语义后置；Phase 2 第十一切片实施顺序与边界。
- [0017 Connection / SecretStore / ConnectorStateStore v1](0017-connection-secret-state-v1.md)：固定 `ConnectionInstance` 实体 + `SourceInstance.connectionId` 可空外键（无认证来源为 null，Bilibili OpenCLI profile 继续作为外部登录态例外）、SecretStore 第一版 = 受限权限明文文件（不加密，待决定 16，加密/OS 凭据库为 Revisit Gate）、`ConnectorStateStore` = 命名空间化版本化 KV 新表（version CAS，不迁移 Checkpoint）、Secret 脱敏与所有权边界（Secret/State/Blob 互不混写）；CollectionPlan/多采集计划、Checkpoint 迁移、真实认证 Adapter 后置；Phase 2 第十二切片实施顺序与边界。
