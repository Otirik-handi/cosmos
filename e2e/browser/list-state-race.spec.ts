import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const FEED_URL = "http://127.0.0.1:4380/feed.xml";

/**
 * 回归：列表状态的读取必须有顺序，且不得变成渲染循环的一部分。
 *
 * 两处都是实测过的产品缺陷：
 * ① 首屏那次 `/api/v1/collection-plans` 读取在用户建计划之前抓到快照，却在建完之后
 *    才落地，把刚建的计划从「采集计划」列表里抹掉——行内的「媒体策略」「启用」等按钮
 *    随之永远等不到（这正是 P4-1 台账里 media-policy 那条的症状形态）。
 * ② `page.tsx` 每次渲染新建的 workspace context 让 `use-source-workspace` 的挂载
 *    effect 每次渲染都重跑：实测一个页面会话对 `/collection-plans` 与 `/connections`
 *    各发了 300+ 次读取，整套验收被拖慢数倍，也是台账里"整轮明显变慢"的来源。
 */

/** 扣住某路径的**第一次**读取：请求立刻发出（快照就是那一刻的），延迟 N 毫秒才交付。 */
async function holdFirstRead(page: import("@playwright/test").Page, pattern: RegExp, holdMs: number): Promise<void> {
    let first = true;
    await page.route(pattern, async (route) => {
        if (!first) {
            await route.continue();
            return;
        }
        first = false;
        const response = await route.fetch();
        await new Promise((resolve) => setTimeout(resolve, holdMs));
        await route.fulfill({ response });
    });
}

test("先发起的计划列表读取晚落地时不得抹掉刚建的计划", async ({ page }) => {
    test.setTimeout(120_000);
    await holdFirstRead(page, /\/api\/v1\/collection-plans(\?|$)/, 6_000);

    const planName = `陈旧读取-${randomUUID().slice(0, 8)}`;
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建计划" }).click();
    await page.getByLabel("名称", { exact: true }).fill(planName);
    await page.getByLabel("Feed URL").fill(FEED_URL);
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("采集计划已保存，当前为停用状态")).toBeVisible();

    const section = page.getByRole("heading", { name: "采集计划" }).locator("..").locator("..");
    const row = section.locator("li").filter({ hasText: planName });
    await expect(row).toBeVisible();

    // 越过延迟窗口：此时"建计划之前"抓到的那次读取已经返回并写过状态。
    await page.waitForTimeout(7_000);

    await expect(row).toBeVisible();
    await expect(row.getByRole("button", { name: `媒体策略 ${planName}` })).toBeVisible();
});

test("首屏之后不得反复重读计划与连接列表", async ({ page }) => {
    test.setTimeout(60_000);
    const reads: string[] = [];
    page.on("request", (request) => {
        const url = request.url();
        if (url.includes("/api/v1/collection-plans") || url.includes("/api/v1/connections")) {
            reads.push(url.replace("http://127.0.0.1:4173", ""));
        }
    });

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    await page.waitForTimeout(3_000);
    const initialReads = reads.length;
    // 3 秒的静置期里，页面只该有首屏那一次读取（各一条）；渲染循环会把它推到几百条。
    expect(
        initialReads,
        `静置 3 秒内计划/连接列表被读取了 ${initialReads} 次：${reads.slice(0, 8).join(", ")}`,
    ).toBeLessThanOrEqual(8);
});
