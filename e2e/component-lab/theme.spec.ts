import {expect, test} from "@playwright/test";

const STORAGE_KEY = "cosmos.theme.preference.v1";
const HYDRATION_ERROR_PATTERN = /hydration|hydrated|server rendered HTML/iu;
const PREVIEW_ROOT = "[data-component-lab-preview]";

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

        await expect(page.locator("html")).toHaveAttribute("data-cosmos-theme", "neurobook");
        await expect(page.locator("html")).toHaveAttribute("data-cosmos-colorway", "macos-light");

        await page.locator("header").getByRole("button", {name: "macOS Night"}).click();

        await expect.poll(() =>
            page.evaluate(() => document.documentElement.dataset.cosmosColorway ?? ""),
        ).toBe("macos-night");
        expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
            .toBe("macos-night");

        const systemButton = page.getByRole("button", {name: "跟随系统"});
        await systemButton.focus();
        await page.keyboard.press("Enter");

        await expect.poll(() =>
            page.evaluate(() => document.documentElement.dataset.cosmosColorway ?? ""),
        ).toBe("macos-light");
        expect(await page.evaluate((key) => window.localStorage.getItem(key), STORAGE_KEY))
            .toBeNull();
        expect(hydrationIssues).toEqual([]);
    });

    test("keeps the URL preview colorway independent from the global chrome", async ({page}) => {
        await page.emulateMedia({colorScheme: "light"});
        await page.evaluate((key) => window.localStorage.setItem(key, "macos-night"), STORAGE_KEY);
        await page.goto("/dev/components?component=button&scene=default&theme=neurobook&colorway=macos-light");
        await expect(page.getByRole("heading", {name: "Cosmos Component Lab"})).toBeVisible();

        await expect(page.locator("html")).toHaveAttribute("data-cosmos-colorway", "macos-night");
        const preview = page.locator(PREVIEW_ROOT);
        await expect(preview).toHaveAttribute("data-cosmos-theme", "neurobook");
        await expect(preview).toHaveAttribute("data-cosmos-colorway", "macos-light");
        await expect(preview).not.toHaveClass(/dark/u);

        await page.locator("#lab-token---radius").fill("2rem");
        await page.keyboard.press("Tab");

        await expect(preview).toHaveAttribute("style", /--radius/u);
        expect(await page.evaluate(() => document.documentElement.style.getPropertyValue("--radius")))
            .toBe("");
        expect(hydrationIssues).toEqual([]);
    });

    test("applies the night preview class locally without darkening the chrome", async ({page}) => {
        await page.emulateMedia({colorScheme: "light"});
        await page.goto("/dev/components?component=button&scene=default&theme=neurobook&colorway=macos-night");
        await expect(page.getByRole("heading", {name: "Cosmos Component Lab"})).toBeVisible();

        const preview = page.locator(PREVIEW_ROOT);
        await expect(preview).toHaveAttribute("data-cosmos-colorway", "macos-night");
        await expect(preview).toHaveClass(/dark/u);
        await expect(page.locator("html")).toHaveAttribute("data-cosmos-colorway", "macos-light");
        expect(hydrationIssues).toEqual([]);
    });

    for (const width of [390, 768, 1024, 1440]) {
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
