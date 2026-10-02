import { expect, test, type Locator, type Page } from "@playwright/test";

import {
    FEED_URL,
    collectConsoleErrors,
    planSectionOf,
    uniqueSourceName,
} from "../support/story-flow";

/**
 * 受控 RSS fixture 的 `offline.xml`：与本套件用的 `feed.xml` 同源同端口，
 * 只换文件名。
 */
const OFFLINE_FEED_URL = new URL("/offline.xml", FEED_URL).toString();

/** 只有这一条 fixture 带图片；用它认领本来源的 Story，避免误判其它 spec 的卡片。 */
const OFFLINE_MEDIA_TITLE = "Offline saved media";

/**
 * 只建来源、不触发录入：媒体策略（ADR-0014）按计划保存且「只影响之后的采集」，
 * 所以必须先有计划、改完策略、再启用试跑，顺序不能换。
 */
async function createSource(page: Page, sourceName: string, feedUrl: string): Promise<void> {
    await page.goto("/automation");
    await expect(page.getByRole("heading", { name: "自动化", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建来源" }).click();
    await page.getByLabel("名称", { exact: true }).fill(sourceName);
    await page.getByLabel("Feed URL").fill(feedUrl);
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("采集计划已保存，当前为停用状态")).toBeVisible();
}

/** 本来源的唯一计划行；同一栈会话内其它 spec 也会建来源，必须按自己的来源名限定。 */
function planRowOf(page: Page, sourceName: string): Locator {
    return planSectionOf(page).locator("li").filter({ hasText: sourceName }).first();
}

/** 打开本计划行的媒体策略表单并返回它。 */
async function openMediaPolicyForm(page: Page, sourceName: string): Promise<Locator> {
    const row = planRowOf(page, sourceName);
    await row.getByRole("button", { name: `媒体策略 ${sourceName}` }).click();
    const form = page.locator(`form[aria-label="媒体策略 ${sourceName}"]`);
    await expect(form).toBeVisible();
    return form;
}

/** 启用本计划并手动录入一次，等任务真的排队。 */
async function enableAndRun(page: Page, sourceName: string): Promise<void> {
    const row = planRowOf(page, sourceName);
    await row.getByRole("button", { name: `启用 ${sourceName}`, exact: true }).click();
    await expect(page.getByText("已启用；可执行手动录入")).toBeVisible();
    await row.getByRole("button", { name: sourceName, exact: true }).click();
    await expect(page.getByText("录入任务已排队", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
}

/** 从信息库的阅读流点开本来源带图的那张卡片；新 IA 下这里导航到 `/stories/:id`。 */
async function openStoryCard(page: Page, sourceName: string, title: string): Promise<void> {
    await page.goto("/library");
    const card = page
        .locator('section[aria-label="阅读流"]')
        .locator("article")
        .filter({ hasText: sourceName })
        .filter({ hasText: title })
        .first();
    await expect(card).toBeVisible({ timeout: 180_000 });
    await card.getByRole("button", { name: "打开 Story" }).click();
    await expect(page.locator("[data-story-id]")).toBeVisible();
}

test("edits a source's media policy, rejects values above the default and keeps it across reloads", async ({ page }) => {
    test.setTimeout(120_000);
    const consoleErrors = collectConsoleErrors(page);

    const sourceName = uniqueSourceName("媒体策略");
    await createSource(page, sourceName, OFFLINE_FEED_URL);

    const row = planRowOf(page, sourceName);
    await expect(row.getByText("媒体策略：跟随默认（10 / 50，重试 3 次，永久保留）")).toBeVisible();

    const form = await openMediaPolicyForm(page, sourceName);

    // 只能收紧：超出全局默认的值在本地被拒绝，不发请求。
    await form.getByLabel("单文件上限（MB）").fill("11");
    await form.getByRole("button", { name: "保存媒体策略" }).click();
    await expect(form.locator("[data-media-policy-error=true]")).toContainText("只能比默认更小");

    await form.getByLabel("图片").selectOption("metadata_only");
    await form.getByLabel("单文件上限（MB）").fill("2");
    await form.getByRole("button", { name: "保存媒体策略" }).click();
    await expect(page.getByText(`已保存 ${sourceName} 的媒体策略`, { exact: false })).toBeVisible();
    await expect(row.getByText("媒体策略：仅记录元数据；单文件 ≤ 2")).toBeVisible();

    // 服务端是唯一真相：刷新后仍是收紧后的策略。
    await page.reload();
    await expect(page.getByRole("heading", { name: "自动化", exact: true })).toBeVisible();
    await expect(planRowOf(page, sourceName).getByText("媒体策略：仅记录元数据；单文件 ≤ 2")).toBeVisible();

    expect(consoleErrors).toEqual([]);
});

test("previews retention cleanup through the maintenance run without deleting anything", async ({ page }) => {
    test.setTimeout(120_000);
    const consoleErrors = collectConsoleErrors(page);

    // 本来源不录入，库里就没有到期媒体；预览只读，不提供确认入口。
    const sourceName = uniqueSourceName("保留期");
    await createSource(page, sourceName, OFFLINE_FEED_URL);

    const form = await openMediaPolicyForm(page, sourceName);
    await form.getByLabel("保留天数").fill("1");
    await form.getByRole("button", { name: "保存媒体策略" }).click();
    await expect(planRowOf(page, sourceName).getByText("媒体策略：媒体保留 1 天")).toBeVisible();

    // 预览走 durable 维护 Run：没有到期媒体时报告 0 项，且不提供确认入口。
    const cleanup = planSectionOf(page).locator("[data-media-cleanup=true]").first();
    await expect(cleanup).toContainText("条目、元数据与原文外链保留");
    await cleanup.getByRole("button", { name: "预览过期媒体" }).click();
    await expect(cleanup.locator("[data-media-cleanup-preview=true]")).toContainText("可清理 0 项", {
        timeout: 30_000,
    });
    await expect(cleanup.getByRole("button", { name: /确认清理/ })).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
});

test("keeps images metadata-only for a source with image download off", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors = collectConsoleErrors(page);

    const sourceName = uniqueSourceName("媒体策略关闭");
    await createSource(page, sourceName, OFFLINE_FEED_URL);

    // 先收紧策略再试跑：策略只影响之后入队的采集。
    const form = await openMediaPolicyForm(page, sourceName);
    await form.getByLabel("图片").selectOption("metadata_only");
    await form.getByRole("button", { name: "保存媒体策略" }).click();
    await expect(planRowOf(page, sourceName).getByText("媒体策略：仅记录元数据")).toBeVisible();

    await enableAndRun(page, sourceName);
    await openStoryCard(page, sourceName, OFFLINE_MEDIA_TITLE);

    // 图片保持连接器给的元数据终态，不产生本地实体。
    const media = page.locator('section[aria-label="媒体"]');
    await expect(media.locator("[data-asset-status=metadata_only]").first()).toBeVisible();
    await expect(media.locator("[data-asset-status=saved] img")).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
});
