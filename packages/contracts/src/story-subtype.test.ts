import { describe, expect, it } from "vitest";

import {
    storySubtypePageSchema,
    storySubtypeQuerySchema,
    storySubtypeStatusSchema,
} from "./index.js";

describe("story subtype registry contracts", () => {
    it("pins the managed status enum and validates catalog pages", () => {
        expect(storySubtypeStatusSchema.options).toEqual(["active", "deprecated", "retired"]);

        const page = storySubtypePageSchema.parse({
            items: [
                {
                    id: "media.comic",
                    kind: "media",
                    version: 1,
                    label: "漫画",
                    description: null,
                    status: "active",
                    identityPolicy: "same-work-v1",
                    owner: "core",
                },
            ],
            nextCursor: null,
            snapshotAt: "2026-09-09T00:00:00.000Z",
        });
        expect(page.items[0]).toMatchObject({ id: "media.comic", kind: "media" });

        expect(() => storySubtypePageSchema.parse({
            items: [{ ...page.items[0], status: "unknown" }],
            nextCursor: null,
            snapshotAt: "2026-09-09T00:00:00.000Z",
        })).toThrow();
        expect(() => storySubtypePageSchema.parse({
            items: [{ ...page.items[0], version: 0 }],
            nextCursor: null,
            snapshotAt: "2026-09-09T00:00:00.000Z",
        })).toThrow();
    });

    it("accepts only known kinds in the catalog query", () => {
        expect(storySubtypeQuerySchema.parse({})).toEqual({});
        expect(storySubtypeQuerySchema.parse({ kind: "media" })).toEqual({ kind: "media" });
        expect(() => storySubtypeQuerySchema.parse({ kind: "video" })).toThrow();
    });
});
