# Docker 验收首次实跑记录（2026-09-23）

**这份是验证记录，不是合同，也不是 Task**：它只记录「第一次真正在容器里跑 `test:docker` 时发生了什么」、证据、根因与候选修复。修复本身按维护者要求**后续单开 Task** 处理。

## 结论

`bun run test:docker` 在本机**首次实跑即失败**，失败点在镜像构建的 `RUN bun run build`，根因是 `docker/Dockerfile` **没有生成 Prisma client 的步骤**——不是网络问题，也与本次 EXT-006 改动无关（本会话分支从未触碰 `docker/`：`git diff 61ac764..HEAD -- docker/` 为空；该目录最后一次改动是 `3489a0a`）。

## 环境事实

- Docker Desktop 29.7.2（client/server 一致），Docker Compose v5.5.1；守护进程由维护者 2026-09-23 启动。
- **Docker Hub 在本机不可达**：`curl -4/-6 https://registry-1.docker.io/v2/` 均为连接失败（`000`），`auth.docker.io` 的 v4/v6 也一样。
- 因此两个基础镜像改经可达的公共镜像站取回，再在本地改回 Dockerfile 期望的名字；**仓库文件一行未改**：
  - `docker.m.daocloud.io/oven/bun:1.4.2` → `oven/bun:1.4.2`（digest `sha256:9114c058aeae42162ee16dd5084b95fe9473970bb6bcb5b232ab1630f0546895`）
  - `docker.m.daocloud.io/library/node:24-bookworm-slim` → `node:24-bookworm-slim`（digest `sha256:0e0ff40c39bc087845bfb27465a0df4ea419520094bc35842ff83dd8cbe6f9b6`）
  - **不确定**：镜像站内容与官方 tag 是否逐字节一致（本机无法访问 Docker Hub 比对官方 digest）。若要严格复现，应改用可达的官方通道或配置 registry mirror。

## 失败证据

```text
$ bun run test:docker          # → scripts/e2e/docker-flow.ts
  docker compose -f docker/compose.yml up --build -d
  ...
  #30 [web build 8/8] RUN bun run build
  packages/storage-prisma/src/workflow-host-store/run-lifecycle-store.ts(57,48): error TS7006: Parameter 'tx' implicitly has an 'any' type.
  packages/storage-prisma/src/workflow-host-store/run-lifecycle-store.ts(106,48): error TS7006: Parameter 'tx' implicitly has an 'any' type.
  packages/storage-prisma/src/workflow-host-store/run-lifecycle-store.ts(227,26): error TS7006: Parameter 'row' implicitly has an 'any' type.
  target web: failed to solve: process "/bin/sh -c bun run build" did not complete successfully: exit code: 2
```

## 根因

1. `docker/Dockerfile` 的构建阶段顺序是 `bun install --frozen-lockfile` → `COPY . .` → `bun run build`，**没有 `prisma generate` 这一步**。
2. bun 默认**不执行**依赖的 `postinstall` 脚本，根 `package.json` 也没有 `trustedDependencies`，所以 `@prisma/client` 的自动生成在容器里从未发生。
3. 生成的 Prisma client 类型缺失时，`this.prisma` 退化为 `any`，`this.prisma.$transaction(async (tx) => …)` 的回调参数就成了隐式 `any`（`noImplicitAny` 下报 TS7006）。容器里报的 3 处正是这种形态。
4. 本机之所以看不出来：本机跑过 `bun run db:generate`，`node_modules` 里有生成物。

**为什么一直没暴露**：`test:docker` 不在 `test`、`test:e2e` 或默认 CI 里（见 [`docs/testing/README.md`](../testing/README.md)）；`docker/Dockerfile` 第 4 行的注释也自述「本机没有 Docker CLI，该版本切换未经容器实跑验证」。这次是该镜像第一次被真正构建。

## 候选修复与未知项（留给将来的 Task）

- **候选**：在 `RUN bun run build` 之前加 `RUN bun run db:generate`（脚本见 [`scripts/prisma.ts`](../../scripts/prisma.ts)，它只是把命令转给 Prisma CLI 并带上 schema 路径）。副作用很小：构建阶段会在 `/app/.cosmos/` 造一个空 sqlite 文件（脚本的既有行为）。
- **未知项**：容器内能否下载 Prisma 引擎。本机对 `https://binaries.prisma.sh/` 有响应（`404`，即服务可达），但**容器内的下载路径未验证**；若不可达，修复会扩大为 vendored 引擎或离线生成路径。
- **验收草案**：`bun run test:docker` 全流程通过（compose 起服务 → 受控 RSS 完成激活/Run/Feed 验收 → `down --volumes`），并记录实际命令与输出；同时把这次的环境前提（镜像来源、registry mirror）写进记录。
- **明确不做**：不在 EXT-006 的切片里顺手修（该分支已合并），也不把本记录当成合同或验收结论。
