import { describe, expect, it } from "vitest";

import {
    IngestWorkflowControlService,
    type IngestWorkflowInputSnapshot,
} from "./workflow-control.js";
import {
    WorkflowHostConflictError,
    WorkflowHostError,
    type CreateWorkflowEnvelopeInput,
    type WorkflowEnvelope,
    type WorkflowHostStore,
} from "./workflow-host.js";

const source: IngestWorkflowInputSnapshot["source"] = {
    id: "source-1",
    name: "Fixture source",
    sourceDefinitionRef: "source.fixture-rss@1",
    operationId: "fetch",
    connectorId: "fixture-rss",
    kind: "fixture-rss",
    config: { fixturePath: "fixtures/rss/feed.xml" },
    enabled: true,
    revisionId: "source-1:1",
    createdAt: "2026-08-16T00:00:00.000Z",
    updatedAt: "2026-08-16T00:00:00.000Z",
};

function ingestEnvelope(overrides: Partial<WorkflowEnvelope> = {}): WorkflowEnvelope {
    return {
        runId: "run-1",
        idempotencyKey: "k1",
        definition: { key: "cosmos.ingest", version: "1", manifestHash: "builtin:cosmos.ingest@1:source-snapshot-v2" },
        inputSnapshot: {
            source,
            cursor: null,
            checkpointRevision: 0,
            triggerKind: "manual",
        } as unknown as WorkflowEnvelope["inputSnapshot"],
        productRun: { status: "failed", sourceId: "source-1", triggerKind: "manual" },
        status: "failed",
        resumeRequired: false,
        createdAt: "2026-08-16T00:00:00.000Z",
        updatedAt: "2026-08-16T00:00:00.000Z",
        startedAt: "2026-08-16T00:00:01.000Z",
        finishedAt: "2026-08-16T00:00:02.000Z",
        ...overrides,
    };
}

function createHarness(existing: WorkflowEnvelope | null) {
    let createCount = 0;
    let sourceReadCount = 0;
    let checkpointReadCount = 0;
    let createdEnvelope: WorkflowEnvelope | null = null;

    const store = {
        loadWorkflowEnvelope: async (runId: string) => (existing?.runId === runId ? existing : null),
        findWorkflowEnvelopeByIdempotencyKey: async (key: string) =>
            createdEnvelope?.idempotencyKey === key ? createdEnvelope : null,
        createWorkflowEnvelope: async (input: CreateWorkflowEnvelopeInput) => {
            createCount += 1;
            const now = input.createdAt ?? "2026-08-16T00:00:00.000Z";
            createdEnvelope = {
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
            return createdEnvelope;
        },
    } as unknown as WorkflowHostStore;

    const service = new IngestWorkflowControlService({
        store,
        getSourceExecutionSnapshot: async (sourceId) => {
            sourceReadCount += 1;
            return { ...source, id: sourceId };
        },
        getCheckpointSnapshot: async () => {
            checkpointReadCount += 1;
            return { cursor: null, revision: 0 };
        },
        ids: { nextId: () => `run-new` },
    });

    return {
        service,
        get createCount() {
            return createCount;
        },
        get sourceReadCount() {
            return sourceReadCount;
        },
        get checkpointReadCount() {
            return checkpointReadCount;
        },
    };
}

describe("IngestWorkflowControlService.rerun", () => {
    it("enqueues a fresh manual Run for a terminal ingest Run", async () => {
        const harness = createHarness(ingestEnvelope());
        const result = await harness.service.rerun({ runId: "run-1", idempotencyKey: "rerun-key" });

        expect(result.runId).toBe("run-new");
        expect(result.status).toBe("queued");
        expect(result.idempotencyKey).toBe("rerun-key");
        expect(result.productRun).toMatchObject({ sourceId: "source-1", triggerKind: "manual" });
        expect(harness.createCount).toBe(1);
        expect(harness.sourceReadCount).toBe(1);
        expect(harness.checkpointReadCount).toBe(1);
    });

    it("rejects a non-terminal Run", async () => {
        const harness = createHarness(ingestEnvelope({ status: "running" }));
        await expect(harness.service.rerun({ runId: "run-1", idempotencyKey: "rerun-key" }))
            .rejects.toBeInstanceOf(WorkflowHostConflictError);
        expect(harness.createCount).toBe(0);
    });

    it("rejects a missing Run", async () => {
        const harness = createHarness(null);
        await expect(harness.service.rerun({ runId: "missing", idempotencyKey: "rerun-key" }))
            .rejects.toMatchObject({ code: "not_found" });
        expect(harness.createCount).toBe(0);
    });

    it("rejects a non-ingest Run whose input snapshot is not an ingest shape", async () => {
        const nonIngest = ingestEnvelope({
            inputSnapshot: { sourceId: "source-1", dryRun: true },
            status: "completed",
        });
        const harness = createHarness(nonIngest);
        await expect(harness.service.rerun({ runId: "run-1", idempotencyKey: "rerun-key" }))
            .rejects.toBeInstanceOf(WorkflowHostError);
        expect(harness.createCount).toBe(0);
    });
});
