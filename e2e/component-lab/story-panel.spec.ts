import {expect, test} from "@playwright/test";

const PREVIEW_ROOT = "[data-component-lab-preview]";

/**
 * Story 当前表示的后两项（时间范围与关键事实）在实验室场景里的渲染验收。
 * 事件时间按本地时间显示，所以期望串由 fixture 的时刻现算，不写死读数。
 */
function localMinuteOf(exact: string): string {
    const at = new Date(exact);
    const pad = (value: number): string => String(value).padStart(2, "0");
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${pad(at.getHours())}:${pad(at.getMinutes())}`;
}

test.describe("component lab story panel representation", () => {
    test("renders the event time and the ordered key facts of the representation scene", async ({page}) => {
        const consoleErrors: string[] = [];
        page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });

        await page.goto("/dev/components?component=story-panel&scene=representation");
        const preview = page.locator(PREVIEW_ROOT);
        await expect(preview).toBeVisible();

        const eventTime = preview.locator('[data-story-event-time="true"]');
        await expect(eventTime).toContainText("事件时间");
        await expect(eventTime).toContainText(localMinuteOf("2026-01-02T09:30:00.000Z"));
        await expect(eventTime).toContainText("昨天下午");
        await expect(eventTime).toContainText("不精确");

        const facts = preview.locator('[data-story-key-facts="true"]');
        await expect(facts).toBeVisible();
        await expect(facts.locator("li")).toHaveCount(3);
        await expect(facts.locator("li").nth(0)).toContainText("上下文窗口 1M");
        await expect(facts.locator("li").nth(0)).toContainText("出处：");
        await expect(facts.locator("li").nth(1)).toContainText("第三方测评认为长文本仍会衰减");
        await expect(facts.locator("li").nth(1)).not.toContainText("出处：");
        await expect(facts.locator("li").nth(2)).toContainText("出处已删除");

        // 表单侧同样可见：时间范围两个端点和事实编辑器都在预览里。
        await expect(preview.locator('fieldset[data-story-time-bound="start"]')).toBeVisible();
        await expect(preview.locator('fieldset[data-story-time-bound="end"]')).toBeVisible();
        await expect(preview.locator('[data-story-key-fact-editor="true"] li')).toHaveCount(3);

        expect(consoleErrors).toEqual([]);
    });
});
