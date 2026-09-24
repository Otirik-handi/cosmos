import { describe, expect, it } from "vitest";

import {
    splitStoryCommandSchema,
    createEntityCommandSchema,
    createEntityRelationCommandSchema,
    entityDetailSchema,
    linkStoryEntityCommandSchema,
    linkEntryStoryCommandSchema,
    entryStoryRelationTypeSchema,
    storyDetailSchema,
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
                producer: "system",
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
                relations: [],
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
                producer: "system",
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
                relations: [],
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
                producer: "human",
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
