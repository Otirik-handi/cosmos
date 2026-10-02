import {expect, test} from "@playwright/test";
import {expectSinglePreview} from "../support/lab";
import {verifiedWidths} from "../support/viewports";

const STORAGE_KEY = "cosmos.theme.preference.v1";
const HYDRATION_ERROR_PATTERN = /hydration|hydrated|server rendered HTML/iu;

test.describe("component lab theme", () => {
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
        await page.goto("/dev/components");
        await page.evaluate((key) => window.localStorage.removeItem(key), STORAGE_KEY);
    });

    test("persists a global preference that themes the lab chrome", async ({page}) => {
        await page.emulateMedia({colorScheme: "light"});
        await page.goto("/dev/components");
        await expect(page.getByRole("heading", {name: "Cosmos Component Lab"})).toBeVisible();

        // 单一明暗轴（ADR-0029 决策 5）：只有一个 data-cosmos-appearance。
        await expect(page.locator("html")).toHaveAttribute("data-cosmos-appearance", "light");

        const switcher = page.getByRole("group", {name: "外观主题"});
        await switcher.getByRole("button", {name: "暗色"}).click();

        await expect.poll(() =>
            page.evaluate(() => document.documentElement.dataset.cosmosAppearance ?? ""),
        ).toBe("dark");
        expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
            .toBe("dark");

        const systemButton = switcher.getByRole("button", {name: "跟随系统"});
        await systemButton.focus();
        await page.keyboard.press("Enter");

        await expect.poll(() =>
            page.evaluate(() => document.documentElement.dataset.cosmosAppearance ?? ""),
        ).toBe("light");
        expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
            .toBeNull();
        expect(hydrationIssues).toEqual([]);
    });

    test("keeps the URL preview appearance independent from the global chrome", async ({page}) => {
        await page.emulateMedia({colorScheme: "light"});
        await page.evaluate((key) => window.localStorage.setItem(key, "dark"), STORAGE_KEY);
        await page.goto("/dev/components?component=button&scene=default&viewport=responsive&appearance=light");
        await expect(page.getByRole("heading", {name: "Cosmos Component Lab"})).toBeVisible();

        await expect(page.locator("html")).toHaveAttribute("data-cosmos-appearance", "dark");
        const preview = await expectSinglePreview(page);
        await expect(preview).toHaveAttribute("data-cosmos-appearance", "light");
        await expect(preview).not.toHaveClass(/dark/u);

        // Token 草稿只作用于预览：这里用控件圆角档（--radius-control）验证。
        await page.locator("#lab-token---radius-control").fill("2rem");
        await page.keyboard.press("Tab");

        await expect(preview).toHaveAttribute("style", /--radius-control/u);
        expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--radius-control")))
            .toBe("");
        expect(hydrationIssues).toEqual([]);
    });

    test("applies the dark preview class locally without darkening the chrome", async ({page}) => {
        await page.emulateMedia({colorScheme: "light"});
        await page.goto("/dev/components?component=button&scene=default&viewport=responsive&appearance=dark");
        await expect(page.getByRole("heading", {name: "Cosmos Component Lab"})).toBeVisible();

        const preview = await expectSinglePreview(page);
        await expect(preview).toHaveAttribute("data-cosmos-appearance", "dark");
        await expect(preview).toHaveClass(/dark/u);
        await expect(page.locator("html")).toHaveAttribute("data-cosmos-appearance", "light");
        expect(hydrationIssues).toEqual([]);
    });

    for (const width of verifiedWidths([390, 768, 1024, 1440])) {
        test(`keeps the lab free of horizontal overflow at ${width}px`, async ({page}) => {
            await page.setViewportSize({width, height: width === 390 ? 844 : 900});
            await page.goto("/dev/components");
            await expect(page.getByRole("heading", {name: "Cosmos Component Lab"})).toBeVisible();
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
