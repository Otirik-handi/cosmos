# Task 35 · 切片 1/2 实施记录分册

> 本册是 [`../README.md`](../README.md) 的分册：切片 1（地基）与切片 2（组件库）的实施与验收
> 记录，2026-10-01 按文档大小治理整段移入（主文档 token 逼近警戒线），**只搬位置、不改写条目**。
> 当前状态、范围、门禁与后续事项仍在主文档。

### 切片 1 · 地基

**贯穿目标**：让外壳与路由先立起来，且首页在换装后行为不变。

- 1a **token 换装**：`globals.css` 写入 V4 的 token 三层（语义映射 + `--marker`/`--marker-soft`/`--paper` + 形状密度动效）；`theme.ts` / `theme-bootstrap.ts` / `component-lab` 收敛为单一 `data-cosmos-appearance`。
- 1b **AppShell**：顶栏（品牌、全局搜索跳转 `/library?q=`、服务状态、系统产出、外观切换、新建）+ 悬浮侧栏（内容/管理两组，八项）+ 主内容区居中限宽。
- 1c **路由骨架**：`(shell)` 与 `(reading)` 两个路由组；十项路由建立；现有首页内容先整体挂在 `/`，行为不变。
- 1d **live-provider**：外壳级单条 SSE 连接、`streamState`、事件→topic 映射表、300 ms 合并、`subscribe(topic, handler)`。

**最多三条可观察验收**：① 换装后首页在 1440 px 下外观符合 V3，且现有浏览器套件通过；② 顶栏与悬浮侧栏在所有 `(shell)` 页面位置一致，切页不重建；③ 打开任意页面时浏览器 Network 面板中 `/api/v1/events` 只有一条连接。

**依赖**：无（起点）。**预计核心文件**：`apps/web/src/app/globals.css`、`src/theme/*`、`src/components/shell/*`、`src/app/layout.tsx`、`src/app/(shell)/layout.tsx`、`src/app/(reading)/layout.tsx`。

### 切片 2 · 组件库

**贯穿目标**：8 个 primitive 可用且登记完整。

- `dialog` / `alert-dialog` / `menu` / `tabs` / `toast` / `select` / `combobox` / `tooltip` 走 `shadcn add` 生成并落到 `components/ui/`。
- 每个 primitive 按 V4 的规范要求：cva 变体、六态、只消费语义 token、文案由调用方传入。
- **同时提交组件实验室定义**（CI 强制登记），否则门禁失败。
- 三档断点的版面规则落地（紧凑/标准/宽屏）；「窗口过窄」提示。

**最多三条可观察验收**：① 组件实验室能预览全部 8 个新 primitive 的关键状态，`test:browser:component-lab` 通过；② 四组对比度实测 ≥ 4.5:1（暗色尤其）；③ 键盘路径可用（dialog 焦点陷阱与归位、menu 方向键、combobox 上下选择、tooltip focus 触发）。

**依赖**：切片 1（token 与外壳）。**预计核心文件**：`src/components/ui/*.tsx`、`src/component-lab/registry.tsx`、`src/component-lab/product-fixtures.tsx`。
