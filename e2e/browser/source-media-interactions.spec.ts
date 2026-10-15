import { expect, test } from "@playwright/test";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { ingestFeed, mergeStoryInto, openStory, waitForStoryId } from "../support/story-flow";

// Both media outcomes originate in real Worker downloads; no Product API response is mocked.
test("source switching isolates bodies and failed media across refresh", async ({ page }) => {
    test.setTimeout(300_000);
    let baseUrl = "";
    const server = createServer((request, response) => {
        const path = new URL(request.url ?? "/", "http://fixture.invalid").pathname;
        if (path === "/saved.svg") {
            response.writeHead(200, { "content-type": "image/svg+xml" });
            response.end('<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24"><rect width="24" height="24" fill="blue"/></svg>');
            return;
        }
        if (path === "/a.xml" || path === "/b.xml") {
            const saved = path === "/a.xml";
            const label = saved ? "Source A saved" : "Source B failed";
            const media = saved ? "saved.svg" : "missing.svg";
            response.writeHead(200, { "content-type": "application/rss+xml" });
            response.end(`<?xml version="1.0"?><rss version="2.0"><channel><title>${label}</title><link>${baseUrl}</link><description>Controlled acceptance</description><item><guid>${label}</guid><title>${label}</title><link>${baseUrl}/${saved ? "a" : "b"}</link><description><![CDATA[<p>${label} body before</p><img src="${baseUrl}/${media}" alt="${label} image"/><p>${label} body after</p>]]></description></item></channel></rss>`);
            return;
        }
        response.writeHead(404, { "content-type": "text/plain" });
        response.end("Controlled missing media");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    page.on("requestfailed", (request) => errors.push(`${request.method()} ${request.url()}`));
    try {
        const sourceA = await ingestFeed(page, "来源A", async (current) => {
            await current.getByLabel("Feed URL").fill(`${baseUrl}/a.xml`);
        });
        const storyA = await waitForStoryId(page, sourceA);
        const sourceB = await ingestFeed(page, "来源B", async (current) => {
            await current.getByLabel("Feed URL").fill(`${baseUrl}/b.xml`);
        });
        const storyB = await waitForStoryId(page, sourceB);
        await openStory(page, storyA);
        await mergeStoryInto(page, storyB);
        const content = page.getByRole("region", { name: "来源正文", exact: true });
        const select = content.getByLabel("选择来源");
        await expect(select.locator("option")).toHaveCount(2);
        const optionA = select.locator("option").filter({ hasText: sourceA });
        const optionB = select.locator("option").filter({ hasText: sourceB });
        const idA = await optionA.getAttribute("value");
        const idB = await optionB.getAttribute("value");
        expect(idA).toBeTruthy();
        expect(idB).toBeTruthy();
        const checkBody = async (label: string, other: string) => {
            await expect(content).toContainText(`${label} body before`);
            await expect(content).toContainText(`${label} body after`);
            await expect(content).not.toContainText(`${other} body`);
            await expect(content.locator("[data-content-block]")).toHaveCount(3);
            await expect(content.getByRole("link", { name: "查看来源原文", exact: true }))
                .toHaveAttribute("href", `${baseUrl}/${label.startsWith("Source A") ? "a" : "b"}`);
        };
        const checkSaved = async () => {
            await checkBody("Source A saved", "Source B failed");
            await expect(content.locator("[data-asset-status=failed]")).toHaveCount(0);
            const image = content.locator("[data-asset-status=saved] img");
            await image.scrollIntoViewIfNeeded();
            await expect(image).toHaveAttribute("src", /\/api\/v1\/assets\//);
            await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).naturalWidth)).toBeGreaterThan(0);
        };
        const checkFailed = async () => {
            await checkBody("Source B failed", "Source A saved");
            await expect(content.locator("[data-asset-status=saved]")).toHaveCount(0);
            const failed = content.locator("[data-asset-status=failed]");
            await expect(failed).toContainText("保存失败");
            await expect(failed).toContainText("404");
            await expect(failed).toContainText(/已尝试 \d+ 次/);
            const link = failed.getByRole("link", { name: "查看原文外链" });
            await expect(link).toHaveAttribute("href", `${baseUrl}/missing.svg`);
            await expect(link).toHaveAttribute("target", "_blank");
            await link.focus();
            await expect(link).toBeFocused();
            await expect(failed.locator("img, audio, video, button")).toHaveCount(0);
        };
        await select.selectOption(idA!);
        await checkSaved();
        await select.focus();
        await expect(select).toBeFocused();
        await select.press(idA!.localeCompare(idB!) < 0 ? "ArrowDown" : "ArrowUp");
        await select.press("Enter");
        await expect(select).toHaveValue(idB!);
        await checkFailed();
        await select.selectOption(idA!);
        await checkSaved();
        await select.selectOption(idB!);
        await checkFailed();
        const checkDefault = async () => {
            await expect(content).toContainText("默认按来源标识顺序选取，可切换");
            const selected = await select.inputValue();
            if (selected === idA) await checkSaved();
            else { expect(selected).toBe(idB); await checkFailed(); }
            return selected;
        };
        await page.reload();
        const defaultId = await checkDefault();
        await select.selectOption(defaultId === idA ? idB! : idA!);
        await page.reload();
        await expect(select).toHaveValue(defaultId);
        await checkDefault();
        for (const width of [1024, 1440]) {
            await page.setViewportSize({ width, height: 900 });
            await expect(content).toBeVisible();
            expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
        }
        expect(errors).toEqual([]);
        await test.step("saved media read failure has an explained fallback", async () => {
            await page.route("**/api/v1/assets/**", (route) => route.fulfill({ status: 404, body: "Controlled unavailable saved bytes" }));
            await page.reload();
            await select.selectOption(idA!);
            await checkBody("Source A saved", "Source B failed");
            const saved = content.locator("[data-asset-status=saved]");
            const image = saved.locator("img");
            await saved.scrollIntoViewIfNeeded();
            await expect.poll(() => image.evaluate((node) => (node as HTMLImageElement).complete && (node as HTMLImageElement).naturalWidth === 0)).toBe(true);
            await expect(image).toBeHidden();
            await expect(saved.getByRole("status")).toHaveText("图片加载失败，正文仍可继续阅读。");
            const original = saved.getByRole("link", { name: "查看原文外链", exact: true });
            await expect(original).toHaveAttribute("href", `${baseUrl}/saved.svg`);
            await expect(original).toHaveAttribute("target", "_blank");
            await expect(original).toHaveAttribute("rel", "noreferrer");
            await original.focus();
            await expect(original).toBeFocused();
            await expect(saved.locator("button")).toHaveCount(0);
            await expect(content.locator("[data-asset-status=failed]")).toHaveCount(0);
            await select.selectOption(idB!);
            await checkFailed();
            await page.unroute("**/api/v1/assets/**");
            await select.selectOption(idA!);
            await checkSaved();
            await expect(content.getByText("图片加载失败，正文仍可继续阅读。", { exact: true })).toHaveCount(0);
        });
    } finally {
        await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
});
