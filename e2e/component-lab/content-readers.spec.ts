import { expect, test } from "@playwright/test";
import { expectSinglePreview } from "../support/lab";

for (const width of [320, 768, 1024, 1440]) {
    test(`ordered source content and keyboard selection at ${width}px`, async ({ page }) => {
        const errors: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        page.on("requestfailed", (request) => errors.push(request.url()));
        await page.setViewportSize({ width, height: 900 });
        await page.goto(`/dev/components?component=story-source-reader&scene=complete&viewport=${width}`);
        const preview = await expectSinglePreview(page);
        await expect(preview.locator("[data-reading-mode]")).toHaveAttribute("data-reading-mode", "representation");
        expect(await preview.locator("[data-block-id]").evaluateAll((nodes) => nodes.map((node) => node.getAttribute("data-block-id"))))
            .toEqual(["before", "image", "after", "audio"]);
        const select = preview.getByLabel("选择来源");
        await select.focus();
        await expect(select).toBeFocused();
        const initial = await select.inputValue();
        await select.press("ArrowDown");
        await select.press("Enter");
        await expect(select).not.toHaveValue(initial);
        await expect(preview.locator("[data-reading-mode]")).toBeVisible();
        await expect(preview.getByRole("link", { name: "查看来源原文" })).toHaveAttribute("href", /^https?:/);
        expect(errors).toEqual([]);
    });
}

test("shows partial, legacy, unavailable and retry states", async ({ page }) => {
    for (const [scene, text] of [
        ["partial", "部分内容未能完整解析"],
        ["legacy", "历史内容以安全文本展示"],
        ["unavailable", "此来源的正文暂不可用"],
        ["loading", "正在读取正文"],
        ["error", "正文读取失败"],
        ["empty", "此 Story 尚无可阅读的来源正文"],
    ]) {
        await page.goto(`/dev/components?component=story-source-reader&scene=${scene}`);
        const preview = await expectSinglePreview(page);
        await expect(preview).toContainText(text!);
        if (scene === "error") {
            await preview.getByRole("button", { name: "重新读取正文" }).click();
            await expect(preview.getByRole("alert")).toContainText("正文读取失败");
        }
    }
});
