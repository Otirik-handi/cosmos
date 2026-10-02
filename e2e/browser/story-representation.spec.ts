import { expect, test } from "@playwright/test";

import {
    expandEditSurface,
    ingestFeed,
    openStory,
    waitForStoryId,
} from "../support/story-flow";

/**
 * Story 表示的可写面验收（ADR-0021 决定 2/3/5、ADR-0028）。
 *
 * 切片 3 之前这条用例驱动首页 + Story 抽屉；ADR-0029 决策 7 把 Story 改成独立阅读页后，
 * 读在 `/stories/:id` 的正文卡片上（只读区块常驻），写在同一页默认收起的「编辑与关联」里。
 * 这里只换导航与选择器，领域断言逐条保留：时间范围、关键事实的顺序与出处、人工保护提示、
 * 全量提交的 no-op 语义。
 */
test("represents a Story with an event time and ordered key facts, and re-submits as a no-op", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    const sourceName = await ingestFeed(page, "Story 表示验收来源");
    const storyId = await waitForStoryId(page, sourceName);
    await openStory(page, storyId);

    const editSection = await expandEditSurface(page);
    const representationForm = editSection.locator('form[aria-label="编辑 Story 表示"]');
    const factEditor = representationForm.locator('[data-story-key-fact-editor="true"]');
    const actionError = editSection.locator("[data-story-action-error]");

    // 时间范围：开始用准确时刻，结束留空。
    const startBound = editSection.locator('fieldset[data-story-time-bound="start"]');
    await startBound.getByRole("radio", { name: "准确时刻" }).check();
    await startBound.getByLabel("开始的准确时刻").fill("2026-09-14T09:30");

    // 关键事实：两条，先写第二条再上移，验证顺序就是展示顺序。
    // 定位用精确匹配：第 N 条的「上移/下移/删除/出处」无障碍名都包含「第 N 条事实」。
    await representationForm.getByTestId("story-key-fact-add").click();
    await representationForm.getByTestId("story-key-fact-add").click();
    await factEditor.getByRole("textbox", { name: "第 2 条事实", exact: true }).fill("第二条事实");
    await factEditor.getByRole("textbox", { name: "第 1 条事实", exact: true }).fill("第一条事实");
    // 每次打字都会让事实行重渲染，所以先取候选值、再重新定位下拉，避免用到过期句柄。
    const sourceEntryId = await factEditor
        .getByLabel("第 1 条事实的出处", { exact: true })
        .locator("option")
        .nth(1)
        .getAttribute("value");
    expect(sourceEntryId).toBeTruthy();
    // 先把第 2 条上移，再给最终排在第一位的它选出处：顺序就是展示顺序。
    await factEditor.getByLabel("上移第 2 条事实", { exact: true }).click();
    await expect(factEditor.getByRole("textbox", { name: "第 1 条事实", exact: true }))
        .toHaveValue("第二条事实");
    const sourceSelect = factEditor.getByLabel("第 1 条事实的出处", { exact: true });
    await sourceSelect.selectOption(sourceEntryId!);
    await expect(sourceSelect).toHaveValue(sourceEntryId!);

    const submit = async (): Promise<void> => {
        await representationForm.getByRole("button", { name: "保存修改", exact: true }).click();
        await expect(actionError).toHaveCount(0);
    };
    const readRepresentation = async (id: string) => page.evaluate(async (currentStoryId) => {
        const response = await fetch(`/api/v1/stories/${encodeURIComponent(currentStoryId)}`);
        const body = await response.json() as {
            story: {
                revisionId: string;
                timeRange: {
                    start: { exact: string | null; fallback: { raw: string; precision: string } | null };
                } | null;
                keyFacts: Array<{ text: string; entryId: string | null }>;
            };
        };
        return body.story;
    }, id);
    // 未人工编辑过的 Story 由 ingest 投影写出，所以还没有保护标记（ADR-0028）。
    await expect(page.locator('[data-story-human-protected="true"]')).toHaveCount(0);
    await submit();

    // 详情：标题下的事件时间按本地分钟显示，关键事实按保存顺序列出并带出处。
    const eventTime = page.locator('[data-story-event-time="true"]');
    await expect(eventTime).toBeVisible();
    await expect(eventTime).toContainText("2026-09-14 09:30");
    const factsBlock = page.locator('[data-story-key-facts="true"]');
    await expect(factsBlock.locator("li")).toHaveCount(2);
    await expect(factsBlock.locator("li").nth(0)).toContainText("第二条事实");
    await expect(factsBlock.locator("li").nth(0)).toContainText("出处：");
    await expect(factsBlock.locator("li").nth(1)).toContainText("第一条事实");
    await expect(factsBlock.locator("li").nth(1)).not.toContainText("出处：");
    // 保存后当前 Revision 归人工，正文卡片说明自动更新已暂停（ADR-0028）。
    const protectedNotice = page.locator('[data-story-human-protected="true"]');
    await expect(protectedNotice).toBeVisible();
    await expect(protectedNotice).toContainText("自动更新已暂停");

    const saved = await readRepresentation(storyId);
    expect(saved.timeRange?.start.exact).not.toBeNull();
    expect(saved.keyFacts.map((fact) => fact.text)).toEqual(["第二条事实", "第一条事实"]);

    // 刷新后仍是同一份表示；编辑面默认收起，写入前要重新展开。
    await page.reload();
    await expect(page.locator("[data-story-id]")).toBeVisible();
    await expect(page.locator('[data-story-event-time="true"]')).toContainText("2026-09-14 09:30");
    await expect(
        page.locator('[data-story-key-facts="true"] li').nth(0),
    ).toContainText("第二条事实");
    const reloadedSection = await expandEditSurface(page);
    const reloadedError = reloadedSection.locator("[data-story-action-error]");

    // 全量提交语义下重复保存相同内容必须是 no-op：版本指针不动（ADR-0021 决定 4/5）。
    await reloadedSection.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(reloadedError).toHaveCount(0);
    const resubmitted = await readRepresentation(storyId);
    expect(resubmitted.revisionId).toBe(saved.revisionId);
    expect(resubmitted.keyFacts).toEqual(saved.keyFacts);

    // 「只有原文」模式：换成原文 + 精度后按原文显示并标注不精确；重复提交仍是 no-op。
    const reloadedStart = reloadedSection.locator('fieldset[data-story-time-bound="start"]');
    await reloadedStart.getByRole("radio", { name: "只有原文（不精确）" }).check();
    // 无障碍名互相包含（「开始的原文」与「开始的原文精度」），用 exact 区分。
    await reloadedStart.getByRole("textbox", { name: "开始的原文", exact: true }).fill("昨天下午");
    await reloadedStart.getByLabel("开始的原文精度", { exact: true }).selectOption("day");
    await reloadedSection.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(reloadedError).toHaveCount(0);
    const rawEventTime = page.locator('[data-story-event-time="true"]');
    await expect(rawEventTime).toContainText("昨天下午");
    await expect(rawEventTime).toContainText("不精确");
    const rawSaved = await readRepresentation(storyId);
    expect(rawSaved.revisionId).not.toBe(saved.revisionId);
    expect(rawSaved.timeRange?.start.exact).toBeNull();
    expect(rawSaved.timeRange?.start.fallback).toMatchObject({ raw: "昨天下午", precision: "day" });

    await reloadedSection.getByRole("button", { name: "保存修改", exact: true }).click();
    await expect(reloadedError).toHaveCount(0);
    expect((await readRepresentation(storyId)).revisionId).toBe(rawSaved.revisionId);

    expect(consoleErrors).toEqual([]);
});
