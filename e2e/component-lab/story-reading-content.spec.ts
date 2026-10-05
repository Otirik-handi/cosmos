import {expect, test} from "@playwright/test";
import {expectSinglePreview} from "../support/lab";

/**
 * 阅读页左栏（`StoryReadingContent`）在实验室场景里的渲染验收。
 *
 * 这些区块都常驻显示、没有「展开」这一步：它们不随编辑面收起（Task 36 切片 A 把只读
 * 内容与写入动作拆到两栏）。真实页面上的同类断言在 `e2e/browser/story-reading.spec.ts`
 * 与 `phase2-entry-relation.spec.ts`。
 */
test.describe("component lab story reading content", () => {
    /**
     * 条目↔条目重复/转载关系在成员行上的渲染：标注、方向措辞与标记/解除入口。
     */
    test("renders the member-row duplicate relation of the entry-relations scene", async ({page}) => {
        const consoleErrors: string[] = [];
        page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });

        await page.goto("/dev/components?component=story-reading-content&scene=entry-relations");
        const preview = await expectSinglePreview(page);

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
     * 成员行的来源标记（ADR-0028）：人工写过当前 Revision 的 Story 标「人工编辑过」，
     * 机器写出的标「系统创建」——两者不能同时出现，也不该在没有 producer 时乱猜。
     */
    test("marks human-written and machine-written members differently", async ({page}) => {
        await page.goto("/dev/components?component=story-reading-content&scene=human-protected");
        const preview = await expectSinglePreview(page);
        const member = preview.locator('[data-story-member-id="entry-fixture"]');
        await expect(member).toContainText("人工编辑过");
        await expect(member).not.toContainText("系统创建");

        await page.goto("/dev/components?component=story-reading-content&scene=representation");
        await expectSinglePreview(page);
        const machineMember = page.locator('[data-story-member-id="entry-fixture"]');
        await expect(machineMember).toContainText("系统创建");
        await expect(machineMember).not.toContainText("人工编辑过");
    });
});
