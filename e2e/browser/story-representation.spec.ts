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
    // 同一栈内其它 spec 也用同一份 fixture，未限定来源的标题断言可能在其它来源
    // 录入完成时就通过；这里再等本来源自己的卡片出现。
    await expect(
        page.locator("article").filter({ hasText: sourceName }).first(),
    ).toBeVisible({ timeout: 180_000 });
    return sourceName;
}

test("represents a Story with an event time and ordered key facts, and re-submits as a no-op", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    // 组件实验室的渲染验收在 e2e/component-lab 里：该路由只在开发服务器上存在。
    const sourceName = await ingestFeed(page, "Story 表示验收来源");

    await page
        .locator("article")
        .filter({ hasText: sourceName })
        .first()
        .getByRole("button", { name: "打开 Story" })
        .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const storyId = await dialog.getAttribute("data-story-id");
    expect(storyId).toBeTruthy();
    const storyTitle = await dialog.getByRole("heading", { level: 2 }).innerText();

    // 时间范围：开始用准确时刻，结束留空。
    const startBound = dialog.locator('fieldset[data-story-time-bound="start"]');
    await startBound.getByRole("radio", { name: "准确时刻" }).check();
    const exactInput = startBound.getByLabel("开始的准确时刻");
    await exactInput.fill("2026-09-14T09:30");

    // 关键事实：两条，先写第二条再上移，验证顺序就是展示顺序。
    // 定位用精确匹配：第 N 条的「上移/下移/删除/出处」无障碍名都包含「第 N 条事实」。
    const factEditor = dialog.locator('form[aria-label="编辑 Story 表示"] section[aria-label="关键事实"]');
    await dialog.getByTestId("story-key-fact-add").click();
    await dialog.getByTestId("story-key-fact-add").click();
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
        await dialog.getByRole("button", { name: "保存修改" }).click();
        await expect(dialog.locator("[data-story-action-error]")).toHaveCount(0);
    };
    const readRepresentation = async (id: string) => page.evaluate(async (storyId) => {
        const response = await fetch(`/api/v1/stories/${encodeURIComponent(storyId)}`);
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
    await submit();

    // 详情：标题下的事件时间按本地分钟显示，关键事实按保存顺序列出并带出处。
    const eventTime = dialog.locator('[data-story-event-time="true"]');
    await expect(eventTime).toBeVisible();
    await expect(eventTime).toContainText("2026-09-14 09:30");
    const factsBlock = dialog.locator('[data-story-key-facts="true"]');
    await expect(factsBlock.locator("li")).toHaveCount(2);
    await expect(factsBlock.locator("li").nth(0)).toContainText("第二条事实");
    await expect(factsBlock.locator("li").nth(0)).toContainText("出处：");
    await expect(factsBlock.locator("li").nth(1)).toContainText("第一条事实");
    await expect(factsBlock.locator("li").nth(1)).not.toContainText("出处：");

    const saved = await readRepresentation(storyId!);
    expect(saved.timeRange?.start.exact).not.toBeNull();
    expect(saved.keyFacts.map((fact) => fact.text)).toEqual(["第二条事实", "第一条事实"]);

    // 刷新后仍是同一份表示。
    await page.reload();
    await page
        .locator("article")
        .filter({ hasText: sourceName })
        .filter({ hasText: storyTitle })
        .getByRole("button", { name: "打开 Story" })
        .click();
    const reopened = page.getByRole("dialog");
    await expect(reopened).toBeVisible();
    await expect(reopened.locator('[data-story-event-time="true"]')).toContainText("2026-09-14 09:30");
    await expect(
        reopened.locator('[data-story-key-facts="true"] li').nth(0),
    ).toContainText("第二条事实");

    // 全量提交语义下重复保存相同内容必须是 no-op：版本指针不动（ADR-0021 决定 4/5）。
    await reopened.getByRole("button", { name: "保存修改" }).click();
    await expect(reopened.locator("[data-story-action-error]")).toHaveCount(0);
    const resubmitted = await readRepresentation(storyId!);
    expect(resubmitted.revisionId).toBe(saved.revisionId);
    expect(resubmitted.keyFacts).toEqual(saved.keyFacts);

    // 「只有原文」模式：换成原文 + 精度后按原文显示并标注不精确；重复提交仍是 no-op。
    const reopenedStart = reopened.locator('fieldset[data-story-time-bound="start"]');
    await reopenedStart.getByRole("radio", { name: "只有原文（不精确）" }).check();
    // 无障碍名互相包含（「开始的原文」与「开始的原文精度」），用 exact 区分。
    await reopenedStart.getByRole("textbox", { name: "开始的原文", exact: true }).fill("昨天下午");
    await reopenedStart.getByLabel("开始的原文精度", { exact: true }).selectOption("day");
    await reopened.getByRole("button", { name: "保存修改" }).click();
    await expect(reopened.locator("[data-story-action-error]")).toHaveCount(0);
    const rawEventTime = reopened.locator('[data-story-event-time="true"]');
    await expect(rawEventTime).toContainText("昨天下午");
    await expect(rawEventTime).toContainText("不精确");
    const rawSaved = await readRepresentation(storyId!);
    expect(rawSaved.revisionId).not.toBe(saved.revisionId);
    expect(rawSaved.timeRange?.start.exact).toBeNull();
    expect(rawSaved.timeRange?.start.fallback).toMatchObject({ raw: "昨天下午", precision: "day" });

    await reopened.getByRole("button", { name: "保存修改" }).click();
    await expect(reopened.locator("[data-story-action-error]")).toHaveCount(0);
    expect((await readRepresentation(storyId!)).revisionId).toBe(rawSaved.revisionId);

    expect(consoleErrors).toEqual([]);
});