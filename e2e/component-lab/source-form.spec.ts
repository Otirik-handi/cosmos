import {expect, test} from "@playwright/test";

test("updates SourceForm preview when inspector props change", async ({page}) => {
    await page.goto("/dev/components?component=source-form&scene=default");
    await expect(page.getByRole("button", {name: "SourceForm", exact: true})).toBeVisible();

    const previewName = page.locator("#source-name");
    await expect(previewName).toHaveValue("Cosmos RSS");
    const previewFeedUrl = page.locator("#source-feed-url");
    await page.locator("#lab-control-source-form-feedUrl").fill("https://example.test/updated.xml");
    await expect(previewFeedUrl).toHaveValue("https://example.test/updated.xml");
    await page.locator("#lab-control-source-form-name").fill("Updated RSS");
    await expect(previewName).toHaveValue("Updated RSS");
    await page.locator("#source-name").fill("User editing");
    await expect(page.locator("#source-name")).toHaveValue("User editing");
});

test("keeps SourceForm RSS submission inside the lab", async ({page}) => {
    await page.goto("/dev/components?component=source-form&scene=default");
    await expect(page).toHaveURL(/viewport=responsive&theme=neurobook&colorway=macos-light/u);
    const initialUrl = page.url();
    let navigationRequests = 0;
    page.on("request", (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            navigationRequests += 1;
        }
    });

    await page.getByRole("button", {name: "保存来源"}).click();
    await expect(page).toHaveURL(initialUrl);

    expect(page.url()).toBe(initialUrl);
    expect(navigationRequests).toBe(0);
    await expect(page.locator("#source-name")).toBeVisible();
});

test("keeps FeedBrowser fixture search inside the lab", async ({page}) => {
    await page.goto("/dev/components?component=feed-browser&scene=populated");
    await expect(page).toHaveURL(/viewport=responsive&theme=neurobook&colorway=macos-light/u);
    const initialUrl = page.url();
    let navigationRequests = 0;
    page.on("request", (request) => {
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) {
            navigationRequests += 1;
        }
    });

    await page.getByRole("button", {name: "搜索", exact: true}).click();
    await expect(page).toHaveURL(initialUrl);
    expect(navigationRequests).toBe(0);
    await expect(page.getByText("Cosmos fixture story")).toBeVisible();
});

test("preserves a restored token when its field blurs without editing", async ({page}) => {
    const storageKey = "cosmos.component-lab.token-draft.v1";
    const storageValue = '{"overrides":{"--radius":"1rem"},"version":1}';
    await page.goto("/dev/components?component=button&scene=default");
    await page.evaluate(({key, value}) => {
        window.localStorage.setItem(key, value);
    }, {key: storageKey, value: storageValue});
    await page.reload();

    const tokenInput = page.locator("#lab-token---radius");
    await expect(tokenInput).toHaveValue("1rem");
    await tokenInput.focus();
    await page.keyboard.press("Tab");
    await expect(tokenInput).toHaveValue("1rem");
    await expect.poll(() => page.evaluate((key) => window.localStorage.getItem(key), storageKey))
        .toBe(storageValue);
    await page.reload();
    await expect(page.locator("#lab-token---radius")).toHaveValue("1rem");
});

test("keeps externally added body attributes free of hydration warnings", async ({page}) => {
    let documentRouteHit = false;
    await page.route("**/dev/components**", async (route) => {
        if (route.request().resourceType() !== "document") {
            await route.continue();
            return;
        }
        documentRouteHit = true;
        const response = await route.fetch();
        const html = await response.text();
        const modifiedHtml = html.replace(
            /<body\b[^>]*>/u,
            (openingTag) => openingTag.replace(
                /<body\b/u,
                '<body inmaintabuse="1"',
            ),
        );
        if (modifiedHtml === html) {
            throw new Error("Expected a body opening tag in the document response");
        }
        const headers = {...response.headers()};
        delete headers["content-encoding"];
        delete headers["content-length"];
        headers["content-type"] = "text/html; charset=utf-8";
        await route.fulfill({response, headers, body: modifiedHtml});
    });

    const hydrationErrors: string[] = [];
    page.on("console", (message) => {
        if (
            message.type() === "error"
            && /hydration|hydrated|server rendered HTML/iu.test(message.text())
        ) {
            hydrationErrors.push(message.text());
        }
    });
    page.on("pageerror", (error) => {
        if (/hydration|hydrated|server rendered HTML/iu.test(error.message)) {
            hydrationErrors.push(error.message);
        }
    });

    await page.goto("/dev/components?component=button&scene=default");
    expect(documentRouteHit).toBe(true);
    await expect(page.locator("body")).toHaveAttribute("inmaintabuse", "1");
    await expect(page.getByRole("heading", {name: "Cosmos Component Lab"})).toBeVisible();
    await expect(page.getByRole("button", {name: "Continue", exact: true})).toBeVisible();
    await page.evaluate(() => new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(resolve));
    }));
    // This Chromium/Next dev runtime did not reproduce the reported warning.
    expect(hydrationErrors).toEqual([]);
});
