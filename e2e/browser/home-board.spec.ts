import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * 首页看板：控制条与写入口径的回执。
 *
 * 回执断言是**行为门禁**的一部分：首页曾经有 `setNotice` 却没有渲染点，
 * 「已创建看板…」这类提示在首页静默丢弃——用户看不到自己刚做的操作生效了。
 */
test("新建看板后回执在首页可见，且看板出现在切换器里", async ({ page }) => {
    const boardName = `验收看板-${randomUUID().slice(0, 8)}`;

    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();

    await page.getByRole("button", { name: "编辑看板", exact: true }).click();
    await page.getByLabel("新看板名称").fill(boardName);
    await page.getByRole("button", { name: "新建看板", exact: true }).click();

    // 按文案定位而不是 role=status：看板的拖拽库自己也挂了三个 live region。
    await expect(page.getByText(`已创建看板「${boardName}」`)).toBeVisible();
    await expect(page.getByRole("option", { name: boardName })).toHaveCount(1);
});
