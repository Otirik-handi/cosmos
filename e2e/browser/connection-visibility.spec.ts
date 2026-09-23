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
