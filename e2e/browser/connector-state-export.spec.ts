import { expect, test } from "@playwright/test";
import { readFileSync } from "node:fs";

/**
 * ING-012 / ADR-0026 的产品面证据：存储面板的「导出连接器状态」产出可保存的 JSON 文件，
 * 并且把同一份文件导入回来是幂等的（默认只补缺失）。
 *
 * 断言分两层：浏览器层证明「点按钮 → 得到文件 + 文件名符合约定」，文件内容层证明导出件
 * 只含连接器状态（不含 Secret 引用与连接配置）。
 */
test("存储面板导出并回导连接器状态", async ({ page }) => {
    test.setTimeout(120_000);
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();

    const storage = page.getByRole("region", { name: "存储" });
    const downloadPromise = page.waitForEvent("download");
    await storage.getByRole("button", { name: "导出连接器状态" }).click();
    const download = await downloadPromise;

    expect(download.suggestedFilename())
        .toMatch(/^cosmos-connector-state-\d{4}-\d{2}-\d{2}T[\d\-.]+Z\.json$/);

    const path = await download.path();
    const payload = JSON.parse(readFileSync(path, "utf8")) as {
        schemaVersion: number;
        counts: { namespaces: number; keys: number };
        namespaces: Array<{ namespace: string; entries: unknown[] }>;
    };
    expect(payload.schemaVersion).toBe(1);
    expect(payload.counts.namespaces).toBe(payload.namespaces.length);
    expect(payload.counts.keys)
        .toBe(payload.namespaces.reduce((total, bucket) => total + bucket.entries.length, 0));
    // 导出件只含非秘密状态：连接与 Secret 引用不在其中。
    expect(JSON.stringify(payload)).not.toContain("secretRef");

    await expect(storage.getByText("已导出连接器状态：", { exact: false })).toBeVisible();

    // 把刚导出的件原样导入：默认模式是「只补缺失」，因此重复导入必然全部跳过。
    await storage.getByLabel("连接器状态导出件").setInputFiles(path);
    await storage.getByRole("button", { name: "导入连接器状态" }).click();
    await expect(storage.getByText("已导入（只补缺失）", { exact: false })).toBeVisible();
    await expect(storage.getByText("覆盖 0", { exact: false })).toBeVisible();
});
