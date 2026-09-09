import { describe, expect, it } from "vitest";

import {
    blockTypes,
    checkStorySubtype,
    createTemporalValue,
    deriveExternalKey,
    entityRelationTypes,
    entityTypes,
    entryStoryRelationTypes,
    favoriteTargetTypes,
    fingerprintEntityRevision,
    fingerprintEntryRevision,
    fingerprintStoryRevision,
    fingerprintTopicRevision,
    listStorySubtypes,
    normalizePublisher,
    projectEntryToStory,
    storyKinds,
    storySubtypeRegistry,
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

describe("board domain semantics", () => {
    it("keeps the managed block type enum stable and readonly", () => {
        expect(blockTypes).toEqual([
            "feed",
            "spotlight",
            "source-health",
            "topic-list",
            "collection",
        ]);
    });
});

describe("entry↔story evidence semantics", () => {
    it("keeps the managed auxiliary relation enum stable and readonly", () => {
        expect(entryStoryRelationTypes).toEqual([
            "evidence_for",
            "mentions",
        ]);
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

    it("keeps the managed subtype registry namespaced by core kind", () => {
        expect(storySubtypeRegistry.map((entry) => entry.id)).toEqual([
            "media.comic",
            "media.anime",
            "media.video",
        ]);
        for (const entry of storySubtypeRegistry) {
            expect(entry.id.startsWith(`${entry.kind}.`)).toBe(true);
            expect(storyKinds).toContain(entry.kind);
            expect(entry.version).toBeGreaterThan(0);
            expect(entry.status).toBe("active");
            expect(entry.owner).toBe("core");
        }
    });

    it("accepts only active registrations of the story's own kind", () => {
        expect(checkStorySubtype("media", null)).toEqual({ ok: true, registration: null });
        expect(checkStorySubtype("media", "media.comic")).toMatchObject({
            ok: true,
            registration: { id: "media.comic", kind: "media", status: "active" },
        });

        expect(checkStorySubtype("media", "  ")).toMatchObject({ ok: false, reason: "empty" });
        expect(checkStorySubtype("media", "media.unknown")).toMatchObject({ ok: false, reason: "unregistered" });
        expect(checkStorySubtype("event", "media.comic")).toMatchObject({ ok: false, reason: "kind_mismatch" });

        const retired = [{
            id: "media.legacy",
            kind: "media" as const,
            version: 1,
            label: "Legacy",
            description: null,
            status: "retired" as const,
            identityPolicy: null,
            owner: "core",
        }];
        expect(checkStorySubtype("media", "media.legacy", retired)).toMatchObject({
            ok: false,
            reason: "not_active",
        });
    });

    it("offers active and deprecated registrations to product consumers", () => {
        expect(listStorySubtypes({ kind: "media" }).map((entry) => entry.id)).toEqual([
            "media.comic",
            "media.anime",
            "media.video",
        ]);
        expect(listStorySubtypes({ kind: "event" })).toEqual([]);
        expect(listStorySubtypes({ statuses: ["retired"] })).toEqual([]);
    });
});
