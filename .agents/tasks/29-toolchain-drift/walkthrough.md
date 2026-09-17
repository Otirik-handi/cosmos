# Task 29 walkthrough：工具链与依赖源固定

基线：`origin/master` = `9f22c15`（Task 26 刚合入）。分支：`chore/t29-toolchain-drift`，worktree `.worktree/t29-toolchain-drift`。

## 本轮假设与自我纠正

- 初始假设：仓库没有源配置，所以**任何人跑一次普通的 `bun install` 都会把锁文件里的 1,026 条镜像地址整体改写**，产生一千多行 diff。
- **实测推翻了它**（见实验 2）：锁文件里已有的条目是"粘"的，不会因为本机/仓库配置不同而被改写。真实机制是"**新解析出来**的条目跟随配置写地址"。风险因此从"锁文件被整体改写"修正为"锁文件会随不同人的环境长成混合来源"。bunfig 注释与 README 已按实测结论改写。

## 事实基线（改动前）

| 项 | 值 |
| --- | --- |
| `bun.lock` | 321,103 B；`npmmirror` 出现 1,026 次、`registry.npmjs.org` 0 次；`configVersion` 0 次；`lockfileVersion` 1 |
| 镜像何时进入锁 | `cc97d4c`（G02，+980；该提交引入 madge / coverage 等新依赖，触发重新解析）→ `cb2b082`（+42）→ `a270079`（+4，并把 `configVersion` 1 → 0） |
| bun 版本引用 | `packageManager` 1.3.14 ／ CI `BUN_VERSION` 1.4.2 ／ `docker/Dockerfile` 1.3.14；本机 1.4.2 |
| 仓库级源配置 | 无 `bunfig.toml`、无 `.npmrc` |

## 实验（全部在临时目录进行，不改仓库）

| # | 实验 | 结果 |
| --- | --- | --- |
| 1 | 复制锁与各 workspace 的 `package.json` 到临时目录，跑 `bun install --lockfile-only` | 锁文件只新增一行 `"configVersion": 0,`（+22 B）；`npmmirror` 1,026 → 1,026，978 个包原样 → **零依赖变化** |
| 2 | 同一临时目录，把 `bunfig.toml` 指向官方源后再跑 | `registry.npmjs.org` 0 次、`npmmirror` 1,026 次 → **已有条目不会被改写**（推翻初始假设） |
| 3 | 极小工程（只依赖 `is-odd`）分别用 bunfig=npmmirror / npmjs 各装一次 | npmmirror → 锁里写入 `https://registry.npmmirror.com/…`；npmjs → bun 不写地址（按默认源解析）→ **新条目跟随配置** |
| 4 | 本 worktree 连跑两次 `--lockfile-only`，比对 SHA256 | 两次哈希相同（`6EF2ED12…`）→ 声明的源与锁内容一致、无改写抖动 |

## 改动

| 文件 | 改动 |
| --- | --- |
| `bunfig.toml`（新增） | 显式声明 `registry = "https://registry.npmmirror.com"`；注释写明上述实测结论、改源需要重生成锁文件 |
| `package.json` | `packageManager` `bun@1.3.14` → **`bun@1.4.2`** |
| `docker/Dockerfile` | `FROM oven/bun:1.3.14` → **`oven/bun:1.4.2`**（注释说明三处一致的原因 + 未做容器实跑） |
| `.github/workflows/ci.yml` | 注释改为「与 `packageManager`、Dockerfile 保持一致」（值不变，仍是 1.4.2） |
| `bun.lock` | +1 行：`"configVersion": 0,` |

## 验证

| 命令 | 结果 |
| --- | --- |
| `bun install --frozen-lockfile`（worktree 内，真实 CI 命令） | exit 0，844 包 / 17.16s；**新 `bunfig.toml` 不影响冻结安装** |
| 冻结安装后 `git diff --stat bun.lock` | 仍是 1 行新增（`configVersion`），安装过程没有改写锁文件 |
| `bun run docs:check` | 675 文件 0 失败 |
| `python scripts/size-governance.py -c docs --check …` | PASS（含既有 warning） |
| `git diff --check` | 干净 |
| `PROJECT-STATUS.md` token | 8,061 / 9,000（余量 939） |

## 未运行 / 限制

- **Docker 构建与启动未运行**（本机没有 Docker CLI）：`oven/bun:1.4.2` 这个 tag 已用 Docker Hub API 核实存在（`last_updated` 2026-09-05），但"构建 + `--frozen-lockfile` + 启动"没有运行证据。
- 没有重生成锁文件、没有换回官方源（Non-goals；换源需要单独切片与完整验证）。
- 未跑全量单测 / typecheck：本切片不改产品代码，锁文件的依赖解析零变化。
