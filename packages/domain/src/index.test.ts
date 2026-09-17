import { describe, expect, it } from "vitest";

import {
    blockTypes,
    checkStorySubtype,
    createTemporalValue,
    deriveExternalKey,
    entityRelationTypes,
    entityTypes,
    entryRelationTypes,
    entryStoryRelationTypes,
    favoriteTargetTypes,
    fingerprintEntityRevision,
    fingerprintEntryRevision,
    fingerprintStoryRevision,
    fingerprintTopicRevision,
    isSymmetricEntryRelationType,
    listStorySubtypes,
    normalizeEntryRelationEndpoints,
    normalizePublisher,
    normalizeStoryRepresentation,
    projectEntryToStory,
    storyKeyFactMaxCount,
    storyKeyFactMaxTextLength,
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

describe("entry↔entry duplicate semantics", () => {
    it("keeps the managed relation family to the three frozen words", () => {
        expect(entryRelationTypes).toEqual([
            "duplicate_of",
            "syndicated_from",
            "near_duplicate_of",
        ]);
    });

    it("treats only the two duplicate kinds as symmetric", () => {
        expect(isSymmetricEntryRelationType("duplicate_of")).toBe(true);
        expect(isSymmetricEntryRelationType("near_duplicate_of")).toBe(true);
        // A reprint has an author order, so it must keep the asserted direction.
        expect(isSymmetricEntryRelationType("syndicated_from")).toBe(false);
        // Unknown values degrade on read and must not be sorted as symmetric:
        // guessing an order for an unknown type would invent a direction.
        expect(isSymmetricEntryRelationType("translated_from")).toBe(false);
    });

    it("sorts symmetric endpoints by id and leaves directed ones alone", () => {
        expect(normalizeEntryRelationEndpoints({
            relationType: "duplicate_of",
            fromEntryId: "entry-b",
            toEntryId: "entry-a",
        })).toEqual({ fromEntryId: "entry-a", toEntryId: "entry-b" });

        // Both input orders must land on the same row, otherwise each side
        // would read its own copy (ADR-0022 decision 3).
        expect(normalizeEntryRelationEndpoints({
            relationType: "near_duplicate_of",
            fromEntryId: "entry-a",
            toEntryId: "entry-b",
        })).toEqual({ fromEntryId: "entry-a", toEntryId: "entry-b" });

        expect(normalizeEntryRelationEndpoints({
            relationType: "syndicated_from",
            fromEntryId: "entry-b",
            toEntryId: "entry-a",
        })).toEqual({ fromEntryId: "entry-b", toEntryId: "entry-a" });
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

describe("story representation extension", () => {
    /**
     * ADR-0021 decision 4 guard: these six digests were produced by the
     * `fingerprintStoryRevision` that shipped before timeRange/keyFacts existed
     * (base 085c217). They are the contract that a Stored Revision written by
     * the old code is still recognised as unchanged after the upgrade. If this
     * test fails, every existing Story gains a phantom Revision on its next
     * no-op edit — do not "fix" it by updating the constants unless a full
     * fingerprint backfill is planned.
     */
    const preExtensionFingerprints: readonly [Record<string, unknown>, string][] = [
        [
            { title: "T", summary: null, kind: "event", subtype: null },
            "45465ac4c76fb9faa01ab135cd3e1ab7f3e4eb34b4ff65dc69fec7c6034b8bb9",
        ],
        [
            {
                title: "多来源 Story 标题",
                summary: "摘要文本",
                kind: "document",
                subtype: "news",
            },
            "e66ef9cf4ed671e0f225c7fc7ef00781b5b054e70cd526a68ee488e5da2e6b76",
        ],
        [
            { title: "", summary: "", kind: "media", subtype: "" },
            "a51ff841ce7df16a2e8e2542e5658b4df95ee389bde8f6b3e7f7ec19c83292e0",
        ],
        [
            { title: "Thread", summary: null, kind: "thread", subtype: "unknown:weibo" },
            "1e3e6737a26ac11c597ad5ff0011f5e8adc60920e811d7d102c6dc4a2a653889",
        ],
        [
            {
                title: '标题 "引号" \\ 反斜杠 🚀',
                summary: "换行\n制表\t",
                kind: "event",
                subtype: null,
            },
            "999c4c0700c8db7af0197627bc616bcbe869c40b5d5861aca4b9ac5b545f325d",
        ],
        [
            { title: "  padded  ", summary: "  ", kind: "document", subtype: null },
            "3d43f370fb0a376e8070d2b9d08ae3bd309e8d6149dffecafd09dce2b2e97d69",
        ],
    ];

    it("keeps the pre-extension fingerprint byte-identical when both fields are empty", () => {
        for (const [input, expected] of preExtensionFingerprints) {
            expect(fingerprintStoryRevision(input as never)).toBe(expected);
            expect(fingerprintStoryRevision({
                ...input,
                timeRange: null,
                keyFacts: [],
            } as never)).toBe(expected);
            expect(fingerprintStoryRevision({
                ...input,
                keyFacts: [{ text: "   ", entryId: null }],
            } as never)).toBe(expected);
        }
    });

    it("appends a revision only when a real extension change survives normalization", () => {
        const base = {
            title: "Same event",
            summary: "summary",
            kind: "event" as const,
            subtype: null,
        };
        const empty = fingerprintStoryRevision(base);
        const facts = [{ text: "第一条事实", entryId: "entry-1" }];
        const range = {
            start: {
                exact: "2026-09-16T00:00:00.000Z",
                exactPrecision: "second" as const,
                fallback: null,
            },
            end: null,
        };

        expect(fingerprintStoryRevision({ ...base, timeRange: range })).not.toBe(empty);
        expect(fingerprintStoryRevision({ ...base, keyFacts: facts })).not.toBe(empty);

        // Setting, then clearing, returns to the pre-extension digest: this is
        // what makes "set -> clear" land back on an equivalent representation.
        expect(fingerprintStoryRevision({ ...base, timeRange: range, keyFacts: facts }))
            .not.toBe(empty);
        expect(fingerprintStoryRevision({ ...base, timeRange: null, keyFacts: [] }))
            .toBe(empty);
    });

    it("does not change the digest for whitespace-only or key-order noise", () => {
        const base = {
            title: "Same event",
            summary: "summary",
            kind: "event" as const,
            subtype: null,
        };
        const range = {
            start: {
                exact: "2026-09-16T00:00:00.000Z",
                exactPrecision: "second" as const,
                fallback: null,
            },
            end: null,
        };

        expect(fingerprintStoryRevision({
            ...base,
            timeRange: range,
            keyFacts: [{ text: "  第一条事实  ", entryId: "  entry-1  " }],
        })).toBe(fingerprintStoryRevision({
            ...base,
            timeRange: range,
            keyFacts: [{ text: "第一条事实", entryId: "entry-1" }],
        }));
    });

    it("normalizes the shared representation for both fingerprint and persistence", () => {
        expect(normalizeStoryRepresentation({})).toEqual({ timeRange: null, keyFacts: [] });

        expect(normalizeStoryRepresentation({
            keyFacts: [
                { text: "  保留顺序一  ", entryId: " entry-1 " },
                { text: "   ", entryId: "entry-2" },
                { text: "保留顺序二", entryId: "   " },
            ],
        })).toEqual({
            timeRange: null,
            keyFacts: [
                { text: "保留顺序一", entryId: "entry-1" },
                { text: "保留顺序二", entryId: null },
            ],
        });

        expect(normalizeStoryRepresentation({
            timeRange: {
                start: {
                    exact: null,
                    exactPrecision: null,
                    fallback: {
                        raw: "  昨天下午  ",
                        lowerBound: " 2026-09-15T00:00:00.000Z ",
                        precision: "day",
                        timezone: "  ",
                        confidence: "uncertain",
                    },
                },
                end: null,
            },
        })).toEqual({
            timeRange: {
                start: {
                    exact: null,
                    exactPrecision: null,
                    fallback: {
                        raw: "昨天下午",
                        lowerBound: "2026-09-15T00:00:00.000Z",
                        precision: "day",
                        timezone: null,
                        confidence: "uncertain",
                    },
                },
                end: null,
            },
            keyFacts: [],
        });
    });

    it("pins the fact ceilings that the contracts package duplicates", () => {
        // @cosmos/contracts cannot import these (it is bundled into the browser
        // and this package pulls in node:crypto), so both sides pin the numbers.
        expect(storyKeyFactMaxCount).toBe(20);
        expect(storyKeyFactMaxTextLength).toBe(500);
    });
});
