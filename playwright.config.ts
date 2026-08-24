import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
    testDir: "./e2e/browser",
    fullyParallel: false,
    workers: 1,
    retries: process.env.CI ? 2 : 0,
    timeout: 60_000,
    expect: {
        timeout: 10_000,
    },
    reporter: process.env.CI ? [["line"], ["html", { open: "never" }]] : "list",
    use: {
        baseURL: `http://127.0.0.1:${process.env.COSMOS_E2E_WEB_PORT ?? "4173"}`,
        trace: "retain-on-failure",
        screenshot: "only-on-failure",
        video: "retain-on-failure",
        ...devices["Desktop Chrome"],
    },
    webServer: [
        {
            command: "bun run scripts/e2e/rss-fixture-server.ts",
            url: "http://127.0.0.1:4380/feed.xml",
            reuseExistingServer: false,
            timeout: 30_000,
            stdout: "pipe",
            stderr: "pipe",
        },
        {
            command: `bun run scripts/e2e/web-stack.ts ${process.env.COSMOS_E2E_WEB_PORT ?? "4173"}`,
            url: `http://127.0.0.1:${process.env.COSMOS_E2E_WEB_PORT ?? "4173"}`,
            reuseExistingServer: false,
            timeout: 120_000,
            stdout: "pipe",
            stderr: "pipe",
        },
    ],
});
