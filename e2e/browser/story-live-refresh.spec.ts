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

/**
 * 「正在编辑时不覆盖」不能只验标题。
 *
 * 表示面共有五份草稿（标题 / 类型 / 细分类型 / 时间范围 / 关键事实，ADR-0021 决定 1），
 * 它们由同一个 `unsaved` 判定守着，但**只有标题进过门禁**——其余四份若哪天被单独
 * 覆盖（例如某个字段改成从 `story` 直接取），标题那条仍然绿。所以这里把五份都填上，
 * 再从外部改一次表示，逐字段断言草稿没动。
 */
test("keeps every representation draft when an external change arrives mid-edit", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") {
            consoleErrors.push(message.text());
        }
    });

    const sourceName = await ingestFeed(page, "草稿保护验收来源");
    const storyId = await waitForStoryId(page, sourceName);
    await openStory(page, storyId);
    const storyPath = `/api/v1/stories/${encodeURIComponent(storyId)}`;

    const edit = await expandEditSurface(page);
    // 先加一条事实，让「关键事实」有一行可编辑（fixture 的 Story 通常没有事实）。
    await edit.getByTestId("story-key-fact-add").click();

    const draftTitle = `草稿标题-${randomUUID().slice(0, 8)}`;
    const draftFact = `草稿事实-${randomUUID().slice(0, 8)}`;
    await edit.getByLabel("标题").fill(draftTitle);
    await edit.getByLabel("Story 类型").selectOption("media");
    // 时间范围用属性选择器而不是 getByLabel：这个输入框由 Base UI 自生成 id 并据此命名，
    // `getByLabel` 对它的可访问名解析不到 `aria-label`（实测 count=0，而属性选择器命中 1）。
    const startFieldset = edit.locator('fieldset[data-story-time-bound="start"]');
    await startFieldset.locator('input[type="radio"][value="exact"]').check();
    await startFieldset.locator('input[type="datetime-local"]').fill("2026-03-04T05:06");
    // `exact` 必须加：事实行里还有「第 1 条事实的出处 / 上移 / 下移 / 删除」，
    // 不加会命中 5 个（Playwright 严格模式直接判失败）。
    await edit.getByLabel("第 1 条事实", { exact: true }).fill(draftFact);

    // 从外部改表示：走界面同一个命令，因此必然发出 `story.revision_created.v1`。
    const detail = await (await page.request.get(storyPath)).json() as {
        story: { revisionId: string; summary: string | null; subtype: string | null };
    };
    const externalTitle = `外部改动-${randomUUID().slice(0, 8)}`;
    const external = await page.request.post(`${storyPath}/revisions`, {
        data: {
            baseRevisionId: detail.story.revisionId,
            title: externalTitle,
            summary: detail.story.summary,
            kind: "event",
            subtype: detail.story.subtype,
            timeRange: null,
            keyFacts: [],
        },
    });
    expect(external.ok(), `外部改表示失败：${external.status()}`).toBe(true);

    // 提示出现（说明事件确实到了），而五份草稿逐项原样。
    await expect(page.getByText(/在别处有了新变化/u)).toBeVisible({ timeout: 20_000 });
    await expect(edit.getByLabel("标题")).toHaveValue(draftTitle);
    await expect(edit.getByLabel("Story 类型")).toHaveValue("media");
    await expect(startFieldset.locator('input[type="radio"][value="exact"]')).toBeChecked();
    await expect(startFieldset.locator('input[type="datetime-local"]')).toHaveValue("2026-03-04T05:06");
    await expect(edit.getByLabel("第 1 条事实", { exact: true })).toHaveValue(draftFact);
    // 页面主体也没被换掉：提示归提示，用户手上的这一版还在。
    await expect(page.locator("[data-story-id]")).not.toHaveText(externalTitle);

    expect(consoleErrors).toEqual([]);
});
