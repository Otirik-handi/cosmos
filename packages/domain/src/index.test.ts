import { describe, expect, it } from "vitest";

import {
    createTemporalValue,
    deriveExternalKey,
    fingerprintEntryRevision,
    normalizePublisher,
    projectEntryToStory,
} from "./index.js";

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
});
