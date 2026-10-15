import { describe, expect, it } from "vitest";
import { shouldPromoteRepresentation, validateRepresentationRollback } from "./representation-policy.js";

const current = { id: "old", entryRevisionId: "revision", status: "partial" as const };

describe("representation selection policy", () => {
    it("promotes better coverage and requires recommendation for equal coverage", () => {
        const input = { current, candidate: { ...current, id: "new" }, locked: false, systemRecommended: false };
        expect(shouldPromoteRepresentation(input)).toBe(false);
        expect(shouldPromoteRepresentation({ ...input, systemRecommended: true })).toBe(true);
        expect(shouldPromoteRepresentation({ ...input, candidate: { ...input.candidate, status: "complete" } })).toBe(true);
        expect(shouldPromoteRepresentation({ ...input, candidate: { ...input.candidate, status: "failed" }, systemRecommended: true })).toBe(false);
    });

    it("preserves manual locks, including an empty selection, and avoids redundant updates", () => {
        const input = { current, candidate: { ...current, id: "new", status: "complete" as const }, locked: true, systemRecommended: true };
        expect(shouldPromoteRepresentation(input)).toBe(false);
        expect(shouldPromoteRepresentation({ ...input, current: null })).toBe(false);
        expect(shouldPromoteRepresentation({ ...input, locked: false, current: null })).toBe(true);
        expect(shouldPromoteRepresentation({ ...input, locked: false, candidate: current })).toBe(false);
    });

    it("rejects cross-revision selection and unusable rollback targets", () => {
        const foreign = { ...current, entryRevisionId: "other" };
        expect(() => shouldPromoteRepresentation({ current, candidate: foreign, locked: false, systemRecommended: true })).toThrow("another source revision");
        expect(() => validateRepresentationRollback("revision", foreign)).toThrow("another source revision");
        expect(() => validateRepresentationRollback("revision", { ...current, status: "failed" })).toThrow("unusable");
        expect(() => validateRepresentationRollback("revision", current)).not.toThrow();
    });
});
