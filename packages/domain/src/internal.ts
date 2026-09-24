import { createHash } from "node:crypto";

export function hashValue(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

export function normalizeText(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    return normalized || null;
}

export function stableStringify(value: unknown): string {
    if (Array.isArray(value)) {
        return `[${value.map((item) => stableStringify(item)).join(",")}]`;
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value as Record<string, unknown>)
            .sort(([left], [right]) => left.localeCompare(right));
        return `{${entries.map(([key, item]) => {
            return `${JSON.stringify(key)}:${stableStringify(item)}`;
        }).join(",")}}`;
    }
    return JSON.stringify(value) ?? "null";
}
