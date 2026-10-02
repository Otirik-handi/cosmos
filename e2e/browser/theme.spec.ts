import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";
import {verifiedWidths} from "../support/viewports";

const STORAGE_KEY = "cosmos.theme.preference.v1";
const HYDRATION_ERROR_PATTERN = /hydration|hydrated|server rendered HTML/iu;

test.describe("production home theme", () => {
    let hydrationIssues: string[] = [];

    test.beforeEach(async ({page}) => {
        hydrationIssues = [];
        page.on("console", (message) => {
            if (message.type() === "error" && HYDRATION_ERROR_PATTERN.test(message.text())) {
                hydrationIssues.push(message.text());
            }
        });
        page.on("pageerror", (error) => {
            if (HYDRATION_ERROR_PATTERN.test(error.message)) {
                hydrationIssues.push(error.message);
            }
        });
    });

    /** 首页没有页面级标题（ADR-0029 决策 3）；主导航是外壳里稳定的首屏锚点。 */
    async function expectShellReady(page: Page): Promise<void> {
        await expect(page.getByRole("navigation", {name: "主导航"})).toBeVisible();
    }

    async function loadWithClearedPreference(page: Page): Promise<void> {
        await page.goto("/");
        await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
        await page.reload();
        await expectShellReady(page);
    }

    /**
     * 单一明暗轴（ADR-0029 决策 5）：只读 `data-cosmos-appearance`，
     * 旧的两套轴 `theme × colorway` 已删除。
     */
    async function documentTheme(page: Page) {
        return page.evaluate(() => ({
            appearance: document.documentElement.dataset.cosmosAppearance ?? null,
            dark: document.documentElement.classList.contains("dark"),
            colorScheme: document.documentElement.style.colorScheme || null,
        }));
    }

    test("follows the light system preference before any stored override", async ({page}) => {
        await page.emulateMedia({colorScheme: "light"});
        await loadWithClearedPreference(page);

        expect(await documentTheme(page)).toEqual({
            appearance: "light",
            dark: false,
            colorScheme: "light",
        });
        // 旧轴是**被删掉**的，不是换了个名字：两个属性都不再写到 <html> 上。
        expect(await page.evaluate(() => [
            document.documentElement.getAttribute("data-cosmos-theme"),
            document.documentElement.getAttribute("data-cosmos-colorway"),
        ])).toEqual([null, null]);
        expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
        expect(hydrationIssues).toEqual([]);
    });

    test("follows the dark system preference before any stored override", async ({page}) => {
        await page.emulateMedia({colorScheme: "dark"});
        await loadWithClearedPreference(page);

        expect(await documentTheme(page)).toEqual({
            appearance: "dark",
            dark: true,
            colorScheme: "dark",
        });
        expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
        expect(hydrationIssues).toEqual([]);
    });

    test("treats an unrecognized stored preference as system", async ({page}) => {
        await page.emulateMedia({colorScheme: "dark"});
        await page.addInitScript(({key}) => {
            window.localStorage.setItem(key, "sepia");
        }, {key: STORAGE_KEY});
        await page.goto("/");
        await expectShellReady(page);

        // 旧两套轴写入的取值（已下线的配色名）属于「无法识别」这一类：
        // 按 theme.ts 的约定落回 system，于是跟随系统明暗而不是回退亮色。
        expect(await documentTheme(page)).toEqual({
            appearance: "dark",
            dark: true,
            colorScheme: "dark",
        });
        const switcher = page.getByRole("group", {name: "外观主题"});
        await expect(switcher.getByRole("button", {name: "跟随系统"}))
            .toHaveAttribute("aria-pressed", "true");
        expect(hydrationIssues).toEqual([]);
    });

    test("falls back to a light appearance when localStorage is unavailable", async ({page}) => {
        await page.addInitScript(() => {
            Object.defineProperty(window, "localStorage", {
                configurable: true,
                get() {
                    throw new Error("storage blocked");
                },
            });
        });
        await page.emulateMedia({colorScheme: "dark"});
        await page.goto("/");
        await expectShellReady(page);

        // 读不到偏好时不能假装知道系统明暗：按合同回退亮色，而不是跟随系统暗色。
        expect(await documentTheme(page)).toEqual({
            appearance: "light",
            dark: false,
            colorScheme: "light",
        });
        expect(hydrationIssues).toEqual([]);
    });

    test("falls back to a light appearance when matchMedia is unavailable", async ({page}) => {
        await page.addInitScript(({key}) => {
            window.localStorage.setItem(key, "dark");
            Object.defineProperty(window, "matchMedia", {
                configurable: true,
                get() {
                    throw new Error("matchMedia blocked");
                },
            });
        }, {key: STORAGE_KEY});
        await page.goto("/");
        await expectShellReady(page);

        // 媒体查询不可用时连**已存储的显式偏好**也回退亮色：系统明暗此时不可知。
        expect(await documentTheme(page)).toEqual({
            appearance: "light",
            dark: false,
            colorScheme: "light",
        });

        // 运行期显式选择不受降级媒体查询影响。
        await page.getByRole("group", {name: "外观主题"}).getByRole("button", {name: "暗色"}).click();
        await expect.poll(() => documentTheme(page)).toMatchObject({appearance: "dark"});
        expect(hydrationIssues).toEqual([]);
    });

    test("persists an explicit dark choice and restores it across reloads", async ({page}) => {
        await page.emulateMedia({colorScheme: "light"});
        await loadWithClearedPreference(page);

        const backgroundBefore = await page.evaluate(
            () => getComputedStyle(document.body).backgroundColor,
        );

        const switcher = page.getByRole("group", {name: "外观主题"});
        await switcher.getByRole("button", {name: "暗色"}).click();

        await expect.poll(() => documentTheme(page)).toEqual({
            appearance: "dark",
            dark: true,
            colorScheme: "dark",
        });
        expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
            .toBe("dark");

        const backgroundAfter = await page.evaluate(
            () => getComputedStyle(document.body).backgroundColor,
        );
        expect(backgroundAfter).not.toBe(backgroundBefore);

        await page.reload();
        await expectShellReady(page);
        expect(await documentTheme(page)).toMatchObject({appearance: "dark"});

        // Explicit choice must win over later OS changes.
        await page.emulateMedia({colorScheme: "light"});
        expect(await documentTheme(page)).toMatchObject({appearance: "dark"});

        await switcher.getByRole("button", {name: "跟随系统"}).click();
        await expect.poll(() => documentTheme(page)).toMatchObject({
            appearance: "light",
            dark: false,
        });
        expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();

        await page.emulateMedia({colorScheme: "dark"});
        await expect.poll(() => documentTheme(page)).toMatchObject({
            appearance: "dark",
            dark: true,
        });
        expect(hydrationIssues).toEqual([]);
    });

    for (const width of verifiedWidths([390, 1440])) {
        test(`keeps the home page free of horizontal overflow at ${width}px`, async ({page}) => {
            await page.setViewportSize({width, height: width === 390 ? 844 : 900});
            await page.goto("/");
            await expectShellReady(page);
            await expect(page.getByRole("button", {name: "跟随系统"})).toBeVisible();

            const scroll = await page.evaluate(() => ({
                scrollWidth: document.documentElement.scrollWidth,
                clientWidth: document.documentElement.clientWidth,
            }));
            expect(scroll.scrollWidth).toBeLessThanOrEqual(scroll.clientWidth);
            expect(hydrationIssues).toEqual([]);
        });
    }
});
