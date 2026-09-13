import {
    afterEach,
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import { WorkflowHostConflictError } from "@cosmos/application";
import { AppController } from "./app.controller.js";
describe("AppController workflow conflicts", () => {
    it("maps an idempotency identity conflict to HTTP 409", async () => {
        const repository = {
            getSource: vi.fn().mockResolvedValue({
                id: "source-1",
                name: "Fixture",
                sourceDefinitionRef: "source.fixture-rss@1",
                operationId: "fetch",
                connectorId: "fixture-rss",
                kind: "fixture-rss",
                config: {},
                enabled: true,
                revisionId: "source-1:1",
                createdAt: "2026-08-08T00:00:00.000Z",
                updatedAt: "2026-08-08T00:00:00.000Z",
                lastRunAt: null,
                lastError: null,
            }),
        };
        const workflowControl = {
            enqueue: vi.fn().mockRejectedValue(
                new WorkflowHostConflictError("Idempotency key already belongs to another source run."),
            ),
        };
        const controller = new AppController(
            repository as never,
            {} as never,
            undefined,
            workflowControl as never,
        );

        const error = await controller.runSource("source-1", "run-key").catch((value) => value);

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.getStatus()).toBe(409);
        expect(error.getResponse()).toMatchObject({
            code: "conflict",
            retryable: false,
        });
    });
});

describe("AppController media cleanup (ADR-0015)", () => {
    function controllerWith(input: {
        report?: unknown;
        enqueue?: (command: unknown) => Promise<unknown>;
    }): { controller: AppController; enqueue: ReturnType<typeof vi.fn> } {
        const enqueue = vi.fn(input.enqueue ?? (async () => ({
            runId: "run-cleanup",
            status: "queued",
            productRun: { status: "queued" },
        })));
        const repository = {
            getMediaCleanupReport: vi.fn().mockResolvedValue(input.report ?? null),
        };
        const controller = new AppController(
            repository as never,
            {} as never,
            undefined,
            undefined,
            undefined,
            { enqueue } as never,
        );
        return { controller, enqueue };
    }

    it("previews by default and never deletes on an implicit dry run", async () => {
        const { controller, enqueue } = controllerWith({});
        const snapshot = await controller.createMediaCleanup({}, undefined);
        expect(enqueue).toHaveBeenCalledWith({
            sourceId: null,
            dryRun: true,
            idempotencyKey: expect.stringContaining("media-cleanup:"),
        });
        expect(snapshot).toMatchObject({ runId: "run-cleanup", status: "queued", report: null });
    });

    it("passes an explicit confirm command and surfaces the report", async () => {
        const report = {
            dryRun: false,
            sourceId: "source-1",
            candidateCount: 2,
            candidateBytes: 2048,
            cleanedCount: 2,
            cleanedBytes: 2048,
            sharedKeyCount: 0,
            samples: [],
            startedAt: "2026-09-09T00:00:00.000Z",
            finishedAt: "2026-09-09T00:00:01.000Z",
        };
        const { controller, enqueue } = controllerWith({
            report,
            enqueue: async () => ({
                runId: "run-cleanup",
                status: "completed",
                productRun: { status: "completed" },
            }),
        });
        const snapshot = await controller.createMediaCleanup(
            { sourceId: "source-1", dryRun: false },
            "cleanup-key",
        );
        expect(enqueue).toHaveBeenCalledWith({
            sourceId: "source-1",
            dryRun: false,
            idempotencyKey: "cleanup-key",
        });
        expect(snapshot).toMatchObject({
            runId: "run-cleanup",
            status: "succeeded",
            report: { cleanedCount: 2 },
        });
    });

    it("rejects an unknown command field before touching the workflow store", async () => {
        const { controller, enqueue } = controllerWith({});
        await expect(controller.createMediaCleanup({ unexpected: true }, undefined))
            .rejects.toBeInstanceOf(BadRequestException);
        expect(enqueue).not.toHaveBeenCalled();
    });

    it("returns 404 for an unknown cleanup run", async () => {
        const controller = new AppController(
            {} as never,
            {} as never,
            undefined,
            undefined,
            { loadWorkflowEnvelope: async () => null } as never,
            {} as never,
        );
        await expect(controller.mediaCleanup("missing"))
            .rejects.toBeInstanceOf(NotFoundException);
    });
});

describe("AppController SSE", () => {
    afterEach(() => {
        delete process.env.COSMOS_SSE_REPLAY_LIMIT;
    });

    it("requests a snapshot when the replay window cannot be filled", async () => {
        process.env.COSMOS_SSE_REPLAY_LIMIT = "1";
        const repository = {
            events: vi.fn().mockResolvedValue([
                {
                    id: "1",
                    type: "run.queued.v1",
                    version: "v1",
                    occurredAt: "2026-08-08T00:00:00.000Z",
                    payload: { runId: "run-1" },
                },
                {
                    id: "2",
                    type: "feed.updated.v1",
                    version: "v1",
                    occurredAt: "2026-08-08T00:00:01.000Z",
                    payload: { storyId: "story-1" },
                },
            ]),
            latestEventSequence: vi.fn().mockResolvedValue(2),
        };
        const controller = new AppController(
            repository as never,
            {} as never,
        );
        const observable = controller.events(undefined, "0");

        const event = await new Promise<{ data: string }>((resolve) => {
            let subscription: { unsubscribe(): void };
            subscription = observable.subscribe({
                next: (value) => {
                    resolve(value as { data: string });
                    subscription.unsubscribe();
                },
            });
        });

        const payload = JSON.parse(event.data) as {
            type: string;
            payload: { latestEventId: string };
        };
        expect(payload.type).toBe("snapshot_required");
        expect(payload.payload.latestEventId).toBe("2");
    });
});

describe("AppController WorkflowRun projection", () => {
    it("maps internal waiting and completed states to the Product Run contract", async () => {
        const store = {
            loadWorkflowEnvelope: vi.fn(),
        };
        const controller = new AppController(
            {} as never,
            {} as never,
            undefined,
            undefined,
            store as never,
        );
        const base = {
            runId: "workflow-run-1",
            idempotencyKey: "run-1",
            definition: {
                key: "cosmos.ingest",
                version: "1",
                manifestHash: "builtin:ingest",
            },
            inputSnapshot: {},
            productRun: {
                sourceId: "source-1",
                triggerKind: "manual",
            },
            resumeRequired: false,
            createdAt: "2026-08-16T00:00:00.000Z",
            updatedAt: "2026-08-16T00:00:01.000Z",
            startedAt: "2026-08-16T00:00:00.100Z",
            finishedAt: null,
        };
        store.loadWorkflowEnvelope.mockResolvedValue({ ...base, status: "waiting" });
        await expect(controller.run("workflow-run-1")).resolves.toMatchObject({ status: "running" });
        store.loadWorkflowEnvelope.mockResolvedValue({
            ...base,
            status: "completed",
            finishedAt: "2026-08-16T00:00:01.000Z",
        });
        await expect(controller.run("workflow-run-1")).resolves.toMatchObject({
            status: "succeeded",
            finishedAt: "2026-08-16T00:00:01.000Z",
        });
    });
});
