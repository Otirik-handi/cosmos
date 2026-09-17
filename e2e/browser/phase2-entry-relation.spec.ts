import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const FEED_URL = "http://127.0.0.1:4380/feed.xml";

/** 每个场景自建来源并触发录入，不依赖其它 spec 留下的数据。 */
async function ingestFeed(page: import("@playwright/test").Page, prefix: string): Promise<string> {
    const sourceName = `${prefix}-${randomUUID().slice(0, 8)}`;
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建来源" }).click();
    await page.getByLabel("名称", { exact: true }).fill(sourceName);
    await page.getByLabel("Feed URL").fill(FEED_URL);
    await page.getByRole("button", { name: "保存来源" }).click();
    await expect(page.getByText("来源已保存，当前为停用状态")).toBeVisible();

    const healthSection = page.getByRole("heading", { name: "来源健康" }).locator("..").locator("..");
    await healthSection.getByRole("button", { name: `启用 ${sourceName}`, exact: true }).click();
    await expect(page.getByText("已启用；可执行手动录入")).toBeVisible();
    await healthSection.getByRole("button", { name: sourceName, exact: true }).click();
    await expect(page.getByText("录入任务已排队", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    await expect(
        page.locator("article").filter({ hasText: sourceName }).first(),
    ).toBeVisible({ timeout: 180_000 });
    return sourceName;
}

test("marks a syndication between two Story members and shows both directions", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    const sourceName = await ingestFeed(page, "重复关系验收来源");

    // 归并两条单成员 Story，得到一条双成员 Story：同一 Story 内的两条重复条目
    // 是合法且常见的场景（ADR-0022 决定 4），两个方向也就能在同一屏里看到。
    const readPair = async (name: string) => page.evaluate(async (sourceName) => {
        const sourceResponse = await fetch("/api/v1/sources");
        const sources = await sourceResponse.json() as Array<{ id: string; name: string }>;
        const sourceId = sources.find((source) => source.name === sourceName)?.id;
        if (!sourceId) {
            return null;
        }
        const entriesResponse = await fetch(`/api/v1/entries?sourceId=${encodeURIComponent(sourceId)}&limit=20`);
        const entries = await entriesResponse.json() as { items: Array<{ storyId: string | null }> };
        const storyIds = [...new Set(entries.items.map((item) => item.storyId).filter((id): id is string => id !== null))];
        if (storyIds.length < 2) {
            return null;
        }
        return Promise.all(storyIds.slice(0, 2).map(async (storyId) => {
            const response = await fetch(`/api/v1/stories/${encodeURIComponent(storyId)}`);
            const body = await response.json() as { story: { id: string; title: string } };
            return body.story;
        }));
    }, name);
    let pair: Array<{ id: string; title: string }> | null = null;
    await expect.poll(async () => {
        pair = await readPair(sourceName);
        return pair?.length ?? 0;
    }, { timeout: 120_000 }).toBeGreaterThanOrEqual(2);
    const [canonical, obsolete] = pair!;

    await page
        .locator("article")
        .filter({ hasText: sourceName })
        .filter({ hasText: canonical.title })
        .getByRole("button", { name: "打开 Story" })
        .first()
        .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("并入本 Story 的 Story ID").fill(obsolete.id);
    await dialog.getByRole("button", { name: "归并" }).click();
    await expect(dialog.getByText("来源成员（2）")).toBeVisible();

    const memberIds = await dialog.locator("[data-story-member-id]").evaluateAll(
        (nodes) => nodes.map((node) => node.getAttribute("data-story-member-id")!),
    );
    expect(memberIds).toHaveLength(2);
    const [reprintId, originalId] = memberIds;
    const memberTitle = async (entryId: string): Promise<string> => (await dialog
        .locator(`[data-story-member-id="${entryId}"] span`)
        .first()
        .innerText()).split(" · ")[1]!.trim();

    // 标记前后 Feed 顺序与搜索结果必须逐字节不变（ADR-0022 决定 6）。
    const readFeedOrder = async (): Promise<string[]> => page.evaluate(async () => {
        const response = await fetch("/api/v1/feed?limit=20");
        const body = await response.json() as { items: Array<{ entryId: string }> };
        return body.items.map((item) => item.entryId);
    });
    const readSearchOrder = async (term: string): Promise<string[]> => page.evaluate(async (text) => {
        const response = await fetch(`/api/v1/search?text=${encodeURIComponent(text)}&limit=20`);
        const body = await response.json() as { items: Array<{ entryId: string }> };
        return body.items.map((item) => item.entryId);
    }, term);
    const feedBefore = await readFeedOrder();
    expect(feedBefore.length).toBeGreaterThan(0);
    const searchBefore = await readSearchOrder("fixture");
    expect(searchBefore.length).toBeGreaterThan(0);

    // 在转载方那一行标记「转载自」原发方。
    await dialog.locator(`[data-entry-relation-open="${reprintId}"]`).click();
    const form = dialog.locator(`[data-entry-relation-form="${reprintId}"]`);
    await form.getByLabel("选择对端条目").selectOption(originalId);
    await form.getByLabel("重复关系类型").selectOption("syndicated_from");
    await form.locator(`[data-entry-relation-submit="${reprintId}"]`).click();

    // 两侧都看得到，方向相反（ADR-0022 决定 3/7）。
    const originalTitle = await memberTitle(originalId);
    const reprintTitle = await memberTitle(reprintId);
    await expect(dialog.locator(`[data-entry-relation-badge="${reprintId}:${originalId}"]`))
        .toHaveText(`转载自 ${originalTitle}`);
    await expect(dialog.locator(`[data-entry-relation-badge="${originalId}:${reprintId}"]`))
        .toHaveText(`被 ${reprintTitle} 转载`);

    // 刷新后关系仍在：它挂在条目内容身份上，不随面板关闭而消失。
    await page.reload();
    await page
        .locator("article")
        .filter({ hasText: sourceName })
        .filter({ hasText: canonical.title })
        .getByRole("button", { name: "打开 Story" })
        // 归并后同一 Story 在 Feed 里有两个成员卡片，任一张都打开同一条 Story。
        .first()
        .click();
    const reopened = page.getByRole("dialog");
    await expect(reopened).toBeVisible();
    await expect(reopened.locator(`[data-entry-relation-badge="${reprintId}:${originalId}"]`))
        .toHaveText(`转载自 ${originalTitle}`);

    // 只标记与展示：Feed 顺序与搜索结果不变（ADR-0022 决定 6）。
    expect(await readFeedOrder()).toEqual(feedBefore);
    expect(await readSearchOrder("fixture")).toEqual(searchBefore);
    expect(consoleErrors).toEqual([]);

    // 同一对条目只留一个当前语义：重复提交幂等，反向提交与自关联都是 409。
    // 下面刻意打出的 409/400 会被浏览器记成资源错误，所以上面的控制台断言到此为止。
    const post = async (body: unknown): Promise<number> => page.evaluate(async (payload) => {
        const response = await fetch("/api/v1/entry-relations", {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
        });
        return response.status;
    }, body);
    expect(await post({ fromEntryId: reprintId, toEntryId: originalId, relationType: "syndicated_from" })).toBe(201);
    expect(await post({ fromEntryId: originalId, toEntryId: reprintId, relationType: "syndicated_from" })).toBe(409);
    expect(await post({ fromEntryId: originalId, toEntryId: originalId, relationType: "duplicate_of" })).toBe(409);
    expect(await post({ fromEntryId: originalId, toEntryId: reprintId, relationType: "same_event" })).toBe(400);
    const relations = await page.evaluate(async (entryId) => {
        const response = await fetch(`/api/v1/entries/${encodeURIComponent(entryId)}`);
        const body = await response.json() as {
            relations: Array<{ entryId: string; relationType: string; direction: string }>;
        };
        return body.relations;
    }, originalId);
    expect(relations).toHaveLength(1);
    expect(relations[0]).toMatchObject({
        entryId: reprintId,
        relationType: "syndicated_from",
        direction: "incoming",
    });

    // 解除后两侧都消失。
    await reopened.locator(`[data-entry-relation-remove="${reprintId}:${originalId}"]`).click();
    await expect(reopened.locator(`[data-entry-relation-badge="${reprintId}:${originalId}"]`)).toHaveCount(0);
    await expect(reopened.locator(`[data-entry-relation-badge="${originalId}:${reprintId}"]`)).toHaveCount(0);
});
