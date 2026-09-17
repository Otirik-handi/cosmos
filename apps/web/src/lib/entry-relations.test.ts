import { describe, expect, it } from "vitest";

import {
    ENTRY_RELATION_TYPE_OPTIONS,
    entryRelationCandidates,
    entryRelationCounterpart,
    entryRelationText,
    entryRelationTypeLabel,
} from "./entry-relations";

describe("entry relation wording", () => {
    it("says 转载自 on the reprint side and 被…转载 on the original side", () => {
        expect(entryRelationText(
            { relationType: "syndicated_from", direction: "outgoing" },
            "阿里官网",
        )).toBe("转载自 阿里官网");
        expect(entryRelationText(
            { relationType: "syndicated_from", direction: "incoming" },
            "某门户",
        )).toBe("被 某门户 转载");
    });

    it("uses the same words on both sides of a symmetric relation", () => {
        expect(entryRelationText(
            { relationType: "duplicate_of", direction: "symmetric" },
            "某门户",
        )).toBe("重复于 某门户");
        expect(entryRelationText(
            { relationType: "near_duplicate_of", direction: "symmetric" },
            "某公众号",
        )).toBe("近似于 某公众号");
    });

    it("falls back to the raw kind for an unknown relation and to the id for a missing title", () => {
        expect(entryRelationText(
            { relationType: "translated_from", direction: "outgoing" },
            "entry-b",
        )).toBe("translated_from：entry-b");
        expect(entryRelationCounterpart({ entryId: "entry-b", title: null })).toBe("entry-b");
        expect(entryRelationCounterpart({ entryId: "entry-b", title: "标题" })).toBe("标题");
        expect(entryRelationTypeLabel("near_duplicate_of")).toBe("近似重复");
        expect(entryRelationTypeLabel("translated_from")).toBe("translated_from");
    });

    it("keeps the write order of the three frozen words", () => {
        expect(ENTRY_RELATION_TYPE_OPTIONS).toEqual([
            "duplicate_of",
            "syndicated_from",
            "near_duplicate_of",
        ]);
    });
});

describe("entry relation candidates", () => {
    it("drops self and entries that already carry a relation", () => {
        const candidates = [
            { id: "entry-a", title: "A", sourceName: "S" },
            { id: "entry-b", title: "B", sourceName: "S" },
            { id: "entry-c", title: "C", sourceName: "S" },
        ];
        expect(entryRelationCandidates(candidates, "entry-a", [{ entryId: "entry-b" }]))
            .toEqual([{ id: "entry-c", title: "C", sourceName: "S" }]);
        expect(entryRelationCandidates(candidates, "entry-a", [])).toHaveLength(2);
    });
});
