import { describe, expect, it } from "vitest";

import {
    describeMediaPolicy,
    mediaPolicyFormValues,
    parseMediaPolicyForm,
    type MediaPolicyFormValues,
} from "./media-policy";

function form(overrides: Partial<MediaPolicyFormValues> = {}): MediaPolicyFormValues {
    return {
        images: "download",
        maxFileMb: "",
        maxRunMb: "",
        retryMaxAttempts: "",
        retentionDays: "",
        ...overrides,
    };
}

describe("media policy form (ADR-0014/0015)", () => {
    it("treats empty inputs as following the default", () => {
        expect(parseMediaPolicyForm(form()))
            .toEqual({ ok: true, policy: { images: "download" } });
    });

    it("converts MB inputs to bytes and keeps the image switch", () => {
        expect(parseMediaPolicyForm(form({
            images: "metadata_only",
            maxFileMb: "2",
            maxRunMb: "8",
        }))).toEqual({
            ok: true,
            policy: {
                images: "metadata_only",
                maxFileBytes: 2 * 1024 * 1024,
                maxRunBytes: 8 * 1024 * 1024,
            },
        });
    });

    it("rejects values that would raise the global default", () => {
        expect(parseMediaPolicyForm(form({ maxFileMb: "11" }))).toMatchObject({ ok: false });
        expect(parseMediaPolicyForm(form({ maxRunMb: "51" }))).toMatchObject({ ok: false });
        expect(parseMediaPolicyForm(form({ maxFileMb: "0.01" }))).toMatchObject({ ok: false });
        expect(parseMediaPolicyForm(form({ maxRunMb: "0.5" }))).toMatchObject({ ok: false });
    });

    it("rejects non-numeric input with a readable message", () => {
        const result = parseMediaPolicyForm(form({ maxFileMb: "abc" }));
        expect(result).toMatchObject({ ok: false });
        if (!result.ok) {
            expect(result.message).toContain("单文件上限");
        }
    });

    it("accepts retry attempts and retention days within their bounds", () => {
        expect(parseMediaPolicyForm(form({
            retryMaxAttempts: "0",
            retentionDays: "30",
        }))).toEqual({
            ok: true,
            policy: { images: "download", retry: { maxAttempts: 0 }, retentionDays: 30 },
        });
        expect(parseMediaPolicyForm(form({ retryMaxAttempts: "11" })))
            .toMatchObject({ ok: false });
        expect(parseMediaPolicyForm(form({ retryMaxAttempts: "-1" })))
            .toMatchObject({ ok: false });
        expect(parseMediaPolicyForm(form({ retentionDays: "3651" })))
            .toMatchObject({ ok: false });
        expect(parseMediaPolicyForm(form({ retentionDays: "1.5" })))
            .toMatchObject({ ok: false });
    });

    it("round-trips stored values into the form", () => {
        expect(mediaPolicyFormValues({
            images: "metadata_only",
            maxFileBytes: 2 * 1024 * 1024,
            maxRunBytes: 8 * 1024 * 1024,
            retry: { maxAttempts: 5 },
            retentionDays: 14,
        })).toEqual({
            images: "metadata_only",
            maxFileMb: "2",
            maxRunMb: "8",
            retryMaxAttempts: "5",
            retentionDays: "14",
        });
        expect(mediaPolicyFormValues(undefined)).toEqual({
            images: "download",
            maxFileMb: "",
            maxRunMb: "",
            retryMaxAttempts: "",
            retentionDays: "",
        });
    });

    it("describes follow-default and tightened states", () => {
        expect(describeMediaPolicy(undefined)).toBe("跟随默认（10 / 50，重试 3 次，永久保留）");
        expect(describeMediaPolicy({ images: "metadata_only" })).toBe("仅记录元数据");
        expect(describeMediaPolicy({ maxFileBytes: 2 * 1024 * 1024, maxRunBytes: 8 * 1024 * 1024 }))
            .toBe("单文件 ≤ 2；单次 ≤ 8");
        expect(describeMediaPolicy({ retry: { maxAttempts: 0 } })).toBe("不重试失败媒体");
        expect(describeMediaPolicy({ retentionDays: 30 })).toBe("媒体保留 30 天");
        expect(describeMediaPolicy({ retentionDays: 0 })).toBe("永久保留媒体");
        expect(describeMediaPolicy({
            images: "metadata_only",
            maxFileBytes: 2 * 1024 * 1024,
        })).toBe("仅记录元数据；单文件 ≤ 2");
    });
});
