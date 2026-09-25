import { describe, expect, it } from "vitest";

import { withRepository } from "./index.fixtures.js";

describe("PrismaCosmosRepository trigger binding (ADR-0018)", () => {
    it("creates a schedule TriggerBinding on source create and exposes it", async () => {
        await withRepository("trigger-binding", async (repository) => {
            const source = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
                scheduleIntervalMs: 60_000,
            });
            expect(source.scheduleIntervalMs).toBe(60_000);

            // Disabled plans are excluded from the scheduler loop.
            await expect(repository.listScheduleTriggers()).resolves.toEqual([]);

            const activated = await repository.updateCollectionPlan(source.planId, {
                enabled: true,
                baseRevisionId: source.planRevisionId,
            });
            expect(activated.scheduleIntervalMs).toBe(60_000);
            await expect(repository.listScheduleTriggers()).resolves.toEqual([
                { planId: `plan:${source.id}`, sourceId: source.id, intervalMs: 60_000, lastRunAt: null },
            ]);
        });
    });

    it("upserts and removes the schedule via the plan endpoint", async () => {
        await withRepository("trigger-binding", async (repository) => {
            const source = await repository.createSource({
                name: "动态",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                config: {},
            });
            expect(source.scheduleIntervalMs).toBeNull();

            const scheduled = await repository.updateCollectionPlan(source.planId, {
                baseRevisionId: source.planRevisionId,
                scheduleIntervalMs: 120_000,
            });
            expect(scheduled.scheduleIntervalMs).toBe(120_000);

            const cleared = await repository.updateCollectionPlan(source.planId, {
                baseRevisionId: scheduled.revisionId,
                scheduleIntervalMs: null,
            });
            expect(cleared.scheduleIntervalMs).toBeNull();
            await expect(repository.listScheduleTriggers()).resolves.toEqual([]);
        });
    });
});
