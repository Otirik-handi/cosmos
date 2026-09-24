import {
    describe,
    expect,
    it,
    vi,
} from "vitest";
import { BadRequestException, ConflictException, NotFoundException } from "@nestjs/common";
import {
    EntityNotFoundError,
    EntityRelationConflictError,
    EntityRevisionConflictError,
    EntryNotFoundError,
    EntryStoryLinkConflictError,
    StoryMergeConflictError,
    StoryNotFoundError,
    StoryRevisionConflictError,
    StorySplitConflictError,
    StorySubtypeInvalidError,
    StoryUserStateMigrationConflictError,
    TopicMembershipNotFoundError,
    TopicMergeConflictError,
    TopicRevisionConflictError,
} from "@cosmos/application";
import { AppController } from "./app.controller.js";
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

    it("passes the Story time range and key facts through to the repository", async () => {
        const repository = {
            updateStoryRevision: vi.fn().mockResolvedValue(storyDetailFixture()),
        };
        const timeRange = {
            start: {
                exact: "2026-09-14T09:30:00.000Z",
                exactPrecision: "second",
                fallback: null,
            },
            end: {
                exact: null,
                exactPrecision: null,
                fallback: {
                    raw: "2026 年",
                    lowerBound: "2026-01-01T00:00:00.000Z",
                    precision: "year",
                    timezone: null,
                    confidence: "uncertain",
                },
            },
        };
        const keyFacts = [
            { text: "上下文窗口 1M", entryId: "entry-a" },
            { text: "第三方测评认为长文本仍会衰减", entryId: null },
        ];
        const result = await createController(repository).updateStoryRevision("story-a", {
            baseRevisionId: "rev-a-1",
            title: "Story A",
            kind: "event",
            timeRange,
            keyFacts,
        });

        expect(result).toMatchObject({ story: { id: "story-a" } });
        expect(repository.updateStoryRevision).toHaveBeenCalledWith({
            storyId: "story-a",
            baseRevisionId: "rev-a-1",
            title: "Story A",
            summary: null,
            kind: "event",
            subtype: null,
            timeRange,
            keyFacts,
            actor: null,
            reason: null,
        });

        // 省略即清空（ADR-0021 决定 5）：命令不带这两项时仓储收到的是空值。
        const clearing = { updateStoryRevision: vi.fn().mockResolvedValue(storyDetailFixture()) };
        await createController(clearing).updateStoryRevision("story-a", {
            baseRevisionId: "rev-a-1",
            title: "Story A",
            kind: "event",
        });
        expect(clearing.updateStoryRevision).toHaveBeenCalledWith(
            expect.objectContaining({ timeRange: null, keyFacts: [] }),
        );
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

    it("splits a Story and maps shell conflicts to 409", async () => {
        const repository = {
            splitStory: vi.fn().mockResolvedValue({
                ...storyDetailFixture(),
                story: {
                    ...storyDetailFixture().story,
                    status: "split",
                    replacedBy: [],
                },
                entry: null,
                entries: [],
            }),
        };
        const controller = createController(repository);
        const result = await controller.splitStory("story-a", {
            successors: [
                { title: "Event A", kind: "event", entryIds: ["entry-a"] },
                {
                    title: "Event B",
                    kind: "event",
                    entryIds: ["entry-b"],
                    entityIds: ["entity-a"],
                },
            ],
            actor: "user",
            reason: "错误合并",
        });
        expect(result).toMatchObject({ story: { status: "split" }, entry: null });
        expect(repository.splitStory).toHaveBeenCalledWith({
            storyId: "story-a",
            successors: [
                {
                    title: "Event A",
                    summary: null,
                    kind: "event",
                    subtype: null,
                    timeRange: null,
                    keyFacts: [],
                    entryIds: ["entry-a"],
                    evidenceEntryIds: [],
                    entityIds: [],
                    topicIds: [],
                },
                {
                    title: "Event B",
                    summary: null,
                    kind: "event",
                    subtype: null,
                    timeRange: null,
                    keyFacts: [],
                    entryIds: ["entry-b"],
                    evidenceEntryIds: [],
                    entityIds: ["entity-a"],
                    topicIds: [],
                },
            ],
            actor: "user",
            reason: "错误合并",
        });

        const conflictRepository = {
            splitStory: vi.fn().mockRejectedValue(
                new StorySplitConflictError("Story is already split: story-a"),
            ),
        };
        await expect(createController(conflictRepository).splitStory("story-a", {
            successors: [
                { title: "A", kind: "event", entryIds: ["entry-a"] },
                { title: "B", kind: "event", entryIds: ["entry-b"] },
            ],
        })).rejects.toBeInstanceOf(ConflictException);

        const validationRepository = {
            splitStory: vi.fn(),
        };
        await expect(createController(validationRepository).splitStory("story-a", {
            successors: [{ title: "A", kind: "event", entryIds: ["entry-a"] }],
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    it("migrates Story user state and maps family conflicts to 409", async () => {
        const resultFixture = {
            sourceStoryId: "story-shell",
            targetStoryId: "story-a",
            favorite: { moved: 1, deduped: 0 },
            labelAssignments: { moved: 1, deduped: 1 },
            collectionItems: { moved: 0, deduped: 0 },
            annotations: { moved: 2, deduped: 0 },
            spotlightPlacements: { moved: 0, deduped: 0 },
        };
        const repository = {
            migrateStoryUserState: vi.fn().mockResolvedValue(resultFixture),
        };
        const controller = createController(repository);

        const result = await controller.migrateStoryUserState("story-shell", {
            targetStoryId: "story-a",
            favorite: true,
            labelIds: ["label-a", "label-b"],
            annotationIds: ["annotation-a", "annotation-b"],
            actor: "user",
            reason: "归到主事件",
            basis: "entry-a 才是主事件",
        });

        expect(result).toEqual(resultFixture);
        // Unset lists default to empty rather than undefined, so the command
        // always describes a complete selection.
        expect(repository.migrateStoryUserState).toHaveBeenCalledWith({
            sourceStoryId: "story-shell",
            targetStoryId: "story-a",
            favorite: true,
            labelIds: ["label-a", "label-b"],
            collectionIds: [],
            annotationIds: ["annotation-a", "annotation-b"],
            spotlightPlacementIds: [],
            actor: "user",
            reason: "归到主事件",
            basis: "entry-a 才是主事件",
        });

        const conflictRepository = {
            migrateStoryUserState: vi.fn().mockRejectedValue(
                new StoryUserStateMigrationConflictError(
                    "User state can only move between a split Story shell and its successors",
                ),
            ),
        };
        await expect(createController(conflictRepository).migrateStoryUserState("story-shell", {
            targetStoryId: "story-other",
        })).rejects.toBeInstanceOf(ConflictException);

        const notFoundRepository = {
            migrateStoryUserState: vi.fn().mockRejectedValue(
                new StoryNotFoundError("story-missing"),
            ),
        };
        await expect(createController(notFoundRepository).migrateStoryUserState("story-missing", {
            targetStoryId: "story-a",
        })).rejects.toBeInstanceOf(NotFoundException);

        const validationRepository = {
            migrateStoryUserState: vi.fn(),
        };
        await expect(createController(validationRepository).migrateStoryUserState("story-shell", {
            targetStoryId: "",
        })).rejects.toBeInstanceOf(BadRequestException);
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

    it("returns the managed subtype catalog page and filters by kind", async () => {
        const repository = {
            listStorySubtypes: vi.fn().mockResolvedValue([{
                id: "media.comic",
                kind: "media",
                version: 1,
                label: "漫画",
                description: null,
                status: "active",
                identityPolicy: "same-work-v1",
                owner: "core",
            }]),
        };
        const controller = createController(repository);

        const page = await controller.listStorySubtypes("media");
        expect(page.items).toHaveLength(1);
        expect(page.items[0]).toMatchObject({ id: "media.comic", kind: "media", status: "active" });
        expect(page.nextCursor).toBeNull();
        expect(repository.listStorySubtypes).toHaveBeenCalledWith({ kind: "media" });

        await expect(controller.listStorySubtypes("unknown"))
            .rejects.toBeInstanceOf(BadRequestException);
    });

    it("maps an unregistered subtype write to 400", async () => {
        const repository = {
            updateStoryRevision: vi.fn().mockRejectedValue(
                new StorySubtypeInvalidError("Unknown Story subtype: media.unknown"),
            ),
            splitStory: vi.fn().mockRejectedValue(
                new StorySubtypeInvalidError("Unknown Story subtype: media.unknown"),
            ),
        };
        const controller = createController(repository);

        await expect(controller.updateStoryRevision("story-a", {
            baseRevisionId: "rev-a-1",
            title: "Story A",
            kind: "media",
            subtype: "media.unknown",
        })).rejects.toBeInstanceOf(BadRequestException);

        await expect(controller.splitStory("story-a", {
            successors: [
                { title: "A", kind: "media", subtype: "media.unknown", entryIds: ["entry-a"] },
                { title: "B", kind: "media", entryIds: ["entry-b"] },
            ],
        })).rejects.toBeInstanceOf(BadRequestException);
    });

    /**
     * 400 的响应体错误码是客户端分支的依据：`StorySubtypeInvalidError` 自带
     * `code: "validation"`，经 `sourceCommandError` 必须变成公开契约的
     * `validation_failed`，而不是泄漏内部 code 或落进 500。
     */
    it("reports the validation_failed code for an unregistered subtype write", async () => {
        const repository = {
            updateStoryRevision: vi.fn().mockRejectedValue(
                new StorySubtypeInvalidError("Unknown Story subtype: media.unknown"),
            ),
            splitStory: vi.fn().mockRejectedValue(
                new StorySubtypeInvalidError("Unknown Story subtype: media.unknown"),
            ),
        };
        const controller = createController(repository);

        const revisionError = await controller.updateStoryRevision("story-a", {
            baseRevisionId: "rev-a-1",
            title: "Story A",
            kind: "media",
            subtype: "media.unknown",
        }).catch((value) => value);
        expect(revisionError).toBeInstanceOf(BadRequestException);
        expect(revisionError.getResponse()).toMatchObject({ code: "validation_failed" });

        const splitError = await controller.splitStory("story-a", {
            successors: [
                { title: "A", kind: "media", subtype: "media.unknown", entryIds: ["entry-a"] },
                { title: "B", kind: "media", entryIds: ["entry-b"] },
            ],
        }).catch((value) => value);
        expect(splitError).toBeInstanceOf(BadRequestException);
        expect(splitError.getResponse()).toMatchObject({ code: "validation_failed" });
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
