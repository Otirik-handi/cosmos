import { createHash } from "node:crypto";

export const storyKinds = ["event", "document", "media", "thread"] as const;

export type StoryKind = (typeof storyKinds)[number];

export interface NormalizedAssetInput {
    kind: string;
    sourceUrl: string | null;
    status: "saved" | "metadata_only" | "skipped" | "failed";
    mimeType: string | null;
    byteSize: number | null;
    content: Uint8Array | null;
}

export interface NormalizedIngestItem {
    externalId?: string | null;
    title: string;
    summary: string | null;
    contentText: string;
    webUrl: string | null;
    sourcePublishedAt: string | null;
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
    sourcePublishedAt?: string | null;
}): string {
    if (input.externalId?.trim()) {
        return `external:${input.externalId.trim()}`;
    }

    if (input.webUrl?.trim()) {
        return `url:${input.webUrl.trim()}`;
    }

    return `fallback:${hashValue([
        input.title.trim(),
        input.sourcePublishedAt ?? "",
    ].join("\u001f"))}`;
}

export function fingerprintEntryRevision(input: {
    title: string;
    summary: string | null;
    contentText: string;
    webUrl: string | null;
    sourcePublishedAt: string | null;
}): string {
    return hashValue(JSON.stringify(input));
}

function hashValue(value: string): string {
    return createHash("sha256").update(value).digest("hex");
}

export function projectEntryToStory(input: {
    entryId: string;
    revisionId: string;
    title: string;
    summary?: string | null;
    kind?: StoryKind;
    subtype?: string | null;
}): MinimalStoryProjection {
    return {
        id: `story:${input.entryId}`,
        kind: input.kind ?? "document",
        subtype: input.subtype ?? null,
        title: input.title,
        summary: input.summary ?? null,
        entryId: input.entryId,
        revisionId: input.revisionId,
    };
}
