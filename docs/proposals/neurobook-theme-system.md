# NeuroBook 主题系统与 macOS 明暗配色

## 状态

`accepted`

## 问题

Cosmos Web 当前只有 shadcn 中性亮暗语义 token：`apps/web/src/app/globals.css` 的 `:root` / `.dark` 是唯一颜色事实源，没有主题轴、没有用户偏好持久化，首页也不提供任何外观切换。组件实验室虽然预留了 `theme` / `colorway` URL 维度，但只登记占位的 `cosmos` + `light/dark`。

产品定位是个人长时间使用的桌面工作台，需要一套确定的默认 UI 风格：高信息密度、桌面控件节奏、明确的明暗两种配色，并且首次跟随操作系统、手动选择后持久化。继续让每个页面自行堆 class 无法满足这个合同。

## 目标与非目标

目标：

- 建立固定视觉主题 `neurobook`：系统/CJK 字体栈、零字距、32px 标准控件密度、10px 控件圆角、18px 面板圆角、pill 胶囊、90/140/180ms 动效、panel/control surface 角色和 raised/popover/dialog 三档阴影；
- 提供两个配色 `macos-light` / `macos-night`，映射到现有 shadcn 语义 token；
- 产品偏好为 `system | macos-light | macos-night`：首次跟随 `prefers-color-scheme`，手动选择写入 localStorage 并在刷新后恢复，“跟随系统”删除偏好；
- 首轮可见范围是全局根布局、首页 `/` 和开发态组件实验室 `/dev/components`；
- 现有 primitive 成为第一批消费者，但不改变其导出、props 或 variant 名。

非目标：

- 不引入 `@notnotype/nb-ui` 包、Vue 实现、编译 CSS、SVG 折射/lens 资产或图片资产；
- 不新增运行时依赖（不使用 next-themes 等）；
- 不实现可安装主题市场、多主题并存或组件实现覆盖 API；
- 不实现桌面壳 vibrancy、Liquid Glass 折射或背景装饰层；
- 不在本轮迁移 Workspace/Feed/Story/Source 之外的全部未来页面；
- 不改变 Product API、SSE、表单语义、数据库或业务 DTO。

## 当前行为与证据

- `apps/web/src/app/globals.css` 只维护中性 oklch 亮暗变量与 `.dark` 类；
- `apps/web/src/app/layout.tsx` 无主题引导，`<body>` 已带扩展容错的 `suppressHydrationWarning`；
- `apps/web/src/component-lab/types.ts` 定义 `LabThemeId = "cosmos"`、`LabColorwayId = "dark" | "light"`；
- 首页 `page.tsx` 不读写任何外观状态；Web 业务 React/SSE 状态按当前 spec 全部不持久化；
- 参考实现 `neuro-book/packages/nb-ui` 的主题/配色分层（theme=形状密度材质，colourway=颜色）已通读其 README、`tokens.css`、`themes/nbook`、`themes/macos` 源码，仅提炼分层思想与 macOS System Blue 取值方向，不复制品名、代码或资产。

## 用户确认记录

2026-08-22 用户原话：“继续在这个分支开发 先确定一个默认的 UI 风格。采用 nb-ui 那种 ui 风格 + 主题系统，默认主题为 NeuroBook + macOS light/macOS night。先模仿 nb-ui 把最主要的 ui 组件实现。”

同轮交互确认：首要场景为个人桌面工作台；先做主题系统再做组件扩展；只复刻 nb-ui 视觉与交互规范；首轮覆盖全局根布局、组件实验室和首页。

## 方案与取舍

### 单一内部合同

`apps/web/src/theme/theme.ts` 导出常量与纯函数：`COSMOS_THEME_ID = "neurobook"`、`COSMOS_THEME_STORAGE_KEY = "cosmos.theme.preference.v1"`、`parseThemePreference`、`resolveThemeColorway`、`themeAttributesFor`。所有调用方只引用该模块，不在页面重复字符串。

### 引导脚本 + Provider 双轨

`<head>` 内注入静态 bootstrap 脚本，在首帧前把 `data-cosmos-theme`、`data-cosmos-colorway`、`dark` class 和 `style.colorScheme` 写到 `<html>`，避免错误配色闪烁；React 侧 `ThemeProvider` 用模块级 `useSyncExternalStore` store 作为唯一浏览器真相，订阅 storage 与 matchMedia，并把同一属性同步回 `<html>`。服务端快照固定 `system → macos-light`。`<html suppressHydrationWarning>` 容忍引导脚本造成的属性差异；既有 `<body suppressHydrationWarning>` 继续容忍浏览器扩展注入。

取舍：不引入 next-themes，因为合同只有三个值、一个 key、两个数据源，第三方库反而带来多余 API 面和不透明的水合策略。

### CSS 分层

`globals.css` 用 `[data-cosmos-theme="neurobook"]` 承载形状/密度/材质/动效 token，用 `[data-cosmos-colorway="macos-*"]` 承载颜色并映射到现有 `--background` 等语义变量；选择器同时命中 `<html>` 与实验室预览根，使一套 CSS 服务产品与实验室。`prefers-reduced-motion` 归零动效时长。

### 实验室职责分离

全局 chrome 使用持久偏好（ThemeSwitcher）；URL `theme=neurobook&colorway=macos-*` 只控制预览画布根，缺省确定性 `macos-light`，token override 仍是预览内最高优先级。

### 备选方案否决

- 直接依赖 nb-ui：Vue 组件/store 无法复用，翻译会制造第二套无障碍合同（沿用 react-component-lab Proposal 已否决结论）；
- next-themes：引入外部运行时与本仓自定义属性命名不一致；
- 只做 CSS 不做 Provider：无法提供键盘可达的三态切换器和跨 tab 同步。

## 数据 / 接口 / 安全 / 迁移 / 发布 / 回滚影响

- 数据：仅新增浏览器 localStorage key `cosmos.theme.preference.v1`（三个枚举值之一）；不触碰 Prisma/SQLite/Blob；
- 接口：仓库内部前端合同，不改 Transport DTO 或公开 API；
- 安全：storage 与 matchMedia 均按不可信输入处理，解析失败回退 `system`/`macos-light`，bootstrap 脚本不含任何用户输入插值；
- 迁移：无存量偏好需要迁移；实验室旧 `cosmos/light/dark` URL 值由归一化回退到新默认，不做别名兼容层；
- 发布：随常规前端构建发布，无独立发布物；
- 回滚：移除 bootstrap 注入、Provider 与 CSS 主题段即可回到现状；localStorage 残留 key 无消费方时无害。

## 对稳定文档的预期改动

- `docs/requirements/0002-product-requirements.md`：看板与浏览体验新增 BRD-010；
- `docs/architecture/0001-cosmos-foundation.md` §3.8：补充 theme × colorway 两轴合同；
- `docs/proposals/react-component-lab.md`：记录本次有界反转的决策行；
- `.agents/tasks/09-react-component-lab/README.md`：记录偏差并追加主题实施切片；
- 行为落地后更新 `docs/spec/interfaces/0005-web-client.md` 与 `docs/testing/README.md`。
本方案暂不写 ADR；若未来开放主题市场或跨仓库 token 共享再升级为 ADR。

## 决策记录

| 日期 | 决策者 | 决定 |
| --- | --- | --- |
| 2026-08-22 | 用户 | 在当前分支确立默认 UI 风格：采用 nb-ui 式风格 + 主题系统，默认 NeuroBook + macOS light/macOS night；先做主题系统。 |
| 2026-08-22 | 用户 | 交互确认：个人桌面工作台优先；只复刻 nb-ui 视觉与交互、不引入运行时；首轮覆盖全局、实验室与首页。 |
| 2026-08-22 | 用户 | 接受本 Proposal，授权更新稳定文档并在 Task 09 追加实施切片；未授权 commit、push、PR 更新、merge、发布或部署。 |
