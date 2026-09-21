import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const FEED_URL = "http://127.0.0.1:4380/feed.xml";

/** 每个场景自建来源并触发一次录入，不依赖其它 spec 留下的数据。 */
async function ingestFeed(page: import("@playwright/test").Page, prefix: string): Promise<string> {
    const sourceName = `${prefix}-${randomUUID().slice(0, 8)}`;
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建计划" }).click();
    await page.getByLabel("名称", { exact: true }).fill(sourceName);
    await page.getByLabel("Feed URL").fill(FEED_URL);
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("采集计划已保存，当前为停用状态")).toBeVisible();

    const healthSection = page.getByRole("heading", { name: "采集计划" }).locator("..").locator("..");
    await healthSection.getByRole("button", { name: `启用 ${sourceName}`, exact: true }).click();
    await expect(page.getByText("已启用；可执行手动录入")).toBeVisible();
    await healthSection.getByRole("button", { name: sourceName, exact: true }).click();
    await expect(page.getByText("录入任务已排队", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(
        page.locator("article").filter({ hasText: sourceName }).first(),
    ).toBeVisible({ timeout: 180_000 });
    return sourceName;
}

function healthSection(page: import("@playwright/test").Page) {
    return page.getByRole("heading", { name: "采集计划" }).locator("..").locator("..");
}

/**
 * AUT-001「删除来源」的 Web 入口：两段确认，且只删配置与定时。
 *
 * 这条用例补的是产品面证据缺口（Task 32 切片 4 记录过：删除入口只有类型/组件层证据）：
 * 第一次点击只切确认态并解释后果，第二次才发命令；删除后来源从采集计划看板消失，
 * 但它已录入的 Story 仍在 Feed 里（墓碑语义，历史保留）。
 */
test("删除来源需要两段确认，删除后保留已录入内容", async ({ page }) => {
    test.setTimeout(300_000);
    const sourceName = await ingestFeed(page, "删除来源");

    const health = healthSection(page);
    const row = health.locator("li").filter({ hasText: sourceName });
    await expect(row).toBeVisible();

    const deleteButton = row.getByRole("button", { name: `删除 ${sourceName}`, exact: true });
    await deleteButton.click();

    // 第一段：只切确认态，计划仍在，且明确说明只移除采集配置与定时。
    await expect(row.getByText("删除计划只移除采集配置与定时", { exact: false })).toBeVisible();
    await expect(row).toBeVisible();

    await row.getByRole("button", { name: `确认删除 ${sourceName}`, exact: true }).click();

    // 第二段：来源从采集计划看板消失。
    await expect(health.locator("li").filter({ hasText: sourceName })).toHaveCount(0, {
        timeout: 15_000,
    });

    // 墓碑语义：配置没了，已录入的 Story 与来源溯源都还在。
    await expect(
        page.locator("article").filter({ hasText: sourceName }).first(),
    ).toBeVisible();
    await expect(
        page.locator("article").filter({ hasText: "Cosmos scaffold is ready" }).first(),
    ).toBeVisible();
});

/**
 * LIB-001 的三个过滤维度在 Web 表单里确实驱动查询。
 *
 * 断言不写死媒体状态这类会随采集策略变化的值：条数一律用「同一条件直查 API」判定。
 * 注意搜索结果是 Entry 分页、Feed 是 Story 卡片，两者不是同一投影，不能互相计数。
 * 作者用「fixture 条目没有发布者 → 任何作者条件命中 0 条」判定，媒体类型用
 * 「RSS 条目一律是 article → 文章条件命中全部、视频条件命中 0 条」判定。
 */
test("LIB-001 的作者、媒体类型、录入状态过滤驱动查询", async ({ page }) => {
    test.setTimeout(300_000);
    const sourceName = await ingestFeed(page, "搜索过滤");

    // 与页面同页大小（page.tsx 的搜索提交固定 limit: 20）：结果提示是分页条数，
    // 不是全库条数，直查 API 必须用同一 limit 才可比。
    const searchCount = async (query: string): Promise<number> =>
        page.evaluate(async (search) => {
            const response = await fetch(`/api/v1/search?${search}&limit=20`);
            const body = (await response.json()) as { items: unknown[] };
            return body.items.length;
        }, query);

    const feedList = page.locator('section[aria-label="阅读流"]');
    const resultNotice = page.getByText(/^搜索到 \d+ 条结果。$/);
    const sourceCards = feedList.locator("article").filter({ hasText: sourceName });

    await page.getByLabel("搜索作者").fill(`不存在作者-${randomUUID().slice(0, 8)}`);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByText("作者：", { exact: false })).toBeVisible();
    await expect(page.getByText("搜索到 0 条结果。")).toBeVisible();
    await expect(sourceCards).toHaveCount(0);

    // 换成媒体类型：RSS 条目一律是「文章」，视频条件应为空。
    await page.getByLabel("搜索作者").fill("");
    await page.getByLabel("媒体类型").selectOption("video");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByText("媒体类型：视频", { exact: false })).toBeVisible();
    await expect(page.getByText("搜索到 0 条结果。")).toBeVisible();
    expect(await searchCount("contentKind=video")).toBe(0);

    await page.getByLabel("媒体类型").selectOption("article");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByText("媒体类型：文章", { exact: false })).toBeVisible();
    const articleCount = await searchCount("contentKind=article");
    expect(articleCount).toBeGreaterThan(0);
    await expect(resultNotice).toHaveText(`搜索到 ${articleCount} 条结果。`);

    // 录入状态：同样以 API 直查条数为准，UI 只是把同一条件发出去。
    await page.getByLabel("媒体类型").selectOption("");
    await page.getByLabel("录入状态").selectOption("skipped");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByText("录入状态：未保存", { exact: false })).toBeVisible();
    const skippedCount = await searchCount("assetStatus=skipped");
    await expect(resultNotice).toHaveText(`搜索到 ${skippedCount} 条结果。`);

    // 清除筛选回到默认 Feed，条目全部回来。
    await page.getByRole("button", { name: "清除筛选" }).click();
    await expect(sourceCards).not.toHaveCount(0);
});
