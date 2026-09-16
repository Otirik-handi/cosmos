import {describe, expect, it} from "vitest";

import type { StoryTimeRange} from "@cosmos/contracts";

import {keyFactSourceLabel, storyEventTimeView} from "./story-event-time";

const rawStart: StoryTimeRange["start"] = {
    exact: null,
    exactPrecision: null,
    fallback: {
        raw: "昨天下午",
        lowerBound: "2026-09-14T00:00:00.000Z",
        precision: "day",
        timezone: null,
        confidence: "uncertain",
    },
};

describe("storyEventTimeView", () => {
    it("renders nothing when the Story has no time range", () => {
        expect(storyEventTimeView(null)).toBeNull();
        expect(storyEventTimeView(undefined)).toBeNull();
    });

    it("renders an exact bound as local minutes and marks it precise", () => {
        const view = storyEventTimeView({
            start: {exact: "2026-09-14T09:30:00.000Z", exactPrecision: "second", fallback: null},
            end: null,
        });

        expect(view?.uncertain).toBe(false);
        expect(view?.text).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/u);
    });

    it("joins both bounds and flags the pair as imprecise when one end is raw only", () => {
        const view = storyEventTimeView({
            start: {exact: "2026-09-14T09:30:00.000Z", exactPrecision: "second", fallback: null},
            end: rawStart,
        });

        expect(view?.uncertain).toBe(true);
        expect(view?.text.endsWith("昨天下午")).toBe(true);
        expect(view?.text).toContain(" – ");
    });

    it("renders raw text alone without an exact bound", () => {
        expect(storyEventTimeView({start: rawStart, end: null}))
            .toEqual({text: "昨天下午", uncertain: true});
    });
});

describe("keyFactSourceLabel", () => {
    it("returns the loaded entry title, null for no source, and a marker for a deleted entry", () => {
        const sources = [{id: "entry:a", title: "官方公告"}];

        expect(keyFactSourceLabel({text: "上下文窗口 1M", entryId: "entry:a"}, sources))
            .toBe("官方公告");
        expect(keyFactSourceLabel({text: "无出处", entryId: null}, sources)).toBeNull();
        expect(keyFactSourceLabel({text: "悬空出处", entryId: "entry:gone"}, sources))
            .toBe("出处已删除");
    });
});
