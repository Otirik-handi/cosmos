import {describe, expect, it} from "vitest";

import {labTokenDefinitions} from "./tokens";
import {
    parseLabOverrideSnapshot,
    serializeLabOverrideSnapshot,
} from "./snapshot";

describe("component lab token snapshots", () => {
    it("serializes overrides deterministically", () => {
        const raw = serializeLabOverrideSnapshot({
            "--radius-card": "1rem",
            "--primary": "#123456",
        });

        expect(raw).toBe('{"overrides":{"--primary":"#123456","--radius-card":"1rem"},"version":1}');
    });

    it("accepts registered token values", () => {
        const raw = serializeLabOverrideSnapshot({"--radius-card": "1rem"});

        expect(parseLabOverrideSnapshot(raw, labTokenDefinitions)).toEqual({"--radius-card": "1rem"});
    });

    it("rejects unknown tokens", () => {
        const raw = '{"overrides":{"--not-registered":"1rem"},"version":1}';

        expect(() => parseLabOverrideSnapshot(raw, labTokenDefinitions)).toThrow(/unregistered token/u);
    });

    it("rejects malformed values without producing a partial snapshot", () => {
        const raw = '{"overrides":{"--radius-card":"1rem; color:red"},"version":1}';

        expect(() => parseLabOverrideSnapshot(raw, labTokenDefinitions)).toThrow(/invalid value/u);
    });

    it("rejects unsupported snapshot versions", () => {
        const raw = '{"overrides":{"--radius-card":"1rem"},"version":2}';

        expect(() => parseLabOverrideSnapshot(raw, labTokenDefinitions)).toThrow(/version/u);
    });
});
