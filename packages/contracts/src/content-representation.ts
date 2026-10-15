import { z } from "zod";

export const contentInputBudget = {
    maxBytes: 1024 * 1024,
    maxNodes: 50_000,
    maxBlocks: 5_000,
    maxDepth: 64,
    maxBlockText: 65_536,
    maxListDepth: 3,
    maxTableRows: 200,
    maxTableColumns: 50,
    maxUrlLength: 4_096,
} as const;

const urlSchema = z.string().max(contentInputBudget.maxUrlLength).url().refine((value) => {
    const protocol = new URL(value).protocol;
    return protocol === "http:" || protocol === "https:";
}, "Only http(s) URLs are allowed.");
const textSchema = z.string().max(contentInputBudget.maxBlockText);

type InlineShape =
    | { type: "text" | "code"; text: string }
    | { type: "link"; text: string; url: string }
    | { type: "strong" | "emphasis"; inlines: readonly InlineShape[] };
const inlineSchema: z.ZodType<InlineShape> = z.lazy(() => z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text: textSchema }).strict(),
    z.object({ type: z.literal("link"), text: textSchema, url: urlSchema }).strict(),
    z.object({ type: z.literal("strong"), inlines: z.array(inlineSchema).max(100) }).strict(),
    z.object({ type: z.literal("emphasis"), inlines: z.array(inlineSchema).max(100) }).strict(),
    z.object({ type: z.literal("code"), text: textSchema }).strict(),
]));
// Bound traversal before recursive Zod parsing so hostile depth cannot exhaust the stack.
function boundedContent(input: unknown): boolean {
    const pending: { value: unknown; depth: number; lists: number }[] = [{ value: input, depth: 0, lists: 0 }];
    let nodes = 0;
    let blocks = 0;
    while (pending.length) {
        const next = pending.pop();
        if (!next) break;
        if (++nodes > contentInputBudget.maxNodes || next.depth > contentInputBudget.maxDepth) return false;
        if (typeof next.value !== "object" || next.value === null) continue;
        const record = next.value as Record<string, unknown>;
        const lists = next.lists + (record.type === "list" ? 1 : 0);
        if (lists > contentInputBudget.maxListDepth) return false;
        if ("data" in record && "type" in record && ++blocks > contentInputBudget.maxBlocks) return false;
        const children = Object.values(record);
        if (children.length + pending.length > contentInputBudget.maxNodes) return false;
        for (const value of children) pending.push({ value, depth: next.depth + 1, lists });
    }
    return true;
}
function bounded<T>(schema: z.ZodType<T>) {
    return z.unknown().refine(boundedContent, "Content complexity budget exceeded.").pipe(schema);
}
export const contentInlineSchema = bounded(inlineSchema);

const blockBase = { id: z.string().min(1), source: z.string().optional(), warnings: z.array(z.string()).optional() };
interface BlockData {
    heading: { level: number; inlines: readonly InlineShape[] };
    paragraph: { inlines: readonly InlineShape[] };
    quote: { blocks: readonly ContentBlockShape[] };
    list: { ordered: boolean; items: readonly { inlines: readonly InlineShape[]; blocks?: readonly ContentBlockShape[] }[] };
    code: { text: string; language?: string };
    image: { assetId: string; sourceUrl?: string; alt?: string; caption?: string };
    video: { assetId: string; sourceUrl?: string; posterAssetId?: string; title?: string; duration?: number };
    audio: { assetId: string; sourceUrl?: string; posterAssetId?: string; title?: string; duration?: number };
    embed: { provider: string; url: string; title?: string };
    table: { columns: readonly string[]; rows: readonly (readonly string[])[] };
    divider: Record<string, never>;
    unknown: { text?: string; sourceUrl?: string; reason: string };
}
type ContentBlockShape = {
    [K in keyof BlockData]: { id: string; type: K; data: BlockData[K]; source?: string; warnings?: readonly string[] }
}[keyof BlockData];
type SourceData<K extends keyof BlockData> = K extends "image" | "video" | "audio"
    ? Omit<BlockData[K], "assetId" | "posterAssetId"> & { sourceUrl: string }
    : K extends "quote" ? { blocks: readonly StructuredBlockShape[] }
    : K extends "list" ? { ordered: boolean; items: readonly { inlines: readonly InlineShape[]; blocks?: readonly StructuredBlockShape[] }[] }
    : BlockData[K];
type StructuredBlockShape = {
    [K in keyof BlockData]: { type: K; data: SourceData<K>; source?: string; warnings?: readonly string[] }
}[keyof BlockData];
const contentBlockSchemaInternal: z.ZodType<ContentBlockShape> = z.lazy(() => z.discriminatedUnion("type", [
    z.object({ ...blockBase, type: z.literal("heading"), data: z.object({ level: z.number().int().min(1).max(6), inlines: z.array(inlineSchema).max(100) }).strict() }).strict(),
    z.object({ ...blockBase, type: z.literal("paragraph"), data: z.object({ inlines: z.array(inlineSchema).max(100) }).strict() }).strict(),
    z.object({ ...blockBase, type: z.literal("quote"), data: z.object({ blocks: z.array(contentBlockSchemaInternal).max(contentInputBudget.maxBlocks) }).strict() }).strict(),
    z.object({ ...blockBase, type: z.literal("list"), data: z.object({ ordered: z.boolean(), items: z.array(z.object({ inlines: z.array(inlineSchema).max(100), blocks: z.array(contentBlockSchemaInternal).max(contentInputBudget.maxBlocks).optional() }).strict()).max(contentInputBudget.maxBlocks) }).strict() }).strict(),
    z.object({ ...blockBase, type: z.literal("code"), data: z.object({ text: textSchema, language: z.string().optional() }).strict() }).strict(),
    z.object({ ...blockBase, type: z.literal("image"), data: z.object({ assetId: z.string().min(1), sourceUrl: urlSchema.optional(), alt: textSchema.optional(), caption: textSchema.optional() }).strict() }).strict(),
    z.object({ ...blockBase, type: z.literal("video"), data: z.object({ assetId: z.string().min(1), sourceUrl: urlSchema.optional(), posterAssetId: z.string().min(1).optional(), title: textSchema.optional(), duration: z.number().nonnegative().optional() }).strict() }).strict(),
    z.object({ ...blockBase, type: z.literal("audio"), data: z.object({ assetId: z.string().min(1), sourceUrl: urlSchema.optional(), posterAssetId: z.string().min(1).optional(), title: textSchema.optional(), duration: z.number().nonnegative().optional() }).strict() }).strict(),
    z.object({ ...blockBase, type: z.literal("embed"), data: z.object({ provider: z.string().min(1), url: urlSchema, title: textSchema.optional() }).strict() }).strict(),
    z.object({ ...blockBase, type: z.literal("table"), data: z.object({ columns: z.array(textSchema).max(contentInputBudget.maxTableColumns), rows: z.array(z.array(textSchema).max(contentInputBudget.maxTableColumns)).max(contentInputBudget.maxTableRows) }).strict() }).strict(),
    z.object({ ...blockBase, type: z.literal("divider"), data: z.object({}).strict() }).strict(),
    z.object({ ...blockBase, type: z.literal("unknown"), data: z.object({ text: textSchema.optional(), sourceUrl: urlSchema.optional(), reason: z.string().min(1) }).strict() }).strict(),
]));
export const contentBlockSchema = bounded(contentBlockSchemaInternal);

const structuredBlockSchemaInternal: z.ZodType<StructuredBlockShape> = z.lazy(() => z.discriminatedUnion("type", [
    z.object({ type: z.literal("heading"), data: z.object({ level: z.number().int().min(1).max(6), inlines: z.array(inlineSchema).max(100) }).strict(), source: z.string().optional(), warnings: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal("paragraph"), data: z.object({ inlines: z.array(inlineSchema).max(100) }).strict(), source: z.string().optional(), warnings: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal("quote"), data: z.object({ blocks: z.array(structuredBlockSchemaInternal).max(contentInputBudget.maxBlocks) }).strict(), source: z.string().optional(), warnings: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal("list"), data: z.object({ ordered: z.boolean(), items: z.array(z.object({ inlines: z.array(inlineSchema).max(100), blocks: z.array(structuredBlockSchemaInternal).max(contentInputBudget.maxBlocks).optional() }).strict()).max(contentInputBudget.maxBlocks) }).strict(), source: z.string().optional(), warnings: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal("code"), data: z.object({ text: textSchema, language: z.string().optional() }).strict(), source: z.string().optional(), warnings: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal("image"), data: z.object({ sourceUrl: urlSchema, alt: textSchema.optional(), caption: textSchema.optional() }).strict(), source: z.string().optional(), warnings: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal("video"), data: z.object({ sourceUrl: urlSchema, title: textSchema.optional(), duration: z.number().nonnegative().optional() }).strict(), source: z.string().optional(), warnings: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal("audio"), data: z.object({ sourceUrl: urlSchema, title: textSchema.optional(), duration: z.number().nonnegative().optional() }).strict(), source: z.string().optional(), warnings: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal("embed"), data: z.object({ provider: z.string().min(1), url: urlSchema, title: textSchema.optional() }).strict(), source: z.string().optional(), warnings: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal("table"), data: z.object({ columns: z.array(textSchema).max(contentInputBudget.maxTableColumns), rows: z.array(z.array(textSchema).max(contentInputBudget.maxTableColumns)).max(contentInputBudget.maxTableRows) }).strict(), source: z.string().optional(), warnings: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal("divider"), data: z.object({}).strict(), source: z.string().optional(), warnings: z.array(z.string()).optional() }).strict(),
    z.object({ type: z.literal("unknown"), data: z.object({ text: textSchema.optional(), sourceUrl: urlSchema.optional(), reason: z.string().min(1) }).strict(), source: z.string().optional(), warnings: z.array(z.string()).optional() }).strict(),
]));
export const structuredSourceBlockSchema = bounded(structuredBlockSchemaInternal);

// Normalizer enforces maxBytes with partial output; rejecting oversized source text here would block ingestion.
export const contentSourceSchema = bounded(z.discriminatedUnion("format", [
    z.object({ format: z.literal("plain-text"), text: z.string() }).strict(),
    z.object({ format: z.literal("safe-html-input"), html: z.string(), baseUrl: urlSchema.optional() }).strict(),
    z.object({ format: z.literal("structured-source-content"), blocks: z.array(structuredBlockSchemaInternal).max(contentInputBudget.maxBlocks) }).strict(),
]));

export const evidenceRefSchema = z.object({ entryId: z.string().min(1), entryRevisionId: z.string().min(1), representationVersion: z.number().int().positive(), blockId: z.string().min(1).optional() }).strict();
export const evidenceStatusSchema = z.enum(["available", "representation-unavailable", "source-revision-superseded", "media-unavailable", "access-restricted", "deleted"]);
export const contentEvidenceSchema = evidenceRefSchema.extend({ status: evidenceStatusSchema }).strict();
export const contentRepresentationSchema = bounded(z.object({
    id: z.string().min(1), entryRevisionId: z.string().min(1), representationVersion: z.number().int().positive(), parserVersion: z.string().min(1),
    status: z.enum(["complete", "partial", "failed"]), blocks: z.array(contentBlockSchemaInternal).max(contentInputBudget.maxBlocks), contentText: z.string(),
    qualitySignals: z.record(z.string(), z.number().finite()).optional(), createdAt: z.string().datetime(), supersedesRepresentationId: z.string().min(1).nullable().optional(),
}).strict());
export const structuredContentViewSchema = z.object({
    entryId: z.string().min(1),
    entryRevisionId: z.string().min(1),
    representation: contentRepresentationSchema.nullable(),
    contentText: z.string(),
    readingMode: z.enum(["representation", "legacy-text", "unavailable"]),
    evidenceStatus: evidenceStatusSchema,
}).strict();
export type StructuredContentViewContract = z.infer<typeof structuredContentViewSchema>;

export const contentSelectionCommandSchema = z.object({
    expectedCurrentId: z.string().min(1).nullable(),
    expectedLocked: z.boolean(),
    operation: z.enum(["lock", "unlock", "rollback"]),
    representationId: z.string().min(1).optional(),
}).strict().superRefine((value, context) => {
    if (value.operation === "rollback" ? !value.representationId : value.representationId !== undefined) {
        context.addIssue({ code: "custom", path: ["representationId"], message: "Only rollback requires a representationId" });
    }
});
export const contentSelectionResultSchema = z.object({
    currentRepresentationId: z.string().min(1).nullable(), locked: z.boolean(), changed: z.boolean(),
}).strict();

export const contentRebuildCommandSchema = z.object({}).strict();
export const contentRebuildResultSchema = z.object({
    representationId: z.string().min(1), representationVersion: z.number().int().positive().safe(), promoted: z.boolean(),
}).strict();

export const contentProfileSchema = z.enum(["summary-only", "structured-content", "full-source-evidence", "media-metadata", "media-bytes"]);
export type ContentSourceContract = z.infer<typeof contentSourceSchema>;
export type ContentBlockContract = z.infer<typeof contentBlockSchema>;
export type StructuredSourceBlockContract = z.infer<typeof structuredSourceBlockSchema>;
export type EvidenceRefContract = z.infer<typeof evidenceRefSchema>;
export type ContentRepresentationContract = z.infer<typeof contentRepresentationSchema>;
export type ContentEvidenceContract = z.infer<typeof contentEvidenceSchema>;
export type ContentProfileContract = z.infer<typeof contentProfileSchema>;
