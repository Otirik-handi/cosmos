import {describe, expect, it} from "vitest";

import type { StoryTimeRange, TemporalValue} from "@cosmos/contracts";

import {
    emptyStoryTimeRangeDraft,
    storyTimeRangeFromDraft,
    storyTimeRangeOrderError,
    storyTimeRangeToDraft,
} from "./story-time-range-draft";

function exactAt(iso: string): TemporalValue {
    return {exact: new Date(iso).toISOString(), exactPrecision: "second", fallback: null};
}

describe("storyTimeRangeFromDraft", () => {
    it("maps the precise input to an exact second-precision value", () => {
        const result = storyTimeRangeFromDraft({
            start: {mode: "exact", exactInput: "2026-09-14T09:30", raw: "", precision: "day"},
            end: {mode: "none", exactInput: "", raw: "", precision: "day"},
        });

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const start = result.timeRange?.start;
        expect(start?.exactPrecision).toBe("second");
        expect(start?.fallback).toBeNull();
        expect(new Date(start?.exact ?? "").getTime())
            .toBe(new Date("2026-09-14T09:30").getTime());
        expect(result.timeRange?.end).toBeNull();
    });

    it("maps raw text to an uncertain fallback whose lower bound is the start of the chosen granularity", () => {
        const result = storyTimeRangeFromDraft({
            start: {mode: "raw", exactInput: "", raw: "2026 年", precision: "year"},
            end: {mode: "none", exactInput: "", raw: "", precision: "day"},
        });

        expect(result.ok).toBe(true);
        if (!result.ok) {
            return;
        }
        const fallback = result.timeRange?.start.fallback;
        expect(result.timeRange?.start.exact).toBeNull();
        expect(result.timeRange?.start.exactPrecision).toBeNull();
        expect(fallback).toMatchObject({
            raw: "2026 年",
            precision: "year",
            timezone: null,
            confidence: "uncertain",
        });
        // 本地下界：断言本地字段而不是固定字符串，避免测试绑定运行机器的时区。
        const lowerBound = new Date(fallback?.lowerBound ?? "");
        const now = new Date();
        expect([lowerBound.getMonth(), lowerBound.getDate(), lowerBound.getHours(), lowerBound.getMinutes()])
            .toEqual([0, 1, 0, 0]);
        expect(lowerBound.getFullYear()).toBe(now.getFullYear());
    });

    it("clears the whole range when both ends are left empty", () => {
        expect(storyTimeRangeFromDraft(emptyStoryTimeRangeDraft()))
            .toEqual({ok: true, timeRange: null});
    });

    it("rejects an end that precedes the start", () => {
        const draft = {
            start: {mode: "exact" as const, exactInput: "2026-09-16T09:30", raw: "", precision: "day" as const},
            end: {mode: "exact" as const, exactInput: "2026-09-14T09:30", raw: "", precision: "day" as const},
        };
        expect(storyTimeRangeOrderError(draft)).toContain("结束时间早于开始时间");
        const result = storyTimeRangeFromDraft(draft);
        expect(result.ok).toBe(false);
    });

    it("rejects an end without a start", () => {
        const result = storyTimeRangeFromDraft({
            start: {mode: "none", exactInput: "", raw: "", precision: "day"},
            end: {mode: "exact", exactInput: "2026-09-14T09:30", raw: "", precision: "day"},
        });
        expect(result.ok).toBe(false);
        if (!result.ok) {
            expect(result.error).toContain("没有开始时间");
        }
    });
});

describe("storyTimeRangeToDraft", () => {
    it("splits an exact bound into the local datetime input value", () => {
        const draft = storyTimeRangeToDraft({
            start: exactAt("2026-09-14T09:30:00.000Z"),
            end: null,
        });

        expect(draft.start.mode).toBe("exact");
        expect(draft.start.exactInput).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/u);
        expect(draft.end).toEqual({mode: "none", exactInput: "", raw: "", precision: "day"});
    });

    it("falls back to the day granularity for raw data with an unlisted precision", () => {
        const stored: StoryTimeRange = {
            start: {
                exact: null,
                exactPrecision: null,
                fallback: {
                    raw: "昨天下午",
                    lowerBound: "2026-09-14T00:00:00.000Z",
                    precision: "unknown",
                    timezone: null,
                    confidence: "uncertain",
                },
            },
            end: null,
        };

        expect(storyTimeRangeToDraft(stored).start).toEqual({
            mode: "raw",
            exactInput: "",
            raw: "昨天下午",
            precision: "day",
        });
    });

    it("round-trips an exact bound through the form", () => {
        // 整分钟的时刻经本地读数往返后仍是同一时刻；不断言固定读数，避免绑定运行机器时区。
        const stored: StoryTimeRange = {start: exactAt("2026-09-14T09:30:00.000Z"), end: null};
        const result = storyTimeRangeFromDraft(storyTimeRangeToDraft(stored));
        expect(result.ok).toBe(true);
        if (result.ok) {
            expect(new Date(result.timeRange?.start.exact ?? "").getTime())
                .toBe(new Date(stored.start.exact ?? "").getTime());
        }
    });
});
