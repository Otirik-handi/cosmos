import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
    expandEditSurface,
    ingestFeed,
    openStory,
    waitForStoryId,
} from "../support/story-flow";

/**
 * 切片 4 的行为门禁（ADR-0029 决策 7 的刷新边界）。
 *
 * 「列表页与未在编辑的详情页静默后台重读；详情页正在编辑时不覆盖，显示
 * 『有新变化，重新读取？』由用户决定」。两条分支都要有证据，所以这条用例先验证静默重读，
 * 再制造一份未保存的编辑、验证它没有被覆盖，最后验证用户确认后能读到新内容。
 */
test("silently refreshes an idle Story but never overwrites an edit in progress", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") {
            consoleErrors.push(message.text());
        }
    });

    const sourceName = await ingestFeed(page, "实时刷新验收来源");
    const storyId = await waitForStoryId(page, sourceName);
    await openStory(page, storyId);

    const storyPath = `/api/v1/stories/${encodeURIComponent(storyId)}`;
    const readRevisionId = async (): Promise<string> => {
        const detail = await (await page.request.get(storyPath)).json() as {
            story: { revisionId: string; summary: string; kind: string; subtype: string | null };
        };
        return detail.story.revisionId;
    };
    /** 从外部改标题：走的就是界面同一个命令，因此必然发出 `story.revision_created.v1`。 */
    const retitleExternally = async (title: string): Promise<void> => {
        const detail = await (await page.request.get(storyPath)).json() as {
            story: {
                revisionId: string;
                summary: string;
                kind: string;
                subtype: string | null;
                timeRange: unknown;
                keyFacts: unknown;
            };
        };
        const response = await page.request.post(`${storyPath}/revisions`, {
            data: {
                baseRevisionId: detail.story.revisionId,
                title,
                summary: detail.story.summary,
                kind: detail.story.kind,
                subtype: detail.story.subtype,
                timeRange: detail.story.timeRange,
                keyFacts: detail.story.keyFacts,
            },
        });
        expect(response.ok(), `外部改标题失败：${response.status()}`).toBe(true);
    };

    // ① 没有未保存的编辑：外部改动静默进来，页面跟着变，且不打扰用户。
    const idleTitle = `外部改动-${randomUUID().slice(0, 8)}`;
    await retitleExternally(idleTitle);
    await expect(page.locator("[data-story-id]")).toHaveText(idleTitle, { timeout: 20_000 });
    await expect(page.getByText(/在别处有了新变化/u)).toHaveCount(0);

    // ② 正在编辑：外部改动**不得**覆盖草稿，只提示有新变化。
    const edit = await expandEditSurface(page);
    const draftTitle = `我正在编辑-${randomUUID().slice(0, 8)}`;
    await edit.getByLabel("标题").fill(draftTitle);
    await expect(edit.getByLabel("标题")).toHaveValue(draftTitle);

    const freshTitle = `外部改动-${randomUUID().slice(0, 8)}`;
    await retitleExternally(freshTitle);
    await expect(page.getByText(/在别处有了新变化/u)).toBeVisible({ timeout: 20_000 });
    await expect(edit.getByLabel("标题")).toHaveValue(draftTitle);
    // 页面主体也没被换掉：提示归提示，用户手上的这一版还在。
    await expect(page.locator("[data-story-id]")).toHaveText(idleTitle);
    expect(await readRevisionId()).not.toBe("");

    // ③ 用户确认后读到新内容，提示消失。
    // 顺序有意如此：先等重读落地（标题主体换掉），再重新展开编辑面——编辑面靠换 key 重挂载，
    // 先展开会拿到重挂载前那个还带着草稿的输入框。
    await page.getByRole("button", { name: "重新读取", exact: true }).click();
    await expect(page.locator("[data-story-id]")).toHaveText(freshTitle, { timeout: 20_000 });
    await expect(page.getByText(/在别处有了新变化/u)).toHaveCount(0);
    const reloaded = await expandEditSurface(page);
    await expect(reloaded.getByLabel("标题")).toHaveValue(freshTitle, { timeout: 20_000 });

    expect(consoleErrors).toEqual([]);
});
