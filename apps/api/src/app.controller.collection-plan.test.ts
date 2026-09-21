import { describe, expect, it, vi } from "vitest";
import { NotFoundException } from "@nestjs/common";

import { AppController } from "./app.controller.js";

const plan = {
    id: "plan:s1",
    name: "主账号动态每 30 分钟",
    sourceId: "s1",
    connectionId: "c1",
    triggerBindingId: "t1",
    mediaPolicy: null,
    overlapPolicy: "forbid",
    enabled: true,
    revisionId: "1",
    scheduleIntervalMs: 1_800_000,
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
});
