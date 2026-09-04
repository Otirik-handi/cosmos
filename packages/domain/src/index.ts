import { createHash } from "node:crypto";

export const storyKinds = ["event", "document", "media", "thread"] as const;

export type StoryKind = (typeof storyKinds)[number];

export const contentKinds = [
    "post",
    "article",
    "video",
    "audio",
    "image",
    "comment",
    "listing",
] as const;

export type ContentKind = (typeof contentKinds)[number];

export const publisherKinds = [
    "user",
    "channel",
    "subreddit",
    "official-account",
    "org",
    "unknown",
] as const;

export type PublisherKind = (typeof publisherKinds)[number];

export const temporalPrecisions = [
    "second",
    "minute",
    "hour",
    "day",
    "week",
    "month",
    "year",
    "unknown",
] as const;

export type TemporalPrecision = (typeof temporalPrecisions)[number];

export type TemporalConfidence = "high" | "inferred" | "uncertain";

export interface TemporalFallback {
    raw: string;
    lowerBound: string;
    precision: TemporalPrecision;
    timezone: string | null;
    confidence: TemporalConfidence;
}

export interface TemporalValue {
    exact: string | null;
    exactPrecision: "second" | null;
    fallback: TemporalFallback | null;
}

export interface PublisherMetrics {
    followers?: number | null;
    following?: number | null;
    statuses?: number | null;
    voteup?: number | null;
    reliable?: "high" | "low" | "unknown";
}

export interface Publisher {
    platformId: string | null;
    name: string;
    handle: string | null;
    profileUrl: string | null;
    kind: PublisherKind;
    metrics?: PublisherMetrics | null;
}

export interface ContentMetrics {
    values: {
        likes?: number | null;
        views?: number | null;
        reposts?: number | null;
        comments?: number | null;
        collects?: number | null;
        score?: number | null;
    };
    raw: Record<string, string>;
    reliability: "high" | "low" | "unknown";
    capturedAt: string;
}

export interface NormalizedAssetInput {
    kind: string;
    sourceUrl: string | null;
    status: "saved" | "metadata_only" | "skipped" | "failed";
    mimeType: string | null;
    byteSize: number | null;
    content: Uint8Array | null;
    /** 面向用户的降级原因；仅非 saved 状态填写（ADR-0005）。 */
    errorMessage?: string | null;
}

export interface NormalizedIngestItem {
    externalId?: string | null;
    title: string;
    summary: string | null;
    contentText: string;
    webUrl: string | null;
    kind: ContentKind;
    publisher: Publisher | null;
    metrics: ContentMetrics | null;
    publishedAt: TemporalValue | null;
    updatedAt?: TemporalValue | null;
    sourceLocator: Record<string, unknown>;
    rawPayload: string;
    rawPayloadMimeType?: string;
    assets: readonly NormalizedAssetInput[];
}

export interface MinimalStoryProjection {
    id: string;
    kind: StoryKind;
    subtype: string | null;
    title: string;
    summary: string | null;
    entryId: string;
    revisionId: string;
}

export function deriveExternalKey(input: {
    externalId?: string | null;
    webUrl?: string | null;
    title: string;
    contentText?: string;
    publishedAt?: TemporalValue | null;
    sourceLocator?: Record<string, unknown>;
}): string {
    if (input.externalId?.trim()) {
        return `external:${input.externalId.trim()}`;
    }

    if (input.webUrl?.trim()) {
        return `url:${input.webUrl.trim()}`;
    }

    return `fallback:${hashValue([
        input.title.trim(),
        input.contentText?.trim() ?? "",
        input.publishedAt?.exact ?? "",
        stableStringify(input.sourceLocator ?? {}),
    ].join("\u001f"))}`;
}

export function fingerprintEntryRevision(input: {
    title: string;
    summary: string | null;
    contentText: string;
    webUrl: string | null;
    kind: ContentKind;
    publisher: Publisher | null;
}): string {
    return hashValue(JSON.stringify(input));
}

export function normalizePublisher(input: {
    platformId?: unknown;
    name?: unknown;
    handle?: unknown;
    profileUrl?: unknown;
    kind?: unknown;
    metrics?: PublisherMetrics | null;
} | null | undefined): Publisher | null {
    if (!input) {
        return null;
    }

    const name = normalizeText(input.name);
    if (!name) {
        return null;
    }

    const kind = typeof input.kind === "string"
        && (publisherKinds as readonly string[]).includes(input.kind)
        ? input.kind as PublisherKind
        : "unknown";

    return {
        platformId: normalizeText(input.platformId),
        name,
        handle: normalizeText(input.handle),
        profileUrl: normalizeText(input.profileUrl),
        kind,
        metrics: input.metrics ?? null,
    };
}

export function createTemporalValue(input: {
    exact?: unknown;
    raw?: string | null;
    now?: Date;
    timezone?: string | null;
}): TemporalValue | null {
    const exact = parseExactTimestamp(input.exact);
    if (exact) {
        return {
            exact,
            exactPrecision: "second",
            fallback: null,
        };
    }

    const raw = normalizeText(input.raw);
    if (!raw) {
        return null;
    }

    const fallback = parseTemporalFallback(
        raw,
        input.now ?? new Date(),
        input.timezone ?? "UTC",
    );
    return {
        exact: null,
        exactPrecision: null,
        fallback,
    };
}

export function temporalProjection(
    value: TemporalValue | null | undefined,
): string | null {
    return value?.exact ?? null;
}

export function mapContentKindToStoryKind(kind: ContentKind): StoryKind {
    switch (kind) {
        case "video":
        case "audio":
        case "image":
            return "media";
        case "comment":
            return "thread";
        case "post":
        case "article":
        case "listing":
            return "document";
    }
}

export function projectEntryToStory(input: {
    entryId: string;
    revisionId: string;
    title: string;
    summary?: string | null;
    kind?: StoryKind;
    subtype?: string | null;
    contentKind?: ContentKind;
}): MinimalStoryProjection {
    return {
        id: `story:${input.entryId}`,
        kind: input.kind
            ?? (input.contentKind
                ? mapContentKindToStoryKind(input.contentKind)
                : "document"),
        subtype: input.subtype ?? null,
        title: input.title,
        summary: input.summary ?? null,
        entryId: input.entryId,
        revisionId: input.revisionId,
    };
}

function hashValue(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

function normalizeText(value: unknown): string | null {
    if (typeof value !== "string") {
        return null;
    }
    const normalized = value.trim();
    return normalized || null;
}

function parseExactTimestamp(value: unknown): string | null {
    if (typeof value === "number" && Number.isFinite(value)) {
        const milliseconds = Math.abs(value) < 100_000_000_000
            ? value * 1_000
            : value;
        const date = new Date(milliseconds);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    const text = normalizeText(value);
    if (!text) {
        return null;
    }

    if (/^\d{10,13}$/.test(text)) {
        const numeric = Number(text);
        const milliseconds = text.length === 10 ? numeric * 1_000 : numeric;
        const date = new Date(milliseconds);
        return Number.isNaN(date.getTime()) ? null : date.toISOString();
    }

    const date = new Date(text);
    return Number.isNaN(date.getTime()) ? null : date.toISOString();
}

function parseTemporalFallback(
    raw: string,
    now: Date,
    timezone: string,
): TemporalFallback {
    const normalized = raw
        .replace(/\([^)]*modified[^)]*\)/i, "")
        .replace(/（[^）]*）/g, "")
        .trim();
    const relative = normalized.match(
        /^(\d+)\s*(秒|分钟?|小时|周|天|个月|年)前$/,
    );
    if (relative) {
        const amount = Number(relative[1]);
        const unit = relative[2];
        const date = new Date(now.getTime());
        let precision: TemporalPrecision = "unknown";

        if (unit === "秒") {
            date.setUTCSeconds(date.getUTCSeconds() - amount);
            precision = "second";
            date.setUTCMilliseconds(0);
        } else if (unit === "分" || unit === "分钟") {
            date.setUTCMinutes(date.getUTCMinutes() - amount);
            precision = "minute";
            date.setUTCSeconds(0, 0);
        } else if (unit === "小时") {
            date.setUTCHours(date.getUTCHours() - amount);
            precision = "hour";
            date.setUTCMinutes(0, 0, 0);
        } else if (unit === "天") {
            date.setUTCDate(date.getUTCDate() - amount);
            precision = "day";
            startOfUtcDay(date);
        } else if (unit === "周") {
            date.setUTCDate(date.getUTCDate() - amount * 7);
            precision = "week";
            startOfUtcDay(date);
        } else if (unit === "个月") {
            date.setUTCMonth(date.getUTCMonth() - amount);
            precision = "month";
            date.setUTCDate(1);
            startOfUtcDay(date);
        } else if (unit === "年") {
            date.setUTCFullYear(date.getUTCFullYear() - amount);
            precision = "year";
            date.setUTCMonth(0, 1);
            startOfUtcDay(date);
        }

        return {
            raw,
            lowerBound: date.toISOString(),
            precision,
            timezone,
            confidence: "inferred",
        };
    }

    const hiddenDate = normalized.match(
        /^(\d{1,2})[-/](\d{1,2})(?:[\u4e00-\u9fff]+)?$/,
    ) ?? normalized.match(
        /^(\d{1,2})月(\d{1,2})日(?:[\u4e00-\u9fff]+)?$/,
    );
    if (hiddenDate) {
        const month = Number(hiddenDate[1]);
        const day = Number(hiddenDate[2]);
        const candidates = [
            createUtcDate(now.getUTCFullYear(), month, day),
            createUtcDate(now.getUTCFullYear() - 1, month, day),
        ].filter((candidate): candidate is Date => candidate !== null);
        const candidate = candidates.sort((left, right) => {
            return Math.abs(now.getTime() - left.getTime())
                - Math.abs(now.getTime() - right.getTime());
        })[0];
        if (candidate) {
            return {
                raw,
                lowerBound: candidate.toISOString(),
                precision: "day",
                timezone,
                confidence: "inferred",
            };
        }
    }

    const fullDate = normalized.match(
        /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/,
    );
    if (fullDate) {
        const date = createUtcDate(
            Number(fullDate[1]),
            Number(fullDate[2]),
            Number(fullDate[3]),
        );
        if (date) {
            return {
                raw,
                lowerBound: date.toISOString(),
                precision: "day",
                timezone,
                confidence: "high",
            };
        }
    }

    return {
        raw,
        lowerBound: new Date(now).toISOString(),
        precision: "unknown",
        timezone,
        confidence: "uncertain",
    };
}

function startOfUtcDay(date: Date): void {
    date.setUTCHours(0, 0, 0, 0);
}

function createUtcDate(year: number, month: number, day: number): Date | null {
    const date = new Date(Date.UTC(year, month - 1, day));
    return date.getUTCFullYear() === year
        && date.getUTCMonth() === month - 1
        && date.getUTCDate() === day
        ? date
        : null;
}

function stableStringify(value: unknown): string {
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
