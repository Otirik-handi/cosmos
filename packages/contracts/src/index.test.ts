import { describe, expect, it } from "vitest";

import {
    aiHotSourceConfigSchema,
    bilibiliSourceConfigSchema,
    getSourceConfigurationSchema,
    publisherSchema,
    rssSourceConfigSchema,
    mediaPolicyCeilings,
    mediaRetryCeiling,
    sourceConfigSchema,
    sourceMediaPolicySchema,
    createSourceCommandSchema,
    jobSnapshotSchema,
    sourceConfigProbeCommandSchema,
    sourceConfigProbeJobPayloadSchema,
    sourceConfigProbeJobSnapshotSchema,
    sourceConfigProbeResultSchema,
    sourceDefinitionManifestSchema,
    sourceDefinitionPageSchema,
    sourceExecutionSnapshotSchema,
    sourceProbeResultSchema,
    temporalValueSchema,
    updateSourceCommandSchema,
    addTopicMemberCommandSchema,
    createTopicCommandSchema,
    splitStoryCommandSchema,
    topicDetailSchema,
    createEntityCommandSchema,
    createEntityRelationCommandSchema,
    entityDetailSchema,
    linkStoryEntityCommandSchema,
    linkEntryStoryCommandSchema,
    entryStoryRelationTypeSchema,
    storyDetailSchema,
    storySubtypePageSchema,
    storySubtypeQuerySchema,
    storySubtypeStatusSchema,
    labelAssignmentCommandSchema,
    labelDetailSchema,
    labelItemSchema,
    labelListSchema,
    collectionDetailSchema,
    collectionListSchema,
    collectionSummarySchema,
    createCollectionCommandSchema,
    createLabelCommandSchema,
    favoriteCommandSchema,
    userOrganizationAckSchema,
    targetTypeSchema,
    favoriteTargetTypeSchema,
    annotationListSchema,
    annotationTargetQuerySchema,
    createAnnotationCommandSchema,
    updateAnnotationCommandSchema,
    createSavedViewCommandSchema,
    savedViewListSchema,
    savedViewSchema,
    searchQuerySchema,
    blockConfigSchemaFor,
    boardBlockSchema,
    boardCommandAckSchema,
    boardDetailSchema,
    createBlockCommandSchema,
    pinSpotlightCommandSchema,
    spotlightPlacementSchema,
} from "./index.js";

describe("entity and relation contracts", () => {
    it("rejects unknown types on write and accepts them on read", () => {
        expect(() => createEntityCommandSchema.parse({
            name: "Jeff Dean",
            type: "superhero",
        })).toThrow();
        expect(() => createEntityCommandSchema.parse({
            name: "Jeff Dean",
            type: "person",
        })).not.toThrow();
        expect(() => createEntityRelationCommandSchema.parse({
            fromEntityId: "entity-a",
            toEntityId: "entity-b",
            relationType: "mentored",
        })).toThrow();

        const detail = entityDetailSchema.parse({
            entity: {
                id: "entity-a",
                revisionId: "rev-e-1",
                type: "future-type",
                name: "Future Thing",
            },
            aliases: ["FT"],
            stories: [{
                storyId: "story-a",
                producer: "human",
                producerVersion: null,
                confidence: 0.9,
                evidence: null,
                actor: "user",
                reason: null,
            }],
            relations: [{
                fromEntityId: "entity-a",
                toEntityId: "entity-b",
                relationType: "future-relation",
                producer: "human",
                producerVersion: null,
                confidence: 0.8,
                evidence: null,
                actor: null,
                reason: null,
            }],
        });
        expect(detail.entity.type).toBe("future-type");
        expect(detail.relations[0].relationType).toBe("future-relation");
    });

    it("leaves provenance unset on write and requires a canonical link", () => {
        const parsed = linkStoryEntityCommandSchema.parse({
            storyId: "story-a",
            entityId: "entity-b",
        });
        expect(parsed.producer).toBeUndefined();
        expect(parsed.confidence).toBeUndefined();

        const story = storyDetailSchema.parse({
            story: {
                id: "story-a",
                kind: "document",
                subtype: null,
                revisionId: "rev-s-1",
                title: "T",
                summary: null,
                status: "active",
                replacedBy: [],
            },
            entry: {
                id: "entry-a",
                sourceId: "source-a",
                sourceName: "S",
                sourceKind: "rss",
                currentRevisionId: "er-1",
                metrics: null,
                revisions: [],
                observations: [],
                relatedStories: [],
            },
            entries: [],
            entities: [{
                entityId: "entity-b",
                name: "Jeff Dean",
                type: "person",
                producer: "human",
                producerVersion: null,
                confidence: 1,
                evidence: null,
                actor: null,
                reason: null,
            }],
            topics: [],
            labels: [],
            favorited: false,
            evidence: [],
        });
        expect(story.entities[0].name).toBe("Jeff Dean");
    });

    it("pins the managed auxiliary relation enum and projects both directions", () => {
        expect(entryStoryRelationTypeSchema.options).toEqual(["evidence_for", "mentions"]);

        const parsed = linkEntryStoryCommandSchema.parse({
            entryId: "entry-a",
            storyId: "story-b",
            relationType: "evidence_for",
        });
        expect(parsed.producer).toBeUndefined();
        expect(parsed.confidence).toBeUndefined();
        expect(() => linkEntryStoryCommandSchema.parse({
            entryId: "entry-a",
            storyId: "story-b",
            relationType: "supports",
        })).toThrow();

        const story = storyDetailSchema.parse({
            story: {
                id: "story-b",
                kind: "event",
                subtype: null,
                revisionId: "rev-sb-1",
                title: "Event",
                summary: null,
                status: "active",
                replacedBy: [],
            },
            entry: {
                id: "entry-b",
                sourceId: "source-b",
                sourceName: "S",
                sourceKind: "rss",
                currentRevisionId: "er-b-1",
                metrics: null,
                revisions: [],
                observations: [],
                relatedStories: [{
                    storyId: "story-c",
                    relationType: "mentions",
                    title: "Other Story",
                    reason: null,
                }],
            },
            entries: [],
            entities: [],
            topics: [],
            labels: [],
            favorited: false,
            evidence: [{
                entryId: "entry-a",
                sourceId: "source-a",
                sourceName: "S",
                // Read side stays permissive: unknown future kinds degrade.
                relationType: "future-kind",
                title: "Long article",
                producer: "human",
                producerVersion: null,
                confidence: 1,
                evidence: "官方公告",
                actor: null,
                reason: "同一事件",
            }],
        });
        expect(story.evidence[0]?.relationType).toBe("future-kind");
        expect(story.entry?.relatedStories[0]?.storyId).toBe("story-c");
    });

    it("pins the split command and the historical-shell projection", () => {
        const parsed = splitStoryCommandSchema.parse({
            successors: [
                {
                    title: "Event A",
                    kind: "event",
                    entryIds: ["entry-a"],
                },
                {
                    title: "Event B",
                    kind: "event",
                    entryIds: ["entry-b"],
                    evidenceEntryIds: ["entry-c"],
                    entityIds: ["entity-a"],
                    topicIds: ["topic-a"],
                },
            ],
            actor: "alice",
            reason: "两个事件被错误合并",
        });
        expect(parsed.successors[0]?.evidenceEntryIds).toEqual([]);
        expect(parsed.successors[1]?.topicIds).toEqual(["topic-a"]);
        expect(() => splitStoryCommandSchema.parse({
            successors: [{ title: "Only one", kind: "event", entryIds: ["entry-a"] }],
        })).toThrow();
        expect(() => splitStoryCommandSchema.parse({
            successors: [
                { title: "A", kind: "event", entryIds: [] },
                { title: "B", kind: "event", entryIds: ["entry-b"] },
            ],
        })).toThrow();

        // A shell may project no primary member at all; `entry` is nullable.
        const shell = storyDetailSchema.parse({
            story: {
                id: "story-shell",
                kind: "event",
                subtype: null,
                revisionId: "rev-shell-1",
                title: "Was one Story",
                summary: null,
                status: "split",
                replacedBy: [
                    { storyId: "story-a", title: "Event A", kind: "event" },
                    { storyId: "story-b", title: "Event B", kind: "document" },
                ],
            },
            entry: null,
            entries: [],
            entities: [],
            topics: [],
            labels: [],
            favorited: false,
            evidence: [],
        });
        expect(shell.story.replacedBy.map((successor) => successor.storyId))
            .toEqual(["story-a", "story-b"]);
        expect(shell.entry).toBeNull();
    });
});

describe("user organization contracts", () => {
    it("pins the managed target-type enums for writes", () => {
        expect(targetTypeSchema.options).toEqual(["story", "entry", "topic"]);
        expect(favoriteTargetTypeSchema.options).toEqual(["story", "entry"]);
        expect(() => labelAssignmentCommandSchema.parse({
            labelId: "label-a",
            targetType: "story",
            targetId: "story-1",
        })).not.toThrow();
        expect(() => labelAssignmentCommandSchema.parse({
            labelId: "label-a",
            targetType: "workspace",
            targetId: "story-1",
        })).toThrow();
        expect(() => favoriteCommandSchema.parse({
            targetType: "topic",
            targetId: "topic-1",
        })).toThrow();
    });

    it("parses label list, detail and commands", () => {
        const item = labelItemSchema.parse({
            id: "label-a",
            name: "AI",
            assignedCount: 2,
            createdAt: "2026-09-08T00:00:00.000Z",
            updatedAt: "2026-09-08T00:00:00.000Z",
        });
        expect(item.name).toBe("AI");
        expect(labelListSchema.parse({ items: [item] }).items).toHaveLength(1);
        expect(createLabelCommandSchema.parse({ name: " AI " }).name).toBe("AI");

        const detail = labelDetailSchema.parse({
            id: "label-a",
            name: "AI",
            createdAt: "2026-09-08T00:00:00.000Z",
            updatedAt: "2026-09-08T00:00:00.000Z",
            assignedStories: [{ id: "story-1", title: "Story one" }],
            assignedEntries: [],
            assignedTopics: [],
        });
        expect(detail.assignedStories[0].title).toBe("Story one");
        expect(() => labelDetailSchema.parse({
            ...detail,
            assignedStories: [{ id: "story-1" }],
        })).toThrow();
    });

    it("parses collection read models and the write ack", () => {
        const summary = collectionSummarySchema.parse({
            id: "collection-a",
            name: "Reading",
            description: null,
            itemCount: 1,
            createdAt: "2026-09-08T00:00:00.000Z",
            updatedAt: "2026-09-08T00:00:00.000Z",
        });
        expect(summary.itemCount).toBe(1);
        expect(collectionListSchema.parse({
            items: [{ ...summary, containsStory: true }],
        }).items[0].containsStory).toBe(true);
        expect(createCollectionCommandSchema.parse({
            name: "Reading",
            description: "Later",
        }).description).toBe("Later");

        const detail = collectionDetailSchema.parse({
            id: "collection-a",
            name: "Reading",
            description: null,
            createdAt: "2026-09-08T00:00:00.000Z",
            updatedAt: "2026-09-08T00:00:00.000Z",
            stories: [{ storyId: "story-1", title: "Story one", addedAt: "2026-09-08T00:00:00.000Z" }],
        });
        expect(detail.stories).toHaveLength(1);

        expect(userOrganizationAckSchema.parse({
            ok: true,
            id: "label-a",
            action: "label.deleted",
        })).toMatchObject({ action: "label.deleted" });
        expect(() => userOrganizationAckSchema.parse({
            ok: false,
            id: "label-a",
            action: "label.deleted",
        })).toThrow();
    });

    it("parses annotation commands, list and permissive read-side target type", () => {
        const created = createAnnotationCommandSchema.parse({
            targetType: "story",
            targetId: "story-a",
            body: "  值得跟进  ",
            quote: "原文片段",
        });
        expect(created.body).toBe("值得跟进");
        expect(created.quote).toBe("原文片段");
        expect(() => createAnnotationCommandSchema.parse({
            targetType: "workspace",
            targetId: "story-a",
            body: "x",
        })).toThrow();
        expect(() => createAnnotationCommandSchema.parse({
            targetType: "story",
            targetId: "story-a",
            body: "   ",
        })).toThrow();

        expect(updateAnnotationCommandSchema.parse({ body: "改后" }).body).toBe("改后");
        expect(annotationTargetQuerySchema.parse({
            targetType: "topic",
            targetId: "topic-a",
        }).targetType).toBe("topic");

        const list = annotationListSchema.parse({
            items: [{
                id: "annotation-a",
                targetType: "future-target",
                targetId: "story-a",
                targetRevisionId: "rev-s-1",
                quote: null,
                body: "备注",
                evidence: null,
                actor: "user",
                createdAt: "2026-09-08T00:00:00.000Z",
                updatedAt: "2026-09-08T00:00:00.000Z",
            }],
        });
        expect(list.items[0].targetType).toBe("future-target");
        expect(list.items[0].targetRevisionId).toBe("rev-s-1");
    });

    it("parses saved view commands and extends search with label/topic filters", () => {
        const command = createSavedViewCommandSchema.parse({
            name: "AI 关注",
            conditions: {
                text: "qwen",
                labelIds: ["label-a"],
                topicIds: [],
            },
        });
        expect(command.conditions.labelIds).toEqual(["label-a"]);
        expect(() => createSavedViewCommandSchema.parse({
            name: "x",
            conditions: { labelIds: ["a".repeat(301)] },
        })).toThrow();

        const view = savedViewSchema.parse({
            id: "saved-view-a",
            name: "AI 关注",
            text: "qwen",
            sourceId: null,
            publishedAfter: null,
            publishedBefore: null,
            labelIds: ["label-a"],
            topicIds: [],
            createdAt: "2026-09-08T00:00:00.000Z",
            updatedAt: "2026-09-08T00:00:00.000Z",
        });
        expect(savedViewListSchema.parse({ items: [view] }).items).toHaveLength(1);

        const query = searchQuerySchema.parse({
            labelIds: "label-a,label-b",
            topicIds: "topic-a",
        });
        expect(query.labelIds).toBe("label-a,label-b");
        expect(query.topicIds).toBe("topic-a");
    });
});

describe("topic contracts", () => {
    it("rejects unknown member roles on write and accepts them on read", () => {
        expect(() => addTopicMemberCommandSchema.parse({
            storyId: "story-a",
            role: "not-a-role",
        })).toThrow();
        expect(() => createTopicCommandSchema.parse({
            title: "T",
            purpose: "P",
        })).not.toThrow();

        const detail = topicDetailSchema.parse({
            topic: {
                id: "topic-a",
                revisionId: "rev-t-1",
                title: "T",
                purpose: "P",
                scope: null,
            },
            members: [{
                storyId: "story-a",
                role: "future-role",
                reason: null,
                actor: null,
                revision: 1,
                removed: false,
            }],
        });
        expect(detail.members[0].role).toBe("future-role");
    });
});

describe("source and job contracts", () => {
    it("accepts only the supported Bilibili source modes", () => {
        expect(bilibiliSourceConfigSchema.parse({
            mode: "hot",
            limit: 5,
        })).toMatchObject({
            mode: "hot",
            limit: 5,
        });

        expect(() => bilibiliSourceConfigSchema.parse({
            mode: "feed",
            limit: 5,
        })).toThrow();

        expect(() => bilibiliSourceConfigSchema.parse({
            mode: "hot",
            command: ["bilibili", "hot"],
        })).toThrow();
    });

    it("restricts RSS feedUrl to http(s) URLs", () => {
        expect(rssSourceConfigSchema.parse({
            feedUrl: "https://example.test/feed.xml",
        })).toMatchObject({ feedUrl: "https://example.test/feed.xml" });
        expect(() => rssSourceConfigSchema.parse({
            feedUrl: "file:///etc/passwd",
        })).toThrow();
        expect(() => rssSourceConfigSchema.parse({
            feedUrl: "ftp://example.test/feed.xml",
        })).toThrow();
    });

    it("resolves canonical configuration schemas by source definition ref", () => {
        expect(getSourceConfigurationSchema("source.rss@1")).toBe(rssSourceConfigSchema);
        expect(getSourceConfigurationSchema("source.bilibili@1")).toBe(bilibiliSourceConfigSchema);
        expect(getSourceConfigurationSchema("source.unknown@1")).toBeNull();
    });

    it("accepts an optional tightened per-source media policy", () => {
        expect(rssSourceConfigSchema.parse({
            feedUrl: "https://example.test/feed.xml",
        }).media).toBeUndefined();
        expect(rssSourceConfigSchema.parse({
            feedUrl: "https://example.test/feed.xml",
            media: {
                images: "metadata_only",
                maxFileBytes: 2 * 1024 * 1024,
                maxRunBytes: 8 * 1024 * 1024,
            },
        }).media).toEqual({
            images: "metadata_only",
            maxFileBytes: 2 * 1024 * 1024,
            maxRunBytes: 8 * 1024 * 1024,
        });
        expect(sourceConfigSchema.parse({
            media: { maxFileBytes: 1024 * 1024 },
        }).media).toEqual({ maxFileBytes: 1024 * 1024 });
    });

    it("rejects media policy values above the global ceilings or outside the enum", () => {
        expect(() => sourceMediaPolicySchema.parse({
            maxFileBytes: mediaPolicyCeilings.maxFileBytes + 1,
        })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({
            maxRunBytes: mediaPolicyCeilings.maxRunBytes + 1,
        })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ maxFileBytes: 1024 })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ images: "keep" })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ downloadAudio: true })).toThrow();
        expect(mediaPolicyCeilings).toEqual({
            maxFileBytes: 10 * 1024 * 1024,
            maxRunBytes: 50 * 1024 * 1024,
        });
    });

    it("accepts the per-source retry and retention policy within its bounds", () => {
        expect(sourceMediaPolicySchema.parse({
            retry: { maxAttempts: 0 },
            retentionDays: 30,
        })).toEqual({ retry: { maxAttempts: 0 }, retentionDays: 30 });
        expect(sourceMediaPolicySchema.parse({ retry: {} })).toEqual({ retry: {} });
        expect(() => sourceMediaPolicySchema.parse({
            retry: { maxAttempts: mediaRetryCeiling + 1 },
        })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ retry: { maxAttempts: -1 } })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ retry: { backoffMs: 1 } })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ retentionDays: 3651 })).toThrow();
        expect(() => sourceMediaPolicySchema.parse({ retentionDays: -1 })).toThrow();
    });

    it("validates the public AI HOT configuration", () => {
        expect(aiHotSourceConfigSchema.parse({})).toMatchObject({
            schemaVersion: 1,
        });
        expect(() => aiHotSourceConfigSchema.parse({
            endpoint: "https://example.test",
        })).toThrow();
    });

    it("requires a versioned source definition while keeping connector validation separate", () => {
        expect(createSourceCommandSchema.parse({
            name: "Bilibili hot",
            sourceDefinitionRef: "source.bilibili@1",
            operationId: "fetch",
            config: {
                mode: "hot",
                limit: 10,
            },
        }).sourceDefinitionRef).toBe("source.bilibili@1");
    });

    it("requires a versioned source definition and saves new sources disabled", () => {
        const command = createSourceCommandSchema.parse({
            name: "RSS source",
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            config: { feedUrl: "https://example.test/feed.xml" },
        });

        expect(command).toMatchObject({
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
        });
        expect(command).not.toHaveProperty("enabled");
        expect(() => createSourceCommandSchema.parse({
            ...command,
            enabled: true,
        })).toThrow();
    });

    it("requires a revision guard for complete source replacement", () => {
        expect(updateSourceCommandSchema.parse({
            baseRevisionId: "source-1:2",
            name: "Renamed RSS",
            config: { feedUrl: "https://example.test/new-feed.xml" },
        })).toMatchObject({
            baseRevisionId: "source-1:2",
            config: { feedUrl: "https://example.test/new-feed.xml" },
        });
        expect(() => updateSourceCommandSchema.parse({
            enabled: true,
        })).toThrow();
    });

    it("exposes a revision id in immutable source execution snapshots", () => {
        const snapshot = sourceExecutionSnapshotSchema.parse({
            id: "source-1",
            name: "RSS source",
            kind: "rss",
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            connectorId: "rss",
            config: { feedUrl: "https://example.test/feed.xml" },
            enabled: false,
            revisionId: "source-1:1",
            createdAt: "2026-08-24T00:00:00.000Z",
            updatedAt: "2026-08-24T00:00:00.000Z",
        });

        expect(snapshot.revisionId).toBe("source-1:1");
    });


    it("validates probe results and job snapshots", () => {
        expect(sourceProbeResultSchema.parse({
            sourceId: "source-1",
            connectorId: "bilibili",
            itemCount: 3,
            nextCursorAvailable: false,
            checkedAt: "2026-08-08T00:00:00.000Z",
        }).itemCount).toBe(3);

        expect(jobSnapshotSchema.parse({
            id: "job-1",
            kind: "source-probe",
            sourceId: "source-1",
            runId: null,
            status: "queued",
            attempts: 0,
            maxAttempts: 3,
            errorCode: null,
            error: null,
            createdAt: "2026-08-08T00:00:00.000Z",
            updatedAt: "2026-08-08T00:00:00.000Z",
            result: null,
        }).kind).toBe("source-probe");
    });

    it("accepts author records without a platform id and normalizes blanks to null", () => {
        expect(publisherSchema.parse({
            platformId: "  ",
            name: "RSS author",
            handle: "",
            profileUrl: null,
            kind: "unknown",
        })).toMatchObject({
            platformId: null,
            name: "RSS author",
            handle: null,
            kind: "unknown",
        });
    });

    it("requires a temporal value to retain exact or fallback evidence", () => {
        expect(() => temporalValueSchema.parse({
            exact: null,
            exactPrecision: null,
            fallback: null,
        })).toThrow();
    });
});

describe("source config probe contracts", () => {
    const probeCommand = {
        sourceDefinitionRef: "source.rss@1",
        operationId: "fetch",
        config: { feedUrl: "https://example.test/feed.xml" },
    } as const;

    it("parses a config probe command and rejects unknown fields", () => {
        expect(sourceConfigProbeCommandSchema.parse(probeCommand)).toEqual(probeCommand);
        expect(() => sourceConfigProbeCommandSchema.parse({
            ...probeCommand,
            sourceId: "source-1",
        })).toThrow();
        expect(() => sourceConfigProbeCommandSchema.parse({
            ...probeCommand,
            sourceDefinitionRef: "source.rss@latest",
        })).toThrow();
    });

    it("parses the job payload wrapper strictly", () => {
        expect(sourceConfigProbeJobPayloadSchema.parse({ configProbe: probeCommand })).toMatchObject({
            configProbe: probeCommand,
        });
        expect(() => sourceConfigProbeJobPayloadSchema.parse({ sourceId: "source-1" })).toThrow();
    });

    it("caps probe results at three sample titles of 200 characters", () => {
        const base = {
            sourceDefinitionRef: "source.rss@1",
            operationId: "fetch",
            connectorId: "rss",
            itemCount: 2,
            nextCursorAvailable: false,
            checkedAt: "2026-08-24T00:00:00.000Z",
            durationMs: 120,
        };
        expect(sourceConfigProbeResultSchema.parse({
            ...base,
            sampleTitles: ["First", "Second"],
        })).toMatchObject({ sampleTitles: ["First", "Second"] });

        expect(() => sourceConfigProbeResultSchema.parse({
            ...base,
            sampleTitles: ["1", "2", "3", "4"],
        })).toThrow();
        expect(() => sourceConfigProbeResultSchema.parse({
            ...base,
            sampleTitles: ["x".repeat(201)],
        })).toThrow();
    });

    it("pins the config probe job snapshot kind and result shape", () => {
        const job = {
            id: "job-1",
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
        expect(sourceConfigProbeJobSnapshotSchema.parse(job)).toMatchObject({ kind: "source-config-probe" });
        expect(() => sourceConfigProbeJobSnapshotSchema.parse({ ...job, kind: "source-probe" })).toThrow();
        expect(() => sourceConfigProbeJobSnapshotSchema.parse({
            ...job,
            status: "succeeded",
            result: { itemCount: 1 },
        })).toThrow();
        expect(jobSnapshotSchema.parse(job)).toMatchObject({ kind: "source-config-probe" });
    });
});

describe("source definition catalog contracts", () => {
    const rssManifest = {
        id: "rss",
        version: 1,
        ref: "source.rss@1",
        provider: "cosmos",
        connectorId: "rss",
        displayName: "RSS",
        description: "Fetch one RSS or Atom feed page.",
        manifestHash: { algorithm: "builtin", value: "builtin:source.rss@1" },
        status: "enabled",
        operationIds: ["fetch"],
        capabilities: ["source:read", "cursor"],
        configurationSchema: {
            id: "source.rss.config@1",
            version: 1,
            hash: { algorithm: "builtin", value: "source.rss.config@1" },
            schema: {
                type: "object",
                properties: { feedUrl: { type: "string", format: "uri" } },
                required: ["feedUrl"],
            },
        },
        auth: { kind: "none", label: null, secretRefRequired: false },
        operations: [{
            operationId: "fetch",
            inputSchema: { id: "source.rss.fetch.input@1", version: 1, hash: { algorithm: "builtin", value: "i" } },
            outputSchema: { id: "source.rss.fetch.output@1", version: 1, hash: { algorithm: "builtin", value: "o" } },
            externalKey: "url",
            discoveryContext: "",
            media: "download",
            stateStoreNamespace: "source:{id}",
        }],
    } as const;

    it("parses a source definition manifest with a descriptive configuration schema", () => {
        const manifest = sourceDefinitionManifestSchema.parse(rssManifest);
        expect(manifest).toMatchObject({
            ref: "source.rss@1",
            connectorId: "rss",
            status: "enabled",
        });
        expect(manifest.configurationSchema.schema).toMatchObject({ type: "object" });
    });

    it("rejects manifests with an unversioned ref or unknown fields", () => {
        expect(() => sourceDefinitionManifestSchema.parse({
            ...rssManifest,
            ref: "source.rss@latest",
        })).toThrow();
        expect(() => sourceDefinitionManifestSchema.parse({
            ...rssManifest,
            scheduleIntervalMs: 1_800_000,
        })).toThrow();
    });

    it("parses the catalog page envelope with items and snapshot metadata", () => {
        const page = sourceDefinitionPageSchema.parse({
            items: [rssManifest],
            nextCursor: null,
            snapshotAt: "2026-09-02T00:00:00.000Z",
        });
        expect(page.items).toHaveLength(1);
        expect(page.snapshotAt).toBe("2026-09-02T00:00:00.000Z");
        expect(() => sourceDefinitionPageSchema.parse({
            items: [rssManifest],
        })).toThrow();
    });
});

describe("board contracts", () => {
    it("enforces the block type enum on write commands and degrades unknown types on read", () => {
        expect(() => createBlockCommandSchema.parse({
            sectionId: "section-1",
            type: "gadget",
            config: {},
        })).toThrow();

        const block = boardBlockSchema.parse({
            id: "block-1",
            sectionId: "section-1",
            type: "gadget",
            config: { anything: true },
            position: 0,
            visible: true,
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
        });
        expect(block.type).toBe("gadget");
    });

    it("validates per-type block config whitelists through blockConfigSchemaFor", () => {
        const feed = blockConfigSchemaFor("feed");
        expect(feed?.parse({ savedViewId: "view-1", limit: 5 })).toEqual({
            savedViewId: "view-1",
            limit: 5,
        });
        // Binding is optional (BRD-006 "可绑定"): an unbound feed block is valid.
        expect(feed?.parse({})).toEqual({});
        expect(() => feed!.parse({ savedViewId: "view-1", rogue: true })).toThrow();

        const collection = blockConfigSchemaFor("collection");
        // Binding is optional (created unbound, configured later).
        expect(collection!.parse({})).toEqual({});
        expect(collection!.parse({ collectionId: "collection-1" })).toEqual({
            collectionId: "collection-1",
        });
        expect(() => collection!.parse({ collectionId: "" })).toThrow();

        expect(blockConfigSchemaFor("gadget")).toBeNull();
    });

    it("parses the board detail tree and command acks", () => {
        const detail = boardDetailSchema.parse({
            id: "board-1",
            name: "默认看板",
            description: null,
            sections: [{
                id: "section-1",
                boardId: "board-1",
                title: "热点",
                position: 0,
                blocks: [{
                    id: "block-1",
                    sectionId: "section-1",
                    type: "spotlight",
                    config: {},
                    position: 0,
                    visible: true,
                    createdAt: "2026-09-09T00:00:00.000Z",
                    updatedAt: "2026-09-09T00:00:00.000Z",
                }],
                createdAt: "2026-09-09T00:00:00.000Z",
                updatedAt: "2026-09-09T00:00:00.000Z",
            }],
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
        });
        expect(detail.sections[0]!.blocks[0]!.type).toBe("spotlight");

        expect(boardCommandAckSchema.parse({ ok: true, id: "board-1", action: "board.deleted" }))
            .toEqual({ ok: true, id: "board-1", action: "board.deleted" });
        expect(() => boardCommandAckSchema.parse({ ok: false, id: "board-1", action: "x" }))
            .toThrow();
    });
});

describe("spotlight placement contracts", () => {
    it("restricts write-side targets to story/topic and parses placements", () => {
        expect(() => pinSpotlightCommandSchema.parse({
            boardId: "board-1",
            targetType: "workspace",
            targetId: "x",
        })).toThrow();
        const command = pinSpotlightCommandSchema.parse({
            boardId: "board-1",
            targetType: "topic",
            targetId: "topic-1",
            reason: "关注",
        });
        expect(command.targetType).toBe("topic");

        const placement = spotlightPlacementSchema.parse({
            id: "placement-1",
            boardId: "board-1",
            targetType: "story",
            targetId: "story-1",
            source: "manual",
            reason: null,
            actor: null,
            expiresAt: null,
            targetTitle: "Story 1",
            createdAt: "2026-09-09T00:00:00.000Z",
            updatedAt: "2026-09-09T00:00:00.000Z",
        });
        expect(placement.targetTitle).toBe("Story 1");
        // Read-side targetType stays permissive for future kinds.
        expect(spotlightPlacementSchema.parse({
            ...placement,
            targetType: "workspace",
        }).targetType).toBe("workspace");
    });
});

describe("story subtype registry contracts", () => {
    it("pins the managed status enum and validates catalog pages", () => {
        expect(storySubtypeStatusSchema.options).toEqual(["active", "deprecated", "retired"]);

        const page = storySubtypePageSchema.parse({
            items: [
                {
                    id: "media.comic",
                    kind: "media",
                    version: 1,
                    label: "漫画",
                    description: null,
                    status: "active",
                    identityPolicy: "same-work-v1",
                    owner: "core",
                },
            ],
            nextCursor: null,
            snapshotAt: "2026-09-09T00:00:00.000Z",
        });
        expect(page.items[0]).toMatchObject({ id: "media.comic", kind: "media" });

        expect(() => storySubtypePageSchema.parse({
            items: [{ ...page.items[0], status: "unknown" }],
            nextCursor: null,
            snapshotAt: "2026-09-09T00:00:00.000Z",
        })).toThrow();
        expect(() => storySubtypePageSchema.parse({
            items: [{ ...page.items[0], version: 0 }],
            nextCursor: null,
            snapshotAt: "2026-09-09T00:00:00.000Z",
        })).toThrow();
    });

    it("accepts only known kinds in the catalog query", () => {
        expect(storySubtypeQuerySchema.parse({})).toEqual({});
        expect(storySubtypeQuerySchema.parse({ kind: "media" })).toEqual({ kind: "media" });
        expect(() => storySubtypeQuerySchema.parse({ kind: "video" })).toThrow();
    });
});
