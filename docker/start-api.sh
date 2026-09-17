#!/bin/sh
# 运行时镜像是纯 Node，所以这里用构建产物里的共享解析器取 Prisma CLI 位置，
# 而不是固定路径（布局随 bun 版本与 lock 变化：包内、工作区根或 bun store）。
set -e

PRISMA_CLI="$(node -e "import('./packages/storage-prisma/dist/prisma-cli.js').then(m => process.stdout.write(m.resolvePrismaCliPath())).catch(e => { console.error(e.message); process.exit(1); })")"

mkdir -p /var/lib/cosmos
touch /var/lib/cosmos/cosmos.sqlite
node "$PRISMA_CLI" migrate deploy --schema packages/storage-prisma/prisma/schema.prisma
exec node apps/api/dist/main.js
