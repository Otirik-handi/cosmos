import "reflect-metadata";

import { BadRequestException, ConflictException, HttpException, NotFoundException } from "@nestjs/common";
// Nest 未在类型层暴露 constants 子路径,运行时可用;键名与 @nestjs/common 11 实测一致。
// @ts-expect-error 该子路径无类型声明
import { HTTP_CODE_METADATA, PATH_METADATA } from "@nestjs/common/constants";
import { describe, expect, it, vi } from "vitest";

import {
    HookController,
    WEBHOOK_ENTRY_ROUTE_PATH,
    WEBHOOK_MAX_BODY_BYTES,
    WEBHOOK_MAX_REQUESTS_PER_MINUTE,
} from "./hook.controller.js";

const target = {
    planId: "plan:s1",
    sourceId: "s1",
    bindingId: "hook-1",
    secretRef: "secret:webhook-1",
    planEnabled: true,
    bindingEnabled: true,
};

function envelope() {
    return {
        runId: "run-1",
        idempotencyKey: "evt-1",
        definition: { key: "cosmos.ingest", version: "1", manifestHash: "builtin:cosmos.ingest@1:source-snapshot-v2" },
        inputSnapshot: {},
        productRun: { status: "queued", sourceId: "s1", triggerKind: "webhook" },
        status: "queued",
        resumeRequired: false,
        createdAt: "2026-09-22T10:00:00.000Z",
        updatedAt: "2026-09-22T10:00:00.000Z",
        startedAt: null,
        finishedAt: null,
    };
}

function controllerWith(overrides: Record<string, unknown> = {}, workflowControl: unknown = { enqueue: vi.fn(async () => envelope()) }) {
    const repository = {
        resolveCollectionPlanWebhookEntry: vi.fn(async () => target),
        verifyCollectionPlanWebhookCredential: vi.fn(async () => true),
        ...overrides,
    };
    const controller = new HookController(repository as never, workflowControl as never, undefined);
    return { controller, repository };
}

describe("HookController webhook 入口 (ADR-0024)", () => {
    it("入口路由声明与 main.ts 的排除路径共用同一个常量，并返回 202", () => {
        const handler = HookController.prototype.triggerCollectionPlan;
        expect(Reflect.getMetadata(PATH_METADATA, handler)).toBe(WEBHOOK_ENTRY_ROUTE_PATH);
        expect(Reflect.getMetadata(HTTP_CODE_METADATA, handler)).toBe(202);
    });

    it("正确凭证：入队一次 webhook Run，并带上触发证据", async () => {
        const enqueue = vi.fn(async () => envelope());
        const { controller } = controllerWith({}, { enqueue });

        const run = await controller.triggerCollectionPlan("tok", "cred", "evt-1", "2", {});

        expect(run).toMatchObject({ id: "run-1", triggerKind: "webhook", status: "queued" });
        expect(enqueue).toHaveBeenCalledTimes(1);
        expect(enqueue).toHaveBeenCalledWith({
            sourceId: "s1",
            triggerKind: "webhook",
            idempotencyKey: "evt-1",
            triggerEvidence: expect.objectContaining({ bindingId: "hook-1", externalEventId: "evt-1" }),
        });
    });

    it("入口不存在与凭证不对返回同一个结果，且都不入队", async () => {
        const unknown = controllerWith({ resolveCollectionPlanWebhookEntry: vi.fn(async () => null) }, { enqueue: vi.fn() });
        await expect(unknown.controller.triggerCollectionPlan("nope", "cred", "evt-1", "2", {}))
            .rejects.toBeInstanceOf(NotFoundException);

        const wrongCredential = controllerWith({ verifyCollectionPlanWebhookCredential: vi.fn(async () => false) }, { enqueue: vi.fn() });
        const failure = await wrongCredential.controller.triggerCollectionPlan("tok", "bad", "evt-1", "2", {})
            .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(NotFoundException);
        expect((failure as NotFoundException).getResponse()).toEqual({
            code: "not_found",
            message: "Webhook entry not found.",
            retryable: false,
        });
    });

    it("凭证缺失时不入队", async () => {
        const enqueue = vi.fn();
        const { controller, repository } = controllerWith({}, { enqueue });
        await expect(controller.triggerCollectionPlan("tok", undefined, "evt-1", "2", {}))
            .rejects.toBeInstanceOf(NotFoundException);
        expect(repository.verifyCollectionPlanWebhookCredential).not.toHaveBeenCalled();
        expect(enqueue).not.toHaveBeenCalled();
    });

    it("外部事件标识必填：它是幂等键，缺失或超长都拒绝", async () => {
        const enqueue = vi.fn();
        const { controller } = controllerWith({}, { enqueue });
        await expect(controller.triggerCollectionPlan("tok", "cred", undefined, "2", {}))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.triggerCollectionPlan("tok", "cred", "x".repeat(301), "2", {}))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it("请求体超过上限时 413，且不入队", async () => {
        const enqueue = vi.fn();
        const { controller } = controllerWith({}, { enqueue });
        const failure = await controller.triggerCollectionPlan("tok", "cred", "evt-1", String(WEBHOOK_MAX_BODY_BYTES + 1), {})
            .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(HttpException);
        expect((failure as HttpException).getStatus()).toBe(413);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it("超过速率上限时 429，且不入队", async () => {
        const enqueue = vi.fn(async () => envelope());
        const { controller } = controllerWith({}, { enqueue });
        for (let index = 0; index < WEBHOOK_MAX_REQUESTS_PER_MINUTE; index += 1) {
            await controller.triggerCollectionPlan("tok", "cred", `evt-${index}`, "2", {});
        }
        const failure = await controller.triggerCollectionPlan("tok", "cred", "evt-over", "2", {})
            .catch((error: unknown) => error);
        expect(failure).toBeInstanceOf(HttpException);
        expect((failure as HttpException).getStatus()).toBe(429);
        expect(enqueue).toHaveBeenCalledTimes(WEBHOOK_MAX_REQUESTS_PER_MINUTE);
    });

    it("计划或触发器停用、durable host 未启用时都是 409", async () => {
        const disabled = controllerWith({ resolveCollectionPlanWebhookEntry: vi.fn(async () => ({ ...target, planEnabled: false })) }, { enqueue: vi.fn() });
        await expect(disabled.controller.triggerCollectionPlan("tok", "cred", "evt-1", "2", {}))
            .rejects.toBeInstanceOf(ConflictException);

        const bindingDisabled = controllerWith({ resolveCollectionPlanWebhookEntry: vi.fn(async () => ({ ...target, bindingEnabled: false })) }, { enqueue: vi.fn() });
        await expect(bindingDisabled.controller.triggerCollectionPlan("tok", "cred", "evt-1", "2", {}))
            .rejects.toBeInstanceOf(ConflictException);

        // legacy 泳道记不下触发原因，所以没有 durable host 时拒绝而不是降级。
        // 传 null 而不是 undefined：undefined 会触发 helper 的默认参数。
        const { controller } = controllerWith({}, null);
        await expect(controller.triggerCollectionPlan("tok", "cred", "evt-1", "2", {}))
            .rejects.toBeInstanceOf(ConflictException);
    });
});
