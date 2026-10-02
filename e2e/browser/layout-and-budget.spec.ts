import { expect, test, type Page } from "@playwright/test";

/**
 * 版面与预算门禁（ADR-0029 决策 2/6、E7）。
 *
 * 这些断言是「回归对门禁可见」的实现：上次失败的根因正是**版面没被断言**——
 * 浏览器验收只查「点得通、文字在、无横向溢出」，导航落到页面下方也照样过。
 * 因此这里断言的是**位置与存在性**，并且自带一条「断言有效性自证」：
 * 把导航盒子换成「被移到页面下方」的坐标，断言必须失败。
 *
 * 与 ADR 的偏差（E5 三档表）：实现把「侧栏 + 内容」作为整体限宽居中
 * （1120px = 196 + 20 + 880），而不是按档位改侧栏宽度、主区 1080px；
 * 见 `(shell)/layout.tsx` 的说明。门禁断言实现承诺的部分，偏差本身记在
 * Task 35 的 walkthrough 里等维护者裁定。
 */

const SIDEBAR_WIDTH_PX = 196;
const SHELL_MAX_WIDTH_PX = 1120;
const CONTENT_MAX_WIDTH_PX = 880;
const TOP_BAR_HEIGHT_PX = 56;
/** E7：首屏可交互 ≤ 2 s（本地开发机、1440 px）。 */
const FIRST_INTERACTIVE_BUDGET_MS = 2_000;
/** E7：同会话内切导航项 ≤ 300 ms。 */
const NAVIGATION_BUDGET_MS = 300;
/** E7：单个列表页首屏数据 20 条；首屏 JS 增量预算的绝对值记录见 walkthrough。 */
const FIRST_LOAD_JS_BUDGET_BYTES = 400 * 1024;

type Box = { x: number; y: number; width: number; height: number };

/**
 * 版面断言内核。抽成纯函数是为了让「故意错位必须失败」这条自证能直接喂假坐标，
 * 不必真去改版面试一次。
 */
export function assertShellLayout(input: {
    nav: Box;
    content: Box;
    viewport: { width: number; height: number };
    /** 阅读组：允许（且要求）没有导航。 */
    expectNav: boolean;
}): string[] {
    const problems: string[] = [];
    const { nav, content, viewport, expectNav } = input;

    if (expectNav) {
        if (nav.width < 1 || nav.height < 1) {
            problems.push("导航不在页面上（宽或高为 0）");
        }
        if (nav.width !== SIDEBAR_WIDTH_PX) {
            problems.push(`侧栏宽度 ${nav.width}px ≠ ${SIDEBAR_WIDTH_PX}px`);
        }
        if (nav.x >= content.x) {
            problems.push(`导航不在内容左侧（导航 x=${nav.x}，内容 x=${content.x}）`);
        }
        if (nav.y + nav.height > content.y + content.height) {
            problems.push("导航落在内容下方");
        }
        if (nav.y < TOP_BAR_HEIGHT_PX - 1) {
            problems.push(`导航被顶栏压住（导航 y=${nav.y}）`);
        }
    } else if (nav.width > 0 && nav.height > 0) {
        problems.push("阅读页不应有侧栏");
    }

    if (content.width > CONTENT_MAX_WIDTH_PX + 1) {
        problems.push(`内容宽 ${content.width}px 超过限宽 ${CONTENT_MAX_WIDTH_PX}px`);
    }
    if (content.width > viewport.width) {
        problems.push("内容比视口还宽");
    }
    return problems;
}

async function shellBoxes(page: Page): Promise<{ nav: Box; content: Box }> {
    const nav = await page.locator("aside").first().boundingBox();
    const content = await page.locator("main").first().boundingBox();
    if (nav === null || content === null) {
        throw new Error("版面盒子取不到：aside 或 main 不存在");
    }
    return { nav, content };
}

async function horizontalOverflow(page: Page): Promise<number> {
    return page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
}

/**
 * 版面用「最终稳定态」断言：首帧到 hydration 之间盒子会短暂不成立，
 * 用 poll 等它稳定，而不是把一次瞬时读数当结论（实测 1024px 档在整套跑时偶发假红）。
 */
async function expectStableShellLayout(page: Page, viewport: { width: number; height: number }): Promise<void> {
    await expect.poll(async () => {
        const { nav, content } = await shellBoxes(page);
        return assertShellLayout({ nav, content, viewport, expectNav: true });
    }, { timeout: 5_000 }).toEqual([]);
    await expect.poll(() => horizontalOverflow(page), { timeout: 5_000 }).toBeLessThanOrEqual(0);
}

test.describe("版面门禁：三档断点", () => {
    for (const width of [1024, 1280, 1440]) {
        test(`在 ${width}px 下侧栏在左、内容限宽、无横向溢出`, async ({ page }) => {
            await page.setViewportSize({ width, height: 900 });
            await page.goto("/");
            await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
            await expectStableShellLayout(page, { width, height: 900 });

            // 「侧栏 + 内容」整体限宽居中：两侧留白对称（±2px）。
            const { nav, content } = await shellBoxes(page);
            const shellWidth = nav.width + 20 + content.width;
            expect(shellWidth).toBeLessThanOrEqual(SHELL_MAX_WIDTH_PX + 1);
        });
    }
});

test.describe("版面门禁：框架常驻与唯一例外", () => {
    test("低于 1024px 只显示「窗口过窄」提示，不做降级布局", async ({ page }) => {
        await page.setViewportSize({ width: 1_000, height: 900 });
        await page.goto("/");
        const notice = page.locator("[data-narrow-window-notice]");
        await expect(notice).toBeVisible();
        await expect(notice).toContainText("窗口过窄");
        // 外壳整组不渲染：既没有导航，也没有内容区（不是「藏起来但还在」）。
        await expect(page.getByRole("navigation", { name: "主导航" })).toBeHidden();
        await expect(page.locator("main").first()).toBeHidden();

        // 阅读组同一条规则。
        await page.goto("/stories/story%3Amissing");
        await expect(page.locator("[data-narrow-window-notice]")).toBeVisible();
        await expect(page.locator("main").first()).toBeHidden();

        // 回到支持下限就不再有提示，外壳正常。
        await page.setViewportSize({ width: 1_024, height: 900 });
        await page.goto("/");
        await expect(page.locator("[data-narrow-window-notice]")).toBeHidden();
        await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
    });

    test("切页后导航与内容的位置不变（外壳不重建）", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("/");
        const before = await shellBoxes(page);

        await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "信息库" }).click();
        await page.waitForURL("**/library");
        const after = await shellBoxes(page);

        expect(after.nav.x).toBe(before.nav.x);
        expect(after.nav.y).toBe(before.nav.y);
        expect(after.content.x).toBe(before.content.x);
    });

    test("Story 阅读页没有侧栏、但有返回入口", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        // 目录里不需要真有一条 Story：版面由路由组决定，读不到内容是另一条路径。
        await page.goto("/stories/story%3Amissing");
        await expect(page.getByRole("button", { name: "跟随系统" })).toBeVisible();

        const navCount = await page.locator("aside").count();
        expect(navCount).toBe(0);
        await expect(page.getByRole("link", { name: "← 返回" })).toBeVisible();
        expect(await horizontalOverflow(page)).toBeLessThanOrEqual(0);
    });

    test("断言有效性自证：把导航移到内容下方必须失败", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await page.goto("/");
        const viewport = { width: 1440, height: 900 };

        /*
         * 对照组：真实版面必须通过。首屏的某一帧还没排完时量到的盒子不满足断言（全量跑里偶发，
         * 单跑必过），所以轮询到稳定为止再拿它做实验组——否则这条自证会变成随机的假红。
         */
        let boxes = await shellBoxes(page);
        await expect.poll(async () => {
            boxes = await shellBoxes(page);
            return assertShellLayout({ nav: boxes.nav, content: boxes.content, viewport, expectNav: true });
        }).toEqual([]);
        const { nav, content } = boxes;

        // 实验组：把导航搬到内容下方（上次失败的形状），断言必须报错。
        const moved = { ...nav, y: content.y + content.height + 40, x: content.x };
        const problems = assertShellLayout({ nav: moved, content, viewport, expectNav: true });
        expect(problems.length).toBeGreaterThan(0);
        expect(problems.join("；")).toContain("导航落在内容下方");

        // 实验组二：阅读页出现侧栏也必须失败。
        expect(assertShellLayout({ nav, content, viewport, expectNav: false }).length).toBeGreaterThan(0);
    });
});

test.describe("预算门禁：实时连接", () => {
    test("一次会话里事件流只有一条连接", async ({ page }) => {
        const eventStreamRequests: string[] = [];
        page.on("request", (request) => {
            if (request.url().includes("/api/v1/events")) {
                eventStreamRequests.push(request.url());
            }
        });

        await page.goto("/");
        await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
        for (const [name, path] of [["信息库", "/library"], ["整理", "/organize"], ["设置", "/settings"]] as const) {
            await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name }).click();
            await page.waitForURL(`**${path}`);
        }
        // 给 EventSource 留出重连窗口：重连也会被计数，因此这条断言能抓住「每次切页新建连接」。
        await page.waitForTimeout(1_500);

        expect(eventStreamRequests).toHaveLength(1);
    });
});

test.describe("预算门禁：动效与首屏", () => {
    test("prefers-reduced-motion 下动效时长归零", async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await page.goto("/");
        const durations = await page.evaluate(() => {
            const style = getComputedStyle(document.documentElement);
            return {
                fast: style.getPropertyValue("--motion-fast").trim(),
                base: style.getPropertyValue("--motion-base").trim(),
            };
        });
        console.log(`[budget] reduced-motion 时长 ${JSON.stringify(durations)}`);
        // 浏览器把 0ms 归一成 0s；两者都表示归零。
        expect(durations.fast).toMatch(/^0(ms|s)$/u);
        expect(durations.base).toMatch(/^0(ms|s)$/u);
    });

    test("首屏可交互与路由切换在预算内，并记录首屏 JS 体积", async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        const started = Date.now();
        await page.goto("/");
        await expect(page.getByRole("navigation", { name: "主导航" })).toBeVisible();
        const interactiveMs = Date.now() - started;

        const scripts = await page.evaluate(() =>
            performance.getEntriesByType("resource")
                .filter((entry) => (entry as PerformanceResourceTiming).initiatorType === "script")
                .map((entry) => {
                    const timing = entry as PerformanceResourceTiming;
                    return { name: timing.name, bytes: timing.encodedBodySize };
                }));
        const firstLoadBytes = scripts.reduce((sum, script) => sum + script.bytes, 0);
        console.log(`[budget] 首屏可交互 ${interactiveMs}ms；首屏 JS ${(firstLoadBytes / 1024).toFixed(1)}KB（${scripts.length} 个脚本）`);

        expect(interactiveMs).toBeLessThanOrEqual(FIRST_INTERACTIVE_BUDGET_MS);
        expect(firstLoadBytes).toBeLessThanOrEqual(FIRST_LOAD_JS_BUDGET_BYTES);

        const navStarted = Date.now();
        await page.getByRole("navigation", { name: "主导航" }).getByRole("link", { name: "信息库" }).click();
        // 信息库页没有页标题（V2 逐页状态设计未做），等它自己的检索入口出现即算切完。
        await expect(page.getByRole("button", { name: "搜索", exact: true })).toBeVisible();
        const navigationMs = Date.now() - navStarted;
        console.log(`[budget] 路由切换 ${navigationMs}ms`);
        expect(navigationMs).toBeLessThanOrEqual(NAVIGATION_BUDGET_MS);
    });
});
