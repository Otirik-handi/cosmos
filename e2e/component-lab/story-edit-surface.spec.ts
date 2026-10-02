import {expect, test} from "@playwright/test";
import {expectSinglePreview} from "../support/lab";

/**
 * Story 编辑与关联面在实验室场景里的渲染验收。
 *
 * 只读区块（事件时间、关键事实展示、人工真相保护提示、成员来源标记）随切片 3f 搬到阅读页，
 * 它们的渲染验收在 `e2e/browser/story-reading.spec.ts` 里对真实页面做；这里只测编辑面本身
 * 与仍在编辑面里的成员行关系控件。
 */
test.describe("component lab story edit surface", () => {
    test("renders the time bounds and the ordered key fact editor of the representation scene", async ({page}) => {
        const consoleErrors: string[] = [];
        page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });

        await page.goto("/dev/components?component=story-edit-surface&scene=representation");
        const preview = await expectSinglePreview(page);

        // 编辑面默认收起：动作要先展开才在预览里可见（阅读页的宽度留给正文）。
        await preview.getByRole("button", {name: "展开", exact: true}).click();
        await expect(preview.getByRole("button", {name: "收起", exact: true})).toBeVisible();

        // 表单侧：时间范围两个端点和三条事实编辑器都在预览里。
        await expect(preview.locator('fieldset[data-story-time-bound="start"]')).toBeVisible();
        await expect(preview.locator('fieldset[data-story-time-bound="end"]')).toBeVisible();
        await expect(preview.locator('[data-story-key-fact-editor="true"] li')).toHaveCount(3);

        expect(consoleErrors).toEqual([]);
    });

    /**
     * 拆分与用户状态迁移（3d 验收 ③）：这两件事在阅读页要求特定数据形态——
     * 拆分要至少两个成员、迁移只在拆分出来的「已拆分」壳上出现。用固定夹具验证它们的
     * 渲染与入口仍在，真实数据侧由 `e2e/browser/story-reading.spec.ts` 覆盖其余动作。
     */
    test("renders the split form for a two-member story and the migration form for a split shell", async ({page}) => {
        await page.goto("/dev/components?component=story-edit-surface&scene=splittable");
        const preview = await expectSinglePreview(page);
        await preview.getByRole("button", {name: "展开", exact: true}).click();

        const splitForm = preview.getByRole("form", {name: "拆分 Story"});
        await expect(splitForm).toBeVisible();
        await expect(splitForm.getByRole("button", {name: "增加后继", exact: true})).toBeVisible();
        // 夹具给两个后继，各自可以选成员去向。
        await expect(splitForm.getByLabel("成员 Cosmos fixture · Cosmos fixture story")).toBeVisible();

        await page.goto("/dev/components?component=story-edit-surface&scene=split-shell");
        const shellPreview = await expectSinglePreview(page);
        await shellPreview.getByRole("button", {name: "展开", exact: true}).click();
        await expect(shellPreview.getByRole("region", {name: "迁移用户状态"})
            .or(shellPreview.locator('section[aria-label="迁移用户状态"]'))).toBeVisible();
        // 已拆分的内容不再提供归并与再次拆分。
        await expect(shellPreview.getByRole("form", {name: "拆分 Story"})).toHaveCount(0);
    });

    /**
     * 条目↔条目重复/转载关系在成员行上的渲染：标注、方向措辞与标记/解除入口。
     */
    test("renders the member-row duplicate relation of the entry-relations scene", async ({page}) => {
        const consoleErrors: string[] = [];
        page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });

        await page.goto("/dev/components?component=story-edit-surface&scene=entry-relations");
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
        await page.goto("/dev/components?component=story-edit-surface&scene=human-protected");
        const preview = await expectSinglePreview(page);
        const member = preview.locator('[data-story-member-id="entry-fixture"]');
        await expect(member).toContainText("人工编辑过");
        await expect(member).not.toContainText("系统创建");

        await page.goto("/dev/components?component=story-edit-surface&scene=representation");
        await expectSinglePreview(page);
        const machineMember = page.locator('[data-story-member-id="entry-fixture"]');
        await expect(machineMember).toContainText("系统创建");
        await expect(machineMember).not.toContainText("人工编辑过");
    });
});
