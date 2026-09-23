import {expect, test} from "@playwright/test";

const PREVIEW_ROOT = "[data-component-lab-preview]";

/**
 * AUT-009 的连接可见性在实验室场景里的渲染验收：授权范围与失效原因两行、两种状态各自的
 * 动作入口，以及「标记失效」的内联原因输入。真实写入与状态翻转在浏览器产品 E2E 里验。
 */
test("renders the authorized scope and failure reason of the connection scene", async ({page}) => {
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/dev/components?component=connection-panel&scene=populated");
    const preview = page.locator(PREVIEW_ROOT);
    await expect(preview).toBeVisible();

    const active = preview.locator("li", { hasText: "我的 Bilibili 主账号" });
    await expect(active).toContainText("授权范围");
    // 授权范围按「键: 值」渲染，而不是把 JSON 原文丢给用户。
    await expect(active).toContainText("read: true · comment: false");
    await expect(active).toContainText("失效原因");
    await expect(active).toContainText("未记录");
    await expect(active.getByRole("button", { name: "标记失效 我的 Bilibili 主账号" })).toBeVisible();

    // 失效中的连接显示原因，动作入口换成「恢复可用」。
    const failed = preview.locator("li", { hasText: "示例站登录态" });
    await expect(failed).toContainText("登录态已过期");
    await expect(failed.getByRole("button", { name: "恢复可用 示例站登录态" })).toBeVisible();

    // 标记失效：内联输入在确认前不可提交，提交后收起。
    await active.getByRole("button", { name: "标记失效 我的 Bilibili 主账号" }).click();
    const reason = active.getByLabel("失效原因 我的 Bilibili 主账号");
    await expect(reason).toBeVisible();
    const confirm = active.getByRole("button", { name: "确认标记失效" });
    await expect(confirm).toBeDisabled();
    await reason.fill("登录态已过期");
    await expect(confirm).toBeEnabled();
    await confirm.click();
    await expect(reason).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
});

/**
 * 授权范围输入必须是合法 JSON：非法输入在本地就被拦下，不发请求也不清空表单。
 */
test("rejects a non-JSON authorized scope before creating the connection", async ({page}) => {
    await page.goto("/dev/components?component=connection-panel&scene=populated");
    const preview = page.locator(PREVIEW_ROOT);
    await expect(preview).toBeVisible();

    await preview.getByLabel("连接名称").fill("范围格式用例");
    await preview.getByLabel("连接授权范围").fill("{read: true}");
    await preview.getByRole("button", { name: "新建连接" }).click();

    await expect(preview.getByRole("alert")).toContainText("授权范围必须是合法 JSON");
    // 表单没有被清空：用户不必重新输入名称。
    await expect(preview.getByLabel("连接名称")).toHaveValue("范围格式用例");
});

/**
 * 适配器配置同样必须是合法 JSON（Proposal connection-login-lifecycle-v1 决定 1）：
 * Bilibili 的 OpenCLI profile 就是从这里进的连接，非法输入在本地拦下。
 */
test("rejects a non-JSON adapter configuration before creating the connection", async ({page}) => {
    await page.goto("/dev/components?component=connection-panel&scene=populated");
    const preview = page.locator(PREVIEW_ROOT);
    await expect(preview).toBeVisible();

    await preview.getByLabel("连接名称").fill("适配器配置格式用例");
    await preview.getByLabel("连接适配器配置").fill("{profile: chrome-main}");
    await preview.getByRole("button", { name: "新建连接" }).click();

    await expect(preview.getByRole("alert")).toContainText("适配器配置必须是合法 JSON");
    await expect(preview.getByLabel("连接名称")).toHaveValue("适配器配置格式用例");
});
