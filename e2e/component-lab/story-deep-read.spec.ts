import { expect, test } from "@playwright/test";
import { expectSinglePreview } from "../support/lab";

for (const width of [1024, 1440]) {
    test(`report, precise evidence, focus and versions at ${width}`, async ({ page }) => {
        const errors: string[] = [];
        const apiCalls: string[] = [];
        page.on("pageerror", (error) => errors.push(error.message));
        page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
        page.on("request", (request) => { if (new URL(request.url()).pathname.startsWith("/api/")) apiCalls.push(request.url()); });
        await page.setViewportSize({ width, height: 1000 });
        await page.goto(`/dev/components?component=story-deep-read&scene=versions&viewport=${width}`);
        const preview = await expectSinglePreview(page);
        await expect(preview.getByRole("heading", { name: "深入阅读报告 2" })).toBeVisible();
        await expect(preview).toContainText("Agent 观点");
        await expect(preview).toContainText("实际成本：0.3 USD");
        const chip = preview.getByRole("button", { name: "来源证据 1", exact: true });
        await chip.focus();
        await chip.press("Enter");
        const drawer = page.getByRole("dialog", { name: "来源证据", exact: true });
        await expect(drawer).toBeVisible();
        await expect(drawer).toContainText("lab-revision · 表示版本 2");
        const target = drawer.locator('[data-block-id="lab-block"]');
        await expect(target).toHaveAttribute("data-deep-read-highlighted", "true");
        await expect(target).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveCount(0);
        await expect(chip).toBeFocused();
        await preview.getByLabel("报告版本", { exact: true }).selectOption("1");
        await expect(preview.getByRole("heading", { name: "深入阅读报告 1" })).toBeVisible();
        await expect(preview).toContainText("旧版本 · 只读");
        expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
        expect(errors).toEqual([]);
        expect(apiCalls).toEqual([]);
    });
}

for (const [scene, message] of [
    ["missing-evidence", "该来源证据暂不可用，报告正文仍可阅读。"],
    ["missing-block", "该证据位置暂不可用，可阅读此版本来源内容。"],
] as const) {
    test(`${scene} does not replace report or exact source`, async ({ page }) => {
        await page.goto(`/dev/components?component=story-deep-read&scene=${scene}&viewport=1024`);
        const preview = await expectSinglePreview(page);
        await preview.getByRole("button", { name: "来源证据 1", exact: true }).click();
        const drawer = page.getByRole("dialog", { name: "来源证据", exact: true });
        await expect(drawer).toContainText(message);
        if (scene === "missing-block") await expect(drawer).toContainText("精确版本来源正文");
        await page.keyboard.press("Escape");
        await expect(preview.getByRole("heading", { name: "深入阅读报告 2" })).toBeVisible();
    });
}

test("lost response replays one key and refresh resumes run without duplicating generation", async ({ page }) => {
    await page.goto("/dev/components?component=story-deep-read&scene=idle&viewport=1024");
    let preview = await expectSinglePreview(page);
    await preview.getByLabel("Hold generation", { exact: true }).check();
    await preview.getByLabel("Lose enqueue response", { exact: true }).check();
    await preview.getByRole("button", { name: "生成深入阅读", exact: true }).click();
    await expect(preview).toContainText("尚未确认入队结果");
    await expect(preview.getByLabel("Generation count")).toHaveText("1");
    await preview.getByRole("button", { name: "恢复同一请求", exact: true }).click();
    await expect(preview).toContainText("正在生成深入阅读");
    await expect(preview.getByLabel("Generation count")).toHaveText("1");
    await page.reload();
    preview = await expectSinglePreview(page);
    await expect(preview.getByRole("heading", { name: "深入阅读报告 1" })).toBeVisible();
    await expect(preview.getByLabel("Generation count")).toHaveText("1");
});

test("failed generation preserves published report and retry uses a new key", async ({ page }) => {
    await page.goto("/dev/components?component=story-deep-read&scene=failed&viewport=1024");
    const preview = await expectSinglePreview(page);
    await preview.getByRole("button", { name: "重新生成深入阅读", exact: true }).click();
    await expect(preview).toContainText("本次生成超出允许时限", { timeout: 15_000 });
    await expect(preview.getByRole("heading", { name: "深入阅读报告 2" })).toBeVisible();
    await preview.getByRole("button", { name: "重试生成深入阅读", exact: true }).click();
    await expect(preview.getByLabel("Generation count")).toHaveText("2");
    await expect(preview).toContainText("本次生成超出允许时限");
});

test("409 reads active generation without creating a replacement request", async ({ page }) => {
    await page.goto("/dev/components?component=story-deep-read&scene=conflict&viewport=1024");
    const preview = await expectSinglePreview(page);
    await preview.getByRole("button", { name: "生成深入阅读", exact: true }).click();
    await expect(preview).toContainText("该 Story 已有进行中的深入阅读");
    await expect(preview).toContainText("正在生成深入阅读");
    await expect(preview.getByLabel("Generation count")).toHaveText("0");
    await expect(preview.getByRole("button", { name: "生成深入阅读", exact: true })).toBeDisabled();
});

test("long report and code stay inside the reading surface", async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 900 });
    await page.goto("/dev/components?component=story-deep-read&scene=long&viewport=1024");
    const preview = await expectSinglePreview(page);
    await expect(preview.getByRole("heading", { name: "深入阅读报告 2" })).toBeVisible();
    expect(await preview.evaluate((element) => element.scrollWidth <= element.clientWidth + 1)).toBe(true);
});
