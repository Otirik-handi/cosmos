import { expect, test, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

import {
    FIXTURE_TITLES,
    collectConsoleErrors,
    enterBoardEditing,
    expandEditSurface,
    ingestFeed,
    mergeStoryInto,
    openStory,
    waitForStoryIds,
} from "../support/story-flow";

/**
 * Phase 2 组织能力的浏览器回归证据（Task 35 切片 3e 按新 IA 重写）。
 *
 * 旧套件把「录入 → 读 → 编辑」都做在首页单页 + Story 抽屉上。切片 3 把它们拆成三个
 * 位置：`/automation` 配置与录入、`/library` 浏览与检索、`/stories/:id` 读与写；创建
 * 动作按 ADR-0029 决策 1 去对象页（`/topics`、`/entities`、`/organize`），关联动作留在
 * Story 页。这条套件守的是「搬迁前后同一操作的数据与领域事件一致」：断言仍然读服务端
 * 真相，只换导航与选择器。
 *
 * 数据限定：同一栈会话内数据库跨 spec/重试持久化，fixture 的三条标题在所有来源之间
 * 重复，所以每条断言都连本用例生成的来源名/标签名/视图名一起限定，不写「Feed 是空的」
 * 这类全局假设。
 */

type StoryReadBody = {
    story: {
        id: string;
        kind: string;
        subtype: string | null;
        revisionId: string;
        title: string;
        status: "active" | "split";
        replacedBy: Array<{ storyId: string; title: string; kind: string }>;
    };
    entry: unknown;
    entries: Array<{ id: string }>;
    entities: Array<{ entityId: string; name: string }>;
    topics: Array<{ topicId: string; title: string; role: string }>;
    labels: Array<{ id: string; name: string }>;
    favorited: boolean;
    evidence: Array<{ entryId: string; relationType: string }>;
};

/** 服务端真相。写命令之后用它断言落库结果，而不是只看界面回显。 */
async function readStory(page: Page, storyId: string): Promise<StoryReadBody> {
    const response = await page.request.get(`/api/v1/stories/${encodeURIComponent(storyId)}`);
    expect(response.ok(), `读取 Story 失败（HTTP ${response.status()}）`).toBe(true);
    return await response.json() as StoryReadBody;
}

/** 按名字取对象 id；名字由本用例生成，不会与别的 spec 留下的数据撞车。 */
async function idOf(page: Page, url: string, name: string): Promise<string> {
    const response = await page.request.get(url);
    expect(response.ok(), `读取 ${url} 失败（HTTP ${response.status()}）`).toBe(true);
    const body = await response.json() as {
        items?: Array<{ id: string; name?: string; title?: string }>;
    };
    const match = (body.items ?? []).find((item) => (item.name ?? item.title) === name);
    if (match === undefined) {
        throw new Error(`列表里没有「${name}」：${url}`);
    }
    return match.id;
}

/** 条目所属的 Story；用于从「证据条目」回到它所在的 Story。 */
async function storyIdOfEntry(page: Page, entryId: string): Promise<string | null> {
    const response = await page.request.get("/api/v1/entries?limit=100");
    expect(response.ok()).toBe(true);
    const body = await response.json() as {
        items: Array<{ id: string; storyId: string | null }>;
    };
    return body.items.find((item) => item.id === entryId)?.storyId ?? null;
}

/**
 * 把已有标签挂到 Story 上。
 *
 * 阅读页**从不读取标签目录**（`story-reading.tsx` 只有 openStory / loadEntities /
 * loadTopics / listStorySubtypes，没有 loadLabels），所以 `StoryOrganizationSection`
 * 拿到的 `labelOptions` 恒为空，「选择要添加的标签」下拉与「添加」按钮从不渲染——
 * 新 IA 里没有从 UI 给 Story 打标签的入口（见交付报告的产品缺口）。这里用服务端命令
 * 完成挂载，好让标签相关的领域断言（按标签检索、相关内容、迁移）仍然跑在真实数据上。
 */
async function assignLabel(page: Page, labelId: string, storyId: string): Promise<void> {
    const response = await page.request.post("/api/v1/label-assignments", {
        data: { labelId, targetType: "story", targetId: storyId },
    });
    expect(response.status(), "挂标签").toBe(201);
}

/** 在 `/organize?tab=labels` 建标签（创建动作在对象页），返回它的 id。 */
async function createLabel(page: Page, labelName: string): Promise<string> {
    await page.goto("/organize?tab=labels");
    await page.getByLabel("新标签名称").fill(labelName);
    await page.getByRole("button", { name: "新建标签", exact: true }).click();
    await expect(page.getByText(`已创建标签「${labelName}」`)).toBeVisible();
    return idOf(page, "/api/v1/labels", labelName);
}

/**
 * 迁移一次之后的落定断言。
 *
 * 用服务端状态而不是界面的勾选态：阅读页的挂载 effect 依赖未记忆化的 `openStory`，每次
 * 渲染都重跑并重新拉取 URL 上那条 Story（实测 3 秒内 349 次请求），迁移提交后的重读会被
 * 这条自激循环挤在后面，勾选态可能长时间停在提交前的样子（2026-10-01 实测：POST 已 201、
 * 服务端已迁移，界面仍是「即将迁移」）。所以迁移的领域结果按落库状态轮询，界面只保留
 * 「已迁移 N 项标记。」这条命令回执。
 */
function userStateText(state: {
    shell: { favorited: boolean; labels: string[] };
    successor: { favorited: boolean; labels: string[] };
}): string {
    const side = (value: { favorited: boolean; labels: string[] }): string =>
        `${value.favorited ? "★" : "-"}${value.labels.join("+")}`;
    return `壳:${side(state.shell)}|后继:${side(state.successor)}`;
}

test("browses by label, saves the condition as a view, and shows the Story timeline and related content", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors = collectConsoleErrors(page);

    const sourceName = await ingestFeed(page, "分类验收来源");
    // fixture 三条各成一个单成员 Story（Story id 由条目身份派生），按来源名限定取回。
    const storyIds = await waitForStoryIds(page, sourceName, 3);
    const [firstStoryId, secondStoryId] = storyIds as [string, string, string];

    const labelName = `阶段2验收-${randomUUID().slice(0, 6)}`;
    const labelId = await createLabel(page, labelName);
    for (const storyId of [firstStoryId, secondStoryId]) {
        await assignLabel(page, labelId, storyId);
    }

    // 按标签浏览的领域结果：标签条件下的检索只返回挂了这条标签的两条 Story。
    const byLabel = await page.request.get(
        `/api/v1/search?labelIds=${encodeURIComponent(labelId)}&limit=50`,
    );
    expect(byLabel.ok(), `按标签检索失败（HTTP ${byLabel.status()}）`).toBe(true);
    const byLabelBody = await byLabel.json() as { items: Array<{ storyId: string }> };
    expect([...new Set(byLabelBody.items.map((item) => item.storyId))].sort())
        .toEqual([firstStoryId, secondStoryId].sort());

    // 时间线与相关内容都在阅读页的**只读区**：不用展开编辑面就在页面上。
    await openStory(page, secondStoryId);
    const timeline = page.locator('[data-story-timeline="true"]');
    await expect(timeline).toBeVisible();
    await expect(timeline.locator("li").first()).toBeVisible();

    const related = page.locator('[data-story-related="true"]');
    await expect(related).toBeVisible({ timeout: 15_000 });
    await expect(related.getByText(`共享标签：${labelName}`)).toBeVisible();
    const firstTitle = (await readStory(page, firstStoryId)).story.title;
    await expect(related.getByRole("button", { name: firstTitle, exact: true })).toBeVisible();

    // 检索工作台与已保存视图面板都在 /library（同一个 FeedBrowser）。
    const searchText = FIXTURE_TITLES[2];
    await page.goto("/library");
    await expect(page.locator('section[aria-label="阅读流"]')).toBeVisible();
    await page.getByLabel("搜索已保存内容").fill(searchText);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByText(`“${searchText}”`)).toBeVisible();

    // 保存为视图：条件是持久化的，清除筛选后套用视图能恢复同一条件。
    const viewName = `分类视图-${randomUUID().slice(0, 6)}`;
    await page.getByLabel("视图名称").fill(viewName);
    await page.getByRole("button", { name: "保存当前条件" }).click();
    await expect(page.getByText(`已保存视图「${viewName}」。`)).toBeVisible();
    await page.getByRole("button", { name: "清除筛选" }).click();
    await expect(page.getByText(`“${searchText}”`)).toHaveCount(0);
    await page.getByRole("button", { name: viewName, exact: true }).click();
    await expect(page.getByText(`“${searchText}”`)).toBeVisible();

    // 刷新后视图仍在，套用后条件一样回来：这是服务端存的视图，不是页面内存里的回显。
    await page.reload();
    await expect(page.getByRole("button", { name: viewName, exact: true })).toBeVisible();
    await page.getByRole("button", { name: viewName, exact: true }).click();
    await expect(page.getByText(`“${searchText}”`)).toBeVisible();

    expect(consoleErrors).toEqual([]);
});

test("links an entry from another Story as evidence and shows the reverse view", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors = collectConsoleErrors(page);

    const sourceName = await ingestFeed(page, "证据关系验收来源");
    const storyIds = await waitForStoryIds(page, sourceName, 3);
    const targetStoryId = storyIds[0]!;

    // 证据来源在阅读页的只读区，默认就可见（不需要展开编辑面）。
    await openStory(page, targetStoryId);
    const targetTitle = (await page.locator("[data-story-id]").innerText()).trim();
    const evidenceSection = page.locator('section[aria-label="证据来源"]');
    await expect(evidenceSection.getByText(/还没有其它 Story 引用/)).toBeVisible();

    /*
     * 候选条目必须按**来源身份**挑，不能按位置挑：候选列表里还有别的来源的条目，而共享
     * fixture 让所有来源用同一组标题，拿别的来源的条目按标题回找卡片会落到本来源同名的
     * 另一条 Story 上，那条 Story 里没有这个条目，成员行永远等不到。
     * 另外排除标题与目标 Story 相同的那条：否则「成员行里含目标标题」会被成员自己的
     * 标题满足，反向引用这条断言就白写了。
     */
    const option = evidenceSection.getByLabel("选择证据条目");
    const candidate = await option.locator("option").evaluateAll((nodes, input) => {
        for (const node of nodes) {
            const value = (node as HTMLOptionElement).value;
            const text = node.textContent ?? "";
            if (value !== "" && text.startsWith(`${input.prefix} · `) && text !== input.sameTitle) {
                return { value, label: text };
            }
        }
        return null;
    }, { prefix: sourceName, sameTitle: `${sourceName} · ${targetTitle}` });
    if (!candidate) {
        throw new Error(`证据候选里没有本来源（${sourceName}）标题不同的其它条目`);
    }
    const entryId = candidate.value;

    await option.selectOption(entryId);
    await evidenceSection.getByLabel("证据关系类型").selectOption("evidence_for");
    await evidenceSection.getByRole("button", { name: "添加", exact: true }).click();
    const evidenceItem = evidenceSection.locator(`[data-story-evidence-entry-id="${entryId}"]`);
    await expect(evidenceItem).toBeVisible();
    await expect(evidenceItem.getByText("证据", { exact: true })).toBeVisible();

    // 反向视图：该条目所属 Story 的成员行显示它作为证据关联到目标 Story。
    const primaryStoryId = await storyIdOfEntry(page, entryId);
    expect(primaryStoryId).not.toBeNull();
    expect(primaryStoryId).not.toBe(targetStoryId);
    await openStory(page, primaryStoryId!);
    const member = page.locator(`[data-story-member-id="${entryId}"]`);
    await expect(member).toBeVisible();
    const reverseLink = member.locator(`[data-story-member-links="${entryId}"]`);
    await expect(reverseLink).toContainText("作为证据关联到");
    await expect(reverseLink).toContainText(targetTitle);

    // 解除后目标 Story 的证据来源清空。
    await openStory(page, targetStoryId);
    const reopened = page.locator('section[aria-label="证据来源"]');
    await reopened
        .locator(`[data-story-evidence-entry-id="${entryId}"]`)
        .getByRole("button", { name: "解除" })
        .click();
    await expect(reopened.getByText(/还没有其它 Story 引用/)).toBeVisible();

    expect(consoleErrors).toEqual([]);
});

test("splits a Story into successors and keeps a historical shell", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors = collectConsoleErrors(page);

    const sourceName = await ingestFeed(page, "拆分验收来源");
    const storyIds = await waitForStoryIds(page, sourceName, 3);
    const [canonicalId, obsoleteId] = storyIds as [string, string, string];
    const canonicalTitle = (await readStory(page, canonicalId)).story.title;

    // 归并两条单成员 Story，得到一条双成员 Story 作为拆分素材：拆分表单要求
    // Story 至少有两个成员（`split.tsx` 的 `entries.length >= 2`）。
    // 「来源成员（N）」在编辑面之外（它是只读区），所以断言按页面而不是按编辑面限定。
    await openStory(page, canonicalId);
    await mergeStoryInto(page, obsoleteId);

    // 拆分前先留下用户真相：一个标签和一个收藏。拆开后它们留在历史壳上，这正是
    // 待迁移的错位；迁移与撤销在下面验证（ADR-0020）。
    const labelName = `迁移验收标签-${randomUUID().slice(0, 6)}`;
    const labelId = await createLabel(page, labelName);
    await assignLabel(page, labelId, canonicalId);
    await openStory(page, canonicalId);
    const userSection = await expandEditSurface(page);
    await userSection.getByTestId("story-favorite-toggle").click();
    await expect(userSection.getByText("★ 取消收藏")).toBeVisible();
    // 两次写入都必须是服务端已确认的，否则后面的拆分与状态断言会在竞态下读到尚未
    // 落库的中间态（2026-09-15 观察到过一次这种失败）。
    await expect.poll(async () => {
        const detail = await readStory(page, canonicalId);
        return `${detail.favorited}:${detail.labels.map((label) => label.name).join(",")}`;
    }, { timeout: 30_000 }).toBe(`true:${labelName}`);

    // 显式把两个成员各分给一个后继；未列出的关系留在历史壳。
    const splitForm = userSection.locator('form[aria-label="拆分 Story"]');
    await expect(splitForm).toBeVisible();
    const targets = splitForm.locator('select[aria-label$="的拆分去向"]');
    await expect(targets).toHaveCount(2);
    await targets.nth(0).selectOption("0");
    await targets.nth(1).selectOption("1");
    await userSection.getByTestId("story-split-submit").click();

    // 命令返回历史壳：成员清空、后继可打开、写操作入口消失。
    const shell = page.locator('section[data-story-shell="true"]');
    await expect(shell).toBeVisible();
    await expect(page.getByRole("heading", { name: "已拆分为 2 条" })).toBeVisible();
    await expect(shell.locator("[data-story-successor-id]")).toHaveCount(2);
    await expect(page.getByRole("heading", { name: "来源成员（0）" })).toBeVisible();
    await expect(page.locator('section[aria-label="Story 操作"]')).toHaveCount(0);
    await expect(page.locator("[data-story-action-error]")).toHaveCount(0);

    const shellStatus = await readStory(page, canonicalId);
    expect({
        status: shellStatus.story.status,
        successors: shellStatus.story.replacedBy.length,
        entry: shellStatus.entry,
    }).toEqual({ status: "split", successors: 2, entry: null });

    // 迁移（ADR-0020）：标签与收藏在拆分后都留在壳上，显式搬到该去的后继。
    const migration = page.locator('section[data-story-user-state-migration="true"]');
    await expect(migration).toBeVisible();
    const successorIds = await shell.locator("[data-story-successor-id]").evaluateAll(
        (nodes) => nodes.map((node) => (node as HTMLElement).dataset.storySuccessorId ?? ""),
    );
    const readUserState = async (shellId: string, successorId: string) => {
        const [shellBody, successorBody] = await Promise.all([
            readStory(page, shellId),
            readStory(page, successorId),
        ]);
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
    };
    expect(await readUserState(canonicalId, successorIds[0]!)).toEqual({
        shell: { favorited: true, labels: [labelName] },
        successor: { favorited: false, labels: [] },
    });

    await migration.getByLabel(`迁移标签 ${labelName}`).check();
    await migration.getByLabel("迁移收藏").check();
    await migration.getByLabel("迁移去向").selectOption(successorIds[0]!);
    await expect(migration.getByTestId("migration-summary")).toContainText("即将迁移");
    // 这条回执在本页此前不存在，所以「等它出现」就是等命令返回。
    await migration.getByTestId("story-user-state-migrate-submit").click();
    await expect(page.getByText("已迁移 2 项标记。")).toBeVisible();
    await expect
        .poll(async () => userStateText(await readUserState(canonicalId, successorIds[0]!)), { timeout: 30_000 })
        .toBe(`壳:-|后继:★${labelName}`);

    // 撤销就是同一个命令反向调用：把后继上的标记迁回本壳。
    await migration.getByLabel("迁移来源").selectOption(successorIds[0]!);
    await expect(migration.getByLabel(`迁移标签 ${labelName}`)).toBeVisible();
    await migration.getByLabel(`迁移标签 ${labelName}`).check();
    await migration.getByLabel("迁移收藏").check();
    await migration.getByLabel("迁移去向").selectOption(canonicalId);
    await migration.getByTestId("story-user-state-migrate-submit").click();
    await expect
        .poll(async () => userStateText(await readUserState(canonicalId, successorIds[0]!)), { timeout: 30_000 })
        .toBe(`壳:★${labelName}|后继:-`);

    /*
     * 后继是普通 Story：单成员、可继续打开，且不再显示历史壳。
     *
     * 这里按 URL 打开而不是点历史壳里的后继按钮：后者在新 IA 下打不开——阅读页的挂载
     * effect 依赖未记忆化的 `openStory`，每次渲染都重跑并重新拉取 URL 上那条 Story，
     * 页面内的跳转会被立刻覆盖回去（实测：点后继后标题与成员数仍是壳的）。这是产品缺口，
     * 已记入交付报告；「后继可打开」这条领域断言本身仍然成立，走产品真正的读取路径断言。
     */
    await openStory(page, successorIds[0]!);
    await expect(page.getByRole("heading", { name: "来源成员（1）" })).toBeVisible();
    await expect(page.locator('section[data-story-shell="true"]')).toHaveCount(0);
    // 后继的标题由命令派生自壳标题，用来确认打开的是刚拆出来的那条。
    await expect(page.locator("[data-story-id]")).toContainText(canonicalTitle);
    const successorDetail = await readStory(page, successorIds[0]!);
    expect(successorDetail.story.status).toBe("active");
    expect(successorDetail.entries).toHaveLength(1);

    expect(consoleErrors).toEqual([]);
});

test("classifies a Story with a managed subtype and rejects an unregistered value", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors = collectConsoleErrors(page);

    const sourceName = await ingestFeed(page, "subtype 验收来源");
    const storyId = (await waitForStoryIds(page, sourceName, 1))[0]!;

    await openStory(page, storyId);
    const originalTitle = (await page.locator("[data-story-id]").innerText()).trim();
    const editSection = await expandEditSurface(page);

    // 受管理目录只注册 media.*，所以先把 Story 类型改成媒体才能选到注册项。
    await editSection.getByLabel("Story 类型").selectOption("media");
    await editSection.getByLabel("Story subtype").selectOption("media.comic");
    await editSection.getByRole("button", { name: "保存修改", exact: true }).click();

    // 阅读页徽章是这次写入的完成信号：提交是异步的，先读服务端会读到写之前的中间态
    // （2026-10-01 实测）。旧套件用 `[data-story-subtype]` 的文本等同一件事，该锚点随
    // 抽屉一起删除，改成等卡片头部的 subtype 徽章。
    await expect(page.locator("article").first()).toContainText("media.comic");
    const saved = await readStory(page, storyId);
    expect(saved.story).toMatchObject({
        kind: "media",
        subtype: "media.comic",
        title: originalTitle,
    });

    // 未注册值被服务端拒绝，Story 保持上一次保存的状态。
    const rejection = await page.evaluate(async (id) => {
        const detail = await (await fetch(`/api/v1/stories/${encodeURIComponent(id)}`)).json() as {
            story: { revisionId: string };
        };
        const response = await fetch(`/api/v1/stories/${encodeURIComponent(id)}/revisions`, {
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

    const stored = await readStory(page, storyId);
    expect(stored.story).toMatchObject({
        kind: "media",
        subtype: "media.comic",
        title: originalTitle,
    });

    // 上面的 API 调用是故意构造的 400；浏览器会把它记为一条资源加载错误。
    expect(consoleErrors.filter((text) => !text.includes("status of 400"))).toEqual([]);
});

test("organizes a Story with Topic, Entity, favorite, collection, and annotation", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors = collectConsoleErrors(page);

    const sourceName = await ingestFeed(page, "用户组织验收来源");
    const storyId = (await waitForStoryIds(page, sourceName, 1))[0]!;

    /*
     * 创建在对象页（ADR-0029 决策 1）：话题在 /topics、Entity 在 /entities、
     * 标签与收藏夹在 /organize。四个对象必须**先建好再打开 Story**——阅读页只在挂载时
     * 读一次话题与实体目录。
     */
    const topicTitle = `验收话题-${randomUUID().slice(0, 6)}`;
    await page.goto("/topics");
    await page.getByLabel("新话题标题").fill(topicTitle);
    await page.getByLabel("关注目的").fill("验证 Phase 2 组织能力");
    await page.getByRole("button", { name: "新建话题", exact: true }).click();
    await expect(page.getByText(`已创建话题「${topicTitle}」。`)).toBeVisible();

    const entityName = `验收实体-${randomUUID().slice(0, 6)}`;
    await page.goto("/entities");
    await page.getByLabel("新 Entity 名称").fill(entityName);
    await page.getByLabel("Entity 类型").selectOption("organization");
    await page.getByRole("button", { name: "新建 Entity", exact: true }).click();
    await expect(page.getByText(`已创建 Entity「${entityName}」。`)).toBeVisible();

    const collectionName = `验收收藏夹-${randomUUID().slice(0, 6)}`;
    await page.goto("/organize?tab=collections");
    await page.getByLabel("新收藏夹名称").fill(collectionName);
    await page.getByRole("button", { name: "新建收藏夹", exact: true }).click();
    await expect(page.getByText(`已创建收藏夹「${collectionName}」`)).toBeVisible();
    const collectionId = await idOf(page, "/api/v1/collections", collectionName);

    const labelName = `验收标签-${randomUUID().slice(0, 6)}`;
    const labelId = await createLabel(page, labelName);
    await assignLabel(page, labelId, storyId);

    // 回到 Story 页做关联：加入话题、关联 Entity、勾收藏夹、写批注、收藏。
    await openStory(page, storyId);
    const editSection = await expandEditSurface(page);

    await expect(editSection.getByLabel("选择 Topic")).toContainText(topicTitle);
    await editSection.getByLabel("选择 Topic").selectOption({ label: topicTitle });
    await editSection.getByRole("button", { name: "加入", exact: true }).click();
    await expect.poll(async () => {
        const detail = await readStory(page, storyId);
        return detail.topics.map((topic) => `${topic.title}:${topic.role}`).join(",");
    }, { timeout: 30_000 }).toBe(`${topicTitle}:core`);

    await editSection.getByLabel("选择 Entity").selectOption({ label: entityName });
    await editSection.getByRole("button", { name: "关联", exact: true }).click();
    const entityRow = editSection.locator('section[aria-label="关联实体"]');
    await expect(entityRow.getByText(entityName, { exact: true })).toBeVisible();

    // 标签在阅读页是只读回显（挂载走服务端命令，原因见 assignLabel）。
    await expect(editSection.getByText(labelName, { exact: true })).toBeVisible();

    const collectionCheckbox = editSection.getByTestId(`story-collection-${collectionId}`);
    // 受控 checkbox 的 DOM 状态由 React 回写，先点击再断言勾选态。
    await collectionCheckbox.click();
    await expect(collectionCheckbox).toBeChecked();
    const collection = await page.request.get(
        `/api/v1/collections/${encodeURIComponent(collectionId)}`,
    );
    const collectionBody = await collection.json() as { stories: Array<{ storyId: string }> };
    expect(collectionBody.stories.map((story) => story.storyId)).toContain(storyId);

    const annotationBody = `验收批注 ${randomUUID().slice(0, 6)}`;
    await editSection.getByPlaceholder("写下批注正文").fill(annotationBody);
    await editSection.getByRole("button", { name: "添加批注", exact: true }).click();
    await expect(editSection.getByText(annotationBody, { exact: true })).toBeVisible();

    await editSection.getByTestId("story-favorite-toggle").click();
    await expect(editSection.getByText("★ 取消收藏")).toBeVisible();

    // 全部落库：重读 Story 与批注列表，确认不是页面内的临时回显。
    const organized = await readStory(page, storyId);
    expect(organized.favorited).toBe(true);
    expect(organized.labels.map((label) => label.name)).toContain(labelName);
    expect(organized.entities.map((entity) => entity.name)).toContain(entityName);
    expect(organized.topics.map((topic) => topic.title)).toContain(topicTitle);
    const annotations = await page.request.get(
        `/api/v1/annotations?targetType=story&targetId=${encodeURIComponent(storyId)}`,
    );
    const annotationList = await annotations.json() as { items: Array<{ body: string }> };
    expect(annotationList.items.map((item) => item.body)).toContain(annotationBody);

    expect(consoleErrors).toEqual([]);
});

test("gives each feed block its own stream and keeps an unbound one on the latest content", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors = collectConsoleErrors(page);

    const sourceName = await ingestFeed(page, "阅读流区块来源");

    // 造一个匹配不到任何内容的视图：条件是服务端存的，不是页面内存里的一份回显。
    const emptyKeyword = `绝不匹配-${randomUUID().slice(0, 8)}`;
    const viewName = `空视图-${randomUUID().slice(0, 6)}`;
    await page.goto("/library");
    await expect(page.locator('section[aria-label="阅读流"]')).toBeVisible();
    await page.getByLabel("搜索已保存内容").fill(emptyKeyword);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await page.getByLabel("视图名称").fill(viewName);
    await page.getByRole("button", { name: "保存当前条件" }).click();
    await expect(page.getByText(`已保存视图「${viewName}」。`)).toBeVisible();

    /*
     * 在自己的分区里加两个阅读流区块：一个不绑定，一个绑定这个空视图。
     * 用独立分区而不是默认的「信息流」——同一栈里别的 spec 也会往默认看板加区块，
     * 断言只数自己这两个，不受它们影响。
     */
    await enterBoardEditing(page);
    const sectionTitle = `阅读流验收-${randomUUID().slice(0, 6)}`;
    await page.getByLabel("新分区标题").fill(sectionTitle);
    await page.getByRole("button", { name: "添加分区", exact: true }).click();
    const section = page.getByRole("region", { name: sectionTitle });
    await expect(section).toBeVisible();
    await section.getByLabel("新增区块类型").selectOption("feed");
    await section.getByRole("button", { name: "添加区块", exact: true }).click();
    await section.getByLabel("新增区块类型").selectOption("feed");
    await section.getByLabel("新增区块绑定视图").selectOption({ label: viewName });
    await section.getByRole("button", { name: "添加区块", exact: true }).click();
    await expect(section.locator('[data-block-type="feed"]')).toHaveCount(2);
    await page.getByRole("button", { name: "完成编辑", exact: true }).click();

    // 两个阅读流区块各自取数：未绑定的按最新内容（本用例刚录入的来源），绑定的按视图为空。
    const blocks = page.getByRole("region", { name: sectionTitle }).locator('[data-block-type="feed"]');
    await expect(blocks).toHaveCount(2);
    await expect(blocks.nth(0)).toContainText(sourceName);
    await expect(blocks.nth(1)).toContainText(`视图「${viewName}」没有匹配的内容。`);

    // 页面级检索在 /library，与看板区块各走各的取数：那边搜不到，这边区块照旧。
    await page.goto("/library");
    await page.getByLabel("搜索已保存内容").fill(emptyKeyword);
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.locator('section[aria-label="阅读流"]').locator("article")).toHaveCount(0);
    await page.goto("/");
    await expect(
        page.getByRole("region", { name: sectionTitle }).locator('[data-block-type="feed"]').nth(0),
    ).toContainText(sourceName);

    expect(consoleErrors).toEqual([]);
});

test("searches a term carrying FTS5 syntax characters without failing", async ({ page }) => {
    test.setTimeout(120_000);
    const consoleErrors = collectConsoleErrors(page);

    // 检索工作台在 /library（同一个 FeedBrowser）。
    await page.goto("/library");
    const feedList = page.locator('section[aria-label="阅读流"]');
    await expect(feedList).toBeVisible();

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
    await page.getByLabel("搜索已保存内容").fill("state-of-the-art");
    await page.getByRole("button", { name: "搜索", exact: true }).click();
    await expect(page.getByText(/搜索到 \d+ 条结果。/)).toBeVisible();
    // 没有错误横幅。限定在 main 内：Next 的路由播报器本身就是一个常驻的
    // `role="alert"`（在 main 之外），不限定会把「页面永远有一个 alert」当成本用例的失败。
    await expect(page.locator('main [role="alert"]')).toHaveCount(0);
    // 搜索结果区正常渲染（空结果也只是空列表，不是错误状态）。
    await expect(feedList.locator("article")).toHaveCount(0);

    expect(consoleErrors).toEqual([]);
});

/**
 * 拖动按钮必须指向预期的那个区块；不匹配说明定位器或页面结构不是假设的样子。
 */
async function assertHandleBlock(
    handle: Locator,
    expectedBlockId: string,
): Promise<void> {
    const owner = await handle.evaluate(
        (element) => element.closest("[data-block-id]")?.getAttribute("data-block-id") ?? null,
    );
    expect(owner).toBe(expectedBlockId);
}

test("moves a block to the slot right below its drop target", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors = collectConsoleErrors(page);

    // 首页看板编辑没有随重做搬家：它仍在 `/`（ADR-0029 决策 3）。
    await enterBoardEditing(page);
    await expect(page.getByRole("button", { name: "完成编辑" })).toBeVisible();

    const blockIds = (section: Locator) =>
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
    // `resolveDropTarget`（board-drag.test.ts 钉住：拖到哪个区块就用它在分区内的下标）
    // 对该场景算出 position=1；这里确认真实服务端在该 position 上得到 [B, A, C, D]。
    // 旧口径把「全量下标」当 position 用，会得到 [B, C, A, D]——即用户报告的「插到 C 和 D 之间」。
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
