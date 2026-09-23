import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const WORKING_FEED_URL = "http://127.0.0.1:4380/feed.xml";

/**
 * 切片 6 的验收（AUT-004 / ADR-0024）：计划面板里生成 Webhook 入口，把地址与凭证拿给
 * 外部自动化用，运行记录里出现触发原因为「外部触发」的 Run。
 *
 * 入口由 API 进程提供，产品面把 `/hooks/*` 透传给 API，所以面板给出的地址与页面同源。
 */
test("generates a webhook entry in the plan panel and triggers a webhook Run", async ({ page }) => {
    test.setTimeout(180_000);
    const suffix = randomUUID().slice(0, 8);
    const planName = `入口计划-${suffix}`;

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();

    // 建计划：计划默认停用，入口只对启用的计划生效。
    await page.getByRole("button", { name: "新建计划" }).click();
    await page.getByLabel("名称", { exact: true }).fill(planName);
    await page.getByLabel("Feed URL").fill(WORKING_FEED_URL);
    await page.locator("#source-schedule-interval").fill("30");
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("采集计划已保存，当前为停用状态")).toBeVisible();

    const row = page.locator("li").filter({ hasText: planName }).first();
    // 定时与 Webhook 是并存的两种触发方式（ADR-0025）：入口生成不改变这条定时。
    await expect(row.getByText("Webhook 入口：未生成")).toBeVisible();
    await expect(row.getByText("已停用，定时抓取暂停")).toBeVisible();

    await row.getByRole("button", { name: `Webhook 入口 ${planName}` }).click();
    await row.getByRole("button", { name: "生成入口" }).click();

    const credentialBlock = row.getByRole("status");
    await expect(credentialBlock.getByText("凭证只显示这一次，请立即保存")).toBeVisible();
    const credential = (await credentialBlock.locator("code").first().innerText()).trim();
    expect(credential.length).toBeGreaterThan(20);
    await expect(row.getByText("Webhook 入口：已配置")).toBeVisible();
    await expect(row.getByText("凭证：已配置")).toBeVisible();

    const address = (await row.locator("code").first().innerText()).trim();
    expect(address).toContain("/hooks/collection-plans/");

    // 计划停用时入口必须拒绝，且不产生 Run。
    const rejected = await page.request.post(address, {
        headers: {
            "x-cosmos-credential": credential,
            "x-cosmos-event-id": `e2e-disabled-${suffix}`,
        },
    });
    expect(rejected.status()).toBe(409);

    await row.getByRole("button", { name: `启用 ${planName}`, exact: true }).click();
    await expect(page.getByText(`计划 ${planName} 已启用`, { exact: false })).toBeVisible();

    const accepted = await page.request.post(address, {
        headers: {
            "x-cosmos-credential": credential,
            "x-cosmos-event-id": `e2e-${suffix}`,
        },
    });
    expect(accepted.status()).toBe(202);

    // 服务端是唯一真相：刷新后运行记录里能看到这次外部触发。
    await page.reload();
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    const webhookRun = page.locator("[data-run-id]").filter({ hasText: "外部触发" });
    await expect(webhookRun.first()).toBeVisible({ timeout: 30_000 });
});
