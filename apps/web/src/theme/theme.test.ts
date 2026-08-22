import {describe, expect, it} from "vitest";

import {
    COSMOS_THEME_ID,
    COSMOS_THEME_STORAGE_KEY,
    parseThemePreference,
    resolveThemeColorway,
    themeAttributesFor,
} from "./theme";

describe("cosmos theme preference parsing", () => {
    it("keeps only the three supported preferences", () => {
        expect(parseThemePreference("system")).toBe("system");
        expect(parseThemePreference("macos-light")).toBe("macos-light");
        expect(parseThemePreference("macos-night")).toBe("macos-night");
    });

    it("falls back to system for missing or untrusted values", () => {
        expect(parseThemePreference(null)).toBe("system");
        expect(parseThemePreference(undefined)).toBe("system");
        expect(parseThemePreference(42)).toBe("system");
        expect(parseThemePreference({})).toBe("system");
        expect(parseThemePreference("cosmos")).toBe("system");
        expect(parseThemePreference("dark")).toBe("system");
        expect(parseThemePreference("MACOS-LIGHT")).toBe("system");
    });
});

describe("cosmos colorway resolution", () => {
    it("maps system preference onto the OS appearance", () => {
        expect(resolveThemeColorway("system", false)).toBe("macos-light");
        expect(resolveThemeColorway("system", true)).toBe("macos-night");
    });

    it("ignores the OS appearance for explicit preferences", () => {
        expect(resolveThemeColorway("macos-light", true)).toBe("macos-light");
        expect(resolveThemeColorway("macos-night", false)).toBe("macos-night");
    });
});

describe("cosmos theme document attributes", () => {
    it("describes the light colorway for the neurobook theme", () => {
        expect(themeAttributesFor("macos-light")).toEqual({
            theme: COSMOS_THEME_ID,
            colorway: "macos-light",
            appearance: "light",
            dark: false,
            colorScheme: "light",
        });
    });

    it("describes the night colorway including the dark class signal", () => {
        expect(themeAttributesFor("macos-night")).toEqual({
            theme: COSMOS_THEME_ID,
            colorway: "macos-night",
            appearance: "dark",
            dark: true,
            colorScheme: "dark",
        });
    });

    it("exposes the persisted storage key", () => {
        expect(COSMOS_THEME_STORAGE_KEY).toBe("cosmos.theme.preference.v1");
    });
});
