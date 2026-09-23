import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * AUT-009 的产品面证据：连接的授权范围与失效原因真的能被用户看到与记录。
 *
 * 断言分三层：建连接时记录的授权范围按可读形式回显；标记失效后状态徽标与原因一起变；
 * 恢复可用后原因被清空。结束前删掉用例创建的连接，避免污染共享栈。
 */
test("连接面板显示并记录授权范围与失效原因", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();

    const connectionName = `连接可见性-${randomUUID().slice(0, 8)}`;
    const connections = page.getByRole("region", { name: "连接" });
    let connectionId: string | null = null;

    try {
        await connections.getByLabel("连接名称").fill(connectionName);
        await connections.getByLabel("连接授权范围").fill('{"read":true,"comment":false}');
        await connections.getByRole("button", { name: "新建连接" }).click();

        const row = connections.locator("li", { hasText: connectionName });
        await expect(row).toBeVisible();
        // 授权范围按「键: 值」渲染，用户不必读 JSON 原文。
        await expect(row).toContainText("read: true · comment: false");
        await expect(row).toContainText("未记录");

        connectionId = await page.evaluate(async (name) => {
            const response = await fetch("/api/v1/connections");
            const body = (await response.json()) as Array<{ id: string; name: string }>;
            return body.find((item) => item.name === name)?.id ?? null;
        }, connectionName);
        expect(connectionId).not.toBeNull();

        await row.getByRole("button", { name: `标记失效 ${connectionName}` }).click();
        await row.getByLabel(`失效原因 ${connectionName}`).fill("登录态已过期");
        await row.getByRole("button", { name: "确认标记失效" }).click();

        await expect(row).toContainText("错误");
        await expect(row).toContainText("登录态已过期");

        await row.getByRole("button", { name: `恢复可用 ${connectionName}` }).click();
        await expect(row).toContainText("可用");
        await expect(row).toContainText("未记录");
    } finally {
        if (connectionId !== null) {
            await page.evaluate(async (id) => {
                await fetch(`/api/v1/connections/${id}/removals`, { method: "POST" });
            }, connectionId);
        }
    }
});

/**
 * 切片 4b 的产品面证据：登录状态由**系统探测**写入，而不是用户手填（Proposal
 * connection-login-lifecycle-v1 决定 2）。
 *
 * 探测结论与运行环境有关（本机有可用 OpenCLI 时是「登录状态正常」，没有时是一句可读的失败
 * 原因），所以这里只断言与结论无关的事实：入口按 manifest 声明出现，探测跑完后「上次检查」
 * 不再是「未检查」——也就是状态真的被系统写回过。
 */
test("连接面板能发起登录探测并记录检查时间", async ({ page }) => {
    // 连接器的子进程超时是 120s，探测又必须等 Worker 跑完，所以给足余量。
    test.setTimeout(240_000);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();

    const connectionName = `登录探测-${randomUUID().slice(0, 8)}`;
    const connections = page.getByRole("region", { name: "连接" });
    let connectionId: string | null = null;

    try {
        await connections.getByLabel("连接名称").fill(connectionName);
        await connections.getByLabel("连接 Connector").fill("bilibili");
        await connections.getByLabel("连接适配器配置").fill('{"profile":"chrome-main"}');
        await connections.getByRole("button", { name: "新建连接" }).click();

        const row = connections.locator("li", { hasText: connectionName });
        await expect(row).toBeVisible();
        await expect(row).toContainText("未检查");

        connectionId = await page.evaluate(async (name) => {
            const response = await fetch("/api/v1/connections");
            const body = (await response.json()) as Array<{ id: string; name: string }>;
            return body.find((item) => item.name === name)?.id ?? null;
        }, connectionName);
        expect(connectionId).not.toBeNull();

        await row.getByRole("button", { name: `检查登录状态 ${connectionName}` }).click();
        // 探测由 Worker 执行（真实 OpenCLI 调用可能慢到分钟级），只等它把检查时间写回来；
        // 结论与运行环境有关，所以这里不断言具体是「正常」还是失败原因。
        await expect(row).not.toContainText("未检查", { timeout: 150_000 });
    } finally {
        if (connectionId !== null) {
            await page.evaluate(async (id) => {
                await fetch(`/api/v1/connections/${id}/removals`, { method: "POST" });
            }, connectionId);
        }
    }
});
