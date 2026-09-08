import { describe, expect, it } from "vitest";

import {
    createTemporalValue,
    deriveExternalKey,
    entityRelationTypes,
    entityTypes,
    favoriteTargetTypes,
    fingerprintEntityRevision,
    fingerprintEntryRevision,
    fingerprintStoryRevision,
    fingerprintTopicRevision,
    normalizePublisher,
    projectEntryToStory,
    targetTypes,
    topicMemberRoles,
} from "./index.js";

describe("topic domain semantics", () => {
    it("fingerprints topic display fields only and keeps the managed role enum stable", () => {
        expect(topicMemberRoles).toEqual([
            "core",
            "update",
            "background",
            "analysis",
            "counterpoint",
            "tutorial",
        ]);

        const base = fingerprintTopicRevision({
            title: "T",
            purpose: "P",
            scope: null,
        });
        expect(fingerprintTopicRevision({ title: "T", purpose: "P", scope: null }))
            .toBe(base);
        expect(fingerprintTopicRevision({ title: "T2", purpose: "P", scope: null }))
            .not.toBe(base);
        expect(fingerprintTopicRevision({ title: "T", purpose: "P", scope: "S" }))
            .not.toBe(base);
    });
});

describe("entity domain semantics", () => {
    it("keeps managed type and relation-type enums stable and fingerprints identity fields", () => {
        expect(entityTypes).toEqual([
            "person",
            "organization",
            "product",
            "project",
            "model",
            "location",
        ]);
        expect(entityRelationTypes).toEqual([
            "founded",
            "works_at",
            "located_in",
            "produced",
            "part_of",
            "related_to",
        ]);

        const base = fingerprintEntityRevision({
            name: "Jeff Dean",
            type: "person",
        });
        expect(fingerprintEntityRevision({ name: "Jeff Dean", type: "person" }))
            .toBe(base);
        expect(fingerprintEntityRevision({ name: "Jeffrey Dean", type: "person" }))
            .not.toBe(base);
        expect(fingerprintEntityRevision({ name: "Jeff Dean", type: "organization" }))
            .not.toBe(base);
    });
});


describe("user organization domain semantics", () => {
    it("keeps the managed attach-target enum stable and readonly", () => {
        expect(targetTypes).toEqual(["story", "entry", "topic"]);
        expect(favoriteTargetTypes).toEqual(["story", "entry"]);
        expect((favoriteTargetTypes as readonly string[]).every((value) => {
            return (targetTypes as readonly string[]).includes(value);
        })).toBe(true);
    });
});

describe("ingestion identity", () => {
    it("prefers a source stable id and falls back without requiring a URL", () => {
        expect(deriveExternalKey({
            externalId: "guid-1",
            title: "First item",
        })).toBe("external:guid-1");

        expect(deriveExternalKey({
            title: "No URL item",
            contentText: "Body",
            publishedAt: {
                exact: "2026-08-08T00:00:00.000Z",
                exactPrecision: "second",
                fallback: null,
            },
            sourceLocator: { provider: "fixture-rss" },
        })).toMatch(/^fallback:[a-f0-9]{64}$/);
    });

    it("changes the revision fingerprint when source content changes", () => {
        const original = fingerprintEntryRevision({
            title: "Title",
            summary: null,
            contentText: "Original",
            webUrl: null,
            kind: "article",
            publisher: null,
        });
        const revised = fingerprintEntryRevision({
            title: "Title",
            summary: null,
            contentText: "Revised",
            webUrl: null,
            kind: "article",
            publisher: null,
        });

        expect(original).not.toBe(revised);
    });

    it("keeps missing publisher ids as null without inventing identity", () => {
        expect(normalizePublisher({
            platformId: "  ",
            name: "RSS author",
            kind: "unknown",
        })).toEqual({
            platformId: null,
            name: "RSS author",
            handle: null,
            profileUrl: null,
            kind: "unknown",
            metrics: null,
        });
        expect(normalizePublisher(null)).toBeNull();
    });

    it("parses exact timestamps before fallback display text", () => {
        expect(createTemporalValue({
            exact: 1_786_170_123,
            raw: "3小时前",
            now: new Date("2026-08-10T12:00:00.000Z"),
        })).toEqual({
            exact: "2026-08-08T06:22:03.000Z",
            exactPrecision: "second",
            fallback: null,
        });

        expect(createTemporalValue({
            raw: "3小时前",
            now: new Date("2026-08-10T12:00:00.000Z"),
        })).toMatchObject({
            exact: null,
            fallback: {
                raw: "3小时前",
                precision: "hour",
                lowerBound: "2026-08-10T09:00:00.000Z",
            },
        });

        expect(createTemporalValue({
            raw: "07-29湖南",
            now: new Date("2026-08-10T12:00:00.000Z"),
        })).toMatchObject({
            fallback: {
                precision: "day",
                lowerBound: "2026-07-29T00:00:00.000Z",
            },
        });

        expect(createTemporalValue({
            raw: "2周前",
            now: new Date("2026-08-10T12:00:00.000Z"),
        })).toMatchObject({
            fallback: {
                precision: "week",
                lowerBound: "2026-07-27T00:00:00.000Z",
            },
        });
    });

    it("projects one entry into a stable story identity", () => {
        expect(projectEntryToStory({
            entryId: "entry-1",
            revisionId: "revision-1",
            title: "A story",
        })).toEqual({
            id: "story:entry-1",
            kind: "document",
            subtype: null,
            title: "A story",
            summary: null,
            entryId: "entry-1",
            revisionId: "revision-1",
        });

        expect(projectEntryToStory({
            entryId: "entry-video",
            revisionId: "revision-video",
            title: "Video",
            contentKind: "video",
        }).kind).toBe("media");
    });

    it("fingerprints story revisions over display fields only", () => {
        const base = fingerprintStoryRevision({
            title: "Same event",
            summary: "summary",
            kind: "event",
            subtype: null,
        });
        expect(fingerprintStoryRevision({
            title: "Same event",
            summary: "summary",
            kind: "event",
            subtype: null,
        })).toBe(base);

        expect(fingerprintStoryRevision({
            title: "Same event",
            summary: "changed",
            kind: "event",
            subtype: null,
        })).not.toBe(base);
        expect(fingerprintStoryRevision({
            title: "Same event",
            summary: "summary",
            kind: "document",
            subtype: null,
        })).not.toBe(base);
        expect(fingerprintStoryRevision({
            title: "Same event",
            summary: "summary",
            kind: "event",
            subtype: "event.announcement",
        })).not.toBe(base);
    });
});
