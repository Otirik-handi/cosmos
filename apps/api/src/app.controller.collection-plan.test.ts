import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";
import { CollectionPlanNotFoundError } from "@cosmos/application";

import { AppController } from "./app.controller.js";

const plan = {
    id: "plan:s1",
    name: "主账号动态每 30 分钟",
    sourceId: "s1",
    connectionId: "c1",
    mediaPolicy: null,
    overlapPolicy: "forbid",
    enabled: true,
    revisionId: "1",
    scheduleIntervalMs: 1_800_000,
    webhook: null,
    createdAt: "2026-09-20T08:00:00.000Z",
    updatedAt: "2026-09-20T08:00:00.000Z",
};

function controllerWith(repository: unknown) {
    return new AppController(
        repository as never,
        {} as never,
        undefined,
        undefined,
        undefined,
        undefined,
        undefined,
    );
}

describe("AppController collection plans (ADR-0023)", () => {
    it("lists and reads collection plans", async () => {
        const repository = {
            listCollectionPlans: vi.fn(async () => [plan]),
            getCollectionPlan: vi.fn(async (id: string) => (id === "plan:s1" ? plan : null)),
        };
        const controller = controllerWith(repository);

        await expect(controller.listCollectionPlans()).resolves.toHaveLength(1);
        await expect(controller.collectionPlan("plan:s1")).resolves.toMatchObject({
            id: "plan:s1",
            scheduleIntervalMs: 1_800_000,
        });
    });

    it("maps a missing collection plan to 404", async () => {
        const controller = controllerWith({ getCollectionPlan: vi.fn(async () => null) });
        await expect(controller.collectionPlan("missing")).rejects.toBeInstanceOf(NotFoundException);
    });

    it("rotates and revokes the webhook entry through the plan endpoints (ADR-0024)", async () => {
        const entry = {
            planId: "plan:s1",
            entryPath: "/hooks/collection-plans/tok_abc",
            credential: "plaintext-once",
        };
        const repository = {
            rotateCollectionPlanWebhookEntry: vi.fn(async () => entry),
            revokeCollectionPlanWebhookEntry: vi.fn(async () => ({ ...plan, webhook: null })),
        };
        const controller = controllerWith(repository);

        // 明文凭证只在这个响应里出现一次；撤销返回计划读投影（webhook 回到 null）。
        await expect(controller.rotateCollectionPlanWebhookEntry("plan:s1")).resolves.toEqual(entry);
        await expect(controller.revokeCollectionPlanWebhookEntry("plan:s1"))
            .resolves.toMatchObject({ id: "plan:s1", webhook: null });
        expect(repository.rotateCollectionPlanWebhookEntry).toHaveBeenCalledWith("plan:s1");
        expect(repository.revokeCollectionPlanWebhookEntry).toHaveBeenCalledWith("plan:s1");
    });

    it("maps a missing plan on the webhook endpoints to 404", async () => {
        const controller = controllerWith({
            rotateCollectionPlanWebhookEntry: vi.fn(async () => {
                throw new CollectionPlanNotFoundError("plan:missing");
            }),
        });
        await expect(controller.rotateCollectionPlanWebhookEntry("plan:missing"))
            .rejects.toBeInstanceOf(NotFoundException);
    });
});
