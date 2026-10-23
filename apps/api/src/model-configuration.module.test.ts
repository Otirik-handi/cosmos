import "reflect-metadata";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import { expect, it, vi } from "vitest";
import type { ModelProviderOperationSnapshot } from "@cosmos/application";
import { ModelConfigurationModule } from "./model-configuration.module.js";
import { configureModelConfigurationBodyParsers } from "./model-configuration-body-parser.js";

it("registers query and raw write routes with supplied dependencies and exact trust", async () => {
    const save = vi.fn();
    const list = vi.fn(async () => ({ items: [], nextCursor: null }));
    const operation: ModelProviderOperationSnapshot = { id: "operation", providerId: "provider", kind: "create", state: "completed", resourceVersion: 1 };
    const operationByKey = vi.fn(async () => operation);
    const trust = { origins: ["https://web.example"], authorities: [] as string[] };
    const discover = vi.fn();
    const app = await NestFactory.create<NestExpressApplication>(ModelConfigurationModule.register({
        trust, credentials: { save, retry: vi.fn() },
        query: { list, get: vi.fn(), operation: vi.fn(), operationByKey },
         models: { list: vi.fn(), get: vi.fn(), create: vi.fn(), update: vi.fn(), delete: vi.fn() },
        discovery: { discover },
        removals: { remove: vi.fn() },
    }), { logger: false, bodyParser: false });
    configureModelConfigurationBodyParsers(app);
    app.setGlobalPrefix("api/v1");
    try {
        await app.listen(0, "127.0.0.1");
        const base = await app.getUrl();
        trust.authorities.push(new URL(base).host);
        const read = await fetch(`${base}/api/v1/model-providers`);
        expect(read.status).toBe(200);
        expect(await read.json()).toEqual({ items: [], nextCursor: null });
        expect(list).toHaveBeenCalledOnce();
        const denied = await fetch(`${base}/api/v1/model-providers`, { method: "POST",
            headers: { Origin: "https://untrusted.example", "Content-Type": "application/json" }, body: "{}" });
        expect(denied.status).toBe(403);
        expect(denied.headers.get("cache-control")).toBe("no-store");
        expect(save).not.toHaveBeenCalled();
        const accepted = await fetch(`${base}/api/v1/model-providers`, { method: "POST",
            headers: { Origin: trust.origins[0]!, "Content-Type": "application/json" }, body: "{}" });
        expect(accepted.status).toBe(400);
        expect((await accepted.json()).code).toBe("invalid_input");
        expect(operationByKey).not.toHaveBeenCalled();
        const replay = await fetch(`${base}/api/v1/model-providers`, { method: "POST",
            headers: { Origin: trust.origins[0]!, "Content-Type": "application/json", "Idempotency-Key": "replay-key" },
            body: '{"apiKey":"synthetic-never-saved"}', });
        expect(replay.status).toBe(202);
        expect(await replay.json()).toEqual(operation);
        expect(operationByKey).toHaveBeenCalledWith("replay-key");
        expect(save).not.toHaveBeenCalled();
    } finally { await app.close(); }
});
