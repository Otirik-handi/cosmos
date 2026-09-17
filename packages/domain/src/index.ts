import { createHash } from "node:crypto";

export const storyKinds = ["event", "document", "media", "thread"] as const;

export type StoryKind = (typeof storyKinds)[number];

export const storySubtypeStatuses = ["active", "deprecated", "retired"] as const;

export type StorySubtypeStatus = (typeof storySubtypeStatuses)[number];

/**
 * A managed Story subtype (ORG-013). Built-in and future plugin subtypes share
 * this shape; the id is namespaced by its core kind so a subtype can never
 * silently change meaning by moving between kinds.
 */
export interface StorySubtypeRegistration {
    id: string;
    kind: StoryKind;
    version: number;
    label: string;
    description: string | null;
    status: StorySubtypeStatus;
    /**
     * Identity policy the subtype declares for future automatic clustering
     * (ORG-021). v1 only records the identifier; nothing executes it yet.
     */
    identityPolicy: string | null;
    owner: string;
}

export const storySubtypeRegistry: readonly StorySubtypeRegistration[] = [
    {
        id: "media.comic",
        kind: "media",
        version: 1,
        label: "漫画",
        description: "同一部漫画作品的平台页面、转发与镜像。",
        status: "active",
        identityPolicy: "same-work-v1",
        owner: "core",
    },
    {
        id: "media.anime",
        kind: "media",
        version: 1,
        label: "动画",
        description: "同一部动画作品的平台页面、转发与镜像。",
        status: "active",
        identityPolicy: "same-work-v1",
        owner: "core",
    },
    {
        id: "media.video",
        kind: "media",
        version: 1,
        label: "视频",
        description: "同一段视频或影像作品的平台页面、转发与镜像。",
        status: "active",
        identityPolicy: "same-work-v1",
        owner: "core",
    },
];

/**
 * Product consumers only see active and deprecated registrations; retired ones
 * stay in the registry for old data but are not offered for new assignments.
 */
export function listStorySubtypes(input?: {
    kind?: StoryKind;
    statuses?: readonly StorySubtypeStatus[];
}): StorySubtypeRegistration[] {
    const statuses = input?.statuses ?? ["active", "deprecated"];
    return storySubtypeRegistry.filter((entry) => (
        (input?.kind === undefined || entry.kind === input.kind)
        && statuses.includes(entry.status)
    ));
}

export type StorySubtypeRejection = "empty" | "unregistered" | "kind_mismatch" | "not_active";

export type StorySubtypeCheck =
    | { readonly ok: true; readonly registration: StorySubtypeRegistration | null }
    | { readonly ok: false; readonly reason: StorySubtypeRejection; readonly registration: StorySubtypeRegistration | null };

/**
 * Write-side gate for `updateStoryRevision` and `splitStory`: a subtype must be
 * registered, belong to the Story's core kind, and still be active. Unknown
 * values already stored stay readable; they simply cannot be written again.
 * The registry argument lets a future plugin registry extend the built-in list.
 */
export function checkStorySubtype(
    kind: StoryKind,
    subtype: string | null,
    registry: readonly StorySubtypeRegistration[] = storySubtypeRegistry,
): StorySubtypeCheck {
    if (subtype === null) {
        return { ok: true, registration: null };
    }
    if (subtype.trim() === "") {
        return { ok: false, reason: "empty", registration: null };
    }
    const registration = registry.find((entry) => entry.id === subtype) ?? null;
    if (!registration) {
        return { ok: false, reason: "unregistered", registration: null };
    }
    if (registration.kind !== kind) {
        return { ok: false, reason: "kind_mismatch", registration };
    }
    if (registration.status !== "active") {
        return { ok: false, reason: "not_active", registration };
    }
    return { ok: true, registration };
}

export const topicMemberRoles = [
    "core",
    "update",
    "background",
    "analysis",
    "counterpoint",
    "tutorial",
] as const;

export type TopicMemberRole = (typeof topicMemberRoles)[number];

export const entityTypes = [
    "person",
    "organization",
    "product",
    "project",
    "model",
    "location",
] as const;

export type EntityType = (typeof entityTypes)[number];

export const entityRelationTypes = [
    "founded",
    "works_at",
    "located_in",
    "produced",
    "part_of",
    "related_to",
] as const;

export type EntityRelationType = (typeof entityRelationTypes)[number];

/**
 * Targets that Label assignments and (later) Annotations can attach to
 * (ADR-0009 decision 1). Unknown values degrade on read, so the list is
 * additive only.
 */
export const targetTypes = [
    "story",
    "entry",
    "topic",
] as const;

export type TargetType = (typeof targetTypes)[number];

/**
 * Favorite targets are a subset of all attach targets: a story or entry can be
 * bookmarked, but a Topic already persists as its own long-lived container
 * (ADR-0009 decision 3).
 */
export const favoriteTargetTypes = [
    "story",
    "entry",
] as const;

export type FavoriteTargetType = (typeof favoriteTargetTypes)[number];

/**
 * Widget types a BoardBlock can render (ADR-0010 decision 2). The list is
 * additive only: readers degrade unknown types to a placeholder instead of
 * failing the whole board.
 */
export const blockTypes = [
    "feed",
    "spotlight",
    "source-health",
    "topic-list",
    "collection",
] as const;

export type BlockType = (typeof blockTypes)[number];

/**
 * Targets a manual spotlight placement can point at (ADR-0010 decision 3).
 * Story and Topic exist today; Workspace/Artifact stay out until Phase 3.
 */
export const spotlightTargetTypes = [
    "story",
    "topic",
] as const;

export type SpotlightTargetType = (typeof spotlightTargetTypes)[number];

/**
 * Auxiliary Entry↔Story relation kinds (ADR-0011 decision 1). The Entry's own
 * primary Story is expressed by `Entry.storyId`, so a link never targets it;
 * unknown values degrade on read, so the list is additive only.
 */
export const entryStoryRelationTypes = [
    "evidence_for",
    "mentions",
] as const;

export type EntryStoryRelationType = (typeof entryStoryRelationTypes)[number];

/**
 * Cross-source duplicate/syndication relations between two Entries (ADR-0022
 * decision 1). One unordered pair of Entries keeps at most one row, so the
 * reader never sees two competing current assertions about the same pair;
 * unknown values degrade on read, so the list is additive only.
 */
export const entryRelationTypes = [
    "duplicate_of",
    "syndicated_from",
    "near_duplicate_of",
] as const;

export type EntryRelationType = (typeof entryRelationTypes)[number];

/**
 * Relation types that make no claim about which Entry came first. They are
 * stored with the two Entry ids in id order, which is what keeps one unordered
 * pair down to a single row (ADR-0022 decision 3); `syndicated_from` keeps the
 * caller's semantic direction instead.
 */
export const symmetricEntryRelationTypes = [
    "duplicate_of",
    "near_duplicate_of",
] as const;

export function isSymmetricEntryRelationType(relationType: string): boolean {
    return (symmetricEntryRelationTypes as readonly string[]).includes(relationType);
}

/**
 * Canonical storage order for one Entry↔Entry relation. Both read directions
 * must land on the same row, so symmetric types are sorted by Entry id while
 * directed types keep the direction the caller asserted.
 */
export function normalizeEntryRelationEndpoints(input: {
    relationType: string;
    fromEntryId: string;
    toEntryId: string;
}): { fromEntryId: string; toEntryId: string } {
    if (!isSymmetricEntryRelationType(input.relationType)) {
        return { fromEntryId: input.fromEntryId, toEntryId: input.toEntryId };
    }
    return input.fromEntryId <= input.toEntryId
        ? { fromEntryId: input.fromEntryId, toEntryId: input.toEntryId }
        : { fromEntryId: input.toEntryId, toEntryId: input.fromEntryId };
}

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
    /** 机器可读的降级原因；重试判定只读它（ADR-0015 决策 2）。 */
    errorCode?: string | null;
    /** 已完成的下载尝试次数，含首次；未尝试时为 0（ADR-0015 决策 3）。 */
    attemptCount?: number;
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

export interface StoryTimeRange {
    start: TemporalValue;
    end: TemporalValue | null;
}

export interface StoryKeyFact {
    text: string;
    entryId: string | null;
}

// Ceilings for the Story representation extension (ADR-0021 decision 3); the
// contracts package reuses them so the write boundary and the domain agree.
export const storyKeyFactMaxCount = 20;
export const storyKeyFactMaxTextLength = 500;

export interface StoryRepresentationExtension {
    timeRange?: StoryTimeRange | null;
    keyFacts?: readonly StoryKeyFact[] | null;
}

export interface StoryRevisionContent extends StoryRepresentationExtension {
    title: string;
    summary: string | null;
    kind: StoryKind;
    subtype: string | null;
}

export interface NormalizedStoryRepresentation {
    timeRange: StoryTimeRange | null;
    keyFacts: StoryKeyFact[];
}

/**
 * Single normalization shared by the Story fingerprint and persistence, so the
 * two never disagree about whether a submission is a no-op (ADR-0021 decision 4).
 */
export function normalizeStoryRepresentation(
    input: StoryRepresentationExtension,
): NormalizedStoryRepresentation {
    return {
        timeRange: normalizeStoryTimeRange(input.timeRange),
        keyFacts: normalizeStoryKeyFacts(input.keyFacts),
    };
}

function normalizeStoryTimeRange(
    value: StoryTimeRange | null | undefined,
): StoryTimeRange | null {
    if (!value) {
        return null;
    }
    const start = normalizeTemporalValue(value.start);
    // `start` is the required anchor of the shape: a range whose start cannot be
    // represented is undetermined, and a lone `end` is not expressible.
    if (!start) {
        return null;
    }
    return { start, end: value.end ? normalizeTemporalValue(value.end) : null };
}

function normalizeTemporalValue(value: TemporalValue): TemporalValue | null {
    const exact = value.exact?.trim() ?? "";
    const fallback = value.fallback
        ? {
            raw: value.fallback.raw.trim(),
            lowerBound: value.fallback.lowerBound.trim(),
            precision: value.fallback.precision,
            timezone: value.fallback.timezone?.trim() || null,
            confidence: value.fallback.confidence,
        }
        : null;
    if (!exact && !fallback) {
        return null;
    }
    return {
        exact: exact || null,
        exactPrecision: exact ? value.exactPrecision : null,
        fallback,
    };
}

function normalizeStoryKeyFacts(
    value: readonly StoryKeyFact[] | null | undefined,
): StoryKeyFact[] {
    if (!value) {
        return [];
    }
    const facts: StoryKeyFact[] = [];
    for (const fact of value) {
        const text = fact.text.trim();
        if (!text) {
            continue;
        }
        facts.push({ text, entryId: fact.entryId?.trim() || null });
    }
    return facts;
}

/**
 * Story revision fingerprint covers the user-visible display fields only.
 * Changes that do not alter any of these fields are no-ops and must not
 * append a new StoryRevision (ADR-0006 decision 3).
 *
 * ADR-0021 decision 4: the four base fields are hashed exactly as before and an
 * empty extension is omitted from the digest input, so a Story that predates
 * timeRange/keyFacts keeps its stored fingerprint and stays a no-op. Key
 * insertion order below is load-bearing.
 */
export function fingerprintStoryRevision(input: StoryRevisionContent): string {
    const representation = normalizeStoryRepresentation(input);
    const digestInput: Record<string, unknown> = {
        title: input.title,
        summary: input.summary,
        kind: input.kind,
        subtype: input.subtype,
    };
    if (representation.timeRange) {
        digestInput.timeRange = representation.timeRange;
    }
    if (representation.keyFacts.length > 0) {
        digestInput.keyFacts = representation.keyFacts;
    }
    return hashValue(JSON.stringify(digestInput));
}

export interface TopicRevisionContent {
    title: string;
    purpose: string;
    scope: string | null;
}

/**
 * Topic revision fingerprint covers the user-visible display fields only.
 * Changes that do not alter any of these fields are no-ops and must not
 * append a new TopicRevision (ADR-0007 decision 1).
 */
export function fingerprintTopicRevision(input: TopicRevisionContent): string {
    return hashValue(JSON.stringify({
        title: input.title,
        purpose: input.purpose,
        scope: input.scope,
    }));
}

export interface EntityRevisionContent {
    name: string;
    type: EntityType;
}

/**
 * Entity revision fingerprint covers the user-visible identity fields only.
 * Changes that do not alter either field are no-ops and must not append a
 * new EntityRevision (ADR-0008 decision 2).
 */
export function fingerprintEntityRevision(input: EntityRevisionContent): string {
    return hashValue(JSON.stringify({
        name: input.name,
        type: input.type,
    }));
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
