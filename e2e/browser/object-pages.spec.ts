import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * 对象页的创建入口（切片 3b 验收 ①：**不打开任何 Story 就能建出话题与 Entity**）。
 *
 * 这两条曾经不成立：`/topics` 与 `/entities` 只做浏览，而创建动作又被 ADR-0029 决策 1
 * 从 Story 页移走，于是「创建话题/Entity」在产品里一度没有入口。现在创建在对象页、
 * 关联在 Story 页，各一处。
 */

test("在 /topics 不打开任何 Story 就能建出话题", async ({ page }) => {
    const title = `验收话题-${randomUUID().slice(0, 8)}`;

    await page.goto("/topics");
    await expect(page.getByRole("heading", { name: "话题", exact: true })).toBeVisible();

    await page.getByLabel("新话题标题").fill(title);
    await page.getByLabel("关注目的").fill("验证对象页可以独立创建话题。");
    await page.getByRole("button", { name: "新建话题", exact: true }).click();

    await expect(page.getByText(`已创建话题「${title}」`)).toBeVisible();
    await expect(page.getByRole("button", { name: title, exact: true })).toBeVisible();
});

test("在 /entities 不打开任何 Story 就能建出 Entity", async ({ page }) => {
    const name = `验收实体-${randomUUID().slice(0, 8)}`;

    await page.goto("/entities");
    await expect(page.getByRole("heading", { name: "Entity", exact: true })).toBeVisible();

    await page.getByLabel("新 Entity 名称").fill(name);
    await page.getByLabel("Entity 类型").selectOption("organization");
    await page.getByRole("button", { name: "新建 Entity", exact: true }).click();

    await expect(page.getByText(`已创建 Entity「${name}」`)).toBeVisible();
    await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
});
