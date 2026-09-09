import {describe, expect, it} from "vitest";

import type { EntryDetail, StoryDetail } from "@cosmos/contracts";

import {buildStoryTimeline} from "./story-timeline";

function entry(overrides: Partial<EntryDetail>): EntryDetail {
    return {
        id: "entry:1",
        sourceId: "source:1",
        sourceName: "来源 A",
        sourceKind: "rss",
        currentRevisionId: "er:2",
        metrics: null,
        revisions: [],
        observations: [],
        relatedStories: [],
        ...overrides,
    };
}

function story(entries: EntryDetail[]): StoryDetail {
    return {
        story: {
            id: "story:1",
            kind: "event",
            subtype: null,
            revisionId: "sr:1",
            title: "同一事件",
            summary: null,
        },
        entry: entries[0]!,
        entries,
        entities: [],
        labels: [],
        favorited: false,
        evidence: [],
    };
}

describe("buildStoryTimeline", () => {
    it("merges revisions and observations of every member source into one time-ordered stream", () => {
        const timeline = buildStoryTimeline(story([
            entry({
                id: "entry:1",
                sourceName: "来源 A",
                revisions: [{
                    id: "er:2",
                    revision: 2,
                    title: "A 修订二",
                    summary: null,
                    contentText: "",
                    webUrl: null,
                    contentKind: "article",
                    publisher: null,
                    publishedAt: {exact: "2026-09-09T08:00:00.000Z", exactPrecision: "second", fallback: null},
                    updatedAt: null,
                    sourcePublishedAt: null,
                    createdAt: "2026-09-09T08:00:00.000Z",
                    assets: [],
                }],
                observations: [{
                    id: "ob:1",
                    externalId: null,
                    externalKey: "a:1",
                    eventKind: "snapshot",
                    webUrl: null,
                    capturedAt: "2026-09-09T07:00:00.000Z",
                    sourcePublishedAt: null,
                }],
            }),
            entry({
                id: "entry:2",
                sourceName: "来源 B",
                revisions: [{
                    id: "er:3",
                    revision: 1,
                    title: "B 首次入库",
                    summary: null,
                    contentText: "",
                    webUrl: null,
                    contentKind: "article",
                    publisher: null,
                    publishedAt: {exact: null, exactPrecision: null, fallback: {
                        raw: "昨天",
                        lowerBound: "2026-09-08T00:00:00.000Z",
                        precision: "day",
                        timezone: null,
                        confidence: "inferred",
                    }},
                    updatedAt: null,
                    sourcePublishedAt: null,
                    createdAt: "2026-09-09T06:00:00.000Z",
                    assets: [],
                }],
                observations: [],
            }),
        ]));

        expect(timeline.map((event) => [event.kind, event.sourceName, event.at])).toEqual([
            ["来源修订 2", "来源 A", "2026-09-09T08:00:00.000Z"],
            ["抓取快照", "来源 A", "2026-09-09T07:00:00.000Z"],
            ["来源修订 1", "来源 B", "2026-09-08T00:00:00.000Z"],
        ]);
    });

    it("falls back to the entry revision creation time when no temporal value exists", () => {
        const timeline = buildStoryTimeline(story([
            entry({
                revisions: [{
                    id: "er:1",
                    revision: 1,
                    title: "无发布时间",
                    summary: null,
                    contentText: "",
                    webUrl: null,
                    contentKind: "article",
                    publisher: null,
                    publishedAt: null,
                    updatedAt: null,
                    sourcePublishedAt: null,
                    createdAt: "2026-09-09T05:00:00.000Z",
                    assets: [],
                }],
            }),
        ]));

        expect(timeline).toHaveLength(1);
        expect(timeline[0]?.at).toBe("2026-09-09T05:00:00.000Z");
    });

    it("returns an empty timeline when a member source has no revision or observation events", () => {
        expect(buildStoryTimeline(story([entry({})]))).toEqual([]);
    });
});
