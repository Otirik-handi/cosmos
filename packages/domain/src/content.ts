import { hashValue, normalizeText, stableStringify } from "./internal.js";
import type { StoryKind } from "./story-subtypes.js";
import type { TemporalValue } from "./temporal.js";

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

/**
 * 「内容为什么被发现」（ING-004）。连接器在抓取时最清楚这一点，所以在域层由连接器声明：
 * Bilibili 的 hot 与 feed 是同一个 manifest 下的两种发现方式，manifest 表达不了这个差别。
 * 取值覆盖需求验收列出的八类渠道，`unknown` 表示未声明（旧数据或未标注的连接器）。
 */
export const discoveryChannels = [
    "account",
    "recommendation",
    "search",
    "announcement",
    "email",
    "manual",
    "related",
    "agent",
    "unknown",
] as const;

export type DiscoveryChannel = (typeof discoveryChannels)[number];

export const publisherKinds = [
    "user",
    "channel",
    "subreddit",
    "official-account",
    "org",
    "unknown",
] as const;

export type PublisherKind = (typeof publisherKinds)[number];

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
    /** 发现渠道（ING-004）。不属于内容指纹：同一条内容换一种发现方式不产生新 Revision。 */
    discoveryChannel?: DiscoveryChannel;
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
