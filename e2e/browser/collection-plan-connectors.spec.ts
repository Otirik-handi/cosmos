import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * 切片 3 的验收（AUT-010 / EXT-006 / EXT-007）：产品面能选连接器，并按所选来源定义的
 * manifest schema 渲染字段（含只有 `enum` 没有 `type` 的必填枚举，以及认证提示），
 * 因此 Bilibili 双计划可以在一个连接下建出来——不再硬编码 RSS。
 *
 * 真实来源抓取（OpenCLI 登录态 + 外网）不在浏览器用例里跑，见 Task walkthrough 的
 * 「未运行」项；这里验的是**产品面能把它建出来**，即切片 3 的产品面那一半。
 */
test("builds two Bilibili plans under one connection from the manifest-driven form", async ({ page }) => {
    test.setTimeout(180_000);
    const suffix = randomUUID().slice(0, 8);
    const connectionName = `B站账号-${suffix}`;
    const hotName = `热门-${suffix}`;
    const feedName = `动态-${suffix}`;

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();

    // 连接按 Bilibili 连接器建：登录态（OpenCLI profile）归连接，表单只做提示。
    await page.getByLabel("连接名称").fill(connectionName);
    await page.getByLabel("连接 Connector").fill("bilibili");
    await page.getByLabel("连接适配器配置").fill('{"profile":"chrome-main"}');
    await page.getByRole("button", { name: "新建连接" }).click();
    await expect(page.getByText(connectionName, { exact: true })).toBeVisible();
    // 适配器配置按可读形式回显（Proposal connection-login-lifecycle-v1 决定 1）。
    await expect(page.getByText("profile: chrome-main")).toBeVisible();

    await createBilibiliPlan(page, {
        name: hotName,
        mode: "hot",
        limit: "20",
        connectionName,
    });
    await createBilibiliPlan(page, {
        name: feedName,
        mode: "feed",
        limit: "50",
        connectionName,
    });

    // 两个计划都在同一个连接的分组下，各自带自己的配置与频率。
    const section = page.getByRole("heading", { name: "采集计划" }).locator("..").locator("..");
    const group = section.locator("[data-plan-group]").filter({ hasText: connectionName });
    await expect(group.locator("li")).toHaveCount(2);
    await expect(group.locator("li").filter({ hasText: hotName })).toBeVisible();
    await expect(group.locator("li").filter({ hasText: feedName })).toBeVisible();

    // 服务端是唯一真相：刷新后两个计划都还在，且挂在同一个连接下。
    await page.reload();
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    const reloadedGroup = page
        .getByRole("heading", { name: "采集计划" })
        .locator("..").locator("..")
        .locator("[data-plan-group]")
        .filter({ hasText: connectionName });
    await expect(reloadedGroup.locator("li")).toHaveCount(2);
});

/** 走 manifest 驱动的表单：先选来源定义，再按它声明的字段填配置。 */
async function createBilibiliPlan(
    page: import("@playwright/test").Page,
    input: {
        name: string;
        mode: "hot" | "feed";
        limit: string;
        connectionName: string;
    },
): Promise<void> {
    await page.getByRole("button", { name: "新建计划" }).click();
    await page.locator("#source-definition").selectOption("source.bilibili@1");

    // 认证提示按 manifest 的 auth 声明展示，凭证不在表单里填。
    await expect(page.locator("[data-source-auth=external]")).toContainText("OpenCLI 浏览器登录态");

    await page.getByLabel("名称", { exact: true }).fill(input.name);
    // `mode` 在 manifest 里只有 enum、没有 type：渲染成选择框而不是被跳过。
    await page.locator("#source-config-mode").selectOption(input.mode);
    await page.locator("#source-config-limit").fill(input.limit);
    await page.locator("#source-connection").selectOption({ label: `${input.connectionName}（bilibili）` });
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("采集计划已保存，当前为停用状态")).toBeVisible();
}

/**
 * 多 operation 的真实消费者（EXT-006／Proposal connection-login-lifecycle-v1 决定 3）：
 * 同一个 Bilibili 定义的第二个操作在 Web 上可选，字段按所选操作声明渲染，保存时提交的是
 * 所选 `operationId`——服务端按 `(ref, operationId)` 校验，所以查询词缺了会被本地与服务端
 * 分别拦一次。搜索匿名可用，因此这个计划**不绑连接**也能建出来。
 */
test("builds a Bilibili search plan from the operation declared by the manifest", async ({ page }) => {
    test.setTimeout(120_000);
    const suffix = randomUUID().slice(0, 8);
    const searchName = `搜索-${suffix}`;

    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建计划" }).click();
    await page.locator("#source-definition").selectOption("source.bilibili@1");

    // 两个操作：默认第一个（fetch）沿用定义级 schema，渲染定义级的 mode/limit。
    await expect(page.locator("#source-operation")).toHaveValue("fetch");
    await expect(page.locator("#source-config-mode")).toBeVisible();

    // 换成 search：它自带配置 schema，查询词出现、fetch 的 mode 消失且旧值不残留。
    await page.locator("#source-operation").selectOption("search");
    await expect(page.locator("#source-config-query")).toBeVisible();
    await expect(page.locator("#source-config-mode")).toHaveCount(0);
    await page.getByLabel("名称", { exact: true }).fill(searchName);
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("请填写查询词。")).toBeVisible();

    await page.locator("#source-config-query").fill("cosmos");
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("采集计划已保存，当前为停用状态")).toBeVisible();

    // 服务端是唯一真相：刷新后计划还在（配置按 search schema 落库）。搜索不绑连接，
    // 所以它在计划列表的「未绑定」分组里——按名称在列表行内定位，不用整页文本匹配
    // （来源筛选下拉里也有同名 option）。
    await page.reload();
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    const planSection = page.getByRole("heading", { name: "采集计划" }).locator("..").locator("..");
    await expect(planSection.locator("li").filter({ hasText: searchName })).toBeVisible();
});

test("rejects a plan whose declared enum field is left at the empty option", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建计划" }).click();
    await page.locator("#source-definition").selectOption("source.bilibili@1");
    await page.getByLabel("名称", { exact: true }).fill(`缺字段-${randomUUID().slice(0, 8)}`);
    // 必填枚举留空：本地就按 manifest 的 required 报错，不发请求。
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("目标配置有未填写或不合法的字段", { exact: false })).toBeVisible();
    await expect(page.getByText("请填写采集模式。")).toBeVisible();
    // 换回 RSS 定义时整组配置重置，不把 Bilibili 的字段带到 RSS 上。
    await page.locator("#source-definition").selectOption("source.rss@1");
    await expect(page.locator("#source-config-feedUrl")).toBeVisible();
    await expect(page.locator("#source-config-mode")).toHaveCount(0);
});
