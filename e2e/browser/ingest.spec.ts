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
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    // 同一栈会话内数据库跨重试持久化，Feed 在重试时可能已有内容；
    // 编辑部空态改由组件实验室 empty 场景覆盖，这里不断言空态。
    await page.getByRole("button", { name: "新建来源" }).click();

    // 表单字段由 catalog manifest 驱动：Feed URL 必填、定时可选默认 30 分钟。
    const feedUrlInput = page.getByLabel("Feed URL");
    await expect(feedUrlInput).toBeVisible();
    const scheduleInput = page.getByLabel("定时抓取间隔");
    await expect(scheduleInput).toHaveValue("30");

    // 精确匹配：Saved View 的“视图名称”输入框也包含“名称”子串。
    await page.getByLabel("名称", { exact: true }).fill("浏览器 RSS 来源");
    await feedUrlInput.fill("http://127.0.0.1:4380/feed.xml");

    // 未保存配置测试：Worker 真实抓取受控 RSS 一页并回显统计与样例标题。
    await page.getByRole("button", { name: "测试配置" }).click();
    const probeFeedback = page.getByRole("status").filter({ hasText: "测试成功" });
    await expect(probeFeedback).toBeVisible({ timeout: 20_000 });
    await expect(probeFeedback).toContainText(/抓取到 3 条内容，耗时/);
    await expect(probeFeedback).toContainText("Cosmos scaffold is ready");

    // 保存只创建停用 Source，启用是列表行内的独立动作。
    await page.getByRole("button", { name: "保存来源" }).click();
    await expect(page.getByText("来源已保存，当前为停用状态")).toBeVisible();
    const healthSection = page.getByRole("heading", { name: "来源健康" }).locator("..").locator("..");
    // 停用来源在健康看板上明确“不参与调度”，即使它配置了定时。
    await expect(healthSection.getByText("已停用，定时抓取暂停")).toBeVisible();
    const enableButton = healthSection.getByRole("button", { name: "启用 浏览器 RSS 来源", exact: true });
    await expect(enableButton).toBeVisible();
    await enableButton.click();
    await expect(page.getByText("已启用；可执行手动录入")).toBeVisible();
    // 启用后健康看板解释定时计划：表单默认 30 分钟。
    await expect(healthSection.getByText("每 30 分钟自动抓取")).toBeVisible();

    const runButton = healthSection.getByRole("button", { name: "浏览器 RSS 来源", exact: true });
    await expect(runButton).toBeEnabled();
    await runButton.click();
    await expect(page.getByText("录入任务已排队", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    await expect(page.getByRole("heading", { name: "Story Feed" })).toBeVisible();
    await expect(page.getByText("Cosmos scaffold is ready")).toBeVisible({ timeout: 30_000 });
    await expect(page.getByText("Message without a web URL")).toBeVisible();

    // 阅读流元信息：中文短日期、附件计数、纯文本摘要（无 HTML 标签泄漏）。
    await expect(page.getByText("2026年8月7日").first()).toBeVisible();
    await expect(page.getByText(/含 \d+ 个附件/)).toBeVisible();
    await expect(
        page.getByText("The second fixture item proves URL-free ingestion.", { exact: true }),
    ).toBeVisible();

    // 阅读抽屉：打开后焦点进入关闭按钮，正文可读，原文外链存在。
    const openStoryTrigger = page.getByRole("button", { name: "打开 Story" }).first();
    await openStoryTrigger.click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(
        dialog.getByText("The third item carries media metadata without requiring a download.", {
            exact: true,
        }),
    ).toBeVisible();
    await expect(dialog.getByRole("button", { name: "关闭" })).toBeFocused();
    await expect(dialog.getByRole("link", { name: "打开原文" })).toBeVisible();

    // Story 编排：更新 Revision（标题实质变化）与归并第二个 Story 到当前 Story。
    const feedItems = await page.evaluate(async () => {
        const response = await fetch("/api/v1/feed?limit=50");
        return (await response.json()) as {
            items: Array<{ storyId: string }>;
        };
    });
    const currentStoryId = feedItems.items[0].storyId;
    const obsoleteStoryId = feedItems.items
        .map((item) => item.storyId)
        .find((storyId) => storyId !== currentStoryId)!;
    const mergedTitle = `合并后标题 ${Date.now()}`;
    await dialog.getByLabel("标题").fill(mergedTitle);
    await dialog.getByRole("button", { name: "保存修改" }).click();
    await expect(dialog.getByRole("heading", { name: mergedTitle, exact: true })).toBeVisible();
    await dialog.getByLabel("并入本 Story 的 Story ID").fill(obsoleteStoryId);
    await dialog.getByRole("button", { name: "归并", exact: true }).click();
    await expect(dialog.getByText(/来源成员（2）/)).toBeVisible();
    const redirected = await page.evaluate(async (storyId) => {
        const response = await fetch(`/api/v1/stories/${encodeURIComponent(storyId)}`);
        return (await response.json()) as {
            story: { id: string };
            entries: unknown[];
        };
    }, obsoleteStoryId);
    expect(redirected.story.id).toBe(currentStoryId);
    expect(redirected.entries).toHaveLength(2);

    // Escape 关闭抽屉并把焦点还给触发按钮。
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(openStoryTrigger).toBeFocused();

    // 搜索条件回显为筛选 chip，清除后恢复默认 Feed。
    await page.getByLabel("搜索已保存内容").fill("fixture");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByText("“fixture”")).toBeVisible();
    await page.getByRole("button", { name: "清除筛选" }).click();
    await expect(page.getByText("Cosmos scaffold is ready")).toBeVisible();

    // 移动端宽度不得出现页面级横向溢出。
    await page.setViewportSize({ width: 390, height: 844 });
    await expect(page.getByRole("heading", { name: "Story Feed" })).toBeVisible();
    const scroll = await page.evaluate(() => ({
        scrollWidth: document.documentElement.scrollWidth,
        clientWidth: document.documentElement.clientWidth,
    }));
    expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);

    // 看板编辑模式：隐藏来源健康区块后浏览视图不再显示，重新进入编辑模式可恢复
    // （BRD-002「隐藏 ≠ 删除」，底层来源数据不变）。
    await page.setViewportSize({ width: 1440, height: 900 });
    await page.getByRole("button", { name: "编辑看板" }).click();
    const sourceHealthBlock = page.locator('[data-block-type="source-health"]').first();
    await sourceHealthBlock
        .getByRole("button", { name: /^隐藏区块/ })
        .click();
    await expect(sourceHealthBlock.getByText("已隐藏：来源健康")).toBeVisible();
    await page.getByRole("button", { name: "完成编辑" }).click();
    await expect(page.getByRole("heading", { name: "来源健康" })).toHaveCount(0);
    await page.getByRole("button", { name: "编辑看板" }).click();
    await page
        .locator('[data-block-type="source-health"]')
        .first()
        .getByRole("button", { name: /^显示区块/ })
        .click();
    await expect(page.getByRole("heading", { name: "来源健康" })).toBeVisible();
    await page.getByRole("button", { name: "完成编辑" }).click();

    // 人工 Spotlight：把当前 Story 固定到看板热点区，热点区出现后可解除。
    await page.getByRole("button", { name: "打开 Story" }).first().click();
    const storyDialog = page.getByRole("dialog");
    await storyDialog.getByRole("button", { name: "固定到看板热点区" }).click();
    await page.keyboard.press("Escape");
    const spotlightBlock = page.locator('[data-block-type="spotlight"]').first();
    const pinnedStory = spotlightBlock.locator("li").filter({ hasText: mergedTitle });
    await expect(pinnedStory).toBeVisible();
    await pinnedStory.getByRole("button", { name: /^解除固定/ }).click();
    await expect(spotlightBlock.locator("li").filter({ hasText: mergedTitle })).toHaveCount(0);

    // 未绑定的收藏夹区块可以创建（回归：曾因 collectionId 必填而 400 失败），
    // 创建后显示占位而不是报错，删除区块不影响底层内容。
    await page.getByRole("button", { name: "编辑看板" }).click();
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

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    await page.screenshot({ path: "test-results/ingest-story.png", fullPage: true });
});
