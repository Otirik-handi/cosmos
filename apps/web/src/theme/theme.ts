export const COSMOS_THEME_ID = "neurobook";
export const COSMOS_THEME_STORAGE_KEY = "cosmos.theme.preference.v1";

export type CosmosThemePreference = "system" | "macos-light" | "macos-night";
export type CosmosColorwayId = "macos-light" | "macos-night";

const THEME_PREFERENCES: readonly CosmosThemePreference[] = [
    "system",
    "macos-light",
    "macos-night",
];

export function parseThemePreference(value: unknown): CosmosThemePreference {
    return typeof value === "string"
        && (THEME_PREFERENCES as readonly string[]).includes(value)
        ? value as CosmosThemePreference
        : "system";
}

export function resolveThemeColorway(
    preference: CosmosThemePreference,
    systemPrefersDark: boolean,
): CosmosColorwayId {
    if (preference !== "system") {
        return preference;
    }
    return systemPrefersDark ? "macos-night" : "macos-light";
}

export type CosmosThemeAttributes = {
    theme: typeof COSMOS_THEME_ID;
    colorway: CosmosColorwayId;
    appearance: "light" | "dark";
    dark: boolean;
    colorScheme: "light" | "dark";
};

export function themeAttributesFor(colorway: CosmosColorwayId): CosmosThemeAttributes {
    const appearance = colorway === "macos-night" ? "dark" : "light";
    return {
        theme: COSMOS_THEME_ID,
        colorway,
        appearance,
        dark: appearance === "dark",
        colorScheme: appearance,
    };
}
