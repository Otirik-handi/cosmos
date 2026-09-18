import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const FEED_URL = "http://127.0.0.1:4380/feed.xml";
const FEED_LIST = 'section[aria-label="阅读流"]';

/** 每个场景自建来源并触发录入，不依赖其它 spec 留下的数据。 */
async function ingestFeed(page: import("@playwright/test").Page, prefix: string): Promise<string> {
    const sourceName = `${prefix}-${randomUUID().slice(0, 8)}`;
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建来源" }).click();
    await page.getByLabel("名称", { exact: true }).fill(sourceName);
    await page.getByLabel("Feed URL").fill(FEED_URL);
    await page.getByRole("button", { name: "保存来源" }).click();
    await expect(page.getByText("来源已保存，当前为停用状态")).toBeVisible();

    const healthSection = page.getByRole("heading", { name: "来源健康" }).locator("..").locator("..");
    await healthSection.getByRole("button", { name: `启用 ${sourceName}`, exact: true }).click();
    await expect(page.getByText("已启用；可执行手动录入")).toBeVisible();
    await healthSection.getByRole("button", { name: sourceName, exact: true }).click();
    await expect(page.getByText("录入任务已排队", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(
        page.locator("article").filter({ hasText: sourceName }).first(),
    ).toBeVisible({ timeout: 180_000 });
    return sourceName;
}

/**
 * 回归：搜索提交后，早于搜索发起的 Feed 刷新不得覆盖搜索结果。
 *
 * 竞态（修复前）：`use-feed-workspace` 的 refresh 按发起时的搜索条件取数、返回后无条件
 * setFeed；页面挂载时发起的那次 refresh 携带 activeSearch = null，若它在搜索之后才返回，
 * 就会把搜索置空的列表重新写成"最新内容"，而搜索条件与提示语仍停留在搜索态。
 * 这里人为延迟 Feed 响应，把这个先后顺序从"偶发"变成"必然"。
 */
test("搜索提交后，早于搜索发起的 Feed 刷新不得覆盖搜索结果", async ({ page }) => {
    test.setTimeout(300_000);
    await ingestFeed(page, "陈旧响应");

    await page.route("**/api/v1/feed**", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        await route.continue();
    });

    await page.goto("/");
    await page.getByLabel("搜索已保存内容").fill(`绝不匹配-${randomUUID().slice(0, 8)}`);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByText("搜索到 0 条结果。")).toBeVisible();

    // 越过延迟窗口：此时早于搜索发起的那次 refresh 已经返回并写过状态。
    await page.waitForTimeout(5_000);

    await expect(page.locator(FEED_LIST).locator("article")).toHaveCount(0);
    await expect(page.getByText("搜索到 0 条结果。")).toBeVisible();
});
