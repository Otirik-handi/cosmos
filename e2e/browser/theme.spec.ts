import {expect, test} from "@playwright/test";
import type {Page} from "@playwright/test";

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

    async function loadWithClearedPreference(page: Page): Promise<void> {
        await page.goto("/");
        await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
        await page.reload();
        await expect(page.getByRole("heading", {name: "Cosmos"})).toBeVisible();
    }

    async function documentTheme(page: Page) {
        return page.evaluate(() => ({
            theme: document.documentElement.dataset.cosmosTheme ?? null,
            colorway: document.documentElement.dataset.cosmosColorway ?? null,
            dark: document.documentElement.classList.contains("dark"),
            colorScheme: document.documentElement.style.colorScheme || null,
        }));
    }

    test("follows the light system preference before any stored override", async ({page}) => {
        await page.emulateMedia({colorScheme: "light"});
        await loadWithClearedPreference(page);

        expect(await documentTheme(page)).toEqual({
            theme: "neurobook",
            colorway: "macos-light",
            dark: false,
            colorScheme: "light",
        });
        expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
        expect(hydrationIssues).toEqual([]);
    });

    test("follows the dark system preference before any stored override", async ({page}) => {
        await page.emulateMedia({colorScheme: "dark"});
        await loadWithClearedPreference(page);

        expect(await documentTheme(page)).toEqual({
            theme: "neurobook",
            colorway: "macos-night",
            dark: true,
            colorScheme: "dark",
        });
        expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();
        expect(hydrationIssues).toEqual([]);
    });

    test("falls back to macOS light when localStorage is unavailable", async ({page}) => {
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
        await expect(page.getByRole("heading", {name: "Cosmos"})).toBeVisible();

        expect(await documentTheme(page)).toEqual({
            theme: "neurobook",
            colorway: "macos-light",
            dark: false,
            colorScheme: "light",
        });
        expect(hydrationIssues).toEqual([]);
    });

    test("falls back to macOS light when matchMedia is unavailable", async ({page}) => {
        await page.addInitScript(({key}) => {
            window.localStorage.setItem(key, "macos-night");
            Object.defineProperty(window, "matchMedia", {
                configurable: true,
                get() {
                    throw new Error("matchMedia blocked");
                },
            });
        }, {key: STORAGE_KEY});
        await page.goto("/");
        await expect(page.getByRole("heading", {name: "Cosmos"})).toBeVisible();

        expect(await documentTheme(page)).toEqual({
            theme: "neurobook",
            colorway: "macos-light",
            dark: false,
            colorScheme: "light",
        });

        // 运行期显式选择不受降级媒体查询影响。
        await page.getByRole("button", {name: "macOS Night"}).click();
        await expect.poll(() => documentTheme(page)).toMatchObject({colorway: "macos-night"});
        expect(hydrationIssues).toEqual([]);
    });

    test("persists an explicit night choice and restores it across reloads", async ({page}) => {
        await page.emulateMedia({colorScheme: "light"});
        await loadWithClearedPreference(page);

        const backgroundBefore = await page.evaluate(
            () => getComputedStyle(document.body).backgroundColor,
        );

        await page.getByRole("button", {name: "macOS Night"}).click();

        await expect.poll(() => documentTheme(page)).toEqual({
            theme: "neurobook",
            colorway: "macos-night",
            dark: true,
            colorScheme: "dark",
        });
        expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
            .toBe("macos-night");

        const backgroundAfter = await page.evaluate(
            () => getComputedStyle(document.body).backgroundColor,
        );
        expect(backgroundAfter).not.toBe(backgroundBefore);

        await page.reload();
        await expect(page.getByRole("heading", {name: "Cosmos"})).toBeVisible();
        expect(await documentTheme(page)).toMatchObject({colorway: "macos-night"});

        // Explicit choice must win over later OS changes.
        await page.emulateMedia({colorScheme: "light"});
        expect(await documentTheme(page)).toMatchObject({colorway: "macos-night"});

        await page.getByRole("button", {name: "跟随系统"}).click();
        await expect.poll(() => documentTheme(page)).toMatchObject({
            colorway: "macos-light",
            dark: false,
        });
        expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY)).toBeNull();

        await page.emulateMedia({colorScheme: "dark"});
        await expect.poll(() => documentTheme(page)).toMatchObject({
            colorway: "macos-night",
            dark: true,
        });
        expect(hydrationIssues).toEqual([]);
    });

    for (const width of [390, 1440]) {
        test(`keeps the home page free of horizontal overflow at ${width}px`, async ({page}) => {
            await page.setViewportSize({width, height: width === 390 ? 844 : 900});
            await page.goto("/");
            await expect(page.getByRole("heading", {name: "Cosmos"})).toBeVisible();
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
