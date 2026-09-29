---
parent: docs/proposals/frontend-redesign-v1.md
range: 第 1 层 V4 · 设计系统与组件库（token 与组件规范）
sealed_at: 2026-09-24
tags: [proposal, ui, frontend, design-system, tokens]
tokens_est: 4600
---

本册是 [`frontend-redesign-v1.md`](../frontend-redesign-v1.md) 的分册，保存 V4（设计系统与组件库）的 token 清单与组件规范。主文档保留当前状态与有效决定；勘误写在主文档，不改写本册。

## Token 结构（维护者 2026-09-24 裁定）

**收成一套轴：只留明暗。** 删除 `colorway` 轴，`theme` 轴不再承担「未来第三方主题」的预留职责（该方向已在 [`neurobook-theme-system.md`](../neurobook-theme-system.md) 的非目标中排除）。

```text
现状：data-cosmos-theme="neurobook"  ×  data-cosmos-colorway="macos-light|macos-night"
改为：data-cosmos-appearance="light|dark"      （单一轴，一个属性）
```

- `apps/web/src/theme/theme.ts`：`CosmosThemePreference` 取值由 `system | macos-light | macos-night` 改为 `system | light | dark`；`COSMOS_THEME_ID` 常量与 `CosmosColorwayId` 类型移除。
- `apps/web/src/theme/theme-bootstrap.ts`：引导脚本写入 `data-cosmos-appearance` 与 `dark` class，不再写两个属性。
- `localStorage` key `cosmos.theme.preference.v1` **保持不变**，但存量取值 `macos-light` / `macos-night` 解析失败时回退 `system`（`parseThemePreference` 已有该行为，无需迁移代码）。
- `apps/web/src/component-lab/` 的 `LabThemeId` / `LabColorwayId` 与注册表 token 登记同步改为单一明暗维度。
- 组件实验室的 CI 门禁（`registry.test.ts` 等）与 `theme.test.ts` 同步更新。

## Token 三层

```text
第 1 层  shadcn 语义 token     现有组件全部只用这一层，换主题零改动
第 2 层  Cosmos 扩展语义       现有语义无法表达的三个概念
第 3 层  形状 / 密度 / 动效     字体栈、字阶、控件高度、圆角、动效、阴影
```

**关键结论：V3 的配色不需要发明新 token。** 它正好装进 shadcn 语义层，因此现有 8 个 primitive 与全部 `components/cosmos/*` 组件**不用改一行 class**，换主题即生效。只有三个概念需要新增语义。

### 第 1 层：V3 配色 → shadcn 语义 token 映射

| V3 名字 | shadcn token | 亮色 | 暗色 |
| --- | --- | --- | --- |
| `canvas` 画布底 | `--background` | `#f4f3ee` | `#141715` |
| `surface` 卡片面 | `--card`、`--popover` | `#fffefb` | `#1c201d` |
| `ink` 正文 | `--foreground`、`--card-foreground`、`--popover-foreground` | `#1c1f1c` | `#e4e9e3` |
| `graphite` 次要文字 | `--muted-foreground` | `#666a62` | `#939b92` |
| `signal` 强调 | `--primary` | `#2c5f4f` | `#64ab8f` |
| `on-signal` 强调上的文字 | `--primary-foreground` | `#ffffff` | `#101713` |
| — 次级面 | `--secondary`、`--muted`、`--accent` | `#eae8e1` | `#232724` |
| — 次级面上的文字 | `--secondary-foreground`、`--accent-foreground` | `#1c1f1c` | `#e4e9e3` |
| `rule` 分隔线 | `--border` | `#e6e4dc` | `#292e2a` |
| — 输入框边框 | `--input` | `#d8d5cb` | `#333834` |
| — 焦点环 | `--ring` | `#2c5f4f` | `#64ab8f` |
| `alert` 错误 | `--destructive` | `#9d3529` | `#df7a6c` |
| — 错误面上的文字 | `--destructive-foreground` | `#ffffff` | `#101713` |

**必须实测的对比度**（暗色下强调色提亮过，白字会掉到约 2.3:1）：`primary-foreground` 对 `primary`、`destructive-foreground` 对 `destructive`、`muted-foreground` 对 `background` 与 `card`，四组均须 ≥ 4.5:1。**实施时必须量，不能靠肉眼。**

### 第 2 层：Cosmos 扩展语义（新增 3 个）

| Token | 亮色 | 暗色 | 语义 |
| --- | --- | --- | --- |
| `--marker` | `#8d5a20` | `#d0a054` | **只用于「系统 / Agent 产生」的内容**。不得用作装饰或通用强调 |
| `--marker-soft` | `#f5ecdc` | `#2d2718` | 机器来源标记的底色 |
| `--paper` | `#fcfbf6` | `#191d1a` | 阅读区专用表面，比 `--card` 再暖一档 |

`--marker` 与 `--primary` 的分工是硬约束：**人操作的地方用 `primary`，机器产生的东西用 `marker`**，两者不互相替代。

### 第 3 层：形状 / 密度 / 动效

**字体**

```css
--font-ui:    system-ui, -apple-system, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
--font-serif: Charter, Georgia, "Songti SC", "SimSun", serif;
--font-mono:  ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace;
```

不新增任何字体下载（维护者 2026-09-24 裁定）。**衬线只用于 Story 标题与导语**；正文用无衬线，书桌感由行高与行宽实现。

**字阶（两套，由「是否在读一条内容」分开）**

| 角色 | 字号 / 行高 | 字重 | 字距 |
| --- | --- | --- | --- |
| 分组标题（内容 / 管理） | 11 px / 1.4 | 500 | +0.02em |
| 元信息（来源、时间、计数） | 12 px / 1.4 | 400 | 0 |
| 正文与列表摘要 | 13 px / 1.45 | 400 | 0 |
| 列表标题 | 14 px / 1.4 | 500 | −0.01em |
| 区块标题 | 15 px / 1.4 | 500 | −0.01em |
| 阅读正文 | 16 px / 1.8 | 400 | 0 |
| 阅读导语 | 17 px / 1.7 | 400 | 0 |
| Story 标题 | 30 px / 1.25 | 600 | −0.02em |
| 数字（计数、日期、置信度） | 同上尺寸 + `--font-mono` | 400 | 0 |

**间距（4 的倍数）**

| Token | 值 | 用途 |
| --- | --- | --- |
| `--space-1` | 4 px | 图标与文字、标记内边距 |
| `--space-2` | 8 px | 紧凑元素之间、列表项内部 |
| `--space-3` | 12 px | 列表项之间、表单行之间 |
| `--space-4` | 16 px | 区块内部 |
| `--space-5` | 20 px | **卡片之间的间隙、页面内边距** |
| `--space-6` | 24 px | 区块之间 |
| `--space-8` | 32 px | 页面级分隔 |
| `--space-12` | 48 px | 阅读区上下留白 |

**圆角（两档，不是一档）**

| Token | 值 | 用途 |
| --- | --- | --- |
| `--radius-control` | 6 px | 按钮、输入框、下拉、标签、标记 |
| `--radius-card` | 14 px | 悬浮卡片、弹层、抽屉 |

全站一个圆角值是 SaaS 卡片套装的识别特征；两档圆角让层级可见。

**阴影（只给悬浮物）**

| Token | 用途 |
| --- | --- |
| `--elevation-card` | `0 1px 2px rgba(24,20,14,.04), 0 8px 24px -12px rgba(24,20,14,.12)` — 悬浮卡片 |
| `--elevation-popover` | 弹层、下拉面板 |
| `--elevation-dialog` | 对话框、抽屉 |

**内容面不用阴影、不用卡片包裹**；靠 `--border` 细线分隔。

**动效**

| Token | 值 | 用途 |
| --- | --- | --- |
| `--motion-fast` | 90 ms | 外壳：hover、焦点、选中 |
| `--motion-base` | 140 ms | 交互：展开、弹层进入、开关 |
| `--ease-standard` | `cubic-bezier(.25,.1,.25,1)` | 全部 |

无入场动画；`prefers-reduced-motion: reduce` 下三个时长全部归零。

## 组件清单（维护者 2026-09-24 裁定：必做 8 个）

基座为 **Base UI（`@base-ui/react` ^1.7.0）+ shadcn `base-nova` 风格**，新 primitive 走 `shadcn add` 生成，组件代码归项目源码所有。

### 已有 8 个 primitive

`badge`、`button`、`card`、`field`、`input`、`label`、`separator`、`textarea`。

### 必做新增 8 个

| 组件 | 用在哪些页面 | 关键要求 |
| --- | --- | --- |
| `dialog` | 归并 Story、拆分 Story、用户状态迁移、媒体策略编辑、新建来源 | 焦点陷阱、Esc 关闭、关闭后焦点回到触发元素；宽 640 px 上限 |
| `alert-dialog` | 破坏性确认：删除标签、删除收藏夹、移除话题成员、删除来源 | 必须写清**可逆性**（判据 R4）；确认按钮用 `destructive`，不用 `primary` |
| `menu` | 列表行内操作、外观切换、标签与收藏夹的更多操作 | 键盘可达（方向键、Enter、Esc）；危险项与普通项之间加分隔线 |
| `tabs` | 整理页五分区（标签 / 收藏夹 / 收藏 / 批注 / 已保存视图） | 分区名与 URL query 同步（`?tab=`），可刷新、可分享 |
| `toast` | 写命令回执（已收藏、已打标签、已加入话题）、失败提示 | 成功 4 秒自动消失；失败**不自动消失**，必须可关闭且说明下一步 |
| `select` | 筛选条件（来源、媒体类型、录入状态）、话题成员角色、Entity 类型、关系类型 | 原生可访问语义；选项超过 12 个时改用 `combobox` |
| `combobox` | 话题选择器、Entity 选择器、Story 选择器（归并目标） | **必须可搜索**（判据 R3：不要求用户输入或背诵内部标识）；支持键盘上下选择 |
| `tooltip` | 来源依据、置信度、`producer` 说明、被截断的标题 | 键盘可达（focus 也触发）；内容不超过两行；**不得承载操作**（不能只在 tooltip 里放按钮） |

### 明确不做

`drawer`（Story 已改为独立页面，无使用场景）、`accordion`、`context-menu`、`menubar`、`navigation-menu`、`preview-card`、`number-field`、`otp-field`、`meter`、`slider`、`toggle-group`、`toolbar`、`avatar`、`progress`、`radio-group`、`scroll-area`、`checkbox`、`switch`、`popover`。

其中 `checkbox` / `switch` / `scroll-area` / `avatar` / `popover` 属「真需要时再加」；加入时必须同时提交组件实验室定义（CI 强制登记）。

## 每个组件的规范要求

按 [`react-component-lab.md`](../react-component-lab.md)，受管目录（`components/ui/*.tsx`、`components/cosmos/*.tsx`）每个公共模块恰好对应一个实验室定义，且必须有默认场景。V4 对每个组件的规范要求：

1. **变体与尺寸**：用 `class-variance-authority` 声明，不写散落的 class 分支。
2. **状态**：`default` / `hover` / `focus-visible` / `active` / `disabled` / `loading`（有异步动作的）六态齐全；`focus-visible` 用 `--ring` 画环，不用 `outline` 抑制。
3. **不得硬编码颜色**：只消费第 1、2 层语义 token，不写字面色值、不引用主题私有变量。
4. **文案由调用方传入**：primitive 不含业务文案，避免术语表与组件耦合。
5. **可访问性下限**：键盘可达、焦点可见、`aria-*` 正确、`prefers-reduced-motion` 生效。

## 资产规则

- **图标**：`lucide-react`，外壳 14 px、阅读区 16 px，线宽 1.75。同一动作在全站用同一图标。
- **插画与装饰图**：不做。信息类缩略图只用真实附件（`publicAssetSnapshot`），不做占位插画。
- **不做**：装饰渐变、纹理背景、品牌吉祥物、启动动画。

## 待验证（V4 交付时必须量）

1. 上表四组对比度实测值（暗色尤其）。
2. `prefers-reduced-motion: reduce` 下动效确实归零。
3. 键盘路径：`dialog` 焦点陷阱与关闭后焦点归位、`menu` 方向键、`combobox` 上下选择、`tooltip` focus 触发。
4. 1024 / 1280 / 1440 三档宽度下，悬浮卡片与主内容区限宽的表现（V3 只验证了 1440）。
