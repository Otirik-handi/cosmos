import {describe, expect, it} from "vitest";

import {labTokenDefinitions} from "./tokens";
import {
    LAB_TOKEN_DRAFT_STORAGE_KEY,
    loadLabTokenDraft,
    readLabTokenDraft,
    resolveLabTokenValueOnBlur,
    saveLabTokenDraft,
} from "./draft";

function createStorage(initial: string | null = null) {
    let value = initial;
    return {
        getItem: (...args: [string]) => {
            void args;
            return value;
        },
        setItem: (_key: string, next: string) => {
            value = next;
        },
        value: () => value,
    };
}

describe("component lab token drafts", () => {
    it("falls back to an empty draft when storage is empty", () => {
        expect(loadLabTokenDraft(createStorage(), labTokenDefinitions)).toEqual({
            error: null,
            overrides: {},
        });
    });

    it("reads a valid versioned draft", () => {
        const storage = createStorage('{"overrides":{"--radius-card":"1rem"},"version":1}');

        expect(loadLabTokenDraft(storage, labTokenDefinitions)).toEqual({
            error: null,
            overrides: {"--radius-card": "1rem"},
        });
    });

    it("reports corrupted drafts without leaking partial overrides", () => {
        const result = readLabTokenDraft(
            '{"overrides":{"--radius-card":"1rem","--unknown":"red"},"version":1}',
            labTokenDefinitions,
        );

        expect(result.overrides).toEqual({});
        expect(result.error).toMatch(/unregistered token/u);
    });

    it("writes a deterministic versioned draft", () => {
        const storage = createStorage();
        const result = saveLabTokenDraft(storage, {
            "--radius-card": "1rem",
            "--primary": "#123456",
        });

        expect(result).toEqual({error: null});
        expect(storage.value()).toBe(
            '{"overrides":{"--primary":"#123456","--radius-card":"1rem"},"version":1}',
        );
        expect(storage.getItem(LAB_TOKEN_DRAFT_STORAGE_KEY)).toBe(storage.value());
    });

    it("reports storage failures without changing the caller state", () => {
        const storage = {
            getItem: () => null,
            setItem: () => {
                throw new Error("quota exceeded");
            },
        };

        expect(saveLabTokenDraft(storage, {"--radius-card": "1rem"})).toEqual({
            error: "quota exceeded",
        });
    });
});

describe("component lab token inspector", () => {
    it("keeps a persisted override when a field is blurred without editing", () => {
        expect(resolveLabTokenValueOnBlur({}, {"--radius-card": "1rem"}, "--radius-card")).toBe("1rem");
    });

    it("allows an explicitly cleared field to remove its override", () => {
        expect(resolveLabTokenValueOnBlur({"--radius-card": ""}, {"--radius-card": "1rem"}, "--radius-card")).toBe("");
    });
});
