import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { expect, it } from "vitest";
import { ModelProviderController } from "./model-provider.controller.js";
import { RequestExceptionFilter } from "./request-logging.js";
import type { Logger } from "@cosmos/logging";
import { ModelProviderQuery } from "../../../packages/application/src/model-provider-query.js";

it("serves safe read routes through isolated local HTTP", async () => {
    const provider = { id: "q", name: "Provider", api: "openai-completions", baseUrl: "https://example.com/v1", version: 1, state: "active", credentialState: "configured", createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z" };
    const receipt = { id: "op", providerId: "q", kind: "create", state: "completed", resourceVersion: 1 };
    const calls: unknown[] = [];
    const reader = new ModelProviderQuery({
        async list(input) { calls.push(input); return [provider]; },
        async get(id) { return id === "missing" ? null : id === "unsafe" ? { ...provider, secretRef: "PRIVATE_SENTINEL" } : provider; },
        async operation(where) {
            if ("id" in where && where.id === "bad") throw new Error("PRIVATE_SENTINEL");
            return receipt;
        },
    });
    @Module({ controllers: [ModelProviderController], providers: [{ provide: "COSMOS_MODEL_PROVIDER_QUERY", useValue: reader }] })
    class TestModule {}
    const app = await NestFactory.create(TestModule, { logger: false });
    try {
        const logger: Logger = {
            child: () => logger, withContext: (_context, use) => use(),
            debug: () => {}, info: () => {}, warn: () => {}, error: () => {}, close: async () => {},
        };
        app.useGlobalFilters(new RequestExceptionFilter(logger));
        app.setGlobalPrefix("api/v1");
        await app.listen(0, "127.0.0.1");
        const base = await app.getUrl();
        const read = async (path: string, status = 200) => {
            const response = await fetch(`${base}/api/v1/${path}`);
            expect(response.status).toBe(status);
            expect(response.headers.get("cache-control")).toBe("no-store");
            const text = await response.text();
            expect(text).not.toContain("PRIVATE_SENTINEL");
            return JSON.parse(text);
        };
        expect(await read("model-providers?limit=2&cursor=p")).toEqual({ items: [provider], nextCursor: null });
        expect(calls).toEqual([{ limit: 3, cursor: "p" }]);
        expect(await read("model-providers/q")).toEqual(provider);
        expect(await read("model-configuration-operations/by-key/request")).toEqual(receipt);
        expect(await read("model-configuration-operations/op")).toEqual(receipt);
        expect(await read("model-providers/unsafe", 503)).toMatchObject({ code: "dependency_unavailable" });
        expect(await read("model-providers?cursor=%20", 400)).toMatchObject({ code: "invalid_input" });
        expect(await read("model-providers?cursor=p&cursor=q", 400)).toMatchObject({ code: "invalid_input" });
        expect(await read("model-providers/missing", 404)).toMatchObject({ code: "not_found", retryable: false });
        expect(await read("model-configuration-operations/bad", 503)).toMatchObject({ code: "dependency_unavailable" });
        expect(await read("model-providers?limit=2x", 400)).toMatchObject({ code: "invalid_input", retryable: false });
        await read("model-providers?limit=0", 400);
        await read("model-providers?limit=101", 400);
        await read("model-providers?limit=1&limit=2", 400);
    } finally { await app.close(); }
});
