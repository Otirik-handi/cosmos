# Task 27 walkthrough：Prisma CLI 按候选位置解析

基线：`origin/master` = `d67e9f1`。分支：`fix/t27-prisma-cli-resolution`，worktree `.worktree/t27-prisma-cli-resolution`。

## 本轮切片与假设

- 切片：让 `bun run db:validate` / `db:generate` 与全部 Prisma CLI 调用方不再假定 CLI 的单一位置。
- 假设（仍有后果）：CI 的失败形态就是「`packages/storage-prisma/node_modules/prisma` 不存在」，而不是「prisma 根本没被安装」。
  本机用全新 worktree + `bun install --frozen-lockfile` 直接复现了这一形态（见下），因此解析器只需覆盖真实存在的三种布局。
- 不在本轮：锁文件、registry、`configVersion`、`BUN_VERSION`、schema/migration、业务行为、20 处重复夹具的合并。

## 修前红灯（worktree 内，`bun install --frozen-lockfile` 之后）

全新安装后的布局本身就是 CI 形态，无需伪造：

```text
packages/storage-prisma/node_modules/prisma/build/index.js  -> False（不存在）
node_modules/prisma/build/index.js                          -> True（CLI 被提升到工作区根）
node_modules/.bun                                           -> 不存在
```

| 命令 | 结果 |
| --- | --- |
| `bun run db:validate` | `error: Module not found "packages/storage-prisma/node_modules/prisma/build/index.js"`（与 CI 报错逐字一致），exit 1 |
| `bunx vitest run packages/storage-prisma/src/connection-state-store.test.ts` | 3 个用例全部失败：`Command failed: node …/packages/storage-prisma/node_modules/prisma/build/index.js migrate deploy …` |
| `bunx vitest run packages/storage-prisma/src/prisma-cli.test.ts` | 模块尚未存在：`Cannot find module './prisma-cli.js'` |

注：测试层红灯是在先用提升到根的 CLI 手工执行一次 `generate` 之后取得的——否则失败点会先落在 `Cannot find module '.prisma/client/default'`（全新安装未生成 Prisma Client），掩盖 CLI 路径问题。

## 实现

1. 新增 `packages/storage-prisma/src/prisma-cli.ts`：`resolvePrismaCliPath(from = 包根)`，候选顺序为
   ① 从 `from` 出发的 Node 模块解析 ② 逐级向上 `node_modules/prisma/build/index.js`
   ③ 逐级向上 `node_modules/.bun/prisma@*/node_modules/prisma/build/index.js`（多个时按**版本号数值**比较取最高，同版本再按目录名定序）；
   全失败时抛错并列出已尝试位置（含模块解析的失败码）与提示在仓库根 `bun install`。包根由 `import.meta.url` 上溯一层得到，`src/` 与 `dist/` 通用。
   候选 ③ 是**纯防御性兜底**：本机观测到的两套布局（包内 Junction、提升到根）都由候选 ① 命中，③ 只覆盖「store 里解包了但没有任何顶层条目」的形态。
2. 批量替换 21 处测试/夹具与 `scripts/prisma.ts`：先 dry run（打印每处命中数、import 落点、`resolve(` 是否仍被使用），确认 21/21 各命中 1 处后 `--write`；两个只 import 外部包的文件自动补空行分组。
3. Docker：新增 `docker/start-api.sh`（`set -e` + 动态 import 构建产物里的共享解析器取 CLI + `migrate deploy` + `exec node apps/api/dist/main.js`），`Dockerfile` 的 `CMD` 与 `compose.yml` 的 api `command` 改为调用它。运行时镜像是纯 Node，跑不了 TS 源码，所以走 `packages/storage-prisma/dist/prisma-cli.js`——与测试、脚本是**同一份解析器**，不再有两套规则。
4. 文档同步：`docs/spec/operations/0002-development-runtime.md`（3 处固定路径 → 候选解析描述）、`docs/spec/operations/0001-deployment.md`（Docker 默认主进程与锚点补该脚本）、`.github/workflows/ci.yml` 仅改注释。

## 修后绿灯

| 命令 | 结果 |
| --- | --- |
| `bunx vitest run packages/storage-prisma/src/prisma-cli.test.ts` | 7/7 通过（包内 node_modules、提升到根、exports 屏蔽时的字面兜底、仅 bun store、多 store 按版本取最高、全缺失抛错并带失败码、真实工作区默认解析） |
| `bun run db:validate` | `The schema … is valid 🚀`，exit 0 |
| `bun run db:generate` | `Generated Prisma Client (v6.19.3)`，exit 0 |
| `bunx vitest run packages/storage-prisma/src/connection-state-store.test.ts` | 3/3 通过（修前同一用例 3 失败） |
| 嵌套布局对照：在 worktree 内用 junction 造出 `packages/storage-prisma/node_modules/prisma`（bun 1.3.14 式） | `bun run db:validate` exit 0；验证后已删除该 junction，`node_modules/prisma` 未受影响 |
| `docker/start-api.sh` 的解析行（最终版：动态 import 构建产物 `packages/storage-prisma/dist/prisma-cli.js`）逐字放进临时 shell 脚本、用真实 POSIX shell（Git 的 `sh`）执行 | `resolved=D:\…\node_modules\prisma\build\index.js`、`file-exists=yes`、exit 0——嵌套引号在 `$( )` 内成立，且容器走的是与测试/脚本同一份解析器 |
| `docker/start-api.sh` 字节校验 | 607 字节、11 LF、0 CR、无 BOM（`.gitattributes` 的 `* text=auto eol=lf` 保证检出为 LF） |
| 解析器在两个运行时下的默认解析：`bun -e "await import('./packages/storage-prisma/src/prisma-cli.ts')"` 与 `node --input-type=module -e …` | 两者都解析到 `…\node_modules\prisma\build\index.js`（提升到根的布局）、`exists=true`——`scripts/prisma.ts` 走 bun、测试/Docker 走 Node，都被覆盖 |

## 全量门禁（worktree 内，顺序执行）

| 命令 | 结果 |
| --- | --- |
| `bun run typecheck` | exit 0 |
| `bun run test` | **94 文件 / 570 用例全绿**（2026-09-16 基线为 93 文件 / 563 用例；差值正是本切片新增的 `prisma-cli.test.ts` 7 个用例） |
| `bun run test:property` | 3 文件 / 4 用例通过 |
| `bun run lint:web` | 0 error / 83 warning（与既有 83 条 warning 一致） |
| `bun run build` | 通过（`✓ Compiled successfully`，含 api/worker tsc 与 Next build） |
| `bun run docs:check` | 656 文件 0 失败 |
| `python scripts/size-governance.py -c docs --check --baseline docs/doc-governance/docs-baseline.json --fail-on-new` | PASS（243 文件、基线 11 条、豁免 1 条；含既有基线内文件增长 warning） |
| `git diff --check` | 干净 |

`PROJECT-STATUS.md` 的 size 门禁细节：该文件未登记，改动前已是 **8,951 / 9,000 token**（只剩 49 token 余量）。第一版 bullet 把它推到 9,015 → 门禁 `[fail] 新增警戒区文件: PROJECT-STATUS.md`；压缩后为 8,931 token（余量 69），门禁恢复 PASS。**这是一个与本次 CI 阻塞同类的既有风险**：该文件任何后续追加都会直接让 CI 失败，需维护者决定切历史分册或登记进基线（见 README 的 Follow-ups）。`docs/spec/operations/0002-development-runtime.md` 27.1 KB、未登记，仍在 30 KB / 9k token 健康区内。

## 未运行项与已知限制

- 远端 CI（push 后才会运行）——本轮结论只到本地等价门禁；`db:validate` 之后的 typecheck / 单测 / property / lint / build / Node E2E / Browser E2E 是否在 CI 真正执行，必须推送后核验。
- 本地未运行、已由远端 CI 承担并全部通过：`test:e2e`、`test:browser`、`test:browser:component-lab`、Windows Node smoke（见下方「远端 CI」节）。仍完全未运行：Docker/Compose 实跑（本机无 Docker CLI）、真实来源联网验收。
- `docker/start-api.sh` 未在容器内实跑（本机无 Docker CLI）；已做的是静态检查、POSIX shell 实跑解析行与字节校验（见上表）。`set -e` 与原先 `&&` 链在「迁移失败就不启动 API」上等价；`exec` 让 API 成为 PID 1。
- Windows 上验证，未在 Linux 上执行；布局对照用的是本机两套真实 node_modules 形态。
- `scripts/**` 不被任何 tsconfig 覆盖（CI 的 typecheck 只跑 packages + apps），`scripts/prisma.ts` 的跨包相对 import 只由 `bun run db:validate` / `db:generate` 在运行时验证；若将来有人用 `tsc` 或 Node 直接执行该脚本会失败。
- 同一次 CI 运行里 `docs:check` 与 size 门禁排在 `db:validate` **之前**（`ci.yml:33-34`）：文档门禁一旦变红，仍然会遮住后面的全部检查。这解释了本轮 PROJECT-STATUS 余量问题的紧迫性。
- 同类既有风险（非本切片引入，未验证）：`docker/Dockerfile` 构建阶段固定 `oven/bun:1.3.14`，而 `bun.lock` 由后续 bun 版本重写、CI 用 1.4.2；该组合下 `bun install --frozen-lockfile` 是否成功没有运行证据（本机无 Docker CLI）。它和本次 CI 阻塞同属「工具链与锁文件漂移」。

## 偏差

- 无范围偏差。相对维护者给的清单多改了一个文件：`docs/spec/operations/0001-deployment.md`（该文件是 Docker 默认主进程的行为 spec，新增 `docker/start-api.sh` 后锚点与表格需同步，否则文档与实现不一致）。
- `exec` 替代原先 `sh -c "… && node apps/api/dist/main.js"` 的末条命令，属同语义的确定性写法；如认为超出「行为等价」边界，可改回无 `exec` 形式。
- Docker 入口改用构建产物里的共享解析器（初版是脚本内自己写一遍 `node -p require.resolve`，等于同一条规则两份实现，已按独立审查 O3 改掉）。

## 独立审查（fresh-context 只读审查，五轴）与处置

审查者未修改任何文件，读的是 11:15 冻结版本 + 我随后补的两份 Task 文档；它自己复跑了 `docs:check`、size 门禁、storage/worker typecheck、解析器用例、`bun -e resolvePrismaCliPath()`、`git grep`、`git diff --check`。

| 级别 | finding | 处置 |
| --- | --- | --- |
| Critical | 无（审查开始时唯一一条是 README 链接指向尚未创建的 walkthrough → `docs:check` FAIL） | 创建 walkthrough 后复跑 PASS |
| Required | **R1**：候选 ③ 实际按目录名字典序取最大，而文档与用例名写「取版本号最高」；位宽不同时会选到更旧 CLI（`6.9.0` vs `6.20.1` → `6.9.0`） | 改为真正的版本号数值比较（`storeEntryVersion` + `compareStoreEntries`），文档承诺现在成立；用例换成位宽敏感的 `6.9.0` / `6.19.3` / `6.20.1` 三组，断言选 `6.20.1` |
| Optional | **O1** 吞掉 `createRequire` 的失败原因（exports 收窄时报 `ERR_PACKAGE_PATH_NOT_EXPORTED` 却无线索） | 错误信息带上失败码（`describeResolutionFailure`），并加断言 `/MODULE_NOT_FOUND/` |
| Optional | **O2** 字面向上查找的命中分支无用例覆盖 | 新增用例：假 `prisma/package.json` 用 `exports` 屏蔽 `./build/index.js`，断言仍能取到该文件 |
| Optional | **O3** Docker 那份只有候选 ①，是同规则的两份实现；prisma 收窄 exports 时测试绿而容器失败 | Docker 改为动态 import 构建产物里的同一解析器；`docs/spec/operations/0001` 同步措辞 |
| Optional | **O4** 解析被提到模块顶层，无参调用时 `Usage` 契约顺序变了（`docs/spec/operations/0002:153,490`） | `scripts/prisma.ts` 把解析调用移到参数校验之后，并在原处留一行说明原因 |
| Optional | **O5** 候选 ③ 在两套实测布局里都不是必需，属投机性纵深 | 保留（成本 10 余行、覆盖 store-only 形态），但已在实现说明与本记录里明确标为**纯防御性兜底**，不再声称由实测布局驱动 |
| Nit | **N1** 三处 import 落点不合字典序 | 已调整（`workflow-backend.test.ts`、`workflow-host-store.fixtures.ts` 前移；worker 用例挪到 `@cosmos/storage-prisma` 相邻行） |
| Nit | **N2** 「27 处」口径在 `PROJECT-STATUS.md` 与 Task 索引里被写成「调用方」 | 两处改为「27 处引用（含 3 处文档描述）」；Task README 的 Scope 拆解本就是 27 |
| Nit | **N3** `scripts/**` 不在任何 tsconfig 覆盖内，`scripts/prisma.ts` 的跨包相对 import 只由 bun 运行时验证 | 不改代码，记入下方限制 |

五轴结论：正确性/简单性已按上表修正；架构（解析器放包内、不进公共导出）与安全（无外部输入、无 secret、加引号使用）、性能（一次 `require.resolve` + 少量 `existsSync`，相对 `prisma migrate` 子进程可忽略）无 finding。

## 远端 CI（2026-09-17 核验：全绿）

分支 `fix/t27-prisma-cli-resolution`（`5d986a5`）已推送到 fork `Otirik-handi/cosmos`。`ci.yml` 的 `on.push` 只列 `master`，功能分支推送本身不触发 CI，因此用 `gh -R Otirik-handi/cosmos workflow run CI --ref fix/t27-prisma-cli-resolution` 手动触发：run **35178356761**。

| job | 结果 | 关键数字 |
| --- | --- | --- |
| Quality | ✓ 4m11s | `docs:check` 656 文件 0 失败；size 门禁 PASS；**`db:validate` schema valid**；`db:generate` ✓；`typecheck` ✓；`test` **570 passed (570)** / 94 文件；`test:property` **4 passed**；`lint:web` 0 error（83 条既有 warning）；`build` ✓ |
| Node process E2E | ✓ 1m13s | `test:e2e` 4 文件通过 |
| Browser E2E | ✓ 3m23s | `test:browser` **20 passed + 1 flaky**；`test:browser:component-lab` 14 passed |
| Windows Node smoke | ✓ 2m48s | `scripts/smoke-node.ps1` 通过 |

- 唯一 flaky 是 `e2e/browser/phase2-organization.spec.ts`（先失败、重试通过），与 [`docs/testing/known-unstable-cases.md`](../../../docs/testing/known-unstable-cases.md) 已登记的间歇用例一致，不是本切片引入，也没有新增失败。
- 这是自 2026-09-15 起 CI 第一次越过 `db:validate` 并真正执行其后全部步骤——维护者验收的第二条据此达成。
- 操作坑：本 worktree 里 `gh` 会把默认仓库解析到 `upstream`（`notnotype/cosmos`）而不是 `origin`（fork），所有 `gh` 命令都必须带 `-R Otirik-handi/cosmos`；这与 Task 10 记过的同一次误判是同一个原因。

## 下一步

1. `--no-ff` 合入 master 并推送（已获授权）；worktree 与分支按要求保留，清理需另行授权。
2. 合并后由维护者决定 `PROJECT-STATUS.md` 的 9k token 余量（切历史分册 / 登记基线）与锁文件—工具链漂移两项，见 README 的 Follow-ups。
3. 仍未验证：Docker/Compose 实跑、真实来源联网验收。
