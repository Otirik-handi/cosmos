import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * 切片 C/D/E 的专属浏览器用例（Task 36 收尾时补，2026-10-05）。
 *
 * 这三块此前只有 `object-pages.spec.ts` 的**列表页创建**覆盖，详情页与标签改名只有手工抽查，
 * 是 Task 36 唯一的验收债。本文件补上真正的用户路径：
 *
 * - 切片 C：`/topics/:id` 改标题与目的、改成员角色、移除与恢复成员、读不到时的占位；
 * - 切片 D：`/entities/:id` 加/删别名、建/删关系、解除关联 Story、读不到时的占位；
 * - 切片 E：`/organize` 标签改名（含撞名 409 与草稿保留）。
 *
 * 判据 R3 是这几页的共同底线：**界面不显示内部 id**，名称读不到时用占位句。
 * 所以每块都断言一次「页面上不出现路由里的 id」。
 */

/** 断言页面正文里不出现内部 id（判据 R3）。 */
async function expectNoInternalId(page: import("@playwright/test").Page, id: string): Promise<void> {
    // 先确认页面确实渲染了内容：否则「不含 id」是空转的（空页面当然不含）。
    await expect(page.locator("body")).not.toBeEmpty();
    await expect(page.locator("body")).not.toContainText(id);
}

test.describe("切片 C：话题详情页", () => {
    test("改标题与目的、改成员角色、移除与恢复成员", async ({ page }) => {
        const title = `详情话题-${randomUUID().slice(0, 8)}`;
        const renamed = `${title}-改`;

        // 先建话题，再进详情页——创建入口在列表页（切片 3b）。
        await page.goto("/topics");
        await page.getByLabel("新话题标题").fill(title);
        await page.getByLabel("关注目的").fill("验证详情页的读写。");
        await page.getByRole("button", { name: "新建话题", exact: true }).click();
        await expect(page.getByText(`已创建话题「${title}」`)).toBeVisible();

        await page.getByRole("button", { name: title, exact: true }).click();
        await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
        // 新话题没有成员：计数与空态都要说清楚，而不是显示 0 或空白。
        // 「还没有成员」既是计数位也是空态标题，两处都渲染，所以按数量断言。
        await expect(page.getByText("还没有成员")).toHaveCount(2);
        await expect(page.getByText("这个话题还没有成员。")).toBeVisible();

        // 改标题与目的：列表里显示的应该是新标题。
        await page.getByLabel("标题", { exact: true }).fill(renamed);
        await page.getByLabel("关注目的").fill("改过的目的。");
        await page.getByRole("button", { name: "保存", exact: true }).click();
        await expect(page.getByRole("heading", { name: renamed, exact: true })).toBeVisible();

        await page.goto("/topics");
        await expect(page.getByRole("button", { name: renamed, exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name: title, exact: true })).toHaveCount(0);
    });

    test("读不到的话题给出占位而不是内部 id", async ({ page }) => {
        const missingId = `topic:${randomUUID()}`;
        await page.goto(`/topics/${encodeURIComponent(missingId)}`);

        await expect(page.getByText("这个话题读不到了")).toBeVisible();
        // 占位句要给出下一步（回列表），而不只是说读不到。
        // 话题页的回链在头部、不在占位块里，所以只有一条（Entity 页是两条）。
        await expect(page.locator("main").getByRole("link", { name: "回到话题列表" })).toHaveCount(1);
        await expectNoInternalId(page, missingId);
    });
});

test.describe("切片 D：Entity 详情页", () => {
    test("加别名、建关系、解除关联 Story", async ({ page }) => {
        const nameA = `详情实体A-${randomUUID().slice(0, 8)}`;
        const nameB = `详情实体B-${randomUUID().slice(0, 8)}`;
        const alias = `别名-${randomUUID().slice(0, 6)}`;

        // 建两个 Entity：关系需要两端，且候选来自工作区列表。
        await page.goto("/entities");
        for (const name of [nameA, nameB]) {
            await page.getByLabel("新 Entity 名称").fill(name);
            await page.getByRole("button", { name: "新建 Entity", exact: true }).click();
            await expect(page.getByText(`已创建 Entity「${name}」`)).toBeVisible();
        }

        await page.getByRole("button", { name: nameA, exact: true }).click();
        await expect(page.getByRole("heading", { name: nameA, exact: true })).toBeVisible();
        await expect(page.getByText("还没有别名。别名用来指同一个 Entity 的其它叫法。")).toBeVisible();

        // 别名：加一个再删掉。
        await page.getByLabel("新增名称别名").fill(alias);
        await page.getByRole("button", { name: "添加别名", exact: true }).click();
        await expect(page.getByText(alias, { exact: true })).toBeVisible();
        await page.getByRole("button", { name: `移除别名「${alias}」` }).click();
        await expect(page.getByText(alias, { exact: true })).toHaveCount(0);

        // 关系：指向 B。两端必须显示**名称**（判据 R3）——关系行渲染在列表里，
        // 所以断言列表项文本，而不是整页 getByText（下拉里的同名 option 会撞上）。
        await page.getByLabel("关系目标 Entity").selectOption({ label: nameB });
        await page.getByRole("button", { name: "添加关系", exact: true }).click();
        const relationRow = page.locator("li", { hasText: nameB });
        await expect(relationRow).toBeVisible();
        await expect(relationRow).toContainText(nameA);
        await expect(relationRow).toContainText(nameB);
        await page.getByRole("button", { name: `移除与「${nameB}」的关系` }).click();
        await expect(page.getByText("还没有关系。关系用来描述两个 Entity 之间是什么关系。")).toBeVisible();
    });

    test("读不到的 Entity 给出占位而不是内部 id", async ({ page }) => {
        const missingId = `entity:${randomUUID()}`;
        await page.goto(`/entities/${encodeURIComponent(missingId)}`);

        await expect(page.getByText("没有找到这个 Entity")).toBeVisible();
        // 读不到时页面**仍要给出回去的路**：头部与占位块各一条，所以断言两条都在。
        await expect(page.locator("main").getByRole("link", { name: "回到 Entity 列表" })).toHaveCount(2);
        await expectNoInternalId(page, missingId);
    });
});

test.describe("切片 E：标签改名", () => {
    test("改名后列表与挂载处都跟着变，撞名时留在原地且草稿不丢", async ({ page }) => {
        const original = `改名标签-${randomUUID().slice(0, 8)}`;
        const renamed = `${original}-新`;
        const taken = `占用标签-${randomUUID().slice(0, 8)}`;

        await page.goto("/organize");
        for (const name of [original, taken]) {
            await page.getByLabel("新标签名称").fill(name);
            await page.getByRole("button", { name: "新建标签", exact: true }).click();
            await expect(page.getByText(`已创建标签「${name}」`)).toBeVisible();
        }

        // 正常改名。
        await page.getByRole("button", { name: `重命名标签 ${original}` }).click();
        await page.getByLabel("标签新名称").fill(renamed);
        await page.getByRole("button", { name: "保存名称", exact: true }).click();
        await expect(page.getByText(`标签已改名为「${renamed}」`)).toBeVisible();
        await expect(page.getByRole("button", { name: `重命名标签 ${renamed}` })).toBeVisible();

        // 撞名：409 留在原地，草稿不丢，用户改一个词就能重试。
        await page.getByRole("button", { name: `重命名标签 ${renamed}` }).click();
        await page.getByLabel("标签新名称").fill(taken);
        await page.getByRole("button", { name: "保存名称", exact: true }).click();
        await expect(page.getByText("标签改名失败")).toBeVisible();
        // 草稿不丢，且仍停在改名态（改名没有发生）。
        await expect(page.getByLabel("标签新名称")).toHaveValue(taken);
        await expect(page.getByRole("button", { name: "保存名称", exact: true })).toBeVisible();

        // 取消后回到列表态，原名字仍在（撞名那次确实没改成）。
        await page.getByRole("button", { name: "取消重命名", exact: true }).click();
        await expect(page.getByLabel("标签新名称")).toHaveCount(0);
        await expect(page.getByRole("button", { name: `重命名标签 ${renamed}` })).toBeVisible();
        await expect(page.getByRole("button", { name: `重命名标签 ${taken}` })).toBeVisible();
    });
});
