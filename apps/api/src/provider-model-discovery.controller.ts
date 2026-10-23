import "reflect-metadata";
import type { IncomingMessage } from "node:http";
import { Controller, Inject, Param, Post, Req, Res } from "@nestjs/common";
import type { ProviderModelDiscoveryRunner } from "@cosmos/application";
import { createProviderModelDiscoveryCommandSchema } from "@cosmos/contracts";

import { readModelConfigurationBody } from "./model-configuration-body-reader.js";

type Trust = Parameters<typeof readModelConfigurationBody>[1];
interface Response {
    setHeader(name: string, value: string): void;
    status(value: number): Response;
    json(value: unknown): void;
}

/**
 * 运行器错误码 → HTTP 契约码。运行器码描述“为什么没开始/没完成”，
 * HTTP 码要跟已发布的模型配置接口保持同一套词汇。
 */
const rejections = new Map<string, { status: number; code: string }>([
    ["not_found", { status: 404, code: "not_found" }],
    ["conflict", { status: 409, code: "version_conflict" }],
    ["unavailable", { status: 409, code: "credential_missing" }],
]);

const transportCodes = new Map<string, number>([
    ["invalid_input", 400], ["forbidden_origin", 403], ["payload_too_large", 413], ["dependency_unavailable", 503],
]);

function invalid(): never {
    throw Object.assign(new Error("Invalid model discovery command."), { code: "invalid_input" });
}

/**
 * 发现是同步只读请求：路由在响应里直接返回已完成的快照，
 * 不存在排队、轮询或任务 ID，因此重复提交只会多一次只读外呼。
 */
@Controller()
export class ProviderModelDiscoveryController {
    constructor(
        @Inject("COSMOS_MODEL_CONFIGURATION_TRUST") private readonly trust: Trust,
        @Inject("COSMOS_PROVIDER_MODEL_DISCOVERY") private readonly discovery: Pick<ProviderModelDiscoveryRunner, "discover">,
    ) {}

    @Post("model-providers/:id/discoveries")
    post(@Param("id") id: string, @Req() request: IncomingMessage, @Res() response: Response): Promise<void> {
        return this.respond(request, response, async () => {
            const body = await readModelConfigurationBody(request, this.trust);
            if (!this.validId(id)) invalid();
            // 路径 ID 是权威来源：body 里不允许出现 providerId，避免两处不一致。
            if (typeof body !== "object" || body === null || Array.isArray(body)) invalid();
            const keys = Object.keys(body);
            if (keys.length !== 1 || keys[0] !== "expectedProviderVersion") invalid();
            const parsed = createProviderModelDiscoveryCommandSchema.safeParse({ providerId: id, ...body });
            if (!parsed.success) invalid();
            return { status: 200, body: await this.discovery.discover(parsed.data) };
        });
    }

    private validId(value: string): boolean {
        return /^[A-Za-z0-9._:-]{1,200}$/.test(value);
    }

    private async respond(
        request: IncomingMessage,
        response: Response,
        use: () => Promise<{ status: number; body: unknown }>,
    ): Promise<void> {
        response.setHeader("Cache-Control", "no-store");
        try {
            const result = await use();
            response.status(result.status).json(result.body);
        } catch (error) {
            const rejection = this.rejectionFor(error);
            if (!request.complete) response.setHeader("Connection", "close");
            response.status(rejection.status).json({
                code: rejection.code,
                message: "Model discovery rejected.",
                retryable: rejection.status >= 500,
            });
        }
    }

    private rejectionFor(error: unknown): { status: number; code: string } {
        try {
            if (typeof error === "object" && error !== null && "code" in error && typeof error.code === "string") {
                const known = rejections.get(error.code);
                if (known) return known;
                const status = transportCodes.get(error.code);
                if (status !== undefined) return { status, code: error.code };
            }
        } catch { /* Dependency failures must not expose throwing error accessors. */ }
        return { status: 503, code: "dependency_unavailable" };
    }
}
