import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";

const FEED_URL = "http://127.0.0.1:4380/feed.xml";

/**
 * Story 阅读页的真实数据验收（ADR-0029 决策 7）。
 *
 * 这一条同时承担两件事：
 * - 读：正文卡片 640px、标题衬线、正文 16px/1.8、阅读列 34em，只读区块与来源标记都在；
 * - 写：切片 3e 把抽屉删掉后，编辑与关联面必须**在阅读页可达**（改标题与关键事实、归并、
 *   拆分、打标签、写批注、加入话题、关联 Entity），否则「Story 的唯一可写入口」就只是句话。
 */

/** 每个场景自建来源并触发录入，不依赖其它 spec 留下的数据。 */
async function ingestFeed(page: import("@playwright/test").Page, prefix: string): Promise<string> {
    const sourceName = `${prefix}-${randomUUID().slice(0, 8)}`;
    await page.goto("/automation");
    await expect(page.getByRole("heading", { name: "自动化", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建来源" }).click();
    await page.getByLabel("名称", { exact: true }).fill(sourceName);
    await page.getByLabel("Feed URL").fill(FEED_URL);
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("采集计划已保存，当前为停用状态")).toBeVisible();

    const planSection = page.getByRole("region", { name: "采集计划" }).or(page.locator("section").filter({ hasText: "采集计划" })).first();
    await planSection.getByRole("button", { name: `启用 ${sourceName}`, exact: true }).click();
    await expect(page.getByText("已启用；可执行手动录入")).toBeVisible();
    await planSection.getByRole("button", { name: sourceName, exact: true }).click();
    await expect(page.getByText("录入任务已排队", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    return sourceName;
}

/** 等这一条来源的 Story 真的落库：读取侧与录入是两条路径，读不到就再等一会儿。 */
async function waitForStoryId(page: import("@playwright/test").Page, sourceName: string): Promise<string> {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
        const response = await page.request.get("/api/v1/feed?limit=20");
        if (response.ok()) {
            const body = await response.json() as { items?: { storyId: string; sourceName: string }[] };
            const match = body.items?.find((item) => item.sourceName === sourceName);
            if (match !== undefined) {
                return match.storyId;
            }
        }
        await page.waitForTimeout(2_000);
    }
    throw new Error(`等待 Story 落库超时：${sourceName}`);
}

test("reads a Story at its own URL and reaches the edit surface there", async ({ page }) => {
    test.setTimeout(300_000);
    const consoleErrors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    });
    const storyRequests: string[] = [];
    page.on("request", (request) => {
        storyRequests.push(request.url());
    });

    const sourceName = await ingestFeed(page, "Story 阅读验收来源");
    const storyId = await waitForStoryId(page, sourceName);

    /*
     * 自己把「关联动作」的前置备齐：编辑面的「加入 Topic」与「关联已有 Entity」区块只在
     * **已有对象**时渲染（`topic-join.tsx` 的 `topics.length > 0`、`link-entity.tsx` 的
     * `entityOptions.length > 0` 守卫），依赖别的 spec 先建对象会让这条用例在单独运行时假红。
     * 创建都走对象页，正是 ADR-0029 决策 1 的分工。
     */
    const topicTitle = `阅读验收话题-${randomUUID().slice(0, 8)}`;
    await page.goto("/topics");
    await page.getByLabel("新话题标题").fill(topicTitle);
    await page.getByLabel("关注目的").fill("给阅读页的关联动作备一个可加入的话题。");
    await page.getByRole("button", { name: "新建话题", exact: true }).click();
    await expect(page.getByText(`已创建话题「${topicTitle}」`)).toBeVisible();

    const entityName = `阅读验收实体-${randomUUID().slice(0, 8)}`;
    await page.goto("/entities");
    await page.getByLabel("新 Entity 名称").fill(entityName);
    await page.getByRole("button", { name: "新建 Entity", exact: true }).click();
    await expect(page.getByText(`已创建 Entity「${entityName}」`)).toBeVisible();

    // id 含冒号，路由段必须编码：不编码会让 Next 把 id 截断。
    await page.goto(`/stories/${encodeURIComponent(storyId)}`);
    const title = page.locator("[data-story-id]");
    await expect(title).toBeVisible();
    await expect(page.getByRole("link", { name: "← 返回" })).toBeVisible();

    /*
     * 取数次数门禁：阅读页的挂载 effect 依赖 `openStory`，而它一旦不是身份稳定的
     * （`useStoryWorkspace` 里必须 `useCallback`），effect 会每渲染重跑 → `setStory` → 再渲染，
     * 形成自激取数循环。实测过：3 秒内对同一条 Story 发了 349 次请求，页内跳转与提交后的重读
     * 全被拖住。这里把「一条 Story 只读几次」变成断言，防止再犯。
     * 计数从**进入阅读页那一刻**开始（上面那些请求属于录入前置，不该算进来）。
     */
    storyRequests.length = 0;
    await page.goto(`/stories/${encodeURIComponent(storyId)}`);
    await expect(title).toBeVisible();
    const storyReads = storyRequests.filter((url) => url.includes("/api/v1/stories/"));
    expect(storyReads.length, `阅读页对同一条 Story 取了 ${storyReads.length} 次`).toBeLessThanOrEqual(8);

    // 阅读版面按 V4 规格：卡片 640px、标题衬线、正文 16px/行高 1.8、阅读列 34em（544px）。
    const article = page.locator("article").first();
    const cardWidth = await article.evaluate((element) => element.getBoundingClientRect().width);
    expect(Math.round(cardWidth)).toBe(640);
    const titleFont = await title.evaluate((element) => getComputedStyle(element).fontFamily);
    expect(titleFont.toLowerCase()).toContain("charter");
    // 正文块必须存在：取不到就断言失败，而不是把这一段整块跳过（曾经用 `if (count > 0)` 包着，
    // 元素消失时用例照样绿）。
    const body = article.locator("div.whitespace-pre-wrap").first();
    await expect(body).toBeVisible();
    const metrics = await body.evaluate((element) => {
        const style = getComputedStyle(element);
        return {
            fontSize: style.fontSize,
            lineHeight: style.lineHeight,
            width: element.getBoundingClientRect().width,
        };
    });
    expect(metrics.fontSize).toBe("16px");
    expect(Number.parseFloat(metrics.lineHeight) / Number.parseFloat(metrics.fontSize)).toBeCloseTo(1.8, 1);
    expect(metrics.width).toBeLessThanOrEqual(544);

    // 只读区块的锚点是既有浏览器验收依赖的合同，删页时不能顺手丢掉。
    await expect(page.locator('[data-story-key-facts="true"]')).toBeVisible();
    await expect(page.locator('[data-story-member-id]').first()).toBeVisible();
    await expect(page.locator('[data-story-timeline="true"], section[aria-label="时间线"]').first()).toBeVisible();
    // 来源标记：机器写出的成员要标出来（ADR-0028）。
    await expect(page.locator('[data-story-member-id]').first()).toContainText(/系统创建|Agent 产生|人工编辑过/);

    // 写入面：抽屉删除后，编辑与关联必须在阅读页可达。
    const editSection = page.getByRole("region", { name: "编辑与关联" })
        .or(page.locator('section[aria-label="编辑与关联"]'));
    await expect(editSection).toBeVisible();
    await editSection.getByRole("button", { name: "展开", exact: true }).click();
    await expect(editSection.locator('fieldset[data-story-time-bound="start"]')).toBeVisible();
    await expect(editSection.getByRole("button", { name: "保存修改", exact: true })).toBeVisible();
    await expect(editSection.getByRole("button", { name: "归并", exact: true })).toBeVisible();
    await expect(editSection.getByRole("button", { name: "添加批注", exact: true })).toBeVisible();

    /*
     * 创建动作**不在** Story 页（ADR-0029 决策 1：创建去对象页、关联就地）。
     * 这四条断言是 3c 验收 ② 的门禁——曾经因为页面把四个 onCreate 回调传下来，
     * 组件里的 `onCreateX &&` 守卫失效、创建表单又冒了出来。
     */
    for (const createAction of ["创建并关联", "创建并加入", "创建并添加", "新建收藏夹"]) {
        await expect(
            editSection.getByRole("button", { name: createAction, exact: true }),
            `Story 页不应出现创建入口：${createAction}`,
        ).toHaveCount(0);
    }
    // 关联动作仍在：挂到已有话题、关联已有 Entity（都是「用已有的」，不新建）。
    await expect(editSection.getByRole("heading", { name: "加入 Topic", exact: true })).toBeVisible();
    await expect(editSection.getByRole("button", { name: "加入", exact: true })).toBeVisible();
    await expect(editSection.getByText("关联已有 Entity", { exact: true })).toBeVisible();
    await expect(editSection.getByRole("button", { name: "关联", exact: true })).toBeVisible();

    /*
     * 「同一件事只有一个可写入口」：收藏的唯一入口是动作区那个按钮，编辑面里不该再有第二个。
     * 这条抓的正是 Round 13 修掉的重复收藏入口——上面按按钮名做黑名单抓不到它。
     */
    await expect(page.getByRole("button", { name: "收藏", exact: true })).toHaveCount(1);
    await expect(editSection.getByRole("button", { name: /收藏/u })).toHaveCount(0);

    /*
     * 拆分表单不在这一条里：它要求 Story 至少有 2 个成员（`split.tsx` 的 `entries.length >= 2`），
     * 一条 RSS 条目进来只有 1 个成员。拆分的渲染验收在组件实验室的 `splittable` 场景里做
     * （`e2e/component-lab/story-edit-surface.spec.ts`），那里有固定的双成员夹具。
     */

    expect(consoleErrors).toEqual([]);
});
