FROM oven/bun:1.3.14 AS build

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

RUN mkdir -p /var/lib/cosmos

EXPOSE 3000 4310

CMD ["sh", "-c", "mkdir -p /var/lib/cosmos && touch /var/lib/cosmos/cosmos.sqlite && node packages/storage-prisma/node_modules/prisma/build/index.js migrate deploy --schema packages/storage-prisma/prisma/schema.prisma && node apps/api/dist/main.js"]
