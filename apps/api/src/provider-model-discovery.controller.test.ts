import "reflect-metadata";
import { Module } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { expect, it } from "vitest";

import { ProviderModelDiscoveryController } from "./provider-model-discovery.controller.js";
import {
    ProviderDiscoveryConflictError,
    ProviderDiscoveryNotFoundError,
    ProviderModelDiscoveryUnavailableError,
} from "../../../packages/application/src/provider-discovery.js";

const trust = { origins: ["http://localhost:4300"], authorities: [] as string[] };

const succeeded = {
    id: "discovery-1", providerId: "provider", providerVersion: 2, status: "succeeded",
    candidates: [{ modelId: "gpt-x", name: "GPT X" }], errorCode: null,
    createdAt: "2026-10-20T00:00:00.000Z", updatedAt: "2026-10-20T00:00:00.000Z",
};

it("runs discovery synchronously, never echoes the credential and maps refusals to fixed codes", async () => {
    const calls: unknown[] = [];
    const discovery = {
        async discover(command: unknown) {
            calls.push(command);
            const version = (command as { expectedProviderVersion: number }).expectedProviderVersion;
            if (version === 1) throw new ProviderDiscoveryConflictError("SYNTHETIC_PRIVATE_KEY");
            if (version === 9) throw new ProviderDiscoveryNotFoundError("absent");
            if (version === 8) throw new ProviderModelDiscoveryUnavailableError("no credential");
            if (version === 7) throw new Error("SYNTHETIC_PRIVATE_KEY");
            if (version === 6) return { ...succeeded, status: "failed", candidates: [], errorCode: "authentication_failed" };
            return succeeded;
        },
    };

    @Module({
        controllers: [ProviderModelDiscoveryController],
        providers: [
            { provide: "COSMOS_MODEL_CONFIGURATION_TRUST", useValue: trust },
            { provide: "COSMOS_PROVIDER_MODEL_DISCOVERY", useValue: discovery },
        ],
    })
    class TestModule {}

    const app = await NestFactory.create(TestModule, { logger: false, bodyParser: false });
    try {
        app.setGlobalPrefix("api/v1");
        await app.listen(0, "127.0.0.1");
        const base = await app.getUrl();
        trust.authorities.push(new URL(base).host);
        const send = async (path: string, body: unknown, origin = "http://localhost:4300") => {
            const response = await fetch(`${base}/api/v1/${path}`, {
                method: "POST",
                headers: { Origin: origin, "Content-Type": "application/json" },
                body: JSON.stringify(body),
            });
            expect(response.headers.get("cache-control")).toBe("no-store");
            const text = await response.text();
            expect(text).not.toContain("SYNTHETIC_PRIVATE_KEY");
            return { status: response.status, body: JSON.parse(text) };
        };

        expect(await send("model-providers/provider/discoveries", { expectedProviderVersion: 2 }))
            .toMatchObject({ status: 200, body: succeeded });
        // 六次进入运行器；后面四个校验失败在读取/解析后就被拒，不会外呼。
        expect(calls).toHaveLength(1);
        expect(calls[0]).toEqual({ providerId: "provider", expectedProviderVersion: 2 });

        // 失败快照仍是 200：发现本身成功执行，是上游拒绝。
        expect(await send("model-providers/provider/discoveries", { expectedProviderVersion: 6 }))
            .toMatchObject({ status: 200, body: { status: "failed", errorCode: "authentication_failed" } });

        expect(await send("model-providers/provider/discoveries", { expectedProviderVersion: 1 }))
            .toMatchObject({ status: 409, body: { code: "version_conflict", retryable: false } });
        expect(await send("model-providers/provider/discoveries", { expectedProviderVersion: 9 }))
            .toMatchObject({ status: 404, body: { code: "not_found" } });
        expect(await send("model-providers/provider/discoveries", { expectedProviderVersion: 8 }))
            .toMatchObject({ status: 409, body: { code: "credential_missing" } });
        expect(await send("model-providers/provider/discoveries", { expectedProviderVersion: 7 }))
            .toMatchObject({ status: 503, body: { code: "dependency_unavailable" } });

        // 路径 ID 权威，body 不接受 providerId；也不接受多余字段与坏版本号。
        expect(await send("model-providers/provider/discoveries", { expectedProviderVersion: 2, providerId: "other" }))
            .toMatchObject({ status: 400, body: { code: "invalid_input" } });
        expect(await send("model-providers/provider/discoveries", { expectedProviderVersion: 0 }))
            .toMatchObject({ status: 400, body: { code: "invalid_input" } });
        expect(await send("model-providers/provider/discoveries", { expectedProviderVersion: 2 }, "http://evil.example"))
            .toMatchObject({ status: 403, body: { code: "forbidden_origin" } });
        expect(await send("model-providers/bad id/discoveries", { expectedProviderVersion: 2 }))
            .toMatchObject({ status: 400, body: { code: "invalid_input" } });
        expect(calls).toHaveLength(6);
    } finally {
        await app.close();
    }
});
