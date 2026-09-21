import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const FEED_URL = "http://127.0.0.1:4380/feed.xml";

/** 每个场景自建来源并触发录入，不依赖其它 spec 留下的数据。 */
async function ingestFeed(page: import("@playwright/test").Page, prefix: string): Promise<string> {
    const sourceName = `${prefix}-${randomUUID().slice(0, 8)}`;
    await page.goto("/");
    await expect(page.getByRole("heading", { name: "Cosmos", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建计划" }).click();
    await page.getByLabel("名称", { exact: true }).fill(sourceName);
    await page.getByLabel("Feed URL").fill(FEED_URL);
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("采集计划已保存，当前为停用状态")).toBeVisible();

    const healthSection = page.getByRole("heading", { name: "采集计划" }).locator("..").locator("..");
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

test("browses by label, saves the condition as a view, and shows the Story timeline and related content", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    const sourceName = await ingestFeed(page, "分类验收来源");

    // 时间线：多来源 Story 的详情展示按时间排列的来源修订与抓取事件。
    // 按来源 + 标题定位卡片：同一栈内其它 spec 也有同名 fixture 标题，且 Feed 排序不稳定。
    await page
        .locator("article")
        .filter({ hasText: sourceName })
        .filter({ hasText: "Fixture media metadata" })
        .getByRole("button", { name: "打开 Story" })
        .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("heading", { name: "Fixture media metadata" })).toBeVisible();
    const timeline = dialog.locator('[data-story-timeline="true"]');
    await expect(timeline).toBeVisible();
    await expect(timeline.locator("li").first()).toBeVisible();

    // 分类（Label）：在第一条 Story 上创建标签。
    const labelName = `阶段2验收-${randomUUID().slice(0, 6)}`;
    await dialog.getByPlaceholder("新标签名称").fill(labelName);
    await dialog.getByRole("button", { name: "创建并添加" }).click();
    await expect(dialog.getByText(labelName, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // 给第二条 Story 打同一个标签，制造“相关但不同事件”。
    await page
        .locator("article")
        .filter({ hasText: sourceName })
        .filter({ hasText: "Cosmos scaffold is ready" })
        .getByRole("button", { name: "打开 Story" })
        .click();
    const secondDialog = page.getByRole("dialog");
    await expect(secondDialog).toBeVisible();
    await expect(secondDialog.getByRole("heading", { name: "Cosmos scaffold is ready" })).toBeVisible();
    await secondDialog.getByLabel("选择要添加的标签").selectOption({ label: labelName });
    await secondDialog
        .locator('section[aria-label="用户组织"]')
        .getByRole("button", { name: "添加", exact: true })
        .click();
    await expect(secondDialog.getByText(labelName, { exact: true })).toBeVisible();

    // 相关内容：共享分类的其它 Story 出现，并说明相关原因。
    const related = secondDialog.locator('[data-story-related="true"]');
    await expect(related).toBeVisible({ timeout: 15_000 });
    await expect(related.getByText(`共享分类：${labelName}`)).toBeVisible();
    await page.keyboard.press("Escape");

    // 按分类浏览：搜索表单的分类入口点选后，筛选 chip 回显分类名。
    await page.getByRole("button", { name: `按分类筛选 ${labelName}` }).click();
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByText(`分类：${labelName}`)).toBeVisible();

    // 保存为视图（带分类条件），清除筛选后套用视图可恢复同一条件。
    const viewName = `分类视图-${randomUUID().slice(0, 6)}`;
    await page.getByLabel("视图名称").fill(viewName);
    await page.getByRole("button", { name: "保存当前条件" }).click();
    await expect(page.getByText(`已保存视图「${viewName}」`)).toBeVisible();
    await page.getByRole("button", { name: "清除筛选" }).click();
    await expect(page.getByText(`分类：${labelName}`)).toHaveCount(0);
    await page.getByRole("button", { name: viewName, exact: true }).click();
    await expect(page.getByText(`分类：${labelName}`)).toBeVisible();

    expect(consoleErrors).toEqual([]);
});

test("links an entry from another Story as evidence and shows the reverse view", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    const sourceName = await ingestFeed(page, "证据关系验收来源");

    // 打开一条 Story 作为证据目标。
    await page
        .locator("article")
        .filter({ hasText: sourceName })
        .first()
        .getByRole("button", { name: "打开 Story" })
        .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    const targetTitle = await dialog.getByRole("heading", { level: 2 }).textContent();
    const evidenceSection = dialog.locator('section[aria-label="证据来源"]');
    await expect(evidenceSection.getByText(/还没有其它 Story 引用/)).toBeVisible();

    // 从另一条 Story 的条目里选一条作为证据。
    const option = evidenceSection.getByLabel("选择证据条目");
    await option.selectOption({ index: 1 });
    const entryId = await option.inputValue();
    await evidenceSection.getByLabel("证据关系类型").selectOption("evidence_for");
    await evidenceSection.getByRole("button", { name: "添加" }).click();
    const evidenceItem = evidenceSection.locator(
        `[data-story-evidence-entry-id="${entryId}"]`,
    );
    await expect(evidenceItem).toBeVisible();
    await expect(evidenceItem.getByText("证据", { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // 反向视图：该条目所属 Story 的成员列表显示它作为证据关联到目标 Story。
    const primaryStoryTitle = await page.evaluate(async (id) => {
        const listResponse = await fetch("/api/v1/entries?limit=100");
        const list = await listResponse.json() as {
            items: Array<{ id: string; storyId: string | null }>;
        };
        const storyId = list.items.find((item) => item.id === id)?.storyId;
        if (!storyId) {
            return null;
        }
        const storyResponse = await fetch(`/api/v1/stories/${encodeURIComponent(storyId)}`);
        const story = await storyResponse.json() as { story: { title: string } };
        return story.story.title;
    }, entryId);
    expect(primaryStoryTitle).not.toBeNull();
    await page
        .locator("article")
        .filter({ hasText: sourceName })
        .filter({ hasText: primaryStoryTitle! })
        .getByRole("button", { name: "打开 Story" })
        .click();
    const reverseDialog = page.getByRole("dialog");
    await expect(reverseDialog).toBeVisible();
    const member = reverseDialog.locator(`[data-story-member-id="${entryId}"]`);
    await expect(member).toBeVisible();
    await expect(member).toContainText("作为证据关联到");
    await expect(member).toContainText(targetTitle!);

    // 解除后目标 Story 的证据来源清空。
    await page.keyboard.press("Escape");
    await page
        .locator("article")
        .filter({ hasText: sourceName })
        .filter({ hasText: targetTitle! })
        .getByRole("button", { name: "打开 Story" })
        .click();
    const targetDialog = page.getByRole("dialog");
    const targetEvidence = targetDialog.locator('section[aria-label="证据来源"]');
    await targetEvidence
        .locator(`[data-story-evidence-entry-id="${entryId}"]`)
        .getByRole("button", { name: "解除" })
        .click();
    await expect(targetEvidence.getByText(/还没有其它 Story 引用/)).toBeVisible();

    expect(consoleErrors).toEqual([]);
});

test("splits a Story into successors and keeps a historical shell", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    const sourceName = await ingestFeed(page, "拆分验收来源");

    // 归并两条单成员 Story，制造一条双成员 Story 作为拆分素材。
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
        const details = await Promise.all(storyIds.slice(0, 2).map(async (storyId) => {
            const response = await fetch(`/api/v1/stories/${encodeURIComponent(storyId)}`);
            const body = await response.json() as { story: { id: string; title: string } };
            return body.story;
        }));
        return details;
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
        .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("并入本 Story 的 Story ID").fill(obsolete.id);
    await dialog.getByRole("button", { name: "归并" }).click();
    await expect(dialog.getByText("来源成员（2）")).toBeVisible();

    // 拆分前先留下用户真相：一个标签和一个收藏。拆开后它们留在历史壳上，这正是
    // 待迁移的错位；迁移与撤销在下面验证（ADR-0020）。
    await dialog.getByPlaceholder("新标签名称").fill("迁移验收标签");
    await dialog.getByRole("button", { name: "创建并添加" }).click();
    await dialog.getByRole("button", { name: "☆ 收藏" }).click();
    // 两次写入都必须是服务端已确认的，否则后面的拆分与状态断言会在竞态下
    // 读到尚未落库的中间态（2026-09-15 观察到过一次这种失败）。
    await expect.poll(async () => {
        const response = await page.evaluate(async (storyId) => {
            const detail = await fetch(`/api/v1/stories/${encodeURIComponent(storyId)}`);
            const body = await detail.json() as {
                favorited: boolean;
                labels: Array<{ name: string }>;
            };
            return { favorited: body.favorited, labels: body.labels.map((label) => label.name) };
        }, canonical.id);
        return `${response.favorited}:${response.labels.join(",")}`;
    }, { timeout: 30_000 }).toBe("true:迁移验收标签");

    // 显式把两个成员各分给一个后继；未列出的关系留在历史壳。
    const splitForm = dialog.locator('form[aria-label="拆分 Story"]');
    await expect(splitForm).toBeVisible();
    const targets = splitForm.locator('select[aria-label$="的拆分去向"]');
    await expect(targets).toHaveCount(2);
    await targets.nth(0).selectOption("0");
    await targets.nth(1).selectOption("1");
    await dialog.getByTestId("story-split-submit").click();

    // 命令返回历史壳：成员清空、后继可打开、写操作入口消失。
    const shell = dialog.locator('[data-story-shell="true"]');
    await expect(shell).toBeVisible();
    await expect(shell.locator("[data-story-successor-id]")).toHaveCount(2);
    await expect(dialog.getByText("来源成员（0）")).toBeVisible();
    await expect(dialog.locator('section[aria-label="Story 操作"]')).toHaveCount(0);
    await expect(dialog.locator("[data-story-action-error]")).toHaveCount(0);

    const shellStatus = await page.evaluate(async (storyId) => {
        const response = await fetch(`/api/v1/stories/${encodeURIComponent(storyId)}`);
        const body = await response.json() as {
            story: { status: string; replacedBy: Array<{ storyId: string }> };
            entry: unknown;
        };
        return { status: body.story.status, successors: body.story.replacedBy.length, entry: body.entry };
    }, canonical.id);
    expect(shellStatus).toEqual({ status: "split", successors: 2, entry: null });

    // 迁移（ADR-0020）：标签与收藏在拆分后都留在壳上，显式搬到该去的后继。
    const migration = dialog.locator('[data-story-user-state-migration="true"]');
    await expect(migration).toBeVisible();
    const successorIds = await shell.locator("[data-story-successor-id]").evaluateAll(
        (nodes) => nodes.map((node) => (node as HTMLElement).dataset.storySuccessorId ?? ""),
    );
    const readUserState = async (shellId: string, successorId: string) => page.evaluate(
        async (input) => {
            const [shellResponse, successorResponse] = await Promise.all([
                fetch(`/api/v1/stories/${encodeURIComponent(input.shellId)}`),
                fetch(`/api/v1/stories/${encodeURIComponent(input.successorId)}`),
            ]);
            const shellBody = await shellResponse.json() as {
                favorited: boolean;
                labels: Array<{ name: string }>;
            };
            const successorBody = await successorResponse.json() as {
                favorited: boolean;
                labels: Array<{ name: string }>;
            };
            return {
                shell: {
                    favorited: shellBody.favorited,
                    labels: shellBody.labels.map((label) => label.name),
                },
                successor: {
                    favorited: successorBody.favorited,
                    labels: successorBody.labels.map((label) => label.name),
                },
            };
        },
        { shellId, successorId },
    );
    expect(await readUserState(canonical.id, successorIds[0]!)).toEqual({
        shell: { favorited: true, labels: ["迁移验收标签"] },
        successor: { favorited: false, labels: [] },
    });

    await migration.getByLabel("迁移标签 迁移验收标签").check();
    await migration.getByLabel("迁移收藏").check();
    await migration.getByLabel("迁移去向").selectOption(successorIds[0]!);
    await expect(migration.getByTestId("migration-summary")).toContainText("即将迁移");
    await migration.getByTestId("story-user-state-migrate-submit").click();
    await expect(page.getByText("已迁移 2 项标记。")).toBeVisible();
    expect(await readUserState(canonical.id, successorIds[0]!)).toEqual({
        shell: { favorited: false, labels: [] },
        successor: { favorited: true, labels: ["迁移验收标签"] },
    });

    // 撤销就是同一个命令反向调用：把后继上的标记迁回本壳。
    await migration.getByLabel("迁移来源").selectOption(successorIds[0]!);
    await expect(migration.getByLabel("迁移标签 迁移验收标签")).toBeVisible();
    await migration.getByLabel("迁移标签 迁移验收标签").check();
    await migration.getByLabel("迁移收藏").check();
    await migration.getByLabel("迁移去向").selectOption(canonical.id);
    await migration.getByTestId("story-user-state-migrate-submit").click();
    await expect(page.getByText("已迁移 2 项标记。")).toBeVisible();
    expect(await readUserState(canonical.id, successorIds[0]!)).toEqual({
        shell: { favorited: true, labels: ["迁移验收标签"] },
        successor: { favorited: false, labels: [] },
    });

    // 后继是普通 Story：单成员、可继续打开，且不再显示历史壳。
    await shell.locator("[data-story-successor-id]").first().click();
    await expect(dialog.getByText("来源成员（1）")).toBeVisible();
    await expect(dialog.locator('[data-story-shell="true"]')).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
});

test("classifies a Story with a managed subtype and rejects an unregistered value", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    const sourceName = await ingestFeed(page, "subtype 验收来源");

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
    const originalTitle = await dialog.getByRole("heading", { level: 2 }).innerText();

    // 受管理目录只注册 media.*，所以先把 Story 类型改成媒体才能选到注册项。
    await dialog.getByLabel("Story 类型").selectOption("media");
    await dialog.getByLabel("Story subtype").selectOption("media.comic");
    await dialog.getByRole("button", { name: "保存修改" }).click();
    await expect(dialog.locator("[data-story-subtype]")).toHaveText("漫画");

    // 未注册值被服务端拒绝，Story 保持上一次保存的状态。
    const rejection = await page.evaluate(async (id) => {
        const detail = await (await fetch(`/api/v1/stories/${encodeURIComponent(id!)}`)).json() as {
            story: { revisionId: string };
        };
        const response = await fetch(`/api/v1/stories/${encodeURIComponent(id!)}/revisions`, {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
                baseRevisionId: detail.story.revisionId,
                title: "不应保存的标题",
                kind: "media",
                subtype: "media.unknown",
            }),
        });
        return {
            status: response.status,
            body: await response.json() as { code: string },
        };
    }, storyId);
    expect(rejection.status).toBe(400);
    expect(rejection.body.code).toBe("validation_failed");

    const stored = await page.evaluate(async (id) => {
        const body = await (await fetch(`/api/v1/stories/${encodeURIComponent(id!)}`)).json() as {
            story: { kind: string; subtype: string | null; title: string };
        };
        return body.story;
    }, storyId);
    expect(stored).toMatchObject({
        kind: "media",
        subtype: "media.comic",
        title: originalTitle,
    });

    // 上面的 API 调用是故意构造的 400；浏览器会把它记为一条资源加载错误。
    expect(consoleErrors.filter((text) => !text.includes("status of 400"))).toEqual([]);
});

test("organizes a Story with Topic, Entity, favorite, collection, and annotation", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    const sourceName = await ingestFeed(page, "用户组织验收来源");

    await page
        .locator("article")
        .filter({ hasText: sourceName })
        .first()
        .getByRole("button", { name: "打开 Story" })
        .click();
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();

    // Topic：从 Story 侧创建并加入，成员出现在 Topic 面板。
    const topicTitle = `验收 Topic ${randomUUID().slice(0, 6)}`;
    await dialog.getByPlaceholder("Topic 标题").fill(topicTitle);
    await dialog.getByPlaceholder("关注目的").fill("验证 Phase 2 组织能力");
    await dialog.getByRole("button", { name: "创建并加入" }).click();
    await expect(page.getByText(`已创建 Topic「${topicTitle}」并把当前 Story 加入为核心成员。`)).toBeVisible();
    await expect(dialog.getByLabel("选择 Topic")).toContainText(topicTitle);

    // Entity：创建并关联本 Story（关联实体区显示，选项下拉里也会出现同名项）。
    const entityName = `验收实体 ${randomUUID().slice(0, 6)}`;
    await dialog.getByPlaceholder("Entity 名称，例如 Jeff Dean").fill(entityName);
    await dialog.getByRole("button", { name: "创建并关联" }).click();
    await expect(
        dialog.locator('section[aria-label="关联实体"]').getByText(entityName, { exact: true }),
    ).toBeVisible();

    // 收藏、收藏夹与批注。
    await dialog.getByTestId("story-favorite-toggle").click();
    await expect(dialog.getByText("★ 取消收藏")).toBeVisible();
    const collectionName = `验收收藏夹 ${randomUUID().slice(0, 6)}`;
    await dialog.getByPlaceholder("新收藏夹名称").fill(collectionName);
    await dialog.getByRole("button", { name: "新建收藏夹" }).click();
    const collectionCheckbox = dialog.getByRole("checkbox").last();
    // 受控 checkbox 的 DOM 状态由 React 回写，先点击再断言勾选态。
    await collectionCheckbox.click();
    await expect(collectionCheckbox).toBeChecked();
    const annotationBody = `验收批注 ${randomUUID().slice(0, 6)}`;
    await dialog.getByPlaceholder("写下批注正文").fill(annotationBody);
    await dialog.getByRole("button", { name: "添加批注" }).click();
    await expect(dialog.getByText(annotationBody, { exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);

    // 侧栏 Entity 入口可以打开详情，并列出关联 Story。
    const entityButton = page.locator(`[data-entity-id]`).filter({ hasText: entityName }).first();
    await expect(entityButton).toBeVisible();
    await entityButton.click();
    const entityDialog = page.getByRole("dialog");
    await expect(entityDialog).toBeVisible();
    await expect(entityDialog.getByRole("heading", { name: entityName })).toBeVisible();
    await expect(entityDialog.getByRole("heading", { name: /关联 Story/ })).toBeVisible();
    await page.keyboard.press("Escape");

    // Topic 面板：改角色、移除后可恢复。
    const topicButton = page.locator(`[data-topic-id]`).filter({ hasText: topicTitle }).first();
    await expect(topicButton).toBeVisible();
    await topicButton.click();
    const topicDialog = page.getByRole("dialog");
    await expect(topicDialog).toBeVisible();
    const member = topicDialog.locator("[data-topic-member-story-id]").first();
    await expect(member).toBeVisible();
    await member.getByLabel(/修改 .* 的角色/).selectOption("background");
    await expect(member.getByLabel(/修改 .* 的角色/)).toHaveValue("background");
    await member.getByRole("button", { name: "移除" }).click();
    await expect(member.getByRole("button", { name: "恢复" })).toBeVisible();
    await member.getByRole("button", { name: "恢复" }).click();
    await expect(member.getByRole("button", { name: "移除" })).toBeVisible();

    expect(consoleErrors).toEqual([]);
});

test("gives each feed block its own stream and keeps an unbound one on the latest content", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    const sourceName = await ingestFeed(page, "阅读流区块来源");

    // 搜索与已保存视图是页面级入口（PRD §8.2），不再寄居在某个看板区块里。
    const searchRegion = page.getByRole("region", { name: "信息库与搜索" });
    await expect(searchRegion).toBeVisible();
    await expect(searchRegion.getByRole("region", { name: "已保存视图" })).toBeVisible();

    // 未绑定的阅读流区块按最新内容取数，而不是「后续切片」占位。
    const feedBlocks = page.locator('[data-block-type="feed"]');
    await expect(feedBlocks).toHaveCount(1);
    await expect(feedBlocks.first()).toContainText("Cosmos scaffold is ready");

    // 造一个匹配不到任何内容的视图。
    await searchRegion.getByLabel("搜索已保存内容").fill(`绝不匹配的关键词${randomUUID().slice(0, 6)}`);
    await searchRegion.getByPlaceholder("视图名称").fill("空视图");
    await searchRegion.getByRole("button", { name: "保存当前条件" }).click();
    await expect(page.getByText("已保存视图「空视图」。")).toBeVisible();

    // 在「信息流」分区加第二个阅读流区块并绑定该视图。
    await page.getByRole("button", { name: "编辑看板" }).click();
    const feedSection = page.getByRole("region", { name: "信息流" });
    await feedSection.getByLabel("新增区块类型").selectOption("feed");
    await feedSection.getByLabel("新增区块绑定视图").selectOption({ label: "空视图" });
    await feedSection.getByRole("button", { name: "添加区块" }).click();
    await page.getByRole("button", { name: "完成编辑" }).click();

    // 两个阅读流区块各自取数：绑定的按视图条件为空，未绑定的仍是最新内容。
    await expect(feedBlocks).toHaveCount(2);
    await expect(feedBlocks.nth(1)).toContainText("视图「空视图」没有匹配的内容。");
    await expect(feedBlocks.first()).toContainText("Cosmos scaffold is ready");
    // 页面级搜索此时没有结果，正好说明区块不共享页面搜索的状态。
    await expect(searchRegion.getByRole("region", { name: "已保存视图" })).toBeVisible();

    expect(consoleErrors).toEqual([]);
});

test("searches a term carrying FTS5 syntax characters without failing", async ({ page }) => {
    test.setTimeout(120_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/");
    await expect(page.getByRole("region", { name: "信息库与搜索" })).toBeVisible();

    // 直接打接口：`-` 在 FTS5 的 MATCH 里是 NOT 运算符，修复前这类输入会变成
    // 语法错误并让整个请求 500。
    const direct = await page.evaluate(async () => {
        const response = await fetch(`/api/v1/search?text=${encodeURIComponent("state-of-the-art")}&limit=5`);
        const body = await response.json() as { items?: unknown[] };
        return { status: response.status, isArray: Array.isArray(body.items) };
    });
    expect(direct.status).toBe(200);
    expect(direct.isArray).toBe(true);

    // UI 路径同样不能再报错：搜索框填一个带连字符的词并提交。
    const searchRegion = page.getByRole("region", { name: "信息库与搜索" });
    await searchRegion.getByLabel("搜索已保存内容").fill("state-of-the-art");
    await searchRegion.getByRole("button", { name: "搜索" }).click();
    await expect(searchRegion.getByText("分类：", { exact: false })).toHaveCount(0);
    // 搜索结果区正常渲染（空结果也只是空列表，不是错误状态）。
    await expect(page.locator("article")).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
});

/**
 * 拖动按钮必须指向预期的那个区块；不匹配说明定位器或页面结构不是假设的样子。
 */
async function assertHandleBlock(
    handle: import("@playwright/test").Locator,
    expectedBlockId: string,
): Promise<void> {
    const owner = await handle.evaluate(
        (element) => element.closest("[data-block-id]")?.getAttribute("data-block-id") ?? null,
    );
    expect(owner).toBe(expectedBlockId);
}

test("moves a block to the slot right below its drop target", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });

    await page.goto("/");
    await page.getByRole("button", { name: "编辑看板" }).click();
    await expect(page.getByRole("button", { name: "完成编辑" })).toBeVisible();

    const blockIds = (section: import("@playwright/test").Locator) =>
        section.evaluate((element) =>
            [...element.querySelectorAll("[data-block-id]")].map((block) =>
                block.getAttribute("data-block-id"),
            ),
        );

    // 独立分区 + 四个小区块：顺序断言不受其它 spec 留在看板上的区块影响。
    const sectionTitle = `拖拽验收-${randomUUID().slice(0, 6)}`;
    await page.getByLabel("新分区标题").fill(sectionTitle);
    await page.getByRole("button", { name: "添加分区" }).click();
    const section = page.getByRole("region", { name: sectionTitle });
    await expect(section).toBeVisible();
    for (let index = 0; index < 4; index += 1) {
        await section.getByLabel("新增区块类型").selectOption("collection");
        await section.getByRole("button", { name: "添加区块" }).click();
        await expect(section.locator('[data-block-type="collection"]')).toHaveCount(index + 1);
    }
    const [first, second, third, fourth] = await blockIds(section);
    expect(await blockIds(section)).toEqual([first, second, third, fourth]);

    // 每个区块都有独立拖动入口，且指向它自己（与上移/下移按钮并存）。
    for (const blockId of [first, second]) {
        await assertHandleBlock(
            page.locator(`[data-block-id="${blockId}"] button[aria-label^="拖动排序"]`),
            blockId!,
        );
    }

    // 回归：把 A 拖到 B 下方应落在 B 与 C 之间。
    // `dropPositionFor`（board-drag.test.ts 钉住）对该场景算出 position=1；这里确认真实
    // 服务端在该 position 上得到 [B, A, C, D]。旧口径把「全量下标」当 position 用，会
    // 得到 [B, C, A, D]——即用户报告的「插到 C 和 D 之间」。
    const moved = await page.evaluate(async (blockId) => {
        const response = await fetch(`/api/v1/board-blocks/${blockId}/moves`, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            // 省略 sectionId 表示留在原分区，只改位置（合同里 sectionId 可选）。
            body: JSON.stringify({ position: 1 }),
        });
        return { ok: response.ok, status: response.status, body: await response.json() };
    }, first);
    expect(moved.ok, `moves 返回 ${moved.status}`).toBe(true);
    const tree = moved.body as { sections: { blocks: { id: string }[] }[] };
    const reordered = tree.sections.find((entry) =>
        entry.blocks.some((block) => block.id === first),
    );
    expect(reordered?.blocks.map((block) => block.id)).toEqual([second, first, third, fourth]);

    // 界面读的是同一份服务端配置：刷新后顺序保持不变。
    await page.reload();
    await page.getByRole("button", { name: "编辑看板" }).click();
    await expect
        .poll(() => blockIds(page.getByRole("region", { name: sectionTitle })))
        .toEqual([second, first, third, fourth]);

    // 拖拽不是唯一排序路径：上移/下移按钮仍然保留可用（按钮路径不移除）。
    await expect(
        page
            .getByRole("region", { name: sectionTitle })
            .locator('[data-block-type="collection"]')
            .last()
            .getByRole("button", { name: /^上移区块/ }),
    ).toBeEnabled();

    expect(consoleErrors).toEqual([]);
});
