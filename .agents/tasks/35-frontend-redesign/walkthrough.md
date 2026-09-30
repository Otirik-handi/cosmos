# Task 35 Walkthrough

本文件是 Task 35 的**唯一过程记录**：每轮的切片、RED/GREEN、实际命令与结果、范围偏差、未运行项、五轴 review finding 都追加在这里，不回改历史记录。当前摘要、范围与门禁在 [`README.md`](README.md)。

> 2026-09-24 按文档大小治理拆出封口分册：Round 0–3 的逐轮记录移入
> [`walkthrough/slices-0-3.md`](walkthrough/slices-0-3.md)（只搬位置、不改写条目）。
> 主文档保留当前状态、门禁与最近几轮。

## Round 4 · 切片 3b 内容组五页（2026-09-24）

**授权**：维护者「继续」。分两次提交：`976147c`（中期检查点：producer 字段 + 首页拆分）与 `7a35663`（四页建成）。

### 已完成

| 页 | 内容 |
| --- | --- |
| `/` 首页看板 | 纯看板 + 系统产出区块；删掉页头、错误/通知横幅、右侧状态栏（Entities/连接/存储）、整套检索区、运行记录。736 → 598 行 |
| `/library` | 整套检索工作台（关键词 + 七个筛选维度 + 已保存视图 + 结果分页）；顶栏 `?q=` 挂载时执行一次 |
| `/topics` | 只读列表 + 跳转（新建与编辑留 3c） |
| `/entities` | 只读列表 + 跳转（同上） |
| `/system` | 运行记录（从首页搬入）+ 系统产出列表 |

**新增组件** `SystemOutputBlock`：列出由系统或 Agent 产生的 Story，用 marker 语义色标记机器产出、另标注人工编辑过的；已登记组件实验室（三场景：机器产出 / 混合 / 空）。

**读取侧扩展**：列表读端点（`search` / `feed`）新增可选 `producer` 字段。

### 过程中发现并修正的问题

1. **`producer` 有两条映射路径，第一版只改了一条**。`search` 走原始 SQL 拼 select、`feed` 走 Prisma 查询与 `toFeedItem` —— 两个独立实现。行为测试直接报出 `producer: undefined`，两处都改完才通过。这是「同一语义两个实现」的典型案例，测试抓住了它。
2. **三个 React 编译器报错：渲染期写 ref**。`useToast`、toast fixture 及相关代码里的 `managerRef.current = manager` 是上一轮为规避无限重渲染加的，但**渲染期访问 ref.current 会阻止编译器优化**，也让「这次渲染读到哪一版」不确定。改为在 effect 里同步；修完 `lint` 从 3 error 降到 **0 error**。

### 一次纪律问题（同类第三次，必须记录）

**用 PowerShell 文本管道改含中文的源文件，再一次把文件写坏**（`read-title-projection.test.ts` 的中文断言与注释丢失，只能删除重写）。本会话同类事故共三次（另两次是 `primitive-fixtures.tsx` 与对 `ui-surface-ownership-v1.md` 的误判）。

**根因与纪律**：`Get-Content -Raw` + `-replace` + `Set-Content` 会改变编码与行尾，含多字节字符的文件必坏。**只读用 read/grep 工具，写入一律用编辑/写入工具；PowerShell 只用于 git、测试、文件计数等不触碰文件内容的操作。**

### 验证

| 命令 / 检查 | 结果 |
| --- | --- |
| `bun run typecheck` | **0 错误** |
| `bun run lint`（apps/web） | **0 error**；52 个 warning 为拆页后残留的失效声明，属切片 3e 清理范围 |
| `bun run test` | **135 文件 / 775 用例通过** |
| `bun run docs:check` | **872 文件 0 失败** |
| 组件实验室门禁 | 通过（31 个定义，新增 `system-output-block`） |
| 浏览器（Playwright，1440×1000） | 五页均渲染；导航位置一致（`navTop=56`）；无横向溢出；**占位文案已全部消失**；首页探针确认检索区与 Entities 面板不存在 |

### 未运行 / 已知边界

- **真人验收与真实数据验收未运行**：本机未起 API，页面级 500 属预期。
- `/topics`、`/entities` 目前**只读**：新建与编辑入口属 3c。
- 来源表单、连接面板与采集计划列表**暂留首页**（属 `/automation`）：现在搬走会先出现「来源配不了」的空窗期，3c 与旧表单删除同批处理。
- `/topics/:id`、`/entities/:id` 详情页与 `/stories/:id` 阅读页仍是占位。

## Round 5 · 切片 3c 管理组三页（2026-09-24）

**授权**：维护者「完成下一个切片」。提交 `a998c7c`。

### 已完成

| 页 | 内容 |
| --- | --- |
| `/organize` | 标签 / 收藏夹 / 收藏 / 批注 / 已保存视图 五分区，`?tab=` 与 URL 同步 |
| `/automation` | 来源表单 + 采集计划 + 连接 + 运行记录（从首页整体搬入） |
| `/settings` | 存储与数据管理 |
| Story 抽屉 | **删除四个创建表单**（新建话题/Entity/标签/收藏夹），保留下沉到抽屉的关联与标记动作 |

**「创建只去对象页」第一次真正成立**：做法是在页面层不再传 `onCreateTopic` / `onCreateEntityLinked` / `onCreateLabel` / `onCreateCollection`，组件里的 `onCreateX &&` 守卫让表单自然消失。**没有删组件代码**——那四个 prop 本来就是可选的；这样 Story 抽屉仍能挂到已有话题/Entity、打已有标签、勾选已有收藏夹，也就是「关联就地、创建去对象页」。

首页随拆随瘦：**736 → 590 行**。`/organize` 按分区拆文件（77–202 行/个），没有再制造超线文件。

### 过程中发现并修正的问题

**我自己引入的 5 个 lint error**：五个分区都用「`useCallback` 载入 + `useEffect` 调用」的写法，`react-hooks/set-state-in-effect` 报「在 effect 里同步调用 setState 可能引发级联渲染」。与 `/system` 同一条规则、同一处理：加说明性豁免（load 内部先 `await` 再 setState，不是同步触发）。修完 lint 回到 **0 error**。

### 已知缺口（本切片范围内无法补齐，已记入）

1. **标签与收藏夹都没有改名命令**，只能删了重建；已保存视图同样。
2. **收藏夹不能在这里加成员**：加入需要 Story 选择器，属切片 3d。
3. **批注没有标题投影**（只有 `targetType`/`targetId`），列表里只能显示正文与它挂在什么类型上；要跳回被批注的内容需要另一次查询。
4. 首页仍留着来源表单与采集计划（现已可从 `/automation` 使用）；首页那两份属切片 3e 的清理与 `board-view.tsx` 拆分。

### 验证

| 命令 / 检查 | 结果 |
| --- | --- |
| `bun run typecheck` | **0 错误** |
| `bun run lint`（apps/web） | **0 error**（54 warning，均为拆页后残留的失效声明，属 3e） |
| `bun run test` | **135 文件 / 775 用例通过** |
| 浏览器 | 三页均渲染、无占位文案、无横向溢出；五个分区逐个切换成功且 URL 同步正确（`?tab=collections/favorites/annotations/views`）；无页面级错误 |
| 创建表单不可达 | 代码层确认：四处 `onCreateX &&` 守卫仍在，页面不再传回调 |

### 未运行

- API 未启动，页面级 500 属预期；未做真实数据的增删改验收（属维护者真人验收）。
- Story 抽屉的视觉验收未做：`/stories/:id` 仍是占位，抽屉在首页打开；本机未起 API 无法取到 Story。

## Round 6 · 切片 3d Story 阅读页（2026-09-24）

**授权**：维护者「直接进 3d」。提交 `f4b67ea`。

### 已完成

`/stories/:id` 从占位变成真的阅读页，是工作区里唯一的 `(reading)` 路由（只有顶栏与返回入口、无侧栏）。

版面按 V4 排版规格落地，**逐项实测**而不是只写类名：

| 规格 | 实测值 |
| --- | --- |
| 正文卡片宽 | **640px** |
| 标题字体 | **Charter**（衬线） |
| 正文 | **16px / 行高 28.8px = 1.8** |
| 阅读列 | **544px = 34em** |

- **正文取主成员当前 Revision 的 contentText**：产品里第一次显示条目正文。
- **复用 story-panel 的只读块**（关键事实、时间线、证据来源、相关内容、来源成员）。理由不只是省事：浏览器验收依赖它们的 `data-story-*` 锚点（实测 e2e 用到 `data-story-key-facts` 2 次、`data-story-related`/`data-story-timeline`/`data-story-event-time` 等），重写会让既有验收失效。
- **来源成员行补上来源标记**：系统/Agent → 「系统创建 / Agent 产生」，人工 → 「人工编辑过」（ADR-0028）。同时**删掉行内显示的裸 Story id**——此前每行末尾缀着 `story:xxx`，判据 R3 明令禁止要求用户认内部标识符。
- **首页的 Story 入口改为导航到阅读页**（看板区块、信息流、系统产出三处）：读是导航动作，不再是打开抽屉。
- **分隔统一**：关键事实/时间线/证据来源/相关内容此前还留着 `border-b`/`border-t` 细线（Round 4 只改了 feed 与 board 两处），本次补齐为色块语言。
- 摘要与正文完全相同时不重复渲染：采集侧有时把来源描述同时写进 `summary` 与 `contentText`。

### 修掉一个影响全站的字体 bug（本切片的意外收获）

`--font-display` 在应用级**从未定义**——第 54 行定义的是 `--font-serif`，而类名用的是 `font-display`。**token 名与类名对不上，Tailwind 从未生成这个工具类**，全站 10 余处用 `font-display` 的标题（`board-view`、`feed-browser`、各 panel、阅读页）**实际全都落在 system-ui 上**，V4 的「标题用衬线」自 Round 1 起一直没生效。补上 `--font-display` 并在 `@theme inline` 映射后，实测为 Charter。

**同一段里 `--radius-control: var(--radius-control)` / `--radius-card: var(--radius-card)` 是自引用**，同样不生成 `rounded-control` / `rounded-card` 工具类；但所有调用方都写 `rounded-[var(--radius-card)]` 走原始变量，视觉上未受影响，故未在本次改动。

### 一处纪律问题（第四次同源事故）

**我又在本会话里用想当然的方式处理编码**：阅读页的 `storyId` 我照首页旧代码加了 `encodeURIComponent`，而 transport 的 `story()` 内部**已经编码过一次**，于是 id 里的冒号变成 `%253A`，接口 404。第一次修（去掉我加的那次）**没有解决**，因为我假设「Next 交给服务端组件的 `params.id` 已解码」——实测（把 `params.id` 渲染进 DOM 再读）证明**它仍是 `story%3A...` 的编码形态**。正确做法是在路由边界 `decodeURIComponent` 一次，编码只由 transport 做。

**教训与 Round 4 的 PowerShell 事故同源：不要基于假设改编码相关代码，先把真实值打印出来看清楚。** 本次我把中间值渲染进 DOM 才定位到，这条诊断手法写在这里备查。

### 已知遗留

- **首页渲染的 `StoryPanel` 抽屉已成死代码**：没有任何入口打开它（三处入口都改成导航），它的编辑标题/时间范围/关键事实、归并、切分能力因此**暂时不可达**。整体删除会牵出 `useStoryWorkspace` 一半的出口，按本会话既有做法（同 `feedBrowser` 那笔账）留到切片 3e 与拆页同批处理。
- `/topics/:id`、`/entities/:id` 详情页仍是占位。
- 阅读页目前**只读** + 收藏；标签、收藏夹、批注的挂载仍在抽屉里（随抽屉一起待办）。

### 验证

| 命令 / 检查 | 结果 |
| --- | --- |
| `bun run typecheck` | **0 错误** |
| `bun run lint`（apps/web） | **0 error**（53 warning，均为拆页后残留的失效声明，属 3e） |
| `bun run test` | **135 文件 / 775 用例通过** |
| 浏览器（真实 fixture 数据，从首页点入） | 侧栏隐藏 ✓；卡片 640px；标题 Charter；正文 16px/1.8；阅读列 544px；`data-story-key-facts`/`member-id`/`timeline` 锚点均在；来源标记「系统创建」出现；裸 id 不再可见；无页面级错误 |

### 未运行

- **真人验收未做**。
- `/stories/:id` 的**键盘路径**（Tab 到收藏、Esc、焦点返回）未逐项实测。
- 三档断点（1024/1280/1440）未在阅读页复测；`prefers-reduced-motion` 与 E7 预算仍未测。







