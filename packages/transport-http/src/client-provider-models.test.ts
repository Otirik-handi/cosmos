import { describe, expect, it } from "vitest";

import { HttpCosmosClient, CosmosTransportError } from "./index.js";

const provider = {
    id: "provider/one", name: "Test provider", api: "openai-completions", baseUrl: "https://provider.example/v1",
    version: 1, state: "active", credentialState: "configured",
    createdAt: "2026-10-15T00:00:00.000Z", updatedAt: "2026-10-15T00:00:00.000Z",
};
const operation = {
    id: "operation:one", kind: "create", providerId: "provider/one", state: "pending", resourceVersion: null,
};

function jsonResponse(body: unknown, status = 200): Response {
    return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });
}

describe("HttpCosmosClient Provider/model configuration", () => {
    it("lists providers with bounded pagination and reads an encoded provider id", async () => {
        const requests: Array<{ url: string; method: string }> = [];
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (input, init) => {
            requests.push({ url: String(input), method: init?.method ?? "GET" });
            return jsonResponse(requests.length === 1 ? { items: [provider], nextCursor: "provider/one" } : provider);
        } });

        const page = await client.listModelProviders({ limit: 20, cursor: "next/id" });
        const result = await client.getModelProvider("provider/one");

        expect(page).toEqual({ items: [provider], nextCursor: "provider/one" });
        expect(result).toEqual(provider);
        expect(requests).toEqual([
            { url: "http://localhost:4310/api/v1/model-providers?limit=20&cursor=next%2Fid", method: "GET" },
            { url: "http://localhost:4310/api/v1/model-providers/provider%2Fone", method: "GET" },
        ]);
    });

    it("submits a caller-owned idempotency key once and returns an operation receipt", async () => {
        let sends = 0;
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (_input, init) => {
            sends++;
            expect(init?.method).toBe("POST");
            expect(new Headers(init?.headers).get("idempotency-key")).toBe("create:one");
            return jsonResponse(operation, 202);
        } });

        const result = await client.createModelProvider({
            name: "Test provider", api: "openai-completions", baseUrl: "https://provider.example/v1", apiKey: "synthetic-key",
        }, "create:one");

        expect(result).toEqual(operation);
        expect(sends).toBe(1);
    });

    it("accepts an immediate 201 provider snapshot without treating it as an operation", async () => {
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (_input, init) => {
            expect(init?.method).toBe("POST");
            return jsonResponse(provider, 201);
        } });
        expect(await client.createModelProvider({
            name: "Test provider", api: "openai-completions", baseUrl: "https://provider.example/v1", apiKey: "synthetic-key",
        }, "create:immediate")).toEqual(provider);
    });

    it("rejects an undeclared successful write status", async () => {
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async () => jsonResponse(provider, 200) });
        await expect(client.createModelProvider({
            name: "Test provider", api: "openai-completions", baseUrl: "https://provider.example/v1", apiKey: "synthetic-key",
        }, "create:unexpected")).rejects.toThrow("Unexpected model provider write status: 200.");
    });

    it("preserves recovery by querying the operation without replaying a failed save", async () => {
        const requests: string[] = [];
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (input) => {
            requests.push(String(input));
            if (requests.length === 1) {
                return jsonResponse({ code: "dependency_unavailable", message: "rejected", retryable: true, operationId: operation.id }, 503);
            }
            return jsonResponse(operation);
        } });

        await expect(client.createModelProvider({
            name: "Test provider", api: "openai-completions", baseUrl: "https://provider.example/v1", apiKey: "synthetic-key",
        }, "create:one")).rejects.toBeInstanceOf(CosmosTransportError);
        const receipt = await client.getModelConfigurationOperation(operation.id);

        expect(receipt).toEqual(operation);
        expect(requests).toEqual([
            "http://localhost:4310/api/v1/model-providers",
            "http://localhost:4310/api/v1/model-configuration-operations/operation%3Aone",
        ]);
    });

    it("updates with version and key through one PATCH request", async () => {
        let sends = 0;
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (_input, init) => {
            sends++;
            expect(init?.method).toBe("PATCH");
            expect(new Headers(init?.headers).get("idempotency-key")).toBe("update:one");
            expect(JSON.parse(String(init?.body))).toEqual({ expectedVersion: 2, name: "Renamed" });
            return jsonResponse(operation, 202);
        } });
        expect(await client.updateModelProvider("provider/one", { expectedVersion: 2, name: "Renamed" }, "update:one")).toEqual(operation);
        expect(sends).toBe(1);
    });

    it("looks up an idempotency key directly rather than resending its command", async () => {
        const requests: string[] = [];
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (input) => {
            requests.push(String(input));
            return jsonResponse(operation);
        } });

        expect(await client.getModelConfigurationOperationByKey("create/one")).toEqual(operation);
        expect(requests).toEqual(["http://localhost:4310/api/v1/model-configuration-operations/by-key/create%2Fone"]);
    });

    it("discovers models in one synchronous request carrying only the expected version", async () => {
        const discovery = {
            id: "provider-discovery:one", providerId: "provider/one", providerVersion: 3, status: "succeeded",
            candidates: [{ modelId: "gpt-4o-mini", name: "GPT-4o mini" }], errorCode: null,
            createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z",
        };
        const requests: Array<{ url: string; method?: string; body: unknown }> = [];
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async (input, init) => {
            requests.push({ url: String(input), method: init?.method, body: JSON.parse(String(init?.body)) });
            return jsonResponse(discovery);
        } });

        expect(await client.discoverProviderModels("provider/one", 3)).toEqual(discovery);
        expect(requests).toEqual([{
            url: "http://localhost:4310/api/v1/model-providers/provider%2Fone/discoveries",
            method: "POST",
            body: { expectedProviderVersion: 3 },
        }]);
    });

    it("surfaces a failed discovery as a finished snapshot instead of retrying", async () => {
        const failed = {
            id: "provider-discovery:two", providerId: "provider/one", providerVersion: 3, status: "failed",
            candidates: [], errorCode: "authentication_failed",
            createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z",
        };
        let sends = 0;
        const client = new HttpCosmosClient({ baseUrl: "http://localhost:4310", fetch: async () => {
            sends++;
            return jsonResponse(failed);
        } });

        expect(await client.discoverProviderModels("provider/one", 3)).toEqual(failed);
        expect(sends).toBe(1);
    });
});
