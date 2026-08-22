"use client";

import {
    createContext,
    useContext,
    useEffect,
    useSyncExternalStore,
} from "react";
import type {ReactNode} from "react";

import {
    COSMOS_THEME_STORAGE_KEY,
    parseThemePreference,
    resolveThemeColorway,
    themeAttributesFor,
    type CosmosColorwayId,
    type CosmosThemePreference,
} from "./theme";

type ThemeSnapshot = {
    preference: CosmosThemePreference;
    colorway: CosmosColorwayId;
};

const SERVER_SNAPSHOT: ThemeSnapshot = Object.freeze({
    preference: "system",
    colorway: "macos-light",
});

let cachedSnapshot: ThemeSnapshot | null = null;
const listeners = new Set<() => void>();
let mediaQuery: MediaQueryList | null = null;

function systemPrefersDark(): boolean | null {
    try {
        return window.matchMedia("(prefers-color-scheme: dark)").matches;
    } catch {
        // null 表示媒体查询不可用；按合同首屏强制回退 macos-light。
        return null;
    }
}

function readStoredPreference(): CosmosThemePreference | "unavailable" {
    try {
        const raw = window.localStorage.getItem(COSMOS_THEME_STORAGE_KEY);
        if (raw === null) {
            return "system";
        }
        return parseThemePreference(raw);
    } catch {
        return "unavailable";
    }
}

function computeSnapshot(): ThemeSnapshot {
    const systemDark = systemPrefersDark();
    // 合同：matchMedia 异常时首屏回退 macos-light（含已存储的显式偏好）。
    if (systemDark === null) {
        return {preference: "macos-light", colorway: "macos-light"};
    }
    const stored = readStoredPreference();
    if (stored === "unavailable") {
        return {preference: "macos-light", colorway: "macos-light"};
    }
    return {preference: stored, colorway: resolveThemeColorway(stored, systemDark)};
}

function emitChange(): void {
    const next = computeSnapshot();
    if (
        cachedSnapshot
        && cachedSnapshot.preference === next.preference
        && cachedSnapshot.colorway === next.colorway
    ) {
        return;
    }
    cachedSnapshot = next;
    for (const listener of [...listeners]) {
        listener();
    }
}

function handleMediaChange(): void {
    if (cachedSnapshot?.preference !== "system") {
        return;
    }
    emitChange();
}

function handleStorage(event: StorageEvent): void {
    if (event.key !== null && event.key !== COSMOS_THEME_STORAGE_KEY) {
        return;
    }
    emitChange();
}

function ensureGlobalListeners(): void {
    try {
        mediaQuery = window.matchMedia("(prefers-color-scheme: dark)");
        mediaQuery.addEventListener("change", handleMediaChange);
    } catch {
        mediaQuery = null;
    }
    window.addEventListener("storage", handleStorage);
}

function releaseGlobalListeners(): void {
    mediaQuery?.removeEventListener("change", handleMediaChange);
    mediaQuery = null;
    window.removeEventListener("storage", handleStorage);
}

function subscribe(listener: () => void): () => void {
    if (listeners.size === 0) {
        ensureGlobalListeners();
    }
    listeners.add(listener);
    return () => {
        listeners.delete(listener);
        if (listeners.size === 0) {
            releaseGlobalListeners();
        }
    };
}

function getSnapshot(): ThemeSnapshot {
    cachedSnapshot ??= computeSnapshot();
    return cachedSnapshot;
}

function getServerSnapshot(): ThemeSnapshot {
    return SERVER_SNAPSHOT;
}

export function applyDocumentTheme(snapshot: ThemeSnapshot): void {
    const attributes = themeAttributesFor(snapshot.colorway);
    const root = document.documentElement;
    root.setAttribute("data-cosmos-theme", attributes.theme);
    root.setAttribute("data-cosmos-colorway", attributes.colorway);
    root.classList.toggle("dark", attributes.dark);
    root.style.colorScheme = attributes.colorScheme;
}

function setPreference(preference: CosmosThemePreference): void {
    try {
        if (preference === "system") {
            window.localStorage.removeItem(COSMOS_THEME_STORAGE_KEY);
        } else {
            window.localStorage.setItem(COSMOS_THEME_STORAGE_KEY, preference);
        }
    } catch {
        // 写入失败时仅应用本标签页的内存偏好，不伪装为已持久化。
    }
    cachedSnapshot = {
        preference,
        colorway: resolveThemeColorway(preference, systemPrefersDark() ?? false),
    };
    applyDocumentTheme(cachedSnapshot);
    for (const listener of [...listeners]) {
        listener();
    }
}

const PreferenceContext = createContext(setPreference);
const SnapshotContext = createContext<ThemeSnapshot>(SERVER_SNAPSHOT);

export function ThemeProvider({children}: {children: ReactNode}) {
    const snapshot = useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);

    useEffect(() => {
        applyDocumentTheme(snapshot);
    }, [snapshot]);

    return (
        <PreferenceContext.Provider value={setPreference}>
            <SnapshotContext.Provider value={snapshot}>
                {children}
            </SnapshotContext.Provider>
        </PreferenceContext.Provider>
    );
}

export function useTheme(): ThemeSnapshot & {setPreference: typeof setPreference} {
    return {
        ...useContext(SnapshotContext),
        setPreference: useContext(PreferenceContext),
    };
}
