import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const OFFLINE_FEED_URL = "http://127.0.0.1:4380/offline.xml";

/** 每个场景自建来源，避免与其它 spec 共用 fixture 状态。 */
async function createSource(page: import("@playwright/test").Page, sourceName: string): Promise<void> {
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建来源" }).click();
    await page.getByLabel("名称", { exact: true }).fill(sourceName);
    await page.getByLabel("Feed URL").fill(OFFLINE_FEED_URL);
    await page.getByRole("button", { name: "保存来源" }).click();
    await expect(page.getByText("来源已保存，当前为停用状态")).toBeVisible();
}

test("edits a source's media policy, rejects values above the default and keeps it across reloads", async ({ page }) => {
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    const sourceName = `媒体策略-${randomUUID().slice(0, 8)}`;
    await createSource(page, sourceName);

    const healthSection = page.getByRole("heading", { name: "来源健康" }).locator("..").locator("..");
    const row = healthSection.locator("li").filter({ hasText: sourceName });
    await expect(row.getByText("媒体策略：跟随默认（10 / 50）")).toBeVisible();

    await row.getByRole("button", { name: `媒体策略 ${sourceName}` }).click();
    const form = row.locator(`form[aria-label="媒体策略 ${sourceName}"]`);
    await expect(form).toBeVisible();

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
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    const reloadedRow = page
        .getByRole("heading", { name: "来源健康" })
        .locator("..")
        .locator("..")
        .locator("li")
        .filter({ hasText: sourceName });
    await expect(reloadedRow.getByText("媒体策略：仅记录元数据；单文件 ≤ 2")).toBeVisible();

    expect(consoleErrors).toEqual([]);
});

test("keeps images metadata-only for a source with image download off", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    const sourceName = `媒体策略关闭-${randomUUID().slice(0, 8)}`;
    await createSource(page, sourceName);

    const healthSection = page.getByRole("heading", { name: "来源健康" }).locator("..").locator("..");
    const row = healthSection.locator("li").filter({ hasText: sourceName });
    await row.getByRole("button", { name: `媒体策略 ${sourceName}` }).click();
    const form = row.locator(`form[aria-label="媒体策略 ${sourceName}"]`);
    await form.getByLabel("图片").selectOption("metadata_only");
    await form.getByRole("button", { name: "保存媒体策略" }).click();
    await expect(row.getByText("媒体策略：仅记录元数据")).toBeVisible();

    await row.getByRole("button", { name: `启用 ${sourceName}`, exact: true }).click();
    await expect(page.getByText("已启用；可执行手动录入")).toBeVisible();
    await row.getByRole("button", { name: sourceName, exact: true }).click();
    await expect(page.getByText("录入任务已排队", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    const card = page
        .locator("article")
        .filter({ hasText: sourceName })
        .filter({ hasText: "Offline saved media" })
        .first();
    await expect(card).toBeVisible({ timeout: 180_000 });
    await card.getByRole("button", { name: "打开 Story" }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // 图片保持连接器给的元数据终态，不产生本地实体。
    await expect(dialog.locator("[data-asset-status=metadata_only]").first()).toBeVisible();
    await expect(dialog.locator("[data-asset-status=saved] img")).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
});
