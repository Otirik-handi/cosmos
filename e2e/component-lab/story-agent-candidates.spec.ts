import { expect, test } from "@playwright/test";
import { expectSinglePreview } from "../support/lab";

for (const width of [320, 768, 1024, 1440]) {
    test(`candidate preview and human decision at ${width}px`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        page.on("requestfailed", (request) => errors.push(request.url()));
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/dev/components?component=story-agent-candidates&scene=interactive&viewport=${width}`);
        const preview = await expectSinglePreview(page);
        await expect(preview.getByText("暂无建议。", { exact: true })).toBeVisible();
        const generate = preview.getByRole("button", { name: "生成建议", exact: true });
        await generate.focus();
        await expect(generate).toBeFocused();
        await generate.press("Enter");
        await expect(preview.getByRole("heading", { name: "建议标题", exact: true })).toBeVisible();
        await expect(preview).toContainText("<script>不会执行</script>");
        await expect(preview.locator("script")).toHaveCount(0);
        await preview.getByLabel("模拟未保存编辑").check();
        await expect(preview.getByRole("button", { name: "接受建议", exact: true })).toBeDisabled();
        await expect(preview).toContainText("请先保存或取消编辑");
        await preview.getByLabel("模拟未保存编辑").uncheck();
        await preview.getByRole("button", { name: "接受建议", exact: true }).click();
        await expect(preview.getByText("已接受", { exact: true })).toBeVisible();
        await expect(preview.getByText("已刷新 Story", { exact: true })).toBeVisible();
        await expect(preview.getByRole("button", { name: "接受建议", exact: true })).toHaveCount(0);
        await generate.click();
        await preview.getByRole("button", { name: "拒绝建议", exact: true }).click();
        await expect(preview.getByText("已拒绝", { exact: true })).toBeVisible();
        expect(errors).toEqual([]);
    });
}
