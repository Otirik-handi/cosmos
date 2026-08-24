import fc from "fast-check";
import { describe, expect, it } from "vitest";

import {
    IngestWorkflowControlService,
    type IngestWorkflowInputSnapshot,
} from "./workflow-control.js";
import {
    WorkflowHostConflictError,
    type CreateWorkflowEnvelopeInput,
    type WorkflowEnvelope,
    type WorkflowHostStore,
} from "./workflow-host.js";

const sourceArbitrary = fc
    .string({ minLength: 1, maxLength: 24 })
    .filter((value) => value.trim().length > 0);
const keyArbitrary = fc
    .string({ minLength: 1, maxLength: 40 })
    .filter((value) => value.trim().length > 0);
const triggerArbitrary = fc.constantFrom<"manual" | "schedule">("manual", "schedule");

function createHarness() {
    let envelope: WorkflowEnvelope | null = null;
    let createCount = 0;
    let sourceReadCount = 0;
    let checkpointReadCount = 0;
    let nextRun = 0;

    const sourceFor = (sourceId: string): IngestWorkflowInputSnapshot["source"] => ({
        id: sourceId,
        name: "Fixture source",
        sourceDefinitionRef: "source.fixture-rss@1",
        operationId: "fetch",
        connectorId: "fixture-rss",
        kind: "fixture-rss",
        config: { fixturePath: "fixtures/rss/feed.xml" },
        enabled: true,
        revisionId: `${sourceId}:1`,
        createdAt: "2026-08-16T00:00:00.000Z",
        updatedAt: "2026-08-16T00:00:00.000Z",
    });

    const store = {
        findWorkflowEnvelopeByIdempotencyKey: async (key: string) =>
            envelope?.idempotencyKey === key ? envelope : null,
        createWorkflowEnvelope: async (input: CreateWorkflowEnvelopeInput) => {
            createCount += 1;
            const now = input.createdAt ?? "2026-08-16T00:00:00.000Z";
            envelope = {
                runId: input.runId,
                idempotencyKey: input.idempotencyKey ?? null,
                definition: input.definition,
                inputSnapshot: input.inputSnapshot,
                productRun: input.productRun,
                status: "queued",
                resumeRequired: false,
                createdAt: now,
                updatedAt: now,
                startedAt: null,
                finishedAt: null,
            };
            return envelope;
        },
    } as unknown as WorkflowHostStore;

    const service = new IngestWorkflowControlService({
        store,
        getSourceExecutionSnapshot: async (sourceId) => {
            sourceReadCount += 1;
            return sourceFor(sourceId);
        },
        getCheckpointSnapshot: async () => {
            checkpointReadCount += 1;
            return { cursor: null, revision: 0 };
        },
        ids: {
            nextId: () => {
                nextRun += 1;
                return `run-${nextRun}`;
            },
        },
    });

    return {
        service,
        counts: {
            get create() {
                return createCount;
            },
            get sourceRead() {
                return sourceReadCount;
            },
            get checkpointRead() {
                return checkpointReadCount;
            },
        },
    };
}

describe("IngestWorkflowControlService properties", () => {
    it("returns the same durable envelope for repeated equivalent identities", async () => {
        await fc.assert(
            fc.asyncProperty(sourceArbitrary, keyArbitrary, triggerArbitrary, async (sourceId, key, triggerKind) => {
                const harness = createHarness();
                const first = await harness.service.enqueue({ sourceId, idempotencyKey: key, triggerKind });
                const second = await harness.service.enqueue({ sourceId, idempotencyKey: key, triggerKind });

                expect(second).toEqual(first);
                expect(harness.counts.create).toBe(1);
                expect(harness.counts.sourceRead).toBe(1);
                expect(harness.counts.checkpointRead).toBe(1);
            }),
            { numRuns: 100 },
        );
    });

    it("rejects a reused key when source or trigger identity changes", async () => {
        await fc.assert(
            fc.asyncProperty(
                sourceArbitrary,
                sourceArbitrary,
                keyArbitrary,
                triggerArbitrary,
                triggerArbitrary,
                async (firstSourceId, secondSourceId, key, firstTriggerKind, secondTriggerKind) => {
                    fc.pre(
                        firstSourceId.trim() !== secondSourceId.trim()
                            || firstTriggerKind !== secondTriggerKind,
                    );
                    const harness = createHarness();
                    await harness.service.enqueue({
                        sourceId: firstSourceId,
                        idempotencyKey: key,
                        triggerKind: firstTriggerKind,
                    });

                    await expect(harness.service.enqueue({
                        sourceId: secondSourceId,
                        idempotencyKey: key,
                        triggerKind: secondTriggerKind,
                    })).rejects.toBeInstanceOf(WorkflowHostConflictError);
                    expect(harness.counts.create).toBe(1);
                },
            ),
            { numRuns: 100 },
        );
    });
});
