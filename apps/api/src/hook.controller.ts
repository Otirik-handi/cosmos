import {
    BadRequestException,
    Bind,
    Body,
    ConflictException,
    Controller,
    Headers,
    HttpCode,
    HttpException,
    HttpStatus,
    Inject,
    NotFoundException,
    Optional,
    Param,
    Post,
} from "@nestjs/common";
import { WorkflowHostConflictError, type CosmosRepository } from "@cosmos/application";
import type { IngestWorkflowControlService } from "@cosmos/application/workflow-control";
import { idempotencyKeySchema } from "@cosmos/contracts";
import type { Logger } from "@cosmos/logging";
import "reflect-metadata";
import { toPublicWorkflowRun } from "./app.controller/internals.js";
import { WebhookEntryRateLimiter } from "./webhook-rate-limiter.js";

/** 入口请求体积上限：外部自动化只需要带一个事件标识，16 KB 足够。 */
export const WEBHOOK_MAX_BODY_BYTES = 16 * 1024;
/** 单入口速率上限：每分钟 30 次。 */
export const WEBHOOK_MAX_REQUESTS_PER_MINUTE = 30;
/**
 * 入口路由的声明路径。`main.ts` 用同一个常量把这条路由排除在全局 `/api/v1` 前缀之外，
 * 两处必须一致——否则入口会被挂到产品 API 的版本路径下，产品契约会被外部调用污染。
 */
export const WEBHOOK_ENTRY_ROUTE_PATH = "hooks/collection-plans/:token";

/**
 * Webhook 入口（ADR-0024）。它**不在** `/api/v1` 下（`main.ts` 把这条路由排除在全局前缀
 * 之外）：调用方是用户自己的自动化，不是产品客户端，所以它不带产品 API 的版本语义。
 *
 * 这个端点是一个外部副作用面，因此四道闸门缺一不可：体积上限、速率上限、常量时间凭证
 * 校验、幂等（外部事件标识就是幂等键）。凭证只从 header 读，明文从不回显、从不进日志。
 */
@Controller()
export class HookController {
    private readonly limiter = new WebhookEntryRateLimiter(WEBHOOK_MAX_REQUESTS_PER_MINUTE, 60_000);

    constructor(
        @Inject("COSMOS_PRODUCT_PORT")
        private readonly repository: CosmosRepository,
        @Optional()
        @Inject("COSMOS_WORKFLOW_CONTROL")
        private readonly workflowControl?: IngestWorkflowControlService,
        @Optional()
        @Inject("COSMOS_LOGGER")
        private readonly logger?: Logger,
    ) {}

    @Post(WEBHOOK_ENTRY_ROUTE_PATH)
    @HttpCode(HttpStatus.ACCEPTED)
    @Bind(
        Param("token"),
        Headers("x-cosmos-credential"),
        Headers("x-cosmos-event-id"),
        Headers("content-length"),
        Body(),
    )
    async triggerCollectionPlan(
        token: string,
        credential?: string,
        eventId?: string,
        contentLength?: string,
        body?: unknown,
    ) {
        const declaredLength = Number.parseInt(contentLength ?? "", 10);
        if (Number.isFinite(declaredLength) && declaredLength > WEBHOOK_MAX_BODY_BYTES) {
            throw this.tooLarge();
        }
        if (body !== undefined && Buffer.byteLength(JSON.stringify(body) ?? "", "utf8") > WEBHOOK_MAX_BODY_BYTES) {
            throw this.tooLarge();
        }
        if (!this.limiter.take(token, Date.now())) {
            throw new HttpException({
                code: "rate_limited",
                message: "Too many webhook requests for this entry.",
                retryable: true,
            }, HttpStatus.TOO_MANY_REQUESTS);
        }

        const target = await this.repository.resolveCollectionPlanWebhookEntry(token);
        // 缺凭证直接拒绝，连校验都不调用：没有凭证就没有可比较的值。
        const credentialAccepted = credential !== undefined && target?.secretRef
            ? await this.repository.verifyCollectionPlanWebhookCredential(target.secretRef, credential)
            : false;
        if (!target || !credentialAccepted) {
            // 「入口不存在」与「凭证不对」返回同一个结果：否则这个端点就成了枚举入口的工具。
            throw new NotFoundException({
                code: "not_found",
                message: "Webhook entry not found.",
                retryable: false,
            });
        }

        const parsedEventId = idempotencyKeySchema.safeParse(eventId ?? "");
        if (!parsedEventId.success) {
            throw new BadRequestException({
                code: "validation_failed",
                message: "X-Cosmos-Event-Id must be 1-300 characters.",
                retryable: false,
            });
        }
        if (!target.bindingEnabled || !target.planEnabled) {
            throw new ConflictException({
                code: "conflict",
                message: "The collection plan is not enabled.",
                retryable: false,
            });
        }
        if (!this.workflowControl) {
            // 触发证据只能由 durable 入队路径固化；legacy 泳道记不下原因，所以这里拒绝
            // 而不是降级（ADR-0024 决定 4）。
            throw new ConflictException({
                code: "conflict",
                message: "The durable workflow host is not enabled.",
                retryable: false,
            });
        }

        try {
            const envelope = await this.workflowControl.enqueue({
                sourceId: target.sourceId,
                triggerKind: "webhook",
                idempotencyKey: parsedEventId.data,
                triggerEvidence: {
                    bindingId: target.bindingId,
                    externalEventId: parsedEventId.data,
                    receivedAt: new Date().toISOString(),
                },
            });
            const run = toPublicWorkflowRun(envelope);
            this.logger?.info("collection_plan.webhook.accepted", {
                planId: target.planId,
                bindingId: target.bindingId,
                runId: run.id,
                status: run.status,
            });
            return run;
        } catch (error) {
            if (error instanceof WorkflowHostConflictError) {
                throw new ConflictException({
                    code: "conflict",
                    message: error.message,
                    retryable: false,
                });
            }
            throw error;
        }
    }

    private tooLarge(): HttpException {
        return new HttpException({
            code: "payload_too_large",
            message: `Webhook payload must not exceed ${WEBHOOK_MAX_BODY_BYTES} bytes.`,
            retryable: false,
        }, HttpStatus.PAYLOAD_TOO_LARGE);
    }
}
