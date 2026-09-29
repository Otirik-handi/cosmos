export const COSMOS_THEME_STORAGE_KEY = "cosmos.theme.preference.v1";

/**
 * 单一明暗轴（ADR-0029 决策 5）：删除了 `theme × colorway` 两套轴。
 * 「未来可安装第三方主题」已排除，保留一个只有单一取值的 theme 轴没有意义。
 */
export type CosmosThemePreference = "system" | "light" | "dark";
export type CosmosAppearance = "light" | "dark";

const THEME_PREFERENCES: readonly CosmosThemePreference[] = [
    "system",
    "light",
    "dark",
];

/**
 * 存量 `localStorage` 里的 `macos-light` / `macos-night` 会落回 `system`，
 * 因此轴收敛不需要迁移代码。
 */
export function parseThemePreference(value: unknown): CosmosThemePreference {
    return typeof value === "string"
        && (THEME_PREFERENCES as readonly string[]).includes(value)
        ? value as CosmosThemePreference
        : "system";
}

export function resolveAppearance(
    preference: CosmosThemePreference,
    systemPrefersDark: boolean,
): CosmosAppearance {
    if (preference !== "system") {
        return preference;
    }
    return systemPrefersDark ? "dark" : "light";
}

export type CosmosThemeAttributes = {
    appearance: CosmosAppearance;
    dark: boolean;
    colorScheme: CosmosAppearance;
};

export function themeAttributesFor(appearance: CosmosAppearance): CosmosThemeAttributes {
    return {
        appearance,
        dark: appearance === "dark",
        colorScheme: appearance,
    };
}
