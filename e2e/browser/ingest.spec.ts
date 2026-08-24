import { expect, test } from "@playwright/test";

test("creates an RSS source, runs ingest, and opens a Story", async ({ page }) => {
    const consoleErrors: string[] = [];
    const pageErrors: string[] = [];
    const failedRequests: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });
    page.on("pageerror", (error) => pageErrors.push(error.message));
    page.on("requestfailed", (request) => {
        failedRequests.push(`${request.method()} ${request.url()}`);
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos" })).toBeVisible();

    await page.getByRole("button", { name: "新建来源" }).click();
    await page.getByLabel("名称").fill("浏览器 RSS 来源");
    await page.getByLabel("Feed URL").fill("http://127.0.0.1:4380/feed.xml");
    await page.getByRole("button", { name: "保存来源" }).click();
    await expect(page.getByRole("status")).toContainText("RSS 来源已保存并启用");

    const ingestSection = page.getByRole("heading", { name: "来源与录入" }).locator("..").locator("..");
    const sourceButton = ingestSection.getByRole("button", { name: "浏览器 RSS 来源" }).first();
    await expect(sourceButton).toBeVisible();
    await expect(sourceButton).toBeEnabled();
    await sourceButton.click();
    await expect(page.getByRole("status")).toContainText("录入任务已排队", { timeout: 15_000 });

    await expect(page.getByRole("heading", { name: "Story Feed" })).toBeVisible();
    await expect(page.getByText("Cosmos scaffold is ready")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Message without a web URL")).toBeVisible();
    await page.getByRole("button", { name: "打开 Story" }).first().click();
    const storyDetail = page.getByText("· 1 个 Revision");
    await expect(storyDetail).toBeVisible();
    await expect(
        page.getByText("The third item carries media metadata without requiring a download.", {
            exact: true,
        }).last(),
    ).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    await page.screenshot({ path: "test-results/ingest-story.png", fullPage: true });
});
