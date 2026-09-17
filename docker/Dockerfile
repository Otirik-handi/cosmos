# 与 package.json 的 packageManager 和 CI 的 BUN_VERSION 保持一致：不同 bun 版本为
# workspace 依赖生成的 node_modules 布局不同（1.3.14 把 Prisma CLI 放在包内、
# 1.4.2 提到工作区根），三处不一致会让「本机可以、镜像里不行」随机发生。
# 本机没有 Docker CLI，该版本切换未经容器实跑验证。
FROM oven/bun:1.4.2 AS build

WORKDIR /app
ARG COSMOS_API_URL=http://localhost:4310
ENV COSMOS_API_URL=${COSMOS_API_URL}

COPY package.json bun.lock tsconfig.base.json tsconfig.node.json ./
COPY apps/api/package.json apps/api/package.json
COPY apps/web/package.json apps/web/package.json
COPY apps/worker/package.json apps/worker/package.json
COPY packages/application/package.json packages/application/package.json
COPY packages/blob-store/package.json packages/blob-store/package.json
COPY packages/contracts/package.json packages/contracts/package.json
COPY packages/domain/package.json packages/domain/package.json
COPY packages/logging/package.json packages/logging/package.json
COPY packages/storage-prisma/package.json packages/storage-prisma/package.json
COPY packages/worker-admin/package.json packages/worker-admin/package.json
COPY packages/transport-http/package.json packages/transport-http/package.json
COPY plugins/collectors/package.json plugins/collectors/package.json
COPY plugins/rss/package.json plugins/rss/package.json

RUN bun install --frozen-lockfile

COPY . .

RUN bun run build

FROM node:24-bookworm-slim AS runtime

WORKDIR /app
ENV NODE_ENV=production
ENV COSMOS_DATA_ROOT=/var/lib/cosmos
ENV DATABASE_URL=file:/var/lib/cosmos/cosmos.sqlite

COPY --from=build /app/ /app/
RUN if [ -d apps/web/.next/static ]; then \
        mkdir -p apps/web/.next/standalone/apps/web/.next \
        && cp -a apps/web/.next/static apps/web/.next/standalone/apps/web/.next/; \
    fi \
    && if [ -d apps/web/public ]; then \
        mkdir -p apps/web/.next/standalone/apps/web \
        && cp -a apps/web/public apps/web/.next/standalone/apps/web/; \
    fi

RUN mkdir -p /var/lib/cosmos

EXPOSE 3000 4310

CMD ["sh", "/app/docker/start-api.sh"]
