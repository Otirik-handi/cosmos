import "reflect-metadata";
import { Body, Controller, Delete, Module, Patch, Post, Req } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import type { NestExpressApplication } from "@nestjs/platform-express";
import type { IncomingMessage } from "node:http";
import { expect, it } from "vitest";
import { configureModelConfigurationBodyParsers } from "./model-configuration-body-parser.js";
import { readModelConfigurationBody } from "./model-configuration-body-reader.js";

it("leaves model-configuration writes raw while preserving ordinary JSON and form parsing", async () => {
    const trust = { origins: ["http://localhost:4300"], authorities: [] as string[] };
    @Controller()
    class TestController {
        @Post("model-providers")
        create(@Req() request: IncomingMessage) { return readModelConfigurationBody(request, trust); }
        @Post("model-providers/:providerId/models")
        createConfigured(@Req() request: IncomingMessage) { return readModelConfigurationBody(request, trust); }
        @Patch("model-providers/:providerId/models/:modelId")
        updateConfigured(@Req() request: IncomingMessage) { return readModelConfigurationBody(request, trust); }
        @Delete("model-providers/:providerId/models/:modelId")
        deleteConfigured(@Req() request: IncomingMessage) { return readModelConfigurationBody(request, trust); }
        @Patch("model-providers/:id")
        update(@Req() request: IncomingMessage) { return readModelConfigurationBody(request, trust); }
        @Post("model-configuration-operations/:id/retries")
        retry(@Req() request: IncomingMessage) { return readModelConfigurationBody(request, trust); }
        @Post("model-providers/:id/discoveries")
        discover(@Req() request: IncomingMessage) { return readModelConfigurationBody(request, trust); }
        @Post("ordinary")
        ordinary(@Body() body: unknown) { return body; }
    }
    @Module({ controllers: [TestController] })
    class TestModule {}
    const app = await NestFactory.create<NestExpressApplication>(TestModule, { logger: false, bodyParser: false });
    configureModelConfigurationBodyParsers(app);
    app.setGlobalPrefix("api/v1");
    try {
        await app.listen(0, "127.0.0.1");
        const base = await app.getUrl();
        trust.authorities.push(new URL(base).host);
        const send = (path: string, body: string, type = "application/json", method = "POST") => fetch(`${base}/api/v1/${path}`, {
            method, headers: { Origin: trust.origins[0]!, "Content-Type": type }, body,
        });
        const raw = await send("model-providers", '{"name":"synthetic"}');
        expect(raw.status).toBe(201);
        expect(await raw.json()).toEqual({ name: "synthetic" });
        const configured = await send("model-providers/provider/models", '{"modelId":"org/model"}');
        expect(configured.status).toBe(201);
        expect(await configured.json()).toEqual({ modelId: "org/model" });
        const queriedConfigured = await send("model-providers/provider/models?view=compact", '{"name":"query-path"}');
        expect(queriedConfigured.status).toBe(201);
        expect(await queriedConfigured.json()).toEqual({ name: "query-path" });
        const configuredUpdate = await send("model-providers/provider/models/model", '{"name":"updated-model"}', "application/json", "PATCH");
        expect(configuredUpdate.status).toBe(200);
        expect(await configuredUpdate.json()).toEqual({ name: "updated-model" });
        const configuredDelete = await send("model-providers/provider/models/model", '{"expectedVersion":1}', "application/json", "DELETE");
        expect(configuredDelete.status).toBe(200);
        expect(await configuredDelete.json()).toEqual({ expectedVersion: 1 });
        const updated = await send("MODEL-PROVIDERS/example/?query=yes", '{"name":"updated"}', "application/json", "PATCH");
        expect(updated.status).toBe(200);
        expect(await updated.json()).toEqual({ name: "updated" });
        const retry = await send("model-configuration-operations/example/retries", "{}");
        expect(retry.status).toBe(201);
        expect(await retry.json()).toEqual({});
        // 发现路由一旦漏登记，通用解析器会先读光请求体，控制器只能拿到空流并报 invalid_input。
        const discover = await send("model-providers/example/discoveries", '{"expectedProviderVersion":3}');
        expect(discover.status).toBe(201);
        expect(await discover.json()).toEqual({ expectedProviderVersion: 3 });
        const ordinary = await send("ordinary", '{"name":"ordinary"}');
        expect(await ordinary.json()).toEqual({ name: "ordinary" });
        const form = await send("ordinary", "name=form", "application/x-www-form-urlencoded");
        expect(await form.json()).toEqual({ name: "form" });
    } finally { await app.close(); }
});
