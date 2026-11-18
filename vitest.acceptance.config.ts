import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const rootDirectory = resolve(import.meta.dirname);

export default defineConfig({
    resolve: {
        alias: {
            "@": resolve(rootDirectory, "apps/web/src"),
            "@cosmos/contracts": resolve(rootDirectory, "packages/contracts/src/index.ts"),
            "@cosmos/logging": resolve(rootDirectory, "packages/logging/src/index.ts"),
            "@cosmos/domain": resolve(rootDirectory, "packages/domain/src/index.ts"),
            "@cosmos/application": resolve(rootDirectory, "packages/application/src/index.ts"),
            "@cosmos/blob-store": resolve(rootDirectory, "packages/blob-store/src/index.ts"),
            "@cosmos/storage-prisma": resolve(rootDirectory, "packages/storage-prisma/src/index.ts"),
            "@cosmos/plugin-rss": resolve(rootDirectory, "plugins/rss/src/index.ts"),
            "@cosmos/plugin-collectors": resolve(rootDirectory, "plugins/collectors/src/index.ts"),
            "@cosmos/transport-http": resolve(rootDirectory, "packages/transport-http/src/index.ts"),
            "@cosmos/agent-pi-ai": resolve(rootDirectory, "packages/agent-pi-ai/src/index.ts"),
            "@cosmos/worker-admin": resolve(rootDirectory, "packages/worker-admin/src/index.ts"),
        },
    },
    test: {
        // 验收层：这些用例会构建产物、起真实 API/Worker 进程或部署迁移，属于重测。
        // 目录级通配让新 Task 的验收用例自动进入本层，不会变成没人执行的孤儿测试。
        include: ["scripts/acceptance/**/*.test.ts", ".agents/tasks/**/*.test.ts"],
        exclude: ["**/*.property.test.ts"],
        environment: "node",
        // 验收用例共享构建产物、端口与隔离根，并行执行会互相干扰。
        fileParallelism: false,
        testTimeout: 120_000,
        hookTimeout: 300_000,
        passWithNoTests: false,
    },
});
