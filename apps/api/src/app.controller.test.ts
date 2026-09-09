import { afterEach, describe, expect, it, vi } from "vitest";
import { BadRequestException, ConflictException, InternalServerErrorException, NotFoundException } from "@nestjs/common";

import {
    EntityNotFoundError,
    EntityRelationConflictError,
    EntityRevisionConflictError,
    EntryNotFoundError,
    EntryStoryLinkConflictError,
    StoryMergeConflictError,
    StoryNotFoundError,
    StoryRevisionConflictError,
    TopicMembershipNotFoundError,
    TopicMergeConflictError,
    TopicNotFoundError,
    TopicRevisionConflictError,
    WorkflowHostConflictError,
    LabelNotFoundError,
    CollectionNotFoundError,
    AnnotationNotFoundError,
    SavedViewNotFoundError,
    BoardBlockNotFoundError,
    BoardNameConflictError,
    BoardNotFoundError,
    SpotlightPlacementNotFoundError,
} from "@cosmos/application";
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

describe("AppController source run gating", () => {
    function sourceFixture(enabled: boolean) {
        return {
            id: "source-1",
            name: "Fixture",
            sourceDefinitionRef: "source.fixture-rss@1",
            operationId: "fetch",
            connectorId: "fixture-rss",
            kind: "fixture-rss",
            config: {},
            enabled,
            revisionId: "source-1:1",
            createdAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:00:00.000Z",
            lastRunAt: null,
            lastError: null,
        };
    }

    it("rejects a manual run for a disabled source", async () => {
        const repository = { getSource: vi.fn().mockResolvedValue(sourceFixture(false)) };
        const workflowControl = { enqueue: vi.fn() };
        const controller = new AppController(
            repository as never,
            {} as never,
            undefined,
            workflowControl as never,
        );

        const error = await controller.runSource("source-1").catch((value) => value);

        expect(error).toBeInstanceOf(ConflictException);
        expect(error.getResponse()).toMatchObject({ code: "conflict", retryable: false });
        expect(workflowControl.enqueue).not.toHaveBeenCalled();
    });

    it("rejects an oversized idempotency key before queueing a run", async () => {
        const repository = { getSource: vi.fn().mockResolvedValue(sourceFixture(true)) };
        const workflowControl = { enqueue: vi.fn() };
        const controller = new AppController(
            repository as never,
            {} as never,
            undefined,
            workflowControl as never,
        );

        const error = await controller.runSource("source-1", "k".repeat(301)).catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ code: "validation_failed" });
        expect(workflowControl.enqueue).not.toHaveBeenCalled();
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

describe("AppController source probe", () => {
    it("queues a probe job without invoking a connector in the API process", async () => {
        const repository = {
            getSource: vi.fn().mockResolvedValue({
                id: "source-1",
                name: "AI HOT",
                sourceDefinitionRef: "source.aihot@1",
                operationId: "fetch",
                connectorId: "aihot",
                kind: "aihot",
                config: {},
                enabled: true,
                revisionId: "source-1:1",
                createdAt: "2026-08-08T00:00:00.000Z",
                updatedAt: "2026-08-08T00:00:00.000Z",
                lastRunAt: null,
                lastError: null,
            }),
            createProbeJob: vi.fn().mockResolvedValue({
                id: "job-1",
                kind: "source-probe",
                sourceId: "source-1",
                runId: null,
                status: "queued",
            }),
        };
        const logger = {
            info: vi.fn(),
        };
        const controller = new AppController(
            repository as never,
            {} as never,
            logger as never,
        );

        const result = await controller.testSource("source-1", "probe-1");

        expect(result).toMatchObject({
            id: "job-1",
            kind: "source-probe",
            status: "queued",
        });
        expect(repository.createProbeJob).toHaveBeenCalledWith({
            sourceId: "source-1",
            idempotencyKey: "probe-1",
        });
        expect(logger.info).toHaveBeenCalledWith("job.queued", {
            jobId: "job-1",
            sourceId: "source-1",
            kind: "source-probe",
            status: "queued",
        });
    });

    it("bridges a queued Run to the request logger", async () => {
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
            createQueuedRun: vi.fn().mockResolvedValue({
                id: "run-1",
                sourceId: "source-1",
                triggerKind: "manual",
                status: "queued",
            }),
        };
        const logger = {
            info: vi.fn(),
        };
        const controller = new AppController(
            repository as never,
            {} as never,
            logger as never,
        );

        await controller.runSource("source-1", "run-1");

        expect(logger.info).toHaveBeenCalledWith("run.queued", {
            runId: "run-1",
            sourceId: "source-1",
            triggerKind: "manual",
            status: "queued",
        });
    });

    it("projects attempts without exposing lease tokens", async () => {
        const attempt = {
            id: "job-1:attempt:1",
            jobId: "job-1",
            number: 1,
            workerId: "worker-1",
            workerInstanceId: "worker-1",
            ownerEpoch: 0,
            ownerSessionId: null,
            status: "succeeded" as const,
            leaseAcquiredAt: "2026-08-08T00:00:00.000Z",
            leaseExpiresAt: "2026-08-08T00:01:00.000Z",
            lastHeartbeatAt: null,
            finishedAt: "2026-08-08T00:00:01.000Z",
            error: null,
        };
        const repository = {
            listWorkflowAttempts: vi.fn().mockResolvedValue([attempt]),
            getWorkflowAttempt: vi.fn().mockResolvedValue(attempt),
        };
        const controller = new AppController(repository as never, {} as never);

        const page = await controller.attempts("job-1");
        expect(page.items).toEqual([attempt]);
        expect(page).toMatchObject({ nextCursor: null });
        expect(page.items[0]).not.toHaveProperty("leaseToken");
        await expect(controller.attempt("job-1:attempt:1")).resolves.toEqual(attempt);
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

describe("AppController source config probes", () => {
    const probeCommand = {
        sourceDefinitionRef: "source.rss@1",
        operationId: "fetch",
        config: { feedUrl: "https://example.test/feed.xml" },
    };
    const probeJob = {
        id: "probe-job-1",
        kind: "source-config-probe",
        sourceId: null,
        runId: null,
        status: "queued",
        attempts: 0,
        maxAttempts: 3,
        errorCode: null,
        error: null,
        createdAt: "2026-08-24T00:00:00.000Z",
        updatedAt: "2026-08-24T00:00:00.000Z",
        result: null,
    };

    function probeController(repository: Record<string, unknown>, sourceProbe: Record<string, unknown>) {
        return new AppController(
            repository as never,
            sourceProbe as never,
        );
    }

    it("queues a config probe job after synchronous validation", async () => {
        const createConfigProbeJob = vi.fn().mockResolvedValue(probeJob);
        const validate = vi.fn();
        const controller = probeController(
            { createConfigProbeJob },
            { validate },
        );

        await expect(controller.createSourceConfigProbe(probeCommand, "probe-key-1")).resolves.toBe(probeJob);
        expect(validate).toHaveBeenCalledWith(probeCommand);
        expect(createConfigProbeJob).toHaveBeenCalledWith({
            command: probeCommand,
            idempotencyKey: "probe-key-1",
        });
    });

    it("generates an idempotency key when the header is absent", async () => {
        const createConfigProbeJob = vi.fn().mockResolvedValue(probeJob);
        const controller = probeController(
            { createConfigProbeJob },
            { validate: vi.fn() },
        );

        await controller.createSourceConfigProbe(probeCommand);
        const call = createConfigProbeJob.mock.calls[0][0] as { idempotencyKey?: string };
        expect(call.idempotencyKey).toMatch(/^config-probe:/);
    });

    it("rejects invalid config payloads with 400 before creating a job", async () => {
        const createConfigProbeJob = vi.fn();
        const controller = probeController(
            { createConfigProbeJob },
            { validate: vi.fn() },
        );

        const error = await controller.createSourceConfigProbe({
            ...probeCommand,
            sourceDefinitionRef: "source.rss@latest",
        }).catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(createConfigProbeJob).not.toHaveBeenCalled();
    });

    it("rejects configs the validator refuses with 400 before creating a job", async () => {
        const createConfigProbeJob = vi.fn();
        const controller = probeController(
            { createConfigProbeJob },
            { validate: () => { throw new Error("Source definition is not available: source.rss@1"); } },
        );

        const error = await controller.createSourceConfigProbe(probeCommand).catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ code: "validation_failed" });
        expect(createConfigProbeJob).not.toHaveBeenCalled();
    });

    it("rejects idempotency keys outside the 1-300 budget", async () => {
        const controller = probeController(
            { createConfigProbeJob: vi.fn() },
            { validate: vi.fn() },
        );

        const error = await controller.createSourceConfigProbe(probeCommand, "x".repeat(301)).catch((value) => value);

        expect(error).toBeInstanceOf(BadRequestException);
        expect(error.getResponse()).toMatchObject({ message: "Idempotency-Key must be 1-300 characters." });
    });

    it("maps repository failures after validation to a 500 instead of a validation 400", async () => {
        const controller = probeController(
            {
                createConfigProbeJob: vi.fn()
                    .mockRejectedValue(new Error("The table `main.Job` does not exist in the current database.")),
            },
            { validate: vi.fn() },
        );

        const error = await controller.createSourceConfigProbe(probeCommand).catch((value) => value);

        expect(error).toBeInstanceOf(InternalServerErrorException);
        expect(error.getResponse()).toMatchObject({ code: "internal_error" });
    });

    it("returns the probe job on the dedicated route and 404s other job kinds", async () => {
        const controller = probeController(
            {
                getJob: vi.fn()
                    .mockResolvedValueOnce(probeJob)
                    .mockResolvedValueOnce({ ...probeJob, kind: "source-probe" })
                    .mockResolvedValueOnce(null),
            },
            { validate: vi.fn() },
        );

        await expect(controller.sourceConfigProbe("probe-job-1")).resolves.toBe(probeJob);
        await expect(controller.sourceConfigProbe("other-job")).rejects.toThrow(NotFoundException);
        await expect(controller.sourceConfigProbe("missing-job")).rejects.toThrow(NotFoundException);
    });
});

describe("AppController story orchestration", () => {
    function storyDetailFixture() {
        return {
            story: {
                id: "story-a",
                kind: "document",
                subtype: null,
                revisionId: "rev-a-1",
                title: "Story A",
                summary: null,
            },
            entry: entryDetailFixture("entry-a"),
            entries: [entryDetailFixture("entry-a")],
        };
    }

    function entryDetailFixture(entryId: string) {
        return {
            id: entryId,
            sourceId: "source-a",
            sourceName: "Source A",
            sourceKind: "rss",
            currentRevisionId: "er-a-1",
            metrics: null,
            revisions: [{
                id: "er-a-1",
                revision: 1,
                title: "Entry A",
                summary: null,
                contentText: "body",
                webUrl: null,
                contentKind: "article",
                publisher: null,
                publishedAt: null,
                updatedAt: null,
                sourcePublishedAt: null,
                createdAt: "2026-08-08T00:00:00.000Z",
                assets: [],
            }],
            observations: [],
        };
    }

    function createController(repository: Record<string, unknown>) {
        return new AppController(
            repository as never,
            {} as never,
            undefined,
            {} as never,
        );
    }

    it("moves an entry and returns the Story detail", async () => {
        const repository = {
            moveEntryToStory: vi.fn().mockResolvedValue(storyDetailFixture()),
        };
        const controller = createController(repository);
        const result = await controller.moveEntryToStory("story-a", {
            entryId: "entry-b",
            actor: "user",
        });
        expect(result).toMatchObject({ story: { id: "story-a" } });
        expect(repository.moveEntryToStory).toHaveBeenCalledWith({
            entryId: "entry-b",
            storyId: "story-a",
            actor: "user",
            reason: null,
        });
    });

    it("maps a missing Story to 404 and stale revision edits to 409", async () => {
        const moveRepository = {
            moveEntryToStory: vi.fn().mockRejectedValue(
                new StoryNotFoundError("story-missing"),
            ),
        };
        await expect(createController(moveRepository)
            .moveEntryToStory("story-missing", { entryId: "entry-b" }))
            .rejects.toBeInstanceOf(NotFoundException);

        const revisionRepository = {
            updateStoryRevision: vi.fn().mockRejectedValue(
                new StoryRevisionConflictError("story-a"),
            ),
        };
        await expect(createController(revisionRepository)
            .updateStoryRevision("story-a", {
                baseRevisionId: "rev-a-1",
                title: "Stale",
                summary: null,
                kind: "event",
                subtype: null,
            }))
            .rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects duplicate merges with 409 and malformed commands with 400", async () => {
        const mergeRepository = {
            mergeStories: vi.fn().mockRejectedValue(
                new StoryMergeConflictError("Story is already merged: story-c"),
            ),
        };
        await expect(createController(mergeRepository).mergeStories({
            canonicalStoryId: "story-a",
            obsoleteStoryIds: ["story-c"],
        })).rejects.toBeInstanceOf(ConflictException);

        const validationRepository = {
            moveEntryToStory: vi.fn(),
        };
        await expect(createController(validationRepository)
            .moveEntryToStory("story-a", { entryId: "" }))
            .rejects.toBeInstanceOf(BadRequestException);
    });
});

describe("AppController topic orchestration", () => {
    function topicDetailFixture() {
        return {
            topic: {
                id: "topic-a",
                revisionId: "rev-t-1",
                title: "Topic A",
                purpose: "p",
                scope: null,
            },
            members: [{
                storyId: "story-a",
                role: "core",
                reason: "seed",
                actor: "user",
                revision: 1,
                removed: false,
            }],
        };
    }

    function createController(repository: Record<string, unknown>) {
        return new AppController(
            repository as never,
            {} as never,
            undefined,
            {} as never,
        );
    }

    it("creates a topic and returns the detail", async () => {
        const repository = {
            createTopic: vi.fn().mockResolvedValue(topicDetailFixture()),
        };
        const controller = createController(repository);
        const result = await controller.createTopic({
            title: "Topic A",
            purpose: "p",
            scope: null,
            seedStoryId: "story-a",
            actor: "user",
        });
        expect(result).toMatchObject({ topic: { id: "topic-a" } });
        expect(repository.createTopic).toHaveBeenCalledWith({
            title: "Topic A",
            purpose: "p",
            scope: null,
            seedStoryId: "story-a",
            actor: "user",
            reason: null,
        });
    });

    it("maps missing topic to 404 and conflict cases to 409", async () => {
        await expect(createController({
            topic: vi.fn().mockResolvedValue(null),
        }).topic("topic-missing")).rejects.toBeInstanceOf(NotFoundException);

        await expect(createController({
            updateTopic: vi.fn().mockRejectedValue(
                new TopicRevisionConflictError("topic-a"),
            ),
        }).updateTopic("topic-a", {
            baseRevisionId: "rev-t-1",
            title: "Stale",
            purpose: "p",
            scope: null,
        })).rejects.toBeInstanceOf(ConflictException);

        await expect(createController({
            mergeTopics: vi.fn().mockRejectedValue(
                new TopicMergeConflictError("Topic is already merged: topic-b"),
            ),
        }).mergeTopics({
            canonicalTopicId: "topic-a",
            obsoleteTopicIds: ["topic-b"],
        })).rejects.toBeInstanceOf(ConflictException);

        await expect(createController({
            removeTopicMember: vi.fn().mockRejectedValue(
                new TopicMembershipNotFoundError("Topic member not found"),
            ),
        }).removeTopicMember("topic-a", { storyId: "story-missing" }))
            .rejects.toBeInstanceOf(NotFoundException);
    });

    it("rejects malformed member commands with 400", async () => {
        const repository = { addTopicMember: vi.fn() };
        await expect(createController(repository)
            .addTopicMember("topic-a", { storyId: "story-a", role: "not-a-role" }))
            .rejects.toBeInstanceOf(BadRequestException);
    });
});

describe("AppController entity orchestration", () => {
    function entityDetailFixture() {
        return {
            entity: {
                id: "entity-a",
                revisionId: "rev-e-1",
                type: "person",
                name: "Jeff Dean",
            },
            aliases: ["Jeffrey Dean"],
            stories: [{
                storyId: "story-a",
                producer: "human",
                producerVersion: null,
                confidence: 1,
                evidence: null,
                actor: "user",
                reason: null,
            }],
            relations: [{
                fromEntityId: "entity-a",
                toEntityId: "entity-b",
                relationType: "founded",
                producer: "human",
                producerVersion: null,
                confidence: 0.9,
                evidence: null,
                actor: null,
                reason: null,
            }],
        };
    }

    function createController(repository: Record<string, unknown>) {
        return new AppController(
            repository as never,
            {} as never,
            undefined,
            {} as never,
        );
    }

    it("creates an entity and returns the detail", async () => {
        const repository = {
            createEntity: vi.fn().mockResolvedValue(entityDetailFixture()),
        };
        const controller = createController(repository);
        const result = await controller.createEntity({
            name: "Jeff Dean",
            type: "person",
            alias: "Jeffrey Dean",
            actor: "user",
        });
        expect(result).toMatchObject({ entity: { id: "entity-a" } });
        expect(repository.createEntity).toHaveBeenCalledWith({
            name: "Jeff Dean",
            type: "person",
            alias: "Jeffrey Dean",
            actor: "user",
            reason: null,
        });
    });

    it("links a story and maps missing entity to 404", async () => {
        const repository = {
            linkStoryEntity: vi.fn().mockResolvedValue(entityDetailFixture()),
        };
        const result = await createController(repository).linkStoryEntity({
            storyId: "story-a",
            entityId: "entity-a",
        });
        expect(result).toMatchObject({ entity: { id: "entity-a" } });
        expect(repository.linkStoryEntity).toHaveBeenCalledWith({
            storyId: "story-a",
            entityId: "entity-a",
            producer: null,
            producerVersion: null,
            confidence: null,
            evidence: null,
            actor: null,
            reason: null,
        });

        await expect(createController({
            entity: vi.fn().mockResolvedValue(null),
        }).entity("entity-missing")).rejects.toBeInstanceOf(NotFoundException);

        await expect(createController({
            linkStoryEntity: vi.fn().mockRejectedValue(
                new EntityNotFoundError("entity-missing"),
            ),
        }).linkStoryEntity({ storyId: "story-a", entityId: "entity-missing" }))
            .rejects.toBeInstanceOf(NotFoundException);
    });

    it("maps stale entity edits and invalid relations to 409", async () => {
        await expect(createController({
            updateEntity: vi.fn().mockRejectedValue(
                new EntityRevisionConflictError("entity-a"),
            ),
        }).updateEntity("entity-a", {
            baseRevisionId: "rev-e-0",
            name: "Stale",
            type: "person",
        })).rejects.toBeInstanceOf(ConflictException);

        await expect(createController({
            createEntityRelation: vi.fn().mockRejectedValue(
                new EntityRelationConflictError("Entity relation must be between distinct entities: entity-a"),
            ),
        }).createEntityRelation({
            fromEntityId: "entity-a",
            toEntityId: "entity-a",
            relationType: "related_to",
        })).rejects.toBeInstanceOf(ConflictException);
    });

    it("rejects malformed entity commands with 400", async () => {
        const repository = { createEntity: vi.fn() };
        await expect(createController(repository).createEntity({
            name: "Jeff Dean",
            type: "superhero",
        })).rejects.toBeInstanceOf(BadRequestException);
    });
});

describe("AppController entry↔story evidence orchestration", () => {
    function createController(repository: Record<string, unknown>) {
        return new AppController(
            repository as never,
            {} as never,
            undefined,
            {} as never,
        );
    }

    it("links an entry and returns the canonical Story detail", async () => {
        const repository = {
            linkEntryStory: vi.fn().mockResolvedValue({
                story: { id: "story-b" },
                evidence: [],
            }),
        };
        const result = await createController(repository).linkEntryStory({
            entryId: "entry-a",
            storyId: "story-b",
            relationType: "evidence_for",
            evidence: "官方公告",
        });
        expect(result).toMatchObject({ story: { id: "story-b" } });
        expect(repository.linkEntryStory).toHaveBeenCalledWith({
            entryId: "entry-a",
            storyId: "story-b",
            relationType: "evidence_for",
            producer: null,
            producerVersion: null,
            confidence: null,
            evidence: "官方公告",
            actor: null,
            reason: null,
        });
    });

    it("maps self-links to 409, missing targets to 404 and malformed commands to 400", async () => {
        await expect(createController({
            linkEntryStory: vi.fn().mockRejectedValue(
                new EntryStoryLinkConflictError("entry-a", "story-a"),
            ),
        }).linkEntryStory({
            entryId: "entry-a",
            storyId: "story-a",
            relationType: "evidence_for",
        })).rejects.toBeInstanceOf(ConflictException);

        await expect(createController({
            linkEntryStory: vi.fn().mockRejectedValue(new EntryNotFoundError("entry-missing")),
        }).linkEntryStory({
            entryId: "entry-missing",
            storyId: "story-b",
            relationType: "evidence_for",
        })).rejects.toBeInstanceOf(NotFoundException);

        await expect(createController({}).linkEntryStory({
            entryId: "entry-a",
            storyId: "story-b",
            relationType: "supports",
        })).rejects.toBeInstanceOf(BadRequestException);

        const repository = {
            unlinkEntryStory: vi.fn().mockResolvedValue({
                story: { id: "story-b" },
                evidence: [],
            }),
        };
        await expect(createController(repository).unlinkEntryStory({
            entryId: "entry-a",
            storyId: "story-b",
        })).resolves.toMatchObject({ story: { id: "story-b" } });
        expect(repository.unlinkEntryStory).toHaveBeenCalledWith({
            entryId: "entry-a",
            storyId: "story-b",
            actor: null,
            reason: null,
        });
    });
});

describe("AppController user organization orchestration", () => {
    function createController(repository: Record<string, unknown>) {
        return new AppController(
            repository as never,
            {} as never,
            undefined,
            {} as never,
        );
    }

    it("creates a label and returns the label item", async () => {
        const repository = {
            createLabel: vi.fn().mockResolvedValue({
                id: "label-a",
                name: "AI",
                assignedCount: 0,
                createdAt: "2026-09-08T00:00:00.000Z",
                updatedAt: "2026-09-08T00:00:00.000Z",
            }),
        };
        const controller = createController(repository);
        const result = await controller.createLabel({ name: "AI" });
        expect(result).toMatchObject({ id: "label-a", name: "AI" });
        expect(repository.createLabel).toHaveBeenCalledWith({ name: "AI" });
    });

    it("maps missing label/collection targets to 404 and conflicts through the funnel", async () => {
        await expect(createController({
            deleteLabel: vi.fn().mockRejectedValue(new LabelNotFoundError("label-missing")),
        }).deleteLabel("label-missing")).rejects.toBeInstanceOf(NotFoundException);

        await expect(createController({
            deleteCollection: vi.fn().mockRejectedValue(
                new CollectionNotFoundError("collection-missing"),
            ),
        }).deleteCollection("collection-missing")).rejects.toBeInstanceOf(NotFoundException);

        await expect(createController({
            attachLabel: vi.fn().mockRejectedValue(new StoryNotFoundError("story-missing")),
        }).attachLabel({
            labelId: "label-a",
            targetType: "story",
            targetId: "story-missing",
        })).rejects.toBeInstanceOf(NotFoundException);
    });

    it("attaches/detaches labels, toggles collection membership and favorites, returning acks", async () => {
        const repository = {
            attachLabel: vi.fn().mockResolvedValue(undefined),
            detachLabel: vi.fn().mockResolvedValue(undefined),
            addCollectionItem: vi.fn().mockResolvedValue(undefined),
            removeCollectionItem: vi.fn().mockResolvedValue(undefined),
            setFavorite: vi.fn().mockResolvedValue(undefined),
            unsetFavorite: vi.fn().mockResolvedValue(undefined),
            deleteLabel: vi.fn().mockResolvedValue(undefined),
            listCollections: vi.fn().mockResolvedValue({ items: [] }),
        };
        const controller = createController(repository);

        await expect(controller.attachLabel({
            labelId: "label-a",
            targetType: "story",
            targetId: "story-a",
        })).resolves.toMatchObject({ ok: true, action: "label.assigned" });
        await expect(controller.detachLabel({
            labelId: "label-a",
            targetType: "story",
            targetId: "story-a",
        })).resolves.toMatchObject({ action: "label.unassigned" });
        await expect(controller.addCollectionItem("collection-a", { storyId: "story-a" }))
            .resolves.toMatchObject({ action: "collection.item_added" });
        await expect(controller.removeCollectionItem("collection-a", { storyId: "story-a" }))
            .resolves.toMatchObject({ action: "collection.item_removed" });
        await expect(controller.setFavorite({ targetType: "story", targetId: "story-a" }))
            .resolves.toMatchObject({ action: "favorite.set" });
        await expect(controller.unsetFavorite({ targetType: "story", targetId: "story-a" }))
            .resolves.toMatchObject({ action: "favorite.unset" });
        await expect(controller.deleteLabel("label-a"))
            .resolves.toMatchObject({ ok: true, action: "label.deleted" });
    });

    it("rejects malformed user organization commands with 400", async () => {
        const repository = { createLabel: vi.fn(), setFavorite: vi.fn() };
        const controller = createController(repository);
        await expect(controller.createLabel({})).rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.setFavorite({ targetType: "story", targetId: 42 }))
            .rejects.toBeInstanceOf(BadRequestException);
        await expect(controller.attachLabel({
            labelId: "label-a",
            targetType: "workspace",
            targetId: "story-a",
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("creates, updates and deletes annotations through the funnel", async () => {
        const annotation = {
            id: "annotation-a",
            targetType: "story",
            targetId: "story-a",
            targetRevisionId: "rev-s-1",
            quote: null,
            body: "备注",
            evidence: null,
            actor: "user",
            createdAt: "2026-09-08T00:00:00.000Z",
            updatedAt: "2026-09-08T00:00:00.000Z",
        };
        const repository = {
            createAnnotation: vi.fn().mockResolvedValue(annotation),
            updateAnnotation: vi.fn().mockResolvedValue({ ...annotation, body: "改后" }),
            deleteAnnotation: vi.fn().mockResolvedValue(undefined),
            listAnnotations: vi.fn().mockResolvedValue({ items: [annotation] }),
        };
        const controller = createController(repository);

        await expect(controller.listAnnotations({
            targetType: "story",
            targetId: "story-a",
        })).resolves.toMatchObject({ items: [expect.objectContaining({ id: "annotation-a" })] });
        expect(repository.listAnnotations).toHaveBeenCalledWith({
            targetType: "story",
            targetId: "story-a",
        });

        await expect(controller.createAnnotation({
            targetType: "story",
            targetId: "story-a",
            body: "备注",
            actor: "user",
        })).resolves.toMatchObject({ id: "annotation-a" });
        expect(repository.createAnnotation).toHaveBeenCalledWith({
            targetType: "story",
            targetId: "story-a",
            body: "备注",
            quote: null,
            evidence: null,
            actor: "user",
        });

        await expect(controller.updateAnnotation("annotation-a", { body: "改后" }))
            .resolves.toMatchObject({ body: "改后" });
        await expect(controller.deleteAnnotation("annotation-a"))
            .resolves.toMatchObject({ ok: true, action: "annotation.deleted" });

        await expect(createController({
            updateAnnotation: vi.fn().mockRejectedValue(
                new AnnotationNotFoundError("annotation-missing"),
            ),
        }).updateAnnotation("annotation-missing", { body: "x" }))
            .rejects.toBeInstanceOf(NotFoundException);

        await expect(createController({ createAnnotation: vi.fn() }).createAnnotation({
            targetType: "workspace",
            targetId: "story-a",
            body: "x",
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("creates, updates and deletes saved views", async () => {
        const view = {
            id: "saved-view-a",
            name: "AI 关注",
            text: null,
            sourceId: null,
            publishedAfter: null,
            publishedBefore: null,
            labelIds: ["label-a"],
            topicIds: [],
            createdAt: "2026-09-08T00:00:00.000Z",
            updatedAt: "2026-09-08T00:00:00.000Z",
        };
        const repository = {
            listSavedViews: vi.fn().mockResolvedValue({ items: [view] }),
            createSavedView: vi.fn().mockResolvedValue(view),
            updateSavedView: vi.fn().mockResolvedValue({ ...view, name: "改" }),
            deleteSavedView: vi.fn().mockResolvedValue(undefined),
        };
        const controller = createController(repository);

        await expect(controller.listSavedViews())
            .resolves.toMatchObject({ items: [expect.objectContaining({ id: "saved-view-a" })] });
        await expect(controller.createSavedView({
            name: "AI 关注",
            conditions: { labelIds: ["label-a"] },
        })).resolves.toMatchObject({ id: "saved-view-a" });
        expect(repository.createSavedView).toHaveBeenCalledWith({
            name: "AI 关注",
            conditions: { labelIds: ["label-a"] },
        });
        await expect(controller.updateSavedView("saved-view-a", { name: "改", conditions: {} }))
            .resolves.toMatchObject({ name: "改" });
        await expect(controller.deleteSavedView("saved-view-a"))
            .resolves.toMatchObject({ ok: true, action: "saved_view.deleted" });

        await expect(createController({
            updateSavedView: vi.fn().mockRejectedValue(
                new SavedViewNotFoundError("saved-view-missing"),
            ),
        }).updateSavedView("saved-view-missing", { name: "x", conditions: {} }))
            .rejects.toBeInstanceOf(NotFoundException);

        await expect(createController({ createSavedView: vi.fn() }).createSavedView({
            name: "",
            conditions: {},
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("seeds, reads and writes boards with tree responses and mapped errors", async () => {
        const block = {
            id: "block-a",
            sectionId: "section-a",
            type: "feed",
            config: {},
            position: 0,
            visible: true,
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
        };
        const board = {
            id: "board-a",
            name: "默认看板",
            description: null,
            sections: [{
                id: "section-a",
                boardId: "board-a",
                title: "信息流",
                position: 0,
                blocks: [block],
                createdAt: "2026-09-09T00:00:00.000Z",
                updatedAt: "2026-09-09T00:00:00.000Z",
            }],
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
        };
        const placement = {
            id: "placement-a",
            boardId: "board-a",
            targetType: "story",
            targetId: "story-a",
            source: "manual",
            reason: null,
            actor: null,
            expiresAt: null,
            targetTitle: "Story A",
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
        };
        const repository = {
            listBoards: vi.fn().mockResolvedValue({ items: [{ ...board, sectionCount: 1 }] }),
            ensureDefaultBoard: vi.fn().mockResolvedValue(board),
            getBoard: vi.fn().mockResolvedValue(board),
            createBoard: vi.fn().mockResolvedValue(board),
            updateBoard: vi.fn().mockResolvedValue(board),
            deleteBoard: vi.fn().mockResolvedValue(undefined),
            createSection: vi.fn().mockResolvedValue(board),
            updateSection: vi.fn().mockResolvedValue(board),
            deleteSection: vi.fn().mockResolvedValue(undefined),
            createBlock: vi.fn().mockResolvedValue(board),
            updateBlockConfig: vi.fn().mockResolvedValue(board),
            moveBlock: vi.fn().mockResolvedValue(board),
            setBlockVisibility: vi.fn().mockResolvedValue(board),
            duplicateBlock: vi.fn().mockResolvedValue(board),
            deleteBlock: vi.fn().mockResolvedValue(undefined),
            listSpotlightPlacements: vi.fn().mockResolvedValue({ items: [placement] }),
            createSpotlightPlacement: vi.fn().mockResolvedValue(placement),
            deleteSpotlightPlacement: vi.fn().mockResolvedValue(undefined),
        };
        const controller = createController(repository);

        await expect(controller.listBoards())
            .resolves.toMatchObject({ items: [expect.objectContaining({ sectionCount: 1 })] });
        await expect(controller.ensureDefaultBoard())
            .resolves.toMatchObject({ id: "board-a" });
        await expect(controller.board("board-a"))
            .resolves.toMatchObject({ sections: [expect.objectContaining({ title: "信息流" })] });

        await controller.createBoard({ name: "工作", description: null });
        expect(repository.createBoard).toHaveBeenCalledWith({ name: "工作", description: null });
        await controller.updateBoard("board-a", { name: "改" });
        expect(repository.updateBoard).toHaveBeenCalledWith({ boardId: "board-a", name: "改" });
        await expect(controller.deleteBoard("board-a"))
            .resolves.toMatchObject({ ok: true, action: "board.deleted" });

        await controller.createBoardSection({ boardId: "board-a", title: "热点" });
        expect(repository.createSection).toHaveBeenCalledWith({ boardId: "board-a", title: "热点" });
        await controller.updateBoardSection("section-a", { title: "改" });
        expect(repository.updateSection).toHaveBeenCalledWith({
            sectionId: "section-a",
            title: "改",
            position: null,
        });
        await expect(controller.deleteBoardSection("section-a"))
            .resolves.toMatchObject({ action: "board_section.deleted" });

        await controller.createBoardBlock({
            sectionId: "section-a",
            type: "feed",
            config: { savedViewId: "view-a" },
        });
        expect(repository.createBlock).toHaveBeenCalledWith({
            sectionId: "section-a",
            type: "feed",
            config: { savedViewId: "view-a" },
        });
        await controller.updateBoardBlockConfig("block-a", { config: { limit: 5 } });
        expect(repository.updateBlockConfig).toHaveBeenCalledWith({
            blockId: "block-a",
            config: { limit: 5 },
        });
        await controller.moveBoardBlock("block-a", { position: 1 });
        expect(repository.moveBlock).toHaveBeenCalledWith({ blockId: "block-a", position: 1 });
        await controller.setBoardBlockVisibility("block-a", { visible: false });
        expect(repository.setBlockVisibility).toHaveBeenCalledWith({
            blockId: "block-a",
            visible: false,
        });
        await expect(controller.duplicateBoardBlock("block-a")).resolves.toMatchObject({ id: "board-a" });
        await expect(controller.deleteBoardBlock("block-a"))
            .resolves.toMatchObject({ action: "board_block.deleted" });

        // Missing resources map to 404 and unknown block types to 400.
        await expect(createController({ getBoard: vi.fn().mockResolvedValue(null) }).board("missing"))
            .rejects.toBeInstanceOf(NotFoundException);
        await expect(createController({
            updateBoard: vi.fn().mockRejectedValue(new BoardNotFoundError("missing")),
        }).updateBoard("missing", { name: "x" })).rejects.toBeInstanceOf(NotFoundException);
        await expect(createController({
            createBoard: vi.fn().mockRejectedValue(new BoardNameConflictError("工作")),
        }).createBoard({ name: "工作" })).rejects.toBeInstanceOf(ConflictException);
        await expect(createController({ createBlock: vi.fn() }).createBoardBlock({
            sectionId: "section-a",
            type: "gadget",
            config: {},
        })).rejects.toBeInstanceOf(BadRequestException);
        await expect(createController({
            updateBlockConfig: vi.fn().mockRejectedValue(new BoardBlockNotFoundError("missing")),
        }).updateBoardBlockConfig("missing", { config: {} }))
            .rejects.toBeInstanceOf(NotFoundException);

        await expect(controller.listSpotlightPlacements("board-a"))
            .resolves.toMatchObject({ items: [expect.objectContaining({ targetTitle: "Story A" })] });
        expect(repository.listSpotlightPlacements).toHaveBeenCalledWith({ boardId: "board-a" });
        await expect(controller.pinSpotlight({
            boardId: "board-a",
            targetType: "story",
            targetId: "story-a",
        })).resolves.toMatchObject({ id: "placement-a" });
        await expect(controller.unpinSpotlight("placement-a"))
            .resolves.toMatchObject({ action: "spotlight_placement.deleted" });
        await expect(createController({ pinSpotlight: undefined, createSpotlightPlacement: vi.fn() })
            .pinSpotlight({
                boardId: "board-a",
                targetType: "workspace",
                targetId: "x",
            })).rejects.toBeInstanceOf(BadRequestException);
        await expect(createController({
            deleteSpotlightPlacement: vi.fn().mockRejectedValue(
                new SpotlightPlacementNotFoundError("missing"),
            ),
        }).unpinSpotlight("missing")).rejects.toBeInstanceOf(NotFoundException);
    });
});
