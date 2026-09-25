import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
    expectNoticeAppeared,
    installNoticeRecorder,
    resetNoticeLog,
} from "../support/notice-log";

const WORKING_FEED_URL = "http://127.0.0.1:4380/feed.xml";
const BROKEN_FEED_URL = "http://127.0.0.1:4380/missing.xml";

/**
 * 切片 2 的验收（AUT-010）：不打开数据库就能在**一个连接下**建出两个计划，
 * 并看到两个计划各自的频率与最近一次失败。
 *
 * v1 计划与采集目标一对一，所以「在连接下建第二个计划」= 建第二个绑定到同一连接的目标。
 */
test("creates two plans under one connection and shows each plan's own schedule and failure", async ({ page }) => {
    test.setTimeout(180_000);
    await installNoticeRecorder(page);
    const suffix = randomUUID().slice(0, 8);
    const connectionName = `主账号-${suffix}`;
    const healthyName = `动态-${suffix}`;
    const brokenName = `推荐流-${suffix}`;

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();

    // 先有一个可复用的连接（ADR-0017）。
    await page.getByLabel("连接名称").fill(connectionName);
    await page.getByLabel("连接 Connector").fill("fixture-rss");
    await page.getByRole("button", { name: "新建连接" }).click();
    await expect(page.getByText(connectionName, { exact: true })).toBeVisible();

    await createPlan(page, {
        name: healthyName,
        feedUrl: WORKING_FEED_URL,
        intervalMinutes: "30",
        connectionName,
    });
    await createPlan(page, {
        name: brokenName,
        feedUrl: BROKEN_FEED_URL,
        intervalMinutes: "120",
        connectionName,
    });

    // 按连接分组：这个连接下正好两个计划，各自带自己的频率。
    const section = page.getByRole("heading", { name: "采集计划" }).locator("..").locator("..");
    const group = section.locator("[data-plan-group]").filter({ hasText: connectionName });
    await expect(group.getByRole("heading", { name: new RegExp(connectionName) })).toBeVisible();
    await expect(group.locator("li")).toHaveCount(2);

    const healthyRow = group.locator("li").filter({ hasText: healthyName });
    const brokenRow = group.locator("li").filter({ hasText: brokenName });
    // 建出来的计划默认停用，两条都不参与调度——各自的频率此时以「暂停」形式呈现。
    await expect(healthyRow.getByText("已停用，定时抓取暂停")).toBeVisible();
    await expect(brokenRow.getByText("已停用，定时抓取暂停")).toBeVisible();

    // 两个计划各自启用、各自跑一次：好的一路成功，坏的一路失败，互不混淆。
    await healthyRow.getByRole("button", { name: `启用 ${healthyName}`, exact: true }).click();
    await expect(page.getByText(`计划 ${healthyName} 已启用`, { exact: false })).toBeVisible();
    await healthyRow.getByRole("button", { name: healthyName, exact: true }).click();
    await expect(page.getByText("录入任务已排队", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    await brokenRow.getByRole("button", { name: `启用 ${brokenName}`, exact: true }).click();
    await expect(page.getByText(`计划 ${brokenName} 已启用`, { exact: false })).toBeVisible();
    // 坏来源的「录入任务已排队」是瞬时状态：实测只存在 480–554ms，而且运行失败得很快，
    // 失败提示（「一次录入运行失败…」）可能先于它出现、也会把它替换掉。对这条提示做
    // 轮询断言等于赌"某一次轮询落在窗口里"，慢轮里就会落空。这里改成断言页面内记录里
    // 出现过这段文字——要求不变，只是不再依赖轮询撞上窗口。
    await resetNoticeLog(page);
    await brokenRow.getByRole("button", { name: brokenName, exact: true }).click();
    await expectNoticeAppeared(page, "录入任务已排队");

    // 失败只落在坏的那一行：好的一行不出现错误文本，也不显示「尚未运行」。
    await expect(brokenRow.locator("span.text-destructive")).toBeVisible({ timeout: 60_000 });
    await expect(healthyRow.locator("span.text-destructive")).toHaveCount(0);
    await expect(healthyRow.getByText("尚未运行")).toHaveCount(0);
    await expect(healthyRow.getByText("每 30 分钟自动抓取")).toBeVisible();
    await expect(brokenRow.getByText("每 2 小时自动抓取")).toBeVisible();

    // 服务端是唯一真相：刷新后分组、频率与失败都还在。
    await page.reload();
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    const reloadedGroup = page
        .getByRole("heading", { name: "采集计划" })
        .locator("..").locator("..")
        .locator("[data-plan-group]")
        .filter({ hasText: connectionName });
    await expect(reloadedGroup.locator("li")).toHaveCount(2);
    await expect(reloadedGroup.locator("li").filter({ hasText: healthyName }).getByText("每 30 分钟自动抓取"))
        .toBeVisible();
    await expect(reloadedGroup.locator("li").filter({ hasText: brokenName }).getByText("每 2 小时自动抓取"))
        .toBeVisible();
    await expect(reloadedGroup.locator("li").filter({ hasText: brokenName }).locator("span.text-destructive"))
        .toBeVisible();
});

/** 走「新建计划」表单：目标配置 + 频率 + 连接一次填完（创建与绑定同一步）。 */
async function createPlan(
    page: import("@playwright/test").Page,
    input: { name: string; feedUrl: string; intervalMinutes: string; connectionName: string },
): Promise<void> {
    await page.getByRole("button", { name: "新建计划" }).click();
    await page.getByLabel("名称", { exact: true }).fill(input.name);
    await page.getByLabel("Feed URL").fill(input.feedUrl);
    await page.locator("#source-schedule-interval").fill(input.intervalMinutes);
    await page.locator("#source-connection").selectOption({ label: `${input.connectionName}（fixture-rss）` });
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("采集计划已保存，当前为停用状态")).toBeVisible();
}
