import {expect, test} from "@playwright/test";
import {expectSinglePreview} from "../support/lab";

/**
 * 阅读页右栏（`StoryEditPanel`）在实验室场景里的渲染验收。
 *
 * 只读区块（成员来源标记、时间线、相关内容、媒体）在左栏
 * `e2e/component-lab/story-reading-content.spec.ts`；这里只测写入动作本身。
 * 真实数据侧的其余动作由 `e2e/browser/story-reading.spec.ts` 覆盖。
 */
test.describe("component lab story edit panel", () => {
    test("renders the time bounds and the ordered key fact editor of the representation scene", async ({page}) => {
        const consoleErrors: string[] = [];
        page.on("console", (message) => {
            if (message.type() === "error") consoleErrors.push(message.text());
        });

        await page.goto("/dev/components?component=story-edit-panel&scene=default");
        const preview = await expectSinglePreview(page);

        // 编辑面默认展开（2026-10-03 起）：进来就该看得见动作，收起是可选的一步。
        await expect(preview.getByRole("button", {name: "收起", exact: true})).toBeVisible();
        await expect(preview.locator('fieldset[data-story-time-bound="start"]')).toBeVisible();
        await preview.getByRole("button", {name: "收起", exact: true}).click();
        await expect(preview.getByRole("button", {name: "展开", exact: true})).toBeVisible();
        /*
         * 收起后四段都不渲染，只剩标题行与折叠提示之间那一条线（实测 4 → 1）。
         * 收藏属于 C 段，因此收起时也不在——它不再常驻标题行（Round 9 从标题行移进 C 段，
         * 这条断言随之下移）。选择器限定在面板内部：实验室预览容器自己也有一条装饰分隔线。
         */
        await expect(preview.locator('fieldset[data-story-time-bound="start"]')).toHaveCount(0);
        await expect(preview.locator('section[aria-label="我的标记"]')).toHaveCount(0);
        await expect(preview.locator('[data-story-edit-panel] [data-slot="separator"]')).toHaveCount(1);
        await expect(preview.getByRole("button", {name: "收藏", exact: true})).toHaveCount(0);

        await preview.getByRole("button", {name: "展开", exact: true}).click();
        await expect(preview.getByRole("button", {name: "收藏", exact: true})).toBeVisible();
        await expect(preview.locator('section[aria-label="我的标记"]')).toBeVisible();
        // 展开后段间线回来：单成员夹具下没有拆分段，所以是 4 条（标题下 + C|B + B|A + A|D）。
        await expect(preview.locator('[data-story-edit-panel] [data-slot="separator"]')).toHaveCount(4);

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
        await page.goto("/dev/components?component=story-edit-panel&scene=splittable");
        const preview = await expectSinglePreview(page);
        // 默认展开（2026-10-03）：这里不再点「展开」，否则会把面板关掉。

        const splitForm = preview.getByRole("form", {name: "拆分 Story"});
        await expect(splitForm).toBeVisible();
        await expect(splitForm.getByRole("button", {name: "增加后继", exact: true})).toBeVisible();
        // 夹具给两个后继，各自可以选成员去向。
        await expect(splitForm.getByLabel("成员 Cosmos fixture · Cosmos fixture story")).toBeVisible();

        await page.goto("/dev/components?component=story-edit-panel&scene=split-shell");
        const shellPreview = await expectSinglePreview(page);
        await expect(shellPreview.getByRole("region", {name: "迁移用户状态"})
            .or(shellPreview.locator('section[aria-label="迁移用户状态"]'))).toBeVisible();
        // 已拆分的内容不再提供归并与再次拆分。
        await expect(shellPreview.getByRole("form", {name: "拆分 Story"})).toHaveCount(0);
    });
});
