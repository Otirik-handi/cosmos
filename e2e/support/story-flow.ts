import { expect, type Locator, type Page } from "@playwright/test";
import { randomUUID } from "node:crypto";

/**
 * 浏览器验收的录入前置与新 IA 导航（切片 3e/4 重写旧套件时抽出）。
 *
 * 旧套件把「录入 → 读 → 编辑」都做在首页 + Story 抽屉上；切片 3 把这三件事拆成了
 * 三个位置：`/automation` 配置与触发录入、`/library` 浏览与检索、`/stories/:id` 读与写。
 * 这里把新路径收成一份，避免每个 spec 各写一遍（旧套件每个文件都抄了一份 ingestFeed）。
 */

/** 受控 RSS fixture；端口可被 `COSMOS_E2E_RSS_PORT` 覆盖（并行跑多套验收时各占一个）。 */
export const FEED_URL = process.env.COSMOS_E2E_RSS_URL
    ?? `http://127.0.0.1:${process.env.COSMOS_E2E_RSS_PORT ?? "4380"}/feed.xml`;

/**
 * fixture 服务器上的某个路径（如 `/offline.xml`、`/media/fixture-image.svg`）。
 *
 * 注意：`fixtures/rss/offline-media.xml` 里的 `<link>` 与 `<img src>` 目前是**绝对地址且硬编码
 * 4380**，所以只改 fixture 端口的话，媒体下载类断言必然失败（worker 会去 4380 抓，那里没人监听）。
 * 要恢复并行端口，得先把那些绝对地址改成相对路径。
 */
export function fixtureUrl(path: string): string {
    return new URL(path, FEED_URL).toString();
}

/** fixture feed 的三条内容；每个来源都会录入这三条，标题在所有来源之间重复。 */
export const FIXTURE_TITLES = [
    "Cosmos scaffold is ready",
    "Message without a web URL",
    "Fixture media metadata",
] as const;

/** 每次调用都给一个唯一来源名：同一栈会话内数据库跨重试持久化，固定名会撞车。 */
export function uniqueSourceName(prefix: string): string {
    return `${prefix}-${randomUUID().slice(0, 8)}`;
}

/**
 * 在 `/automation` 建来源并触发一次录入，返回来源名。
 *
 * `configure` 在**保存前**改表单，只能改新建来源表单里有的字段（名称 / 来源定义 / 操作 /
 * Feed URL / 采集模式 / 查询词 / 每次条数 / 定时 / 连接）。**媒体策略不在这个表单里**——
 * 它按计划保存（ADR-0014），只能在计划列表行内设置；媒体策略类场景要「先建计划 → 行内改策略
 * → 再启用试跑」，不能靠这个回调一次做完。
 */
export async function ingestFeed(
    page: Page,
    prefix: string,
    configure?: (page: Page, sourceName: string) => Promise<void>,
): Promise<string> {
    const sourceName = uniqueSourceName(prefix);
    await page.goto("/automation");
    await expect(page.getByRole("heading", { name: "自动化", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "新建来源" }).click();
    await page.getByLabel("名称", { exact: true }).fill(sourceName);
    await page.getByLabel("Feed URL").fill(FEED_URL);
    if (configure !== undefined) {
        await configure(page, sourceName);
    }
    await page.getByRole("button", { name: "保存计划" }).click();
    await expect(page.getByText("采集计划已保存，当前为停用状态")).toBeVisible();

    const planSection = planSectionOf(page);
    await planSection.getByRole("button", { name: `启用 ${sourceName}`, exact: true }).click();
    await expect(page.getByText("已启用；可执行手动录入")).toBeVisible();
    await planSection.getByRole("button", { name: `立即抓取 ${sourceName}`, exact: true }).click();
    await expect(page.getByText("录入任务已排队", { exact: false }).first()).toBeVisible({ timeout: 15_000 });
    return sourceName;
}

/** 采集计划区块；`/automation` 上它是一个带 aria-label 的分区。 */
export function planSectionOf(page: Page): Locator {
    return page.locator('section[aria-label="采集计划"], [data-block-type="source-health"]').first();
}

/**
 * 计划列表里某一行的定位。
 *
 * 必须按来源名过滤：`/automation` 上「采集计划」标题出现两次（页面分区 + 列表自带的标题），
 * 用标题向上取父级会歧义；同一栈会话里还有别的来源的计划行。
 */
export function planRowOf(page: Page, sourceName: string): Locator {
    return planSectionOf(page).locator("li").filter({ hasText: sourceName }).first();
}

/**
 * 从 `/library` 的阅读流里按「来源名 + 标题」定位并点开那条 Story，返回它的 id。
 *
 * 比「取 feed 第一条」确定得多：Feed 按更新时间排序，归并/改标题之后顺序会变，
 * 拿列表下标当「刚操作的那条」会指到别的 Story 上。
 */
export async function openStoryFromFeed(
    page: Page,
    options: { sourceName: string; title: string },
): Promise<string> {
    await page.goto("/library");
    const card = page.locator("article")
        .filter({ hasText: options.sourceName })
        .filter({ hasText: options.title })
        .first();
    await expect(card).toBeVisible({ timeout: 30_000 });
    await card.getByRole("button", { name: "打开 Story" }).click();
    await page.waitForURL(/\/stories\//u);
    const title = page.locator("[data-story-id]");
    await expect(title).toBeVisible();
    const storyId = await title.getAttribute("data-story-id");
    if (storyId === null) {
        throw new Error("阅读页没有 data-story-id");
    }
    return storyId;
}

/** 读取侧与录入是两条路径：等这一条来源的 Story 真的可读。 */
export async function waitForStoryIds(
    page: Page,
    sourceName: string,
    expected = 1,
): Promise<string[]> {
    const deadline = Date.now() + 180_000;
    while (Date.now() < deadline) {
        const response = await page.request.get("/api/v1/feed?limit=50");
        if (response.ok()) {
            const body = await response.json() as { items?: { storyId: string; sourceName: string }[] };
            const ids = [...new Set(
                (body.items ?? [])
                    .filter((item) => item.sourceName === sourceName)
                    .map((item) => item.storyId),
            )];
            if (ids.length >= expected) {
                return ids;
            }
        }
        await page.waitForTimeout(2_000);
    }
    throw new Error(`等待 Story 落库超时：${sourceName}（期望 ${expected} 条）`);
}

export async function waitForStoryId(page: Page, sourceName: string): Promise<string> {
    const [first] = await waitForStoryIds(page, sourceName, 1);
    return first;
}

/**
 * 打开阅读页。id 含冒号，路由段必须编码：不编码会让 Next 把 id 截断。
 * 打开后等正文卡片出现，后续断言才有稳定的起点。
 */
export async function openStory(page: Page, storyId: string): Promise<Locator> {
    await page.goto(`/stories/${encodeURIComponent(storyId)}`);
    const title = page.locator("[data-story-id]");
    await expect(title).toBeVisible();
    return title;
}

/** 阅读页的「编辑与关联」面：默认收起，写入动作要先展开。 */
export async function expandEditSurface(page: Page): Promise<Locator> {
    const section = page.locator('section[aria-label="编辑与关联"]');
    await expect(section).toBeVisible();
    const expand = section.getByRole("button", { name: "展开", exact: true });
    if (await expand.count() > 0) {
        await expand.click();
    }
    return section;
}

/** 首页看板上的某个区块（按 `data-block-type`）。 */
export function boardBlock(page: Page, type: string): Locator {
    return page.locator(`[data-block-type="${type}"]`).first();
}

/** 进入首页的看板编辑模式。 */
export async function enterBoardEditing(page: Page): Promise<void> {
    await page.goto("/");
    await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
    await page.getByRole("button", { name: "编辑看板", exact: true }).click();
}

/** 汇总控制台错误，供 spec 断言「零控制台错误」。 */
export function collectConsoleErrors(page: Page): string[] {
    const errors: string[] = [];
    page.on("console", (message) => {
        if (message.type() === "error") {
            errors.push(message.text());
        }
    });
    return errors;
}

/**
 * 归并另一条 Story 进来，造出**多成员 Story**。
 *
 * 这是唯一的造法：Entry 按 `(sourceInstanceId, canonicalExternalId)` 唯一、Story id 由
 * `story:<entryId>` 派生，所以「两个来源录同一份 feed」只会得到各自独立的 Story，
 * 不会自动合成一条（实测 6 条）。拆分表单与「来源成员（N）」都需要多成员。
 *
 * 调用前页面必须已经在**归并目标**那条 Story 的阅读页上。
 */
/**
 * 在归并选择器里选出目标 Story。
 *
 * 归并入口在 Task 36 切片 B 从「粘贴内部 Story ID」改成了可搜索的选择列表（判据 R3）。
 * 这里**不依赖搜索**：先直接用完整标题在初始候选里选（打开就有最近 20 条），
 * 选不到再用标题前几个字搜索兜底。理由是服务端搜索按空白拆词、每段当字面短语，
 * 拿标题片段去搜可能一条都命中不到（实测「Message with」对不上「Message without a web URL」），
 * 而那属于搜索语义、不是这条归并合同要验的东西。
 */
export async function pickMergeTarget(
    page: Page,
    section: Locator,
    title: string,
): Promise<void> {
    const picker = section.getByPlaceholder("搜索标题…");
    await picker.click();
    const option = page.getByRole("option", { name: new RegExp(escapeRegExp(title), "u") }).first();
    try {
        await option.waitFor({ state: "visible", timeout: 5_000 });
    } catch {
        await picker.fill(mergeSearchTerm(title));
    }
    await option.click();
    /*
     * 选中后输入框必须回填**完整标题**，而不是留下的搜索词（维护者 D5 验收发现：
     * 搜「派评」选中后框里还是「派评」，看不出到底选中了哪一条）。
     * 放在这个共用入口上，是因为每一处归并都经过它。
     */
    await expect(picker).toHaveValue(title);
}

function escapeRegExp(value: string): string {
    return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/** 搜索兜底词：取标题前若干字符，既能在搜索里命中，又不会长到搜不到。 */
export function mergeSearchTerm(title: string): string {
    return title.slice(0, 6);
}

export async function mergeStoryInto(
    page: Page,
    obsoleteStoryId: string,
    expectedMembers = 2,
): Promise<void> {
    const section = await expandEditSurface(page);
    // 先读出目标的真实标题：选择器按标题定位，粘贴 id 的时代已经过去。
    const response = await page.request.get(`/api/v1/stories/${encodeURIComponent(obsoleteStoryId)}`);
    expect(response.ok(), `读取归并目标失败：${obsoleteStoryId}`).toBe(true);
    const body = await response.json() as { story: { title: string } };
    await pickMergeTarget(page, section, body.story.title);
    await section.getByRole("button", { name: "归并", exact: true }).click();
    await expect(page.getByText(new RegExp(`来源成员（${expectedMembers}）`, "u")))
        .toBeVisible({ timeout: 15_000 });
}

export type StoryMemberSnapshot = {
    entryId: string;
    title: string;
    sourceName: string;
};

export type StorySnapshot = {
    id: string;
    title: string;
    status: string;
    members: StoryMemberSnapshot[];
    /** 证据关系（entryId + relationType），用于断言「加了/解了证据」。 */
    evidence: { entryId: string; relationType: string }[];
};

/**
 * 从读取侧取 Story 详情。
 *
 * 读端点走的是与页面同一个同源代理（`/api/v1`），因此断言的是**服务端真正落库的形状**，
 * 而不是界面自己渲染出来的样子——「同一操作的数据与领域事件一致」这类断言需要前者。
 */
export async function readStoryDetail(page: Page, storyId: string): Promise<StorySnapshot> {
    const response = await page.request.get(`/api/v1/stories/${encodeURIComponent(storyId)}`);
    if (!response.ok()) {
        throw new Error(`读取 Story 失败：${response.status()} ${storyId}`);
    }
    const body = await response.json() as {
        story: { id: string; title: string; status: string };
        entries: {
            id: string;
            sourceName: string;
            revisions: { title: string }[];
        }[];
        evidence: { entryId: string; relationType: string }[];
    };
    return {
        id: body.story.id,
        title: body.story.title,
        status: body.story.status,
        members: body.entries.map((entry) => ({
            entryId: entry.id,
            title: entry.revisions[0]?.title ?? "",
            sourceName: entry.sourceName,
        })),
        evidence: body.evidence.map((item) => ({
            entryId: item.entryId,
            relationType: item.relationType,
        })),
    };
}
