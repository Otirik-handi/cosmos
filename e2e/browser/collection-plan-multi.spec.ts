import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
    expectNoticeAppeared,
    installNoticeRecorder,
    resetNoticeLog,
} from "../support/notice-log";
import { planRowOf, planSectionOf } from "../support/story-flow";

const WORKING_FEED_URL = "http://127.0.0.1:4380/feed.xml";
const BROKEN_FEED_URL = "http://127.0.0.1:4380/missing.xml";

/**
 * 切片 2 的验收（AUT-010）：不打开数据库就能在**一个连接下**建出两个计划，
 * 并看到两个计划各自的频率与最近一次失败。
 *
 * v1 计划与采集目标一对一，所以「在连接下建第二个计划」= 建第二个绑定到同一连接的目标。
 *
 * 连接与计划都在 `/automation` 建（ADR-0029 决策 1：创建去对象页，首页只看）。本用例
 * 自己控制启用与试跑的先后，所以不走 `story-flow.ts` 的 `ingestFeed`。
 */
test("creates two plans under one connection and shows each plan's own schedule and failure", async ({ page }) => {
    test.setTimeout(180_000);
    await installNoticeRecorder(page);
    const suffix = randomUUID().slice(0, 8);
    const connectionName = `主账号-${suffix}`;
    const healthyName = `动态-${suffix}`;
    const brokenName = `推荐流-${suffix}`;

    await page.goto("/automation");
    await expect(page.getByRole("heading", { name: "自动化", exact: true })).toBeVisible();

    // 先有一个可复用的连接（ADR-0017）。创建表单在模态框里（Task 37 切片 1），
    // 模态框 portal 到 body，所以从 page 定位。
    await page.getByRole("button", { name: "新建连接" }).click();
    await page.getByLabel("连接名称").fill(connectionName);
    await page.getByLabel("连接 Connector").fill("fixture-rss");
    await page.getByRole("button", { name: "保存连接" }).click();
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
    const group = planSectionOf(page).locator("[data-plan-group]").filter({ hasText: connectionName });
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
    await healthyRow.getByRole("button", { name: `立即抓取 ${healthyName}`, exact: true }).click();
    await expect(page.getByText("录入任务已排队", { exact: false }).first()).toBeVisible({ timeout: 15_000 });

    await brokenRow.getByRole("button", { name: `启用 ${brokenName}`, exact: true }).click();
    await expect(page.getByText(`计划 ${brokenName} 已启用`, { exact: false })).toBeVisible();
    // 坏来源的「录入任务已排队」是瞬时状态：实测只存在 480–554ms，而且运行失败得很快，
    // 失败提示（「一次录入运行失败…」）可能先于它出现、也会把它替换掉。对这条提示做
    // 轮询断言等于赌"某一次轮询落在窗口里"，慢轮里就会落空。这里改成断言页面内记录里
    // 出现过这段文字——要求不变，只是不再依赖轮询撞上窗口。
    await resetNoticeLog(page);
    await brokenRow.getByRole("button", { name: `立即抓取 ${brokenName}`, exact: true }).click();
    await expectNoticeAppeared(page, "录入任务已排队");

    // 失败只落在坏的那一行：好的一行不出现错误文本，也不显示「尚未运行」。
    await expect(brokenRow.locator("span.text-destructive")).toBeVisible({ timeout: 60_000 });
    await expect(healthyRow.locator("span.text-destructive")).toHaveCount(0);
    await expect(healthyRow.getByText("尚未运行")).toHaveCount(0);
    await expect(healthyRow.getByText("每 30 分钟自动抓取")).toBeVisible();
    await expect(brokenRow.getByText("每 2 小时自动抓取")).toBeVisible();

    // 服务端是唯一真相：刷新后分组、频率与失败都还在。
    await page.reload();
    await expect(page.getByRole("heading", { name: "自动化", exact: true })).toBeVisible();
    const reloadedGroup = planSectionOf(page)
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

/**
 * 切片 3 的验收：计划行的纯图标按钮在**鼠标悬停**与**键盘聚焦**时都给出文字提示，
 * 且提示文案与按钮的可访问名同源（不出现第二份措辞）。
 *
 * 这条用例是本次唯一能证明提示真的挂上了的检查。提示层是**按需加载**的（见
 * `collection-plan-list/icon-action-tooltip.tsx` 的文件头注释）：首屏只渲染纯按钮，
 * `load` 之后才异步取回提示层。因此断言必须容忍"取回之前"的短暂窗口——先等提示层
 * 就位（用一次悬停探测），再断言文案。
 *
 * 同时断言按钮**在提示层到位前后都可访问**：可访问名留在按钮自身，不依赖提示层。
 */
test("shows a text hint for icon-only plan row buttons on hover and keyboard focus", async ({ page }) => {
    test.setTimeout(180_000);
    const suffix = randomUUID().slice(0, 8);
    const connectionName = `提示-${suffix}`;
    const sourceName = `提示源-${suffix}`;

    await page.goto("/automation");
    await expect(page.getByRole("heading", { name: "自动化", exact: true })).toBeVisible();

    await page.getByRole("button", { name: "新建连接" }).click();
    await page.getByLabel("连接名称").fill(connectionName);
    await page.getByLabel("连接 Connector").fill("fixture-rss");
    await page.getByRole("button", { name: "保存连接" }).click();
    await expect(page.getByText(connectionName, { exact: true })).toBeVisible();

    await createPlan(page, {
        name: sourceName,
        feedUrl: WORKING_FEED_URL,
        intervalMinutes: "30",
        connectionName,
    });

    const row = planRowOf(page, sourceName);
    const toggle = row.getByRole("button", { name: `启用 ${sourceName}`, exact: true });
    const hint = page.locator('[data-slot="tooltip-content"]');

    // 可访问名不依赖提示层：按钮本身必须一直能被角色 + 名字定位到。
    await expect(toggle).toBeVisible();

    // 悬停：等提示层就位。首次悬停可能落在"尚未取回"的窗口里，所以用轮询等它出现，
    // 而不是断言"第一次悬停立刻有提示"——那会把按需加载的加载时延当成缺陷。
    await toggle.hover();
    await expect(hint).toHaveText(`启用 ${sourceName}`, { timeout: 15_000 });

    // 提示文案与可访问名同源：同一条文案，不是第二份措辞。
    await expect(hint).toHaveText(`启用 ${sourceName}`);

    // 键盘聚焦：移开鼠标后提示消失，再用**真实 Tab 键**走到该按钮，提示必须重新出现。
    //
    // 这里不能用 `locator.focus()`：那是脚本聚焦，Chromium 不给它 `:focus-visible`，而
    // Base UI 的 `useFocus` 只在 focus-visible 时开提示（`floating-ui-react/hooks/useFocus.js`
    // 的 `matchesFocusVisible` 早退分支）。用 `.focus()` 断言等于测一个键盘用户走不到的路径。
    await page.mouse.move(0, 0);
    await expect(hint).toHaveCount(0);
    expect(await tabTo(page, toggle)).toBe(true);
    await expect(hint).toHaveText(`启用 ${sourceName}`);

    // 提示不得承载操作：它是说明，不是动作入口。
    await expect(hint.getByRole("button")).toHaveCount(0);
    await expect(hint.getByRole("link")).toHaveCount(0);
});

/**
 * 用真实 Tab 键把焦点走到目标元素，返回是否走到了。
 *
 * 必须用真键盘事件：`locator.focus()` 是脚本聚焦，Chromium 不会给它 `:focus-visible`，
 * 而 Base UI 的提示只在 focus-visible 时打开。从页面开头最多按 `limit` 次 Tab；
 * 走到就停，避免 Tab 出页面。
 */
async function tabTo(page: import("@playwright/test").Page, target: import("@playwright/test").Locator, limit = 80): Promise<boolean> {
    // 先把焦点交还给文档，再从文档开头按 Tab。不能点 body 的某个坐标——那可能点中
    // 页头的链接而离开 `/automation`。
    await page.evaluate(() => {
        const active = document.activeElement;
        if (active instanceof HTMLElement) {
            active.blur();
        }
    });
    for (let i = 0; i < limit; i += 1) {
        await page.keyboard.press("Tab");
        if (await target.evaluate((node) => node === document.activeElement)) {
            return true;
        }
    }
    return false;
}

/**
 * 展开来源表单。
 *
 * `/automation` 保存成功后表单**不会**自动收起（页头按钮停在「关闭表单」），所以第二个计划
 * 是在同一张还开着的表单上接着填。按当前态决定要不要点开，不赌它是否已经收起。
 */
async function openSourceForm(page: import("@playwright/test").Page): Promise<void> {
    if (await page.getByRole("button", { name: "保存计划" }).isVisible()) {
        return;
    }
    await page.getByRole("button", { name: "新建来源" }).click();
}

/** 走「新建来源」表单：目标配置 + 频率 + 连接一次填完（创建与绑定同一步）。 */
async function createPlan(
    page: import("@playwright/test").Page,
    input: { name: string; feedUrl: string; intervalMinutes: string; connectionName: string },
): Promise<void> {
    await openSourceForm(page);
    await page.getByLabel("名称", { exact: true }).fill(input.name);
    await page.getByLabel("Feed URL").fill(input.feedUrl);
    // `/automation` 的表单定时默认留空（留空 = 不自动抓取），本用例要断言各自频率，必须显式填。
    await page.locator("#source-schedule-interval").fill(input.intervalMinutes);
    await page.locator("#source-connection").selectOption({ label: `${input.connectionName}（fixture-rss）` });
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("采集计划已保存，当前为停用状态")).toBeVisible();
}
