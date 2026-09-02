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

    await page.getByLabel("名称").fill("浏览器 RSS 来源");
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
    const ingestSection = page.getByRole("heading", { name: "来源与录入" }).locator("..").locator("..");
    const enableButton = ingestSection.getByRole("button", { name: "启用 浏览器 RSS 来源", exact: true });
    await expect(enableButton).toBeVisible();
    await enableButton.click();
    await expect(page.getByText("已启用；可执行手动录入")).toBeVisible();

    const runButton = ingestSection.getByRole("button", { name: "浏览器 RSS 来源", exact: true });
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

    expect(consoleErrors).toEqual([]);
    expect(pageErrors).toEqual([]);
    expect(failedRequests).toEqual([]);
    await page.screenshot({ path: "test-results/ingest-story.png", fullPage: true });
});
