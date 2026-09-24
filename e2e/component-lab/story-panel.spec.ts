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

    /**
     * 条目↔条目重复/转载关系在成员行上的渲染：标注、方向措辞与标记/解除入口。
     */
    test("renders the member-row duplicate relation of the entry-relations scene", async ({page}) => {
        const consoleErrors: string[] = [];
        page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });

        await page.goto("/dev/components?component=story-panel&scene=entry-relations");
        const preview = page.locator(PREVIEW_ROOT);
        await expect(preview).toBeVisible();

        // 第二条成员转载自第一条：两侧措辞相反，且只有转载方那条 fixture 关系。
        const reprint = preview.locator('[data-story-member-id="entry-fixture-2"]');
        await expect(reprint.locator('[data-story-member-relations="entry-fixture-2"]'))
            .toContainText("转载自");
        const original = preview.locator('[data-story-member-id="entry-fixture"]');
        await expect(original.locator('[data-story-member-relations="entry-fixture"]')).toHaveCount(0);

        // 标记入口与解除入口都在。
        await expect(preview.locator('[data-entry-relation-open="entry-fixture"]')).toBeVisible();
        await expect(preview.locator('[data-entry-relation-remove="entry-fixture-2:entry-fixture"]')).toBeVisible();

        expect(consoleErrors).toEqual([]);
    });

    /**
     * 人工真相保护（ADR-0028）：当前 Revision 归人工时面板说明自动更新已暂停，
     * 未受保护的场景不出现这条标记。
     */
    test("shows the human-protection notice only for the human-protected scene", async ({page}) => {
        await page.goto("/dev/components?component=story-panel&scene=human-protected");
        const preview = page.locator(PREVIEW_ROOT);
        await expect(preview).toBeVisible();
        const notice = preview.locator('[data-story-human-protected="true"]');
        await expect(notice).toBeVisible();
        await expect(notice).toContainText("自动更新已暂停");

        await page.goto("/dev/components?component=story-panel&scene=representation");
        await expect(page.locator(PREVIEW_ROOT)).toBeVisible();
        await expect(page.locator('[data-story-human-protected="true"]')).toHaveCount(0);
    });
});
