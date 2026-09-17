import { describe, expect, it } from "vitest";

import {
    entryDetailSchema,
    entryRelationSchema,
    entryRelationTypeSchema,
    linkEntryRelationCommandSchema,
    unlinkEntryRelationCommandSchema,
} from "./index.js";

describe("entry↔entry relation contracts", () => {
    it("pins the managed write-side enum to the three frozen words", () => {
        expect(entryRelationTypeSchema.options).toEqual([
            "duplicate_of",
            "syndicated_from",
            "near_duplicate_of",
        ]);
    });

    it("leaves provenance unset on write and demands both endpoints", () => {
        const parsed = linkEntryRelationCommandSchema.parse({
            fromEntryId: " entry-b ",
            toEntryId: "entry-a",
            relationType: "syndicated_from",
        });
        expect(parsed.fromEntryId).toBe("entry-b");
        expect(parsed.producer).toBeUndefined();
        expect(parsed.confidence).toBeUndefined();
        expect(parsed.evidence).toBeUndefined();

        const removal = unlinkEntryRelationCommandSchema.parse({
            fromEntryId: "entry-a",
            toEntryId: "entry-b",
        });
        expect(removal.actor).toBeUndefined();

        // An invented relation word is rejected on write; only the read side
        // degrades unknown values.
        expect(linkEntryRelationCommandSchema.safeParse({
            fromEntryId: "entry-a",
            toEntryId: "entry-b",
            relationType: "translated_from",
        }).success).toBe(false);
        expect(linkEntryRelationCommandSchema.safeParse({
            fromEntryId: "entry-a",
            relationType: "duplicate_of",
        }).success).toBe(false);
    });

    it("reads an unknown relation kind back as a plain string with a known direction", () => {
        const relation = entryRelationSchema.parse({
            entryId: "entry-b",
            relationType: "translated_from",
            direction: "symmetric",
            title: null,
            sourceId: "source-b",
            sourceName: "Source B",
            producer: "human",
            producerVersion: null,
            confidence: 1,
            evidence: null,
            actor: null,
            reason: null,
        });
        expect(relation.relationType).toBe("translated_from");
        expect(relation.title).toBeNull();
        expect(entryRelationSchema.safeParse({ ...relation, direction: "sideways" }).success).toBe(false);
    });

    it("carries the relation list on EntryDetail and defaults nothing", () => {
        const detail = entryDetailSchema.parse({
            id: "entry-a",
            sourceId: "source-a",
            sourceName: "Source A",
            sourceKind: "rss",
            currentRevisionId: "er-a-1",
            metrics: null,
            revisions: [],
            observations: [],
            relatedStories: [],
            relations: [{
                entryId: "entry-b",
                relationType: "duplicate_of",
                direction: "symmetric",
                title: "Entry B",
                sourceId: "source-b",
                sourceName: "Source B",
                producer: "human",
                producerVersion: null,
                confidence: 1,
                evidence: null,
                actor: null,
                reason: null,
            }],
        });
        expect(detail.relations).toHaveLength(1);
        expect(detail.relations[0]?.direction).toBe("symmetric");

        // The field is required: a producer that forgets it must fail loudly
        // instead of shipping an Entry whose relations silently vanished.
        expect(entryDetailSchema.safeParse({
            id: "entry-a",
            sourceId: "source-a",
            sourceName: "Source A",
            sourceKind: "rss",
            currentRevisionId: "er-a-1",
            metrics: null,
            revisions: [],
            observations: [],
            relatedStories: [],
        }).success).toBe(false);
    });
});
