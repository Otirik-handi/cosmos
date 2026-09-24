import { ConnectorExecutionError } from "@cosmos/application";
import type { ContentMetrics, NormalizedAssetInput } from "@cosmos/domain";

export function parseJsonDocument(output: string): unknown {
    const trimmed = output.trim();
    try {
        return JSON.parse(trimmed) as unknown;
    } catch {
        for (let index = 0; index < trimmed.length; index += 1) {
            if (trimmed[index] !== "[" && trimmed[index] !== "{") {
                continue;
            }
            const candidate = extractJsonCandidate(trimmed, index);
            if (!candidate) {
                continue;
            }
            try {
                return JSON.parse(candidate) as unknown;
            } catch {
                continue;
            }
        }
    }
    throw new ConnectorExecutionError(
        "malformed_payload",
        "OpenCLI returned no valid JSON payload.",
        false,
    );
}

export function extractRows(value: unknown): readonly Record<string, unknown>[] {
    if (Array.isArray(value) && value.every(isRecord)) {
        return value;
    }
    if (isRecord(value)) {
        for (const key of ["items", "data", "results"]) {
            const rows = value[key];
            if (Array.isArray(rows) && rows.every(isRecord)) {
                return rows;
            }
        }
        return [value];
    }
    throw new ConnectorExecutionError(
        "malformed_payload",
        "OpenCLI returned an unsupported JSON shape.",
        false,
    );
}

export function extractJsonCandidate(input: string, start: number): string | null {
    const opening = input[start];
    const closing = opening === "[" ? "]" : "}";
    let depth = 0;
    let inString = false;
    let escaped = false;

    for (let index = start; index < input.length; index += 1) {
        const character = input[index];
        if (inString) {
            if (escaped) {
                escaped = false;
            } else if (character === "\\") {
                escaped = true;
            } else if (character === "\"") {
                inString = false;
            }
            continue;
        }
        if (character === "\"") {
            inString = true;
        } else if (character === opening) {
            depth += 1;
        } else if (character === closing) {
            depth -= 1;
            if (depth === 0) {
                return input.slice(start, index + 1);
            }
        }
    }
    return null;
}

export function createMetadataAsset(
    kind: string,
    sourceUrl: string | null,
): NormalizedAssetInput | null {
    return sourceUrl
        ? {
            kind,
            sourceUrl,
            status: "metadata_only",
            mimeType: null,
            byteSize: null,
            content: null,
        }
        : null;
}

export function normalizeContentMetrics(input: {
    likes?: string | null;
    views?: string | null;
    reposts?: string | null;
    comments?: string | null;
    collects?: string | null;
    score?: string | null;
}): ContentMetrics | null {
    const values: ContentMetrics["values"] = {};
    const raw: Record<string, string> = {};
    const entries = Object.entries(input) as Array<
        [keyof ContentMetrics["values"], string | null | undefined]
    >;

    for (const [key, rawValue] of entries) {
        if (!rawValue) {
            continue;
        }
        raw[key] = rawValue;
        const numeric = Number(rawValue.replaceAll(",", ""));
        if (Number.isFinite(numeric)) {
            values[key] = numeric;
        }
    }

    return Object.keys(raw).length > 0
        ? {
            values,
            raw,
            reliability: "unknown",
            capturedAt: new Date().toISOString(),
        }
        : null;
}

export function readRecordValue(
    value: unknown,
    key: string,
): unknown {
    return isRecord(value) ? value[key] : undefined;
}

export function asRecord(value: unknown): Record<string, unknown> | null {
    return isRecord(value) ? value : null;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
    return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function firstText(...values: readonly unknown[]): string | null {
    for (const value of values) {
        if (typeof value === "string" && value.trim()) {
            return value.trim();
        }
        if (typeof value === "number" || typeof value === "boolean") {
            return String(value);
        }
    }
    return null;
}

export function firstUrl(...values: readonly unknown[]): string | null {
    for (const value of values) {
        if (
            typeof value === "string"
            && (value.startsWith("http://") || value.startsWith("https://"))
        ) {
            return value;
        }
    }
    return null;
}
