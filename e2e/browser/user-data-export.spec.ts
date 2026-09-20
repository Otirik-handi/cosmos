import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

/**
 * LIB-008 / OPS-004 的产品面证据：存储面板的「导出用户数据」真的产出可保存的 JSON 文件。
 *
 * 断言分两层：浏览器层证明「点按钮 → 得到文件 + 文件名符合约定」，文件内容层证明导出件
 * 带上了刚创建的用户真相对象，且不含连接/Secret 这类非用户数据面。
 */
test("存储面板导出用户数据为可保存的 JSON 文件", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();

    const labelName = `导出标签-${randomUUID().slice(0, 8)}`;
    const labelId = await page.evaluate(async (name) => {
        const response = await fetch("/api/v1/labels", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({ name }),
        });
        const body = (await response.json()) as { id: string };
        return body.id;
    }, labelName);

    try {
        const storage = page.getByRole("region", { name: "存储" });
        const downloadPromise = page.waitForEvent("download");
        await storage.getByRole("button", { name: "导出用户数据" }).click();
        const download = await downloadPromise;

        expect(download.suggestedFilename()).toMatch(/^cosmos-user-data-\d{4}-\d{2}-\d{2}T[\d\-.]+Z\.json$/);

        const path = await download.path();
        const payload = JSON.parse(readFileSync(path, "utf8")) as {
            schemaVersion: number;
            counts: { labels: number };
            data: { labels: Array<{ id: string; name: string }> };
        };
        expect(payload.schemaVersion).toBe(1);
        expect(payload.counts.labels).toBe(payload.data.labels.length);
        expect(payload.data.labels.map((label) => label.name)).toContain(labelName);
        // 导出件只含用户真相对象：连接与 Secret 引用不在其中。
        expect(JSON.stringify(payload)).not.toContain("secretRef");

        await expect(storage.getByText("已导出：", { exact: false })).toBeVisible();
    } finally {
        // 共享栈：本用例创建的标签必须清掉，否则会影响依赖标签列表的其它 spec。
        await page.evaluate(async (id) => {
            await fetch(`/api/v1/labels/${id}/removals`, { method: "POST" });
        }, labelId);
    }
});
