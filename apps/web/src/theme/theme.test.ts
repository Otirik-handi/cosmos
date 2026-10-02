import {describe, expect, it} from "vitest";

import {
    COSMOS_THEME_STORAGE_KEY,
    parseThemePreference,
    resolveAppearance,
    themeAttributesFor,
} from "./theme";

describe("cosmos theme preference parsing", () => {
    it("keeps only the three supported preferences", () => {
        expect(parseThemePreference("system")).toBe("system");
        expect(parseThemePreference("light")).toBe("light");
        expect(parseThemePreference("dark")).toBe("dark");
    });

    it("falls back to system for missing or untrusted values", () => {
        expect(parseThemePreference(null)).toBe("system");
        expect(parseThemePreference(undefined)).toBe("system");
        expect(parseThemePreference(42)).toBe("system");
        expect(parseThemePreference({})).toBe("system");
        expect(parseThemePreference("cosmos")).toBe("system");
        expect(parseThemePreference("LIGHT")).toBe("system");
    });

    it("drops the retired colorway values so the axis collapse needs no migration", () => {
        expect(parseThemePreference("macos-light")).toBe("system");
        expect(parseThemePreference("macos-night")).toBe("system");
    });
});

describe("cosmos appearance resolution", () => {
    it("maps system preference onto the OS appearance", () => {
        expect(resolveAppearance("system", false)).toBe("light");
        expect(resolveAppearance("system", true)).toBe("dark");
    });

    it("ignores the OS appearance for explicit preferences", () => {
        expect(resolveAppearance("light", true)).toBe("light");
        expect(resolveAppearance("dark", false)).toBe("dark");
    });
});

describe("cosmos theme document attributes", () => {
    it("describes the light appearance", () => {
        expect(themeAttributesFor("light")).toEqual({
            appearance: "light",
            dark: false,
            colorScheme: "light",
        });
    });

    it("describes the dark appearance including the dark class signal", () => {
        expect(themeAttributesFor("dark")).toEqual({
            appearance: "dark",
            dark: true,
            colorScheme: "dark",
        });
    });

    it("exposes the persisted storage key", () => {
        expect(COSMOS_THEME_STORAGE_KEY).toBe("cosmos.theme.preference.v1");
    });
});
