import { describe, expect, it } from "vitest";

import {
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
} from "./index.js";

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
