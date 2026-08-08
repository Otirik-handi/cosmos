import { describe, expect, it } from "vitest";

import {
    deriveExternalKey,
    fingerprintEntryRevision,
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
            sourcePublishedAt: "2026-08-08T00:00:00.000Z",
        })).toMatch(/^fallback:[a-f0-9]{64}$/);
    });

    it("changes the revision fingerprint when source content changes", () => {
        const original = fingerprintEntryRevision({
            title: "Title",
            summary: null,
            contentText: "Original",
            webUrl: null,
            sourcePublishedAt: null,
        });
        const revised = fingerprintEntryRevision({
            title: "Title",
            summary: null,
            contentText: "Revised",
            webUrl: null,
            sourcePublishedAt: null,
        });

        expect(original).not.toBe(revised);
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
    });
});
