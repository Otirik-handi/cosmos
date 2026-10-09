import { expect, test } from "@playwright/test";

import { DEFERRED_MOBILE_WIDTH, MOBILE_WIDTH_VERIFIED } from "../support/viewports";
import {
    boardBlock,
    collectConsoleErrors,
    enterBoardEditing,
    expandEditSurface,
    FEED_URL,
    mergeStoryInto,
    planSectionOf,
    readStoryDetail,
    uniqueSourceName,
    waitForStoryIds,
} from "../support/story-flow";

/**
 * 端到端主链路的浏览器回归证据：建来源 → 真实抓取 → 阅读 → 编辑与归并 → 看板 → 检索。
 *
 * 切片 3 把这三段拆到了三个页面（`/automation` 配置、`/library` 浏览、`/stories/:id` 读与写），
 * 旧套件驱动的首页单页 + Story 抽屉已经不存在。这条用例守的是「搬迁前后同一操作的数据与
 * 领域事件一致」：断言全部落在新 IA 的可达路径上，不换一套更弱的观察方式。
 *
 * 录入前置没有走 `story-flow.ts` 的 `ingestFeed`：它保存后直接启用，而「停用来源不参与
 * 调度」必须在下一次点击之前观察，所以这里把同一段流程按原用例的顺序就地展开。
 */

/** 本用例专属来源的 Story id：Feed 里其它来源也录入同一份 fixture，必须按来源限定。 */
async function sourceStoryIds(page: import("@playwright/test").Page, sourceName: string): Promise<string[]> {
    const response = await page.request.get("/api/v1/feed?limit=50");
    const body = await response.json() as { items?: { storyId: string; sourceName: string }[] };
    return [...new Set(
        (body.items ?? [])
            .filter((item) => item.sourceName === sourceName)
            .map((item) => item.storyId),
    )];
}

test("creates an RSS source, runs ingest, and reads the Story at its own URL", async ({ page }) => {
    const consoleErrors = collectConsoleErrors(page);
    const pageErrors: string[] = [];
    page.on("pageerror", (error) => pageErrors.push(error.message));
    /*
     * 只统计真正的请求失败：新 IA 靠路由跳转（`router.push("/stories/:id")`），Next 会预取
     * 目标路由，跳转/离开页面时主动取消在途的 RSC 请求（`net::ERR_ABORTED`）。那是浏览器侧
     * 取消，不是失败；断言剩下的部分为空。
     */
    const failedRequests: string[] = [];
    page.on("requestfailed", (request) => {
        const errorText = request.failure()?.errorText ?? "";
        if (errorText.includes("ERR_ABORTED")) {
            return;
        }
        failedRequests.push(`${request.method()} ${request.url()} [${errorText}]`);
    });

    // 建来源与触发录入在 /automation（同一个 SourceForm）。来源名唯一：同一栈会话内
    // 数据库跨重试持久化，固定名会在重试时产生第二行同名计划。
    const sourceName = uniqueSourceName("浏览器 RSS 来源");
    await page.goto("/automation");
    await expect(page.getByRole("heading", { name: "自动化", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建来源" }).click();

    // 表单字段由 catalog manifest 驱动：Feed URL 必填、定时可选默认留空。
    const feedUrlInput = page.getByLabel("Feed URL");
    await expect(feedUrlInput).toBeVisible();
    const scheduleInput = page.getByLabel("定时抓取间隔（分钟）");
    await expect(scheduleInput).toHaveValue("");

    // 未保存配置测试：Worker 真实抓取受控 RSS 一页并回显统计与样例标题。
    // 探针用临时名称，它不落库；随后换回真正要保存的来源名。
    await page.getByLabel("名称", { exact: true }).fill(uniqueSourceName("探针"));
    await feedUrlInput.fill(FEED_URL);
    // 定时填 30：留空表示「不自动抓取」，计划看板就不会解释定时语义，
    // 而停用/启用两条文案正是要守住的地方。
    await scheduleInput.fill("30");
    await page.getByRole("button", { name: "测试配置" }).click();
    const probeFeedback = page.getByRole("status").filter({ hasText: "测试成功" });
    await expect(probeFeedback).toBeVisible({ timeout: 20_000 });
    await expect(probeFeedback).toContainText(/抓取到 3 条内容，耗时/);
    await expect(probeFeedback).toContainText("Cosmos scaffold is ready");

    // 保存只创建停用来源，启用是列表行内的独立动作。
    await page.getByLabel("名称", { exact: true }).fill(sourceName);
    await page.getByRole("button", { name: "保存计划（停用）" }).click();
    await expect(page.getByText("采集计划已保存，当前为停用状态")).toBeVisible();

    const planSection = planSectionOf(page);
    const healthRow = planSection.locator("li").filter({ hasText: sourceName });
    await expect(healthRow).toBeVisible();
    // 停用来源在健康看板上明确「不参与调度」，即使它配置了定时。
    await expect(healthRow.getByText("已停用，定时抓取暂停")).toBeVisible();
    await healthRow.getByRole("button", { name: `启用 ${sourceName}`, exact: true }).click();
    await expect(page.getByText("已启用；可执行手动录入")).toBeVisible();
    // 启用后健康看板解释定时计划：表单填的是 30 分钟。
    await expect(healthRow.getByText("每 30 分钟自动抓取")).toBeVisible();

    await healthRow.getByRole("button", { name: `立即抓取 ${sourceName}`, exact: true }).click();
    await expect(page.getByText("录入任务已排队", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    // 阅读流在 /library（同一个 FeedBrowser）。
    await page.goto("/library");
    const feedList = page.locator('section[aria-label="阅读流"]');
    await expect(feedList).toBeVisible();
    // 卡片按来源限定：数据库跨重试/跨 spec 持久化，Feed 里有别的来源的同名 fixture 标题。
    const sourceCards = feedList.locator("article").filter({ hasText: sourceName });
    await expect(sourceCards.getByText("Cosmos scaffold is ready").first()).toBeVisible({ timeout: 30_000 });
    await expect(sourceCards.getByText("Message without a web URL").first()).toBeVisible();
    await expect(sourceCards.getByText("Fixture media metadata").first()).toBeVisible();

    // 阅读流元信息：中文短日期、附件计数、纯文本摘要（无 HTML 标签泄漏）。
    await expect(sourceCards.getByText("2026年8月7日").first()).toBeVisible();
    await expect(sourceCards.getByText(/含 \d+ 个附件/).first()).toBeVisible();
    await expect(
        sourceCards.getByText("The second fixture item proves URL-free ingestion.", { exact: true }).first(),
    ).toBeVisible();

    // 打开 Story 是导航动作：卡片标题直接跳到 /stories/:id 阅读页。
    // 先等本来源至少两条 Story 落库，归并才有第二个目标。
    await waitForStoryIds(page, sourceName, 2);
    await sourceCards.getByRole("button", { name: "Cosmos scaffold is ready", exact: true }).first().click();
    const storyTitle = page.locator("[data-story-id]");
    await expect(storyTitle).toBeVisible();
    await expect(storyTitle).toHaveText("Cosmos scaffold is ready");
    // 当前 Story 的 id 从页面读：Feed 按更新时间排序，列表第一条不一定就是被点开的这张卡，
    // 拿列表顺序当 id 会让后面的归并断言指向另一条 Story。
    const currentStoryId = await storyTitle.getAttribute("data-story-id");
    if (currentStoryId === null) {
        throw new Error("阅读页没有给出 data-story-id");
    }
    const obsoleteStoryId = (await sourceStoryIds(page, sourceName))
        .find((storyId) => storyId !== currentStoryId);
    if (obsoleteStoryId === undefined) {
        throw new Error(`本来源只有一条 Story，无法验证归并：${sourceName}`);
    }
    // 阅读页能读到正文（产品里第一次显示条目正文）。
    const article = page.locator("article").first();
    await expect(
        article.getByText("The first fixture item has a web URL.", { exact: true }),
    ).toBeVisible();

    // 编辑与关联默认收起，写入动作要先展开。
    const editSection = await expandEditSurface(page);
    await expect(editSection.locator('fieldset[data-story-time-bound="start"]')).toBeVisible();
    await expect(editSection.getByRole("button", { name: "保存修改", exact: true })).toBeVisible();

    // 改标题（保存修改）：Revision 真的换了，标题在页面上随之变化。
    const mergedTitle = `合并后标题 ${Date.now()}`;
    await editSection.getByLabel("标题").fill(mergedTitle);
    await editSection.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(page.locator("[data-story-id]")).toHaveText(mergedTitle);

    // 归并第二个 Story：并入后来源成员变成 2。
    await mergeStoryInto(page, obsoleteStoryId);

    // 最硬的一条：被并入的 id 现在读回来就是当前 Story，成员条目两条。
    // `readStoryDetail` 的 members 就是读端点 `entries` 的投影，断言的是服务端落库形状。
    const redirected = await readStoryDetail(page, obsoleteStoryId);
    expect(redirected.id).toBe(currentStoryId);
    expect(redirected.members).toHaveLength(2);

    // 人工 Spotlight：在阅读页固定到默认看板热点区。
    await page.getByRole("button", { name: "固定到看板热点区" }).click();
    await expect(page.getByText("已固定到看板热点区。")).toBeVisible();

    // 移动端宽度不得出现页面级横向溢出。移动端适配后置（维护者 2026-09-17），
    // 检查暂停但保留：恢复时把开关置回 true，见 e2e/support/viewports.ts。
    if (MOBILE_WIDTH_VERIFIED) {
        await page.setViewportSize({ width: DEFERRED_MOBILE_WIDTH, height: 844 });
        await expect(page.locator('section[aria-label="阅读流"]')).toBeVisible();
        const scroll = await page.evaluate(() => ({
            scrollWidth: document.documentElement.scrollWidth,
            clientWidth: document.documentElement.clientWidth,
        }));
        expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
    }

    // 看板编辑仍在首页：隐藏采集计划区块后浏览视图不再显示，重新显示后回来
    // （BRD-002「隐藏 ≠ 删除」，底层来源数据不变）。
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterBoardEditing(page);
    const sourceHealthBlock = boardBlock(page, "source-health");
    await sourceHealthBlock.getByRole("button", { name: /^隐藏区块/ }).click();
    await expect(sourceHealthBlock.getByText("已隐藏：采集计划")).toBeVisible();
    await page.getByRole("button", { name: "完成编辑" }).click();
    await expect(page.getByRole("heading", { name: "采集计划" })).toHaveCount(0);
    await page.getByRole("button", { name: "编辑看板" }).click();
    await boardBlock(page, "source-health").getByRole("button", { name: /^显示区块/ }).click();
    await expect(page.getByRole("heading", { name: "采集计划" })).toBeVisible();
    await page.getByRole("button", { name: "完成编辑" }).click();

    // 固定后热点区出现，解除后消失。
    const spotlightBlock = boardBlock(page, "spotlight");
    const pinnedStory = spotlightBlock.locator("li").filter({ hasText: mergedTitle });
    await expect(pinnedStory).toBeVisible({ timeout: 15_000 });
    await pinnedStory.getByRole("button", { name: /^解除固定/ }).click();
    await expect(spotlightBlock.locator("li").filter({ hasText: mergedTitle })).toHaveCount(0);

    // 未绑定的收藏夹区块可以创建（回归：曾因 collectionId 必填而 400 失败），
    // 创建后显示占位而不是报错，删除区块不影响底层内容。
    await enterBoardEditing(page);
    const feedSection = page
        .locator("[data-section-id]")
        .filter({ hasText: "信息流" })
        .first();
    await feedSection.getByLabel("新增区块类型").selectOption("collection");
    await feedSection.getByRole("button", { name: "添加区块" }).click();
    await expect(page.getByText("此区块尚未绑定收藏夹")).toBeVisible();
    await page
        .locator('[data-block-type="collection"]')
        .last()
        .getByRole("button", { name: /^删除区块/ })
        .click();
    await expect(page.getByText("此区块尚未绑定收藏夹")).toHaveCount(0);
    await page.getByRole("button", { name: "完成编辑" }).click();

    // 检索工作台在 /library：搜索条件回显为筛选 chip，清除后恢复默认 Feed。
    await page.goto("/library");
    await page.getByLabel("搜索已保存内容").fill("fixture");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByText("“fixture”")).toBeVisible();
    await page.getByRole("button", { name: "清除筛选" }).click();
    // 恢复后本来源的卡片回来：卡片标题是 Story 当前 Revision 的标题，前面已改过名，
    // 所以这里认改名后的标题（它唯一，且仍按来源限定）。
    await expect(
        page.locator('section[aria-label="阅读流"]').locator("article").filter({ hasText: sourceName })
            .getByText(mergedTitle).first(),
    ).toBeVisible();

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    await page.screenshot({ path: "test-results/ingest-story.png", fullPage: true });
});
