import "reflect-metadata";
import type { IncomingMessage } from "node:http";
import { Controller, Delete, Get, Header, HttpException, Inject, Param, Patch, Post, Req, Res } from "@nestjs/common";
import type { ConfiguredModels } from "@cosmos/application";
import { createConfiguredModelCommandSchema, updateConfiguredModelCommandSchema } from "@cosmos/contracts";
import { z } from "zod";
import { readModelConfigurationBody } from "./model-configuration-body-reader.js";

type Trust = Parameters<typeof readModelConfigurationBody>[1];
type Response = {
    setHeader(name: string, value: string): void;
    status(value: number): Response;
    json(value: unknown): void;
};
type Service = Pick<ConfiguredModels, "list" | "get" | "create" | "update" | "delete">;
const deleteSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const codes = new Map<string, number>([
    ["invalid_input", 400], ["forbidden_origin", 403], ["payload_too_large", 413],
    ["not_found", 404], ["already_exists", 409], ["in_use", 409], ["version_conflict", 409],
    ["dependency_unavailable", 503],
]);
function failure(code: string): HttpException {
    const status = codes.get(code) ?? 503;
    return new HttpException({ code: codes.has(code) ? code : "dependency_unavailable", message: "Configured model operation failed.", retryable: status >= 500 }, status);
}

@Controller()
export class ConfiguredModelController {
    constructor(
        @Inject("COSMOS_MODEL_CONFIGURATION_TRUST") private readonly trust: Trust,
        @Inject("COSMOS_CONFIGURED_MODELS") private readonly models: Service,
    ) {}

    @Get("model-providers/:providerId/models")
    @Header("Cache-Control", "no-store")
    async list(@Param("providerId") providerId: string) {
        const items = await this.safe(() => this.models.list(providerId));
        return { items, nextCursor: null };
    }

    @Get("model-providers/:providerId/models/:modelId")
    @Header("Cache-Control", "no-store")
    get(@Param("providerId") providerId: string, @Param("modelId") modelId: string) {
        return this.safe(async () => {
            const model = await this.models.get(providerId, modelId);
            if (model === null) throw Object.assign(new Error("Configured model was not found."), { code: "not_found" });
            return model;
        });
    }

    @Post("model-providers/:providerId/models")
    create(@Param("providerId") providerId: string, @Req() request: IncomingMessage, @Res() response: Response) {
        return this.write(request, response, async (body) => {
            const key = this.idempotencyKey(request);
            const parsed = createConfiguredModelCommandSchema.safeParse(body);
            if (!key || !parsed.success) throw Object.assign(new Error("Invalid configured model command."), { code: "invalid_input" });
            return { status: 201, body: await this.models.create(providerId, parsed.data) };
        });
    }

    @Patch("model-providers/:providerId/models/:modelId")
    update(@Param("providerId") providerId: string, @Param("modelId") modelId: string, @Req() request: IncomingMessage, @Res() response: Response) {
        return this.write(request, response, async (body) => {
            const key = this.idempotencyKey(request);
            const parsed = updateConfiguredModelCommandSchema.safeParse(body);
            if (!key || !parsed.success) throw Object.assign(new Error("Invalid configured model command."), { code: "invalid_input" });
            return { status: 200, body: await this.models.update(providerId, modelId, parsed.data) };
        });
    }

    @Delete("model-providers/:providerId/models/:modelId")
    delete(@Param("providerId") providerId: string, @Param("modelId") modelId: string, @Req() request: IncomingMessage, @Res() response: Response) {
        return this.write(request, response, async (body) => {
            const key = this.idempotencyKey(request);
            const parsed = deleteSchema.safeParse(body);
            if (!key || !parsed.success) throw Object.assign(new Error("Invalid configured model deletion."), { code: "invalid_input" });
            await this.models.delete(providerId, modelId, parsed.data.expectedVersion);
            return { status: 204, body: {} };
        });
    }

    private idempotencyKey(request: IncomingMessage): string | undefined {
        const values: string[] = [];
        for (let index = 0; index < request.rawHeaders.length; index += 2) if (request.rawHeaders[index]!.toLowerCase() === "idempotency-key") values.push(request.rawHeaders[index + 1]!);
        return values.length === 1 && /^[A-Za-z0-9._:-]{1,200}$/.test(values[0]!) ? values[0] : undefined;
    }

    private async write(request: IncomingMessage, response: Response, use: (body: unknown) => Promise<{ status: number; body: unknown }>): Promise<void> {
        response.setHeader("Cache-Control", "no-store");
        try {
            const body = await readModelConfigurationBody(request, this.trust);
            const result = await use(body);
            response.status(result.status).json(result.body);
        } catch (error) {
            let code = "dependency_unavailable";
            try { if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && codes.has(error.code)) code = error.code; } catch { /* Keep dependency details out of HTTP responses. */ }
            response.status(codes.get(code) ?? 503).json({ code, message: "Configured model operation failed.", retryable: (codes.get(code) ?? 503) >= 500 });
        }
    }

    private async safe<T>(use: () => Promise<T>): Promise<T> {
        try { return await use(); } catch (error) {
            let code = "dependency_unavailable";
            try { if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && codes.has(error.code)) code = error.code; } catch { /* Keep dependency details out of HTTP responses. */ }
            throw failure(code);
        }
    }
}
