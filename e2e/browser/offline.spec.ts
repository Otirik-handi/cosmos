import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

test("offline: locally saved images render from the API after the network is blocked", async ({ page }) => {
    test.setTimeout(300_000);

    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();

    // 使用本地受控 RSS：feed 与正文图片都来自 127.0.0.1，避免真实外网决定 CI 结果。
    const sourceName = `离线媒体-${randomUUID().slice(0, 8)}`;
    await page.getByRole("button", { name: "新建来源" }).click();
    const feedUrlInput = page.getByLabel("Feed URL");
    await expect(feedUrlInput).toBeVisible();
    // 精确匹配：Saved View 的“视图名称”输入框也包含“名称”子串。
    await page.getByLabel("名称", { exact: true }).fill(sourceName);
    await feedUrlInput.fill("http://127.0.0.1:4380/offline.xml");
    await page.getByRole("button", { name: "保存来源" }).click();
    await expect(page.getByText("来源已保存，当前为停用状态")).toBeVisible();

    const healthSection = page.getByRole("heading", { name: "来源健康" }).locator("..").locator("..");
    const enableButton = healthSection.getByRole("button", { name: `启用 ${sourceName}`, exact: true });
    await enableButton.click();
    await expect(page.getByText("已启用；可执行手动录入")).toBeVisible();

    const runButton = healthSection.getByRole("button", { name: sourceName, exact: true });
    await runButton.click();
    await expect(page.getByText("录入任务已排队", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    // Wait until this test's own feed items appear; earlier specs may already
    // have produced stories, so "any Story trigger" is not a completion signal.
    await expect(page.getByRole("heading", { name: "Story Feed" })).toBeVisible();
    await expect(page.getByText("Offline saved media").first()).toBeVisible({ timeout: 180_000 });
    const storyTriggers = page.getByRole("button", { name: "打开 Story" });
    await expect(storyTriggers.first()).toBeVisible({ timeout: 180_000 });

    // Find a Story with at least one saved image by iterating through the feed.
    let foundSavedImage = false;
    const storyCount = Math.min(await storyTriggers.count(), 10);
    for (let i = 0; i < storyCount; i++) {
        await storyTriggers.nth(i).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const savedImage = dialog.locator("[data-asset-status=saved] img").first();
        const hasSaved = (await savedImage.count()) > 0;
        if (hasSaved) {
            // Online: verify image loads from local API.
            await expect(savedImage).toHaveAttribute("src", /\/api\/v1\/assets\//);
            await expect.poll(async () => (
                await savedImage.evaluate((el) => (el as HTMLImageElement).naturalWidth)
            )).toBeGreaterThan(0);
            foundSavedImage = true;
            break;
        }
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
    }
    expect(foundSavedImage, "At least one Story should have a saved image").toBe(true);

    // Block all non-localhost requests to simulate offline.
    await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
            return route.continue();
        }
        return route.abort();
    });

    // Reload and verify offline behavior.
    await page.reload();
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "打开 Story" }).first()).toBeVisible({ timeout: 30_000 });

    // Offline: find the same Story with saved image and verify it still renders.
    const offlineTriggers = page.getByRole("button", { name: "打开 Story" });
    let offlineVerified = false;
    const offlineCount = Math.min(await offlineTriggers.count(), 10);
    for (let i = 0; i < offlineCount; i++) {
        await offlineTriggers.nth(i).click();
        const dialog = page.getByRole("dialog");
        await expect(dialog).toBeVisible();
        const savedImage = dialog.locator("[data-asset-status=saved] img").first();
        if ((await savedImage.count()) > 0) {
            await expect(savedImage).toHaveAttribute("src", /\/api\/v1\/assets\//);
            await expect.poll(async () => (
                await savedImage.evaluate((el) => (el as HTMLImageElement).naturalWidth)
            )).toBeGreaterThan(0);
            offlineVerified = true;
            break;
        }
        await page.keyboard.press("Escape");
        await expect(dialog).not.toBeVisible();
    }
    expect(offlineVerified, "Saved image should render offline from local API").toBe(true);

    // Verify page is healthy after offline verification.
    await page.keyboard.press("Escape");
    await expect(page.getByRole("heading", { name: "Story Feed" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "来源健康" })).toBeVisible();
});
