import { expect, test } from "@playwright/test";
import { randomUUID } from "node:crypto";
import { configuredModelSnapshotSchema, modelProviderSnapshotSchema, systemConfigDtoSchema, storyDeepReadRevisionDetailSchema } from "@cosmos/contracts";
import { ingestFeed, openStory, waitForStoryId } from "../support/story-flow";

test("deep read generation, precise evidence, revision history and refresh recovery use isolated Worker model", async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    const consoleErrors: string[] = [];
    const expectedConflictResponses: string[] = [];
    const trackConsole = (message: import("@playwright/test").ConsoleMessage) => {
        if (message.type() === "error") consoleErrors.push(message.text());
    };
    const trackPageErrors = (error: Error) => errors.push(error.message);
    const trackFailedRequests = (request: import("@playwright/test").Request) => errors.push(`${request.method()} ${request.url()}`);
    page.on("pageerror", trackPageErrors);
    page.on("console", trackConsole);
    page.on("requestfailed", trackFailedRequests);
    const origin = `http://127.0.0.1:${process.env.COSMOS_E2E_WEB_PORT ?? "4173"}`;
    const headers = () => ({ origin, "idempotency-key": randomUUID() });
    const previous = systemConfigDtoSchema.parse(await (await page.request.get("/api/v1/system/config")).json());
    let providerId: string | null = null;
    let providerVersion: number | null = null;
    let modelId: string | null = null;
    let modelVersion: number | null = null;
    let conflictPage: import("@playwright/test").Page | null = null;
    const extraModels: { id: string; version: number }[] = [];
    try {
        const source = await ingestFeed(page, "Story deep read browser");
        const storyId = await waitForStoryId(page, source);
        const providerResponse = await page.request.post("/api/v1/model-providers", { headers: headers(), data: {
            name: "Synthetic Deep Read Provider", api: "openai-completions", baseUrl: "https://story-agent.e2e.invalid/v1", apiKey: "e2e-synthetic-key",
        } });
        expect(providerResponse.status()).toBe(201);
        const provider = modelProviderSnapshotSchema.parse(await providerResponse.json());
        providerId = provider.id;
        providerVersion = provider.version;
        const modelResponse = await page.request.post(`/api/v1/model-providers/${provider.id}/models`, { headers: headers(), data: {
            modelId: "synthetic-story-model", name: "Synthetic Deep Read Model", contextWindow: 4096, maxOutputTokens: 512,
            inputPricePerMillion: 1, outputPricePerMillion: 2, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0, currency: "USD",
        } });
        expect(modelResponse.status()).toBe(201);
        const model = configuredModelSnapshotSchema.parse(await modelResponse.json());
        modelId = model.id;
        modelVersion = model.version;
        expect((await page.request.put("/api/v1/system/config", { data: { defaultModelId: model.id } })).status()).toBe(200);
        await openStory(page, storyId);
        const panel = page.getByRole("region", { name: "深入阅读", exact: true });
        const queuedResponse = page.waitForResponse((response) => response.url().includes(`/stories/${encodeURIComponent(storyId)}/deep-reads`)
            && response.request().method() === "POST");
        await panel.getByRole("button", { name: "生成深入阅读", exact: true }).click();
        const queued = await queuedResponse;
        expect(queued.status()).toBe(202);
        const generation = await queued.json() as { runId: string };
        await expect(panel.getByRole("heading", { name: "Synthetic deep-read report", exact: true })).toBeVisible({ timeout: 90_000 });
        await expect(panel).toContainText("Agent 观点");
        await expect(panel).toContainText(`实际调用模型：${provider.id} / synthetic-story-model`);
        await expect(panel).toContainText("实际成本：0.00005 USD");
        const artifact = await page.request.get(`/api/v1/stories/${storyId}/deep-reads`);
        expect(artifact.status()).toBe(200);
        const artifactRead = await artifact.json() as { artifact: { current: { revision: number; sections: Array<{ evidence: Array<{ entryRevisionId: string; representationVersion: number; blockId?: string }> }> }; revisions: Array<{ revision: number }> } };
        const published = storyDeepReadRevisionDetailSchema.parse(artifactRead.artifact.current);
        expect(published.sections.flatMap((section) => section.evidence)).toHaveLength(1);
        const evidence = published.sections[0]!.evidence[0]!;
        const exactResponse = await page.request.get(`/api/v1/revisions/${evidence.entryRevisionId}/content?representationVersion=${evidence.representationVersion}`);
        expect(exactResponse.status()).toBe(200);
        const exact = await exactResponse.json() as { representation: { blocks: Array<{ id: string }> } };
        expect(exact.representation.blocks.map((block) => block.id)).toContain(evidence.blockId);
        const chip = panel.getByRole("button", { name: "来源证据 1", exact: true });
        await chip.focus();
        await chip.press("Enter");
        const drawer = page.getByRole("dialog", { name: "来源证据", exact: true });
        await expect(drawer).toBeVisible();
        await expect(drawer.locator(`[data-block-id="${evidence.blockId}"]`)).toBeFocused();
        await page.keyboard.press("Escape");
        await expect(drawer).toHaveCount(0);
        await expect(chip).toBeFocused();
        await page.reload();
        const restoredPanel = page.getByRole("region", { name: "深入阅读", exact: true });
        await expect(restoredPanel.getByRole("heading", { name: "Synthetic deep-read report", exact: true })).toBeVisible();
        const oldKey = queued.request().headers()["idempotency-key"];
        expect(oldKey).toBeTruthy();
        expect(await page.evaluate((key) => JSON.parse(sessionStorage.getItem(key) ?? "null"), `cosmos.story-deep-read.v1:${encodeURIComponent(storyId)}`))
            .toMatchObject({ key: oldKey, runId: generation.runId });
        await expect.poll(async () => {
            const response = await page.request.get(`/api/v1/stories/${storyId}/deep-reads`);
            const value = await response.json() as { artifact: { current: { revision: number } } };
            return value.artifact.current.revision;
        }).toBe(1);
        const secondPost = page.waitForResponse((response) => response.url().includes(`/stories/${encodeURIComponent(storyId)}/deep-reads`)
            && response.request().method() === "POST");
        await restoredPanel.getByRole("button", { name: "重新生成深入阅读", exact: true }).click();
        expect((await secondPost).status()).toBe(202);
        await expect.poll(async () => {
            const response = await page.request.get(`/api/v1/stories/${storyId}/deep-reads`);
            const value = await response.json() as { artifact: { current: { revision: number } } };
            return value.artifact.current.revision;
        }, { timeout: 90_000 }).toBe(2);
        const versionSelect = restoredPanel.getByLabel("报告版本", { exact: true });
        await versionSelect.selectOption("1");
        await expect(restoredPanel).toContainText("旧版本 · 只读");
        await versionSelect.selectOption("2");
        await expect(restoredPanel).toContainText("当前版本");

        const createModel = async (upstreamModel: string) => {
            const response = await page.request.post(`/api/v1/model-providers/${provider.id}/models`, { headers: headers(), data: {
                modelId: upstreamModel, name: `Synthetic ${upstreamModel}`, contextWindow: 4096, maxOutputTokens: 512,
                inputPricePerMillion: 1, outputPricePerMillion: 2, cacheWritePricePerMillion: 0, cacheReadPricePerMillion: 0, currency: "USD",
            } });
            expect(response.status()).toBe(201);
            const value = configuredModelSnapshotSchema.parse(await response.json());
            extraModels.push({ id: value.id, version: value.version });
            return value;
        };
        const failingModel = await createModel("synthetic-story-model-fail");
        expect((await page.request.put("/api/v1/system/config", { data: { defaultModelId: failingModel.id } })).status()).toBe(200);
        const failurePanel = page.getByRole("region", { name: "深入阅读", exact: true });
        const failedResponse = page.waitForResponse((response) => response.url().includes(`/stories/${encodeURIComponent(storyId)}/deep-reads`)
            && response.request().method() === "POST");
        await failurePanel.getByRole("button", { name: "重新生成深入阅读", exact: true }).click();
        const failedIntent = await failedResponse;
        expect(failedIntent.status()).toBe(202);
        const failedKey = failedIntent.request().headers()["idempotency-key"];
        await expect(failurePanel.getByRole("alert").filter({ hasText: /模型服务暂时不可用|生成未能完成/u })).toBeVisible({ timeout: 90_000 });
        await expect(failurePanel.getByRole("heading", { name: "Synthetic deep-read report", exact: true })).toBeVisible();
        const retryResponse = page.waitForResponse((response) => response.url().includes(`/stories/${encodeURIComponent(storyId)}/deep-reads`)
            && response.request().method() === "POST");
        await failurePanel.getByRole("button", { name: "重试生成深入阅读", exact: true }).click();
        const retryIntent = await retryResponse;
        expect(retryIntent.status()).toBe(202);
        expect(retryIntent.request().headers()["idempotency-key"]).not.toBe(failedKey);
        await expect(failurePanel.getByRole("alert").filter({ hasText: /模型服务暂时不可用|生成未能完成/u })).toBeVisible({ timeout: 90_000 });
        await expect(failurePanel.getByRole("heading", { name: "Synthetic deep-read report", exact: true })).toBeVisible();

        const holdingModel = await createModel("synthetic-story-model-hold");
        expect((await page.request.put("/api/v1/system/config", { data: { defaultModelId: holdingModel.id } })).status()).toBe(200);
        const activeSource = await ingestFeed(page, "Story deep read active conflict");
        const activeStoryId = await waitForStoryId(page, activeSource);
        await openStory(page, activeStoryId);
        conflictPage = await page.context().newPage();
        conflictPage.on("pageerror", trackPageErrors);
        conflictPage.on("console", trackConsole);
        conflictPage.on("requestfailed", trackFailedRequests);
        await openStory(conflictPage, activeStoryId);
        const activePanel = page.getByRole("region", { name: "深入阅读", exact: true });
        const conflictPanel = conflictPage.getByRole("region", { name: "深入阅读", exact: true });
        const deepReadPath = `/api/v1/stories/${encodeURIComponent(activeStoryId)}/deep-reads`;
        const deepReadUrl = new URL(deepReadPath, page.url()).href;
        const trackConflictResponse = (response: import("@playwright/test").Response) => {
            if (response.url() === deepReadUrl && response.request().method() === "POST" && response.status() === 409) {
                expectedConflictResponses.push(response.url());
            }
        };
        page.on("response", trackConflictResponse);
        conflictPage.on("response", trackConflictResponse);
        const readQueued = (target: import("@playwright/test").Page) => target.waitForResponse((response) => response.url() === deepReadUrl
            && response.request().method() === "POST");
        const firstQueued = readQueued(page);
        const secondQueued = readQueued(conflictPage);
        await Promise.all([
            activePanel.getByRole("button", { name: "生成深入阅读", exact: true }).click(),
            conflictPanel.getByRole("button", { name: "生成深入阅读", exact: true }).click(),
        ]);
        const [firstResponse, secondResponse] = await Promise.all([firstQueued, secondQueued]);
        expect([firstResponse.status(), secondResponse.status()].toSorted()).toEqual([202, 409]);
        if (firstResponse.status() === 409) {
            await expect(activePanel).toContainText("该 Story 已有进行中的深入阅读");
        } else {
            await expect(conflictPanel).toContainText("该 Story 已有进行中的深入阅读");
        }
        await expect(activePanel).toContainText("正在生成深入阅读");
        await page.reload();
        await expect(page.getByRole("region", { name: "深入阅读", exact: true })).toContainText("正在生成深入阅读");
        expect(expectedConflictResponses).toEqual([deepReadUrl]);
        const expectedConflictConsole = "Failed to load resource: the server responded with a status of 409 (Conflict)";
        expect(consoleErrors.filter((message) => message === expectedConflictConsole)).toHaveLength(1);
        expect(consoleErrors.filter((message) => message !== expectedConflictConsole)).toEqual([]);
        expect(errors).toEqual([]);
    } finally {
        if (conflictPage) await conflictPage.close();
        expect((await page.request.put("/api/v1/system/config", { data: { defaultModelId: previous.defaultModelId } })).status()).toBe(200);
        for (const extra of extraModels) {
            const removed = await page.request.delete(`/api/v1/model-providers/${providerId}/models/${extra.id}`, { headers: headers(), data: { expectedVersion: extra.version } });
            expect(removed.status()).toBe(204);
        }
        if (modelId && providerId && modelVersion !== null) {
            const removed = await page.request.delete(`/api/v1/model-providers/${providerId}/models/${modelId}`, { headers: headers(), data: { expectedVersion: modelVersion } });
            expect(removed.status()).toBe(204);
        }
        if (providerId && providerVersion !== null) {
            const removed = await page.request.delete(`/api/v1/model-providers/${providerId}`, { headers: headers(), data: { expectedVersion: providerVersion } });
            expect(removed.status()).toBe(204);
        }
    }
});
