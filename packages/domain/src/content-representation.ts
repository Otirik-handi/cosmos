export const CONTENT_INPUT_MAX_BYTES = 1024 * 1024;
export const CONTENT_NODE_MAX_COUNT = 50_000;
export const CONTENT_BLOCK_MAX_COUNT = 5_000;
export const CONTENT_MAX_DEPTH = 64;
export const CONTENT_BLOCK_TEXT_MAX_LENGTH = 65_536;
export const CONTENT_LIST_MAX_DEPTH = 3;
export const CONTENT_TABLE_MAX_ROWS = 200;
export const CONTENT_TABLE_MAX_COLUMNS = 50;
export const CONTENT_URL_MAX_LENGTH = 4_096;

export type ContentInline =
    | { type: "text"; text: string }
    | { type: "link"; text: string; url: string }
    | { type: "strong" | "emphasis"; inlines: readonly ContentInline[] }
    | { type: "code"; text: string };

export interface ContentBlockData {
    heading: { level: number; inlines: readonly ContentInline[] };
    paragraph: { inlines: readonly ContentInline[] };
    quote: { blocks: readonly ContentBlock[] };
    list: { ordered: boolean; items: readonly { inlines: readonly ContentInline[]; blocks?: readonly ContentBlock[] }[] };
    code: { text: string; language?: string };
    image: { assetId: string; sourceUrl?: string; alt?: string; caption?: string };
    video: { assetId: string; sourceUrl?: string; posterAssetId?: string; title?: string; duration?: number };
    audio: { assetId: string; sourceUrl?: string; posterAssetId?: string; title?: string; duration?: number };
    embed: { provider: string; url: string; title?: string };
    table: { columns: readonly string[]; rows: readonly (readonly string[])[] };
    divider: Record<string, never>;
    unknown: { text?: string; sourceUrl?: string; reason: string };
}
export type ContentBlock = {
    [K in keyof ContentBlockData]: {
        id: string; type: K; data: ContentBlockData[K]; source?: string; warnings?: readonly string[];
    }
}[keyof ContentBlockData];

type SourceData<K extends keyof ContentBlockData> = K extends "image" | "video" | "audio"
    ? Omit<ContentBlockData[K], "assetId" | "posterAssetId"> & { sourceUrl: string }
    : K extends "quote" ? { blocks: readonly StructuredSourceBlock[] }
    : K extends "list" ? { ordered: boolean; items: readonly { inlines: readonly ContentInline[]; blocks?: readonly StructuredSourceBlock[] }[] }
    : ContentBlockData[K];
export type StructuredSourceBlock = {
    [K in keyof ContentBlockData]: { type: K; data: SourceData<K>; source?: string; warnings?: readonly string[] }
}[keyof ContentBlockData];
export type ContentSource =
    | { format: "plain-text"; text: string }
    | { format: "safe-html-input"; html: string; baseUrl?: string }
    | { format: "structured-source-content"; blocks: readonly StructuredSourceBlock[] };

export interface EvidenceRef {
    entryId: string;
    entryRevisionId: string;
    representationVersion: number;
    blockId?: string;
}
export const evidenceStatuses = [
    "available", "representation-unavailable", "source-revision-superseded",
    "media-unavailable", "access-restricted", "deleted",
] as const;
export type EvidenceStatus = (typeof evidenceStatuses)[number];
export interface ContentEvidence extends EvidenceRef { status: EvidenceStatus }
export interface ContentRepresentation {
    id: string;
    entryRevisionId: string;
    representationVersion: number;
    parserVersion: string;
    status: "complete" | "partial" | "failed";
    blocks: readonly ContentBlock[];
    contentText: string;
    qualitySignals?: Readonly<Record<string, number>>;
    createdAt: string;
    supersedesRepresentationId?: string | null;
}
export const contentProfiles = [
    "summary-only", "structured-content", "full-source-evidence", "media-metadata", "media-bytes",
] as const;
export type ContentProfile = (typeof contentProfiles)[number];

export function isControlledContentUrl(value: string): boolean {
    if (!value || value.length > CONTENT_URL_MAX_LENGTH) return false;
    try {
        const url = new URL(value);
        return url.protocol === "http:" || url.protocol === "https:";
    } catch {
        return false;
    }
}
