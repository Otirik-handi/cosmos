import "reflect-metadata";
import { randomUUID } from "node:crypto";
import type { IncomingMessage } from "node:http";
import { Controller, Delete, HttpCode, Inject, Param, Patch, Post, Req, Res } from "@nestjs/common";
import type { ModelProviderCredentials, ModelProviderQuery, ModelProviderRemovals } from "@cosmos/application";
import { createModelProviderCommandSchema, updateModelProviderCommandSchema, modelProviderSnapshotSchema } from "@cosmos/contracts";
import { z } from "zod";
import { readModelConfigurationBody } from "./model-configuration-body-reader.js";

type Trust = Parameters<typeof readModelConfigurationBody>[1];
interface Response {
    setHeader(name: string, value: string): void;
    getHeader(name: string): unknown;
    status(value: number): Response;
    json(value: unknown): void;
}
const deleteSchema = z.object({ expectedVersion: z.number().int().positive() }).strict();
const codes = new Map<string, number>([
    ["invalid_input", 400], ["forbidden_origin", 403], ["not_found", 404],
    ["in_use", 409], ["version_conflict", 409], ["operation_in_progress", 409], ["payload_too_large", 413],
    ["credential_write_failed", 503], ["cleanup_pending", 503], ["dependency_unavailable", 503],
]);
function invalid(): never { throw Object.assign(new Error("Invalid model configuration command."), { code: "invalid_input" }); }
@Controller()
export class ModelProviderWriteController {
    constructor(
        @Inject("COSMOS_MODEL_CONFIGURATION_TRUST") private readonly trust: Trust,
        @Inject("COSMOS_MODEL_PROVIDER_CREDENTIALS") private readonly credentials: Pick<ModelProviderCredentials, "save" | "retry">,
        @Inject("COSMOS_MODEL_PROVIDER_QUERY") private readonly query: Pick<ModelProviderQuery, "get" | "operation" | "operationByKey">,
        @Inject("COSMOS_MODEL_PROVIDER_REMOVALS") private readonly removals: Pick<ModelProviderRemovals, "remove">,
    ) {}

    @Post("model-providers")
    create(@Req() request: IncomingMessage, @Res() response: Response) {
        return this.save(request, response);
    }
    @Patch("model-providers/:id")
    update(@Param("id") id: string, @Req() request: IncomingMessage, @Res() response: Response) {
        return this.save(request, response, id);
    }
    @Delete("model-providers/:id")
    @HttpCode(204)
    remove(@Param("id") id: string, @Req() request: IncomingMessage, @Res() response: Response) {
        return this.respond(request, response, async () => {
            const body = await readModelConfigurationBody(request, this.trust);
            if (!this.validId(id) || !this.hasIdempotencyKey(request)) invalid();
            const parsed = deleteSchema.safeParse(body);
            if (!parsed.success) invalid();
            await this.removals.remove(id, parsed.data.expectedVersion);
            return { status: 204, body: {} };
        });
    }

    /** 删除没有收据可查，但仍要求幂等键：调用方拿到 204 就该停止重试，键只用来对齐其它写入口的行为。 */
    private hasIdempotencyKey(request: IncomingMessage): boolean {
        let found = false;
        for (let index = 0; index < request.rawHeaders.length; index += 2) {
            if (request.rawHeaders[index]!.toLowerCase() !== "idempotency-key") continue;
            if (found) return false;
            found = true;
        }
        return found;
    }

    @Post("model-configuration-operations/:id/retries")
    @HttpCode(202)
    retry(@Param("id") id: string, @Req() request: IncomingMessage, @Res() response: Response) {
        return this.respond(request, response, async () => {
            const body = await readModelConfigurationBody(request, this.trust);
            if (!body || typeof body !== "object" || Array.isArray(body) || Object.keys(body).length || !this.validId(id)) invalid();
            const receipt = await this.credentials.retry(id);
            response.setHeader("X-Cosmos-Operation-ID", receipt.id);
            return { status: 202, body: await this.query.operation(receipt.id) };
        });
    }
    private save(request: IncomingMessage, response: Response, id?: string) {
        return this.respond(request, response, async () => {
            const body = await readModelConfigurationBody(request, this.trust);
            const keys: string[] = [];
            for (let i = 0; i < request.rawHeaders.length; i += 2) {
                if (request.rawHeaders[i]!.toLowerCase() === "idempotency-key") keys.push(request.rawHeaders[i + 1]!);
            }
            if (keys.length !== 1 || !this.validId(keys[0]!) || (id !== undefined && !this.validId(id))) invalid();
            let existing;
            try { existing = await this.query.operationByKey(keys[0]!); }
            catch (error) {
                if (typeof error !== "object" || error === null || !("code" in error) || error.code !== "not_found") throw error;
            }
            if (existing) {
                response.setHeader("X-Cosmos-Operation-ID", existing.id);
                return { status: 202, body: existing };
            }
            const parsed = id === undefined ? createModelProviderCommandSchema.safeParse(body) : updateModelProviderCommandSchema.safeParse(body);
            if (!parsed.success) invalid();
            const receipt = await this.credentials.save({ idempotencyKey: keys[0]!, providerId: id ?? randomUUID(), command: parsed.data });
            response.setHeader("X-Cosmos-Operation-ID", receipt.id);
            if (receipt.replayed) return { status: 202, body: await this.query.operation(receipt.id) };
            if (receipt.state === "failed" && (receipt.errorCode === "version_conflict" || receipt.errorCode === "operation_in_progress")) {
                return { status: 409, body: { code: receipt.errorCode, message: "Model configuration operation conflict.", retryable: false, operationId: receipt.id } };
            }
            if (receipt.state !== "completed") {
                if (receipt.state === "pending") return { status: 202, body: await this.query.operation(receipt.id) };
                return { status: 503, body: { code: receipt.state === "cleanup_pending" ? "cleanup_pending" : "credential_write_failed", message: receipt.state === "cleanup_pending"
                    ? receipt.resourceVersion === null
                        ? "Configuration was not published; local credential cleanup is pending."
                        : "Configuration saved; local credential cleanup is pending."
                    : "Configuration was not published; credential storage failed.", retryable: true, operationId: receipt.id, resourceVersion: receipt.resourceVersion } };
            }
            return { status: id === undefined ? 201 : 200, body: modelProviderSnapshotSchema.parse(await this.query.get(receipt.providerId)) };
        });
    }
    private validId(value: string): boolean { return /^[A-Za-z0-9._:-]{1,200}$/.test(value); }
    private async respond(request: IncomingMessage, response: Response, use: () => Promise<{ status: number; body: unknown }>): Promise<void> {
        response.setHeader("Cache-Control", "no-store");
        try {
            const result = await use();
            response.status(result.status).json(result.body);
        } catch (error) {
            let code = "dependency_unavailable";
            try { if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string" && codes.has(error.code)) code = error.code; } catch { /* No dependency error data crosses this boundary. */ }
            if (!request.complete) {
                response.setHeader("Connection", "close");
            }
            const operationId = response.getHeader("X-Cosmos-Operation-ID");
            response.status(codes.get(code)!).json({ code, message: "Model configuration write rejected.", retryable: codes.get(code)! >= 500,
                ...(typeof operationId === "string" && this.validId(operationId) ? { operationId } : {}),
            });
        }
    }
}
