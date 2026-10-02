import { expect, test } from "@playwright/test";

import { FEED_URL, ingestFeed } from "../support/story-flow";

/**
 * 受控 RSS fixture 的 `offline.xml`：与本套件用的 `feed.xml` 同源同端口，
 * 只换文件名。
 */
const OFFLINE_FEED_URL = new URL("/offline.xml", FEED_URL).toString();

/** 只有这一条 fixture 带本地图片；用它认领本来源的 Story，避免误判其它 spec 的卡片。 */
const OFFLINE_MEDIA_TITLE = "Offline saved media";

/** 已保存媒体走站内 API，断网后必须仍从这里取字节（ADR-0005）。 */
const SAVED_IMAGE_SRC = /\/api\/v1\/assets\//;

test("offline: locally saved images render from the API after the network is blocked", async ({ page }) => {
    test.setTimeout(300_000);

    // 使用本地受控 RSS：feed 与正文图片都来自 127.0.0.1，避免真实外网决定 CI 结果。
    const sourceName = await ingestFeed(page, "离线媒体", async (current) => {
        await current.getByLabel("Feed URL").fill(OFFLINE_FEED_URL);
    });

    // 从信息库的阅读流点开带图的那张卡片；新 IA 下这里导航到 `/stories/:id`。
    await page.goto("/library");
    const card = page
        .locator('section[aria-label="阅读流"]')
        .locator("article")
        .filter({ hasText: sourceName })
        .filter({ hasText: OFFLINE_MEDIA_TITLE })
        .first();
    await expect(card).toBeVisible({ timeout: 180_000 });
    await card.getByRole("button", { name: "打开 Story" }).click();
    await expect(page.locator("[data-story-id]")).toBeVisible();

    // Online: the saved image loads from the local API and really decodes.
    // 图是 loading="lazy" 且位于阅读页折叠线以下：先滚进视口再断言，否则这条断言依赖浏览器
    // 对屏外图片的预加载时机——页面并发请求一多就会被推迟，失败与「图片是否可取」无关。
    const savedImage = page
        .locator('section[aria-label="媒体"]')
        .locator("[data-asset-status=saved] img")
        .first();
    await expect(savedImage).toHaveAttribute("src", SAVED_IMAGE_SRC);
    await savedImage.scrollIntoViewIfNeeded();
    await expect.poll(async () => (
        await savedImage.evaluate((el) => (el as HTMLImageElement).naturalWidth)
    )).toBeGreaterThan(0);

    // Block all non-localhost requests to simulate offline.
    await page.route("**/*", (route) => {
        const url = new URL(route.request().url());
        if (url.hostname === "127.0.0.1" || url.hostname === "localhost") {
            return route.continue();
        }
        return route.abort();
    });

    // Reload the same Story and verify the bytes still come from the local API.
    await page.reload();
    const offlineImage = page
        .locator('section[aria-label="媒体"]')
        .locator("[data-asset-status=saved] img")
        .first();
    await expect(offlineImage).toBeVisible({ timeout: 30_000 });
    await expect(offlineImage).toHaveAttribute("src", SAVED_IMAGE_SRC);
    await offlineImage.scrollIntoViewIfNeeded();
    await expect.poll(async () => (
        await offlineImage.evaluate((el) => (el as HTMLImageElement).naturalWidth)
    )).toBeGreaterThan(0);

    // Verify the app is healthy after offline verification: 自动化页仍可读。
    await page.goto("/automation");
    await expect(page.getByRole("heading", { name: "自动化", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "采集计划", exact: true }).first()).toBeVisible();
});
