# 模型页服务商写入反馈设计

## 目标与范围
修复 `/models` 添加/编辑服务商后反馈不符合预期的问题。只调整 Web 客户端反馈，不改 HTTP/后端契约、数据库、模型列表区或保存时调用上游的承诺。工作区有大量并行未提交更改，变更严格限定在服务商面板、纯逻辑测试和模型文案。

## 设计
- 成功返回 `ModelProviderSnapshot`：关闭并清空对话框，刷新服务商列表，使用现有 success toast 显示“已保存。保存不调用模型。”
- HTTP 202 且操作仍未失败：关闭并清空对话框，刷新列表，使用 info toast；文案明确凭证仍可能未写完，不称作成功。
- 写入失败（包括 operation 快照 `state === failed`）：保持对话框打开、草稿不变、结束 saving；对话框提交按钮附近显示 `role=alert` 的两段固定文案（失败提示和可操作原因），不生成外部错误提示。每次提交前清除旧的表单级错误。
- 版本冲突/目标不存在：关闭并清空过期编辑器，重新读取列表，并用 info toast 告知原因。
- 客户端校验维持现有字段级错误，不发网络请求；编辑时空 API Key 仍表示保留原凭证。
- 失败原因仅按现有 `WriteFailureNotice` 固定错误码映射，不显示服务端正文、URL 或堆栈。`writeFailureNotice` 的状态码/错误码识别设计保持不变。

## 文案与恢复方向
新增原因文案按以下固定类别提供检查/恢复动作：版本冲突→刷新后基于最新配置再提交；凭证缺失→编辑服务商并补充 API Key；操作进行中→等待该操作完成后重试；旧凭证清理待处理→重新保存以继续清理；本地凭证写入失败→检查本地凭证存储可写性后重试；目标不存在→使用已刷新列表重新选择；载荷过大→缩短提交内容；暂不可用→检查网络/上游状态并稍后重试。失败主提示与原因分开渲染。

## 组件与测试
- `apps/web/src/components/cosmos/provider-model-draft.ts`：为失败通知键提供纯逻辑原因映射，文案仍由 `apps/web/src/copy/areas/models.ts` 提供。
- `apps/web/src/components/cosmos/provider-model-draft.test.ts`：覆盖所有错误通知键到原因键映射，确保不会接触服务端正文。
- `apps/web/src/copy/areas/models.ts`：集中维护失败主提示、原因提示、冲突/不存在后的说明和 toast 文案。
- `apps/web/src/components/cosmos/model-provider-panel.tsx`：接入已有 `useToast()`；成功与 pending 用 toast，普通失败留在模态框；过期编辑器关闭并刷新；错误区就近保留 `role=alert`。

## 验收
运行指定的 `bun run --cwd apps/web tsc --noEmit`、`bun run lint:web`、`bunx vitest run apps/web/src/components/cosmos/provider-model-draft.test.ts`。浏览器验收记录成功、失败重试、202、版本冲突、字段校验与重复提交各场景；无法实际触发的条件要明确说明未验证，不用逻辑测试冒充浏览器验收。
