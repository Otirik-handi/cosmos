import { expect, test } from "@playwright/test";

test("creates a fixture source, runs ingest, and opens a Story", async ({ page }) => {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos" })).toBeVisible();

    await page.getByRole("button", { name: "新建来源" }).click();
    await page.getByLabel("名称").fill("浏览器 Fixture 来源");
    await page.getByLabel("Fixture 路径").fill("fixtures/rss/basic.xml");
    await page.getByRole("button", { name: "保存来源" }).click();
    await expect(page.getByRole("status")).toContainText("来源已创建");

    const ingestSection = page.getByRole("heading", { name: "来源与录入" }).locator("..") .locator("..");
    const sourceButton = ingestSection.getByRole("button", { name: "浏览器 Fixture 来源" }).first();
    await expect(sourceButton).toBeVisible();
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

    await page.screenshot({ path: "test-results/ingest-story.png", fullPage: true });
});
