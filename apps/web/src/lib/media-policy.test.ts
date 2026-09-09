import { describe, expect, it } from "vitest";

import {
    describeMediaPolicy,
    mediaPolicyFormValues,
    parseMediaPolicyForm,
} from "./media-policy";

describe("media policy form (ADR-0014)", () => {
    it("treats empty inputs as following the default", () => {
        expect(parseMediaPolicyForm({ images: "download", maxFileMb: "", maxRunMb: "" }))
            .toEqual({ ok: true, policy: { images: "download" } });
    });

    it("converts MB inputs to bytes and keeps the image switch", () => {
        expect(parseMediaPolicyForm({
            images: "metadata_only",
            maxFileMb: "2",
            maxRunMb: "8",
        })).toEqual({
            ok: true,
            policy: {
                images: "metadata_only",
                maxFileBytes: 2 * 1024 * 1024,
                maxRunBytes: 8 * 1024 * 1024,
            },
        });
    });

    it("rejects values that would raise the global default", () => {
        expect(parseMediaPolicyForm({ images: "download", maxFileMb: "11", maxRunMb: "" }))
            .toMatchObject({ ok: false });
        expect(parseMediaPolicyForm({ images: "download", maxFileMb: "", maxRunMb: "51" }))
            .toMatchObject({ ok: false });
        expect(parseMediaPolicyForm({ images: "download", maxFileMb: "0.01", maxRunMb: "" }))
            .toMatchObject({ ok: false });
        expect(parseMediaPolicyForm({ images: "download", maxFileMb: "", maxRunMb: "0.5" }))
            .toMatchObject({ ok: false });
    });

    it("rejects non-numeric input with a readable message", () => {
        const result = parseMediaPolicyForm({ images: "download", maxFileMb: "abc", maxRunMb: "" });
        expect(result).toMatchObject({ ok: false });
        if (!result.ok) {
            expect(result.message).toContain("单文件上限");
        }
    });

    it("round-trips stored values into the form", () => {
        expect(mediaPolicyFormValues({
            images: "metadata_only",
            maxFileBytes: 2 * 1024 * 1024,
            maxRunBytes: 8 * 1024 * 1024,
        })).toEqual({ images: "metadata_only", maxFileMb: "2", maxRunMb: "8" });
        expect(mediaPolicyFormValues(undefined))
            .toEqual({ images: "download", maxFileMb: "", maxRunMb: "" });
    });

    it("describes follow-default and tightened states", () => {
        expect(describeMediaPolicy(undefined)).toBe("跟随默认（10 / 50）");
        expect(describeMediaPolicy({ images: "metadata_only" })).toBe("仅记录元数据");
        expect(describeMediaPolicy({ maxFileBytes: 2 * 1024 * 1024, maxRunBytes: 8 * 1024 * 1024 }))
            .toBe("单文件 ≤ 2；单次 ≤ 8");
        expect(describeMediaPolicy({
            images: "metadata_only",
            maxFileBytes: 2 * 1024 * 1024,
        })).toBe("仅记录元数据；单文件 ≤ 2");
    });
});
