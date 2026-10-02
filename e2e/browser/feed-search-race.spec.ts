import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { ingestFeed, waitForStoryId } from "../support/story-flow";

const FEED_LIST = 'section[aria-label="阅读流"]';

/**
 * 回归：搜索提交后，早于搜索发起的 Feed 刷新不得覆盖搜索结果。
 *
 * 竞态（修复前）：`use-feed-workspace` 的 refresh 按发起时的搜索条件取数、返回后无条件
 * setFeed；页面挂载时发起的那次 refresh 携带 activeSearch = null，若它在搜索之后才返回，
 * 就会把搜索置空的列表重新写成"最新内容"，而搜索条件与提示语仍停留在搜索态。
 * 这里人为延迟 Feed 响应，把这个先后顺序从"偶发"变成"必然"。
 *
 * 录入前置在 `/automation`、检索在 `/library`（ADR-0029 决策 1、8）。本用例自建来源并等
 * 它真的可读：那次陈旧刷新必须有内容可写，否则竞态根本不会被触发。
 */
test("搜索提交后，早于搜索发起的 Feed 刷新不得覆盖搜索结果", async ({ page }) => {
    test.setTimeout(300_000);
    const sourceName = await ingestFeed(page, "陈旧响应");
    await waitForStoryId(page, sourceName);

    await page.route("**/api/v1/feed**", async (route) => {
        await new Promise((resolve) => setTimeout(resolve, 3_000));
        await route.continue();
    });

    await page.goto("/library");
    await page.getByLabel("搜索已保存内容").fill(`绝不匹配-${randomUUID().slice(0, 8)}`);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByText("搜索到 0 条结果。")).toBeVisible();

    // 越过延迟窗口：此时早于搜索发起的那次 refresh 已经返回并写过状态。
    await page.waitForTimeout(5_000);

    await expect(page.locator(FEED_LIST).locator("article")).toHaveCount(0);
    await expect(page.getByText("搜索到 0 条结果。")).toBeVisible();
});
