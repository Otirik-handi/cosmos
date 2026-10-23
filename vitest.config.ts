import { configDefaults, defineConfig } from "vitest/config";
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
            // 其它 workspace 包都在这里指向源码；漏掉 agent-pi-ai 会让测试落到已经过期的
            // dist/ 上（node 解析条件取 dist，bun 条件才取 src），源码里的新导出在测试里
            // 变成 undefined。
            "@cosmos/agent-pi-ai": resolve(rootDirectory, "packages/agent-pi-ai/src/index.ts"),
            "@cosmos/worker-admin": resolve(rootDirectory, "packages/worker-admin/src/index.ts"),
        },
    },
    test: {
        include: [
            "packages/**/src/**/*.test.ts",
            "plugins/**/src/**/*.test.ts",
            "apps/**/src/**/*.test.ts",
            "scripts/**/*.test.ts",
            ".agents/tasks/39-pi-ai-adapter/**/*.test.ts",
        ],
        exclude: [...configDefaults.exclude, "**/*.property.test.ts"],
        environment: "node",
        // Prisma/SQLite 用例单条 3~5s,与 vitest 默认 5s 余量过窄,并行时偶发假失败;
        // 与 property/e2e 配置保持一致。
        testTimeout: 60_000,
        hookTimeout: 120_000,
        coverage: {
            provider: "v8",
            include: [
                "packages/**/src/**/*.{ts,tsx}",
                "plugins/**/src/**/*.{ts,tsx}",
                "apps/**/src/**/*.{ts,tsx}",
                "scripts/**/*.ts",
            ],
            exclude: ["**/*.test.ts", "**/*.d.ts"],
        },
        passWithNoTests: false,
    },
});
