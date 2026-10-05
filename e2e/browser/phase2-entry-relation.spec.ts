import { expect, test, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import { latestToast } from "../support/lab";
import {
    expandEditSurface,
    ingestFeed,
    openStory,
    pickMergeTarget,
    waitForStoryIds,
} from "../support/story-flow";

/**
 * 条目↔条目重复/转载关系的浏览器验收（ADR-0022 决定 3/4/6/7）。
 *
 * 切片 3 之前这条用例在首页 Feed + Story 抽屉上跑；ADR-0029 之后：
 * - 双成员 Story 仍然只能由「归并」造出来（录入按 entry 投影 Story，不跨来源归并），
 *   归并入口搬到了 `/stories/:id` 的「编辑与关联」里（默认收起，先点「展开」）；
 * - 成员行与两个方向的措辞在阅读页的只读区，不用展开就在页面上；
 * - Feed 卡片与搜索在 `/library`。
 * 领域断言逐条保留：两侧措辞相反、刷新后仍在、只标记不折叠、解除后两侧都消失、
 * 4xx 写入拒绝。
 */

/** 读一条 Story 的标题与成员条目：归并与成员行断言都用它。 */
async function readStory(page: Page, storyId: string): Promise<{
    id: string;
    title: string;
    memberIds: string[];
}> {
    const response = await page.request.get(`/api/v1/stories/${encodeURIComponent(storyId)}`);
    expect(response.ok(), `读取 Story 失败：${storyId}`).toBe(true);
    const body = await response.json() as {
        story: { id: string; title: string };
        entries: Array<{ id: string }>;
    };
    return {
        id: body.story.id,
        title: body.story.title,
        memberIds: body.entries.map((entry) => entry.id),
    };
}

test("marks a syndication between two Story members and shows both directions", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    const sourceName = await ingestFeed(page, "重复关系验收来源");
    // fixture 有三条内容，本来源至少落两条 Story；取前两条做归并素材。
    const [canonicalId, obsoleteId] = await waitForStoryIds(page, sourceName, 2);
    const canonical = await readStory(page, canonicalId);
    const obsolete = await readStory(page, obsoleteId);
    expect(canonical.title.length).toBeGreaterThan(0);

    // 归并两条单成员 Story，得到一条双成员 Story：同一 Story 内的两条重复条目
    // 是合法且常见的场景（ADR-0022 决定 4），两个方向也就能在同一屏里看到。
    await openStory(page, canonicalId);
    const editSection = await expandEditSurface(page);
    // 归并目标按标题在选择器里选（Task 36 切片 B：粘贴内部 Story ID 的入口已删除）。
    await pickMergeTarget(page, editSection, obsolete.title);
    await editSection.getByRole("button", { name: "归并", exact: true }).click();
    await expect(page.getByText("来源成员（2）")).toBeVisible();

    const memberIds = await page.locator("[data-story-member-id]").evaluateAll(
        (nodes) => nodes.map((node) => node.getAttribute("data-story-member-id")!),
    );
    expect(memberIds).toHaveLength(2);
    const [reprintId, originalId] = memberIds;
    const memberTitle = async (entryId: string): Promise<string> => (await page
        .locator(`[data-story-member-id="${entryId}"] span`)
        .first()
        .locator("span")
        .first()
        .innerText()).trim();

    // 标记前后 Feed 顺序与搜索结果必须逐字节不变（ADR-0022 决定 6）。按本用例自己的
    // 来源名限定：同一栈会话内数据库跨 spec 持久化，其它来源的新条目会让全量顺序变化。
    const readFeedOrder = async (): Promise<string[]> => page.evaluate(async (name) => {
        const response = await fetch("/api/v1/feed?limit=100");
        const body = await response.json() as {
            items: Array<{ entryId: string; sourceName: string }>;
        };
        return body.items.filter((item) => item.sourceName === name).map((item) => item.entryId);
    }, sourceName);
    const readSearchOrder = async (term: string): Promise<string[]> => page.evaluate(
        async (input: { text: string; name: string }) => {
            const response = await fetch(`/api/v1/search?text=${encodeURIComponent(input.text)}&limit=100`);
            const body = await response.json() as {
                items: Array<{ entryId: string; sourceName: string }>;
            };
            return body.items
                .filter((item) => item.sourceName === input.name)
                .map((item) => item.entryId);
        },
        { text: term, name: sourceName },
    );
    const feedBefore = await readFeedOrder();
    expect(feedBefore.length).toBeGreaterThan(0);
    const searchBefore = await readSearchOrder("fixture");
    expect(searchBefore.length).toBeGreaterThan(0);

    // 在转载方那一行标记「转载自」原发方。
    await page.locator(`[data-entry-relation-open="${reprintId}"]`).click();
    const relationForm = page.locator(`[data-entry-relation-form="${reprintId}"]`);
    await relationForm.getByLabel("选择对端条目").selectOption(originalId);
    await relationForm.getByLabel("重复关系类型").selectOption("syndicated_from");
    await relationForm.locator(`[data-entry-relation-submit="${reprintId}"]`).click();

    // 两侧都看得到，方向相反（ADR-0022 决定 3/7）。
    const originalTitle = await memberTitle(originalId);
    const reprintTitle = await memberTitle(reprintId);
    await expect(page.locator(`[data-entry-relation-badge="${reprintId}:${originalId}"]`))
        .toHaveText(`转载自 ${originalTitle}`);
    await expect(page.locator(`[data-entry-relation-badge="${originalId}:${reprintId}"]`))
        .toHaveText(`被 ${reprintTitle} 转载`);

    // 刷新后关系仍在：它挂在条目内容身份上，不随页面重开而消失。
    await page.reload();
    await expect(page.locator("[data-story-id]")).toBeVisible();
    await expect(page.locator(`[data-entry-relation-badge="${reprintId}:${originalId}"]`))
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
    await page.locator(`[data-entry-relation-remove="${reprintId}:${originalId}"]`).click();
    await expect(page.locator(`[data-entry-relation-badge="${reprintId}:${originalId}"]`)).toHaveCount(0);
    await expect(page.locator(`[data-entry-relation-badge="${originalId}:${reprintId}"]`)).toHaveCount(0);

    // 归并后的 Story 在信息库里有两张成员卡片：同一个 storyId、两个不同 entryId。
    // 列表 key 用 storyId 会重复，React 只认其中一张，另一张的 DOM 节点不再受它管理，
    // 列表被整体替换（例如搜索无结果）后仍旧残留，看起来就是「提示语说 0 条、还留着一张卡」。
    await page.goto("/library");
    const searchRegion = page.locator('section[aria-label="阅读流"]');
    await expect(searchRegion).toBeVisible();
    await expect(
        page.locator("article").filter({ hasText: sourceName }).first(),
    ).toBeVisible();
    const memberCards = await page.locator("article").filter({ hasText: sourceName }).count();
    expect(memberCards, "归并后同一 Story 在 Feed 里至少有两张成员卡片").toBeGreaterThanOrEqual(2);
    await searchRegion.getByLabel("搜索已保存内容").fill(`绝不匹配-${randomUUID().slice(0, 8)}`);
    await searchRegion.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(await latestToast(page)).toHaveText("搜索到 0 条结果。");
    await expect(page.locator("article")).toHaveCount(0);
});
