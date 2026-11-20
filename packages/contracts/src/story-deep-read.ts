import { z } from "zod";
import { agentInvocationOutputSchema, agentInvocationUsageSchema } from "./agent.js";
import { configuredModelSnapshotSchema } from "./provider-model.js";
import { contentBlockSchema, contentInputBudget, evidenceRefSchema } from "./content-representation.js";

export const deepReadLimits = {
    maxSources: 8, maxSourceCharacters: 12_000, maxTotalCharacters: 60_000,
    maxSections: 8, maxBlocks: 60, maxHeadingCharacters: 200, maxHeadlineCharacters: 300,
    maxEvidencePerSection: 30, maxJsonBytes: 200 * 1024, maxRevisions: 50, maxIdCharacters: 200,
} as const;
const id = z.string().trim().min(1).max(deepReadLimits.maxIdCharacters);
const positive = z.number().int().positive().safe();
const count = z.number().int().nonnegative().safe();
const plainText = (maximum: number) => z.string().trim().min(1).max(maximum)
    .refine((text) => !/<\/?[a-z][^>]*>/i.test(text), "Raw HTML is not allowed.");
const text = z.string().max(contentInputBudget.maxBlockText);
const url = z.string().max(contentInputBudget.maxUrlLength).url()
    .refine((value) => /^https?:\/\//i.test(value), "Only http(s) URLs are allowed.");

// Only an owned data snapshot reaches Zod/serialization; accessors and hooks are never invoked.
function copyWithinBudget(input: unknown): unknown {
    let nodes = 0;
    let blocks = 0;
    const copy = (value: unknown, depth: number, containers: number): unknown => {
        if (++nodes > contentInputBudget.maxNodes || depth > contentInputBudget.maxDepth) throw new Error("Complexity limit");
        if (value === null || typeof value === "string" || typeof value === "boolean") return value;
        if (typeof value === "number" && Number.isFinite(value)) return value;
        if (typeof value !== "object" || value === null) throw new Error("Non-JSON value");
        const array = Array.isArray(value);
        const prototype = Object.getPrototypeOf(value);
        if (prototype !== (array ? Array.prototype : Object.prototype) && prototype !== null) throw new Error("Non-JSON prototype");
        const descriptors = Object.getOwnPropertyDescriptors(value);
        const keys = Reflect.ownKeys(descriptors);
        for (const key of keys) {
            if (typeof key !== "string" || key === "toJSON") throw new Error("Non-JSON property");
            const descriptor = descriptors[key];
            if (!descriptor || !("value" in descriptor) || (!descriptor.enumerable && !(array && key === "length"))) {
                throw new Error("Accessor or hidden property");
            }
        }
        const type: unknown = descriptors.type?.value;
        const nestedContainers = containers + (type === "quote" || type === "list" ? 1 : 0);
        if (nestedContainers > 2 || (descriptors.data && descriptors.type && ++blocks > deepReadLimits.maxBlocks)) throw new Error("Report block limit");
        if (array) {
            const length: unknown = descriptors.length?.value;
            if (typeof length !== "number" || length > contentInputBudget.maxNodes || keys.length !== length + 1) throw new Error("Sparse or oversized array");
            return Array.from({ length }, (_, index) => {
                const descriptor = descriptors[String(index)];
                if (!descriptor) throw new Error("Non-JSON array property");
                return copy(descriptor.value, depth + 1, nestedContainers);
            });
        }
        return Object.fromEntries(Object.entries(descriptors).map(([key, descriptor]) =>
            [key, copy(descriptor.value, depth + 1, nestedContainers)]));
    };
    const snapshot = copy(input, 0, 0);
    if (new TextEncoder().encode(JSON.stringify(snapshot)).byteLength > deepReadLimits.maxJsonBytes) throw new Error("JSON byte limit");
    return snapshot;
}
function bounded<T>(schema: z.ZodType<T>) {
    return z.unknown().transform((input, context) => {
        try {
            return copyWithinBudget(input);
        } catch {
            context.addIssue({ code: "custom", message: "Report must be bounded JSON data without accessors or serialization hooks." });
            return z.NEVER;
        }
    }).pipe(schema);
}

type ReportInlineInputShape =
    | { type: "text" | "code"; text: string }
    | { type: "link"; text: string; url: string }
    | { type: "strong" | "emphasis"; inlines: ReportInlineInputShape[] };
const inline: z.ZodType<ReportInlineInputShape> = z.lazy(() => z.discriminatedUnion("type", [
    z.object({ type: z.literal("text"), text }).strict(),
    z.object({ type: z.literal("code"), text }).strict(),
    z.object({ type: z.literal("link"), text, url }).strict(),
    z.object({ type: z.literal("strong"), inlines: z.array(inline).max(100) }).strict(),
    z.object({ type: z.literal("emphasis"), inlines: z.array(inline).max(100) }).strict(),
]));
export const reportInlineInputSchema = bounded(inline);

type ReportBlockInputShape =
    | { type: "paragraph"; data: { inlines: ReportInlineInputShape[] } }
    | { type: "code"; data: { text: string; language?: string } }
    | { type: "quote"; data: { blocks: ReportBlockInputShape[] } }
    | { type: "list"; data: { ordered: boolean; items: { inlines: ReportInlineInputShape[]; blocks?: ReportBlockInputShape[] }[] } };
const blockInput: z.ZodType<ReportBlockInputShape> = z.lazy(() => z.discriminatedUnion("type", [
    z.object({ type: z.literal("paragraph"), data: z.object({ inlines: z.array(inline).max(100) }).strict() }).strict(),
    z.object({ type: z.literal("code"), data: z.object({ text, language: id.optional() }).strict() }).strict(),
    z.object({ type: z.literal("quote"), data: z.object({ blocks: z.array(blockInput).max(deepReadLimits.maxBlocks) }).strict() }).strict(),
    z.object({ type: z.literal("list"), data: z.object({ ordered: z.boolean(), items: z.array(z.object({
        inlines: z.array(inline).max(100), blocks: z.array(blockInput).max(deepReadLimits.maxBlocks).optional(),
    }).strict()).max(deepReadLimits.maxBlocks) }).strict() }).strict(),
]));
export const reportBlockInputSchema = bounded(blockInput);

// Keep the existing content block validator as the final owner of reader-compatible blocks.
type ReportBlockShape =
    | (Extract<ReportBlockInputShape, { type: "paragraph" | "code" }> & { id: string })
    | { id: string; type: "quote"; data: { blocks: ReportBlockShape[] } }
    | { id: string; type: "list"; data: { ordered: boolean; items: { inlines: ReportInlineInputShape[]; blocks?: ReportBlockShape[] }[] } };
const reportBlockWhitelist: z.ZodType<ReportBlockShape> = z.lazy(() => z.discriminatedUnion("type", [
    z.object({ id, type: z.literal("paragraph"), data: z.object({ inlines: z.array(inline).max(100) }).strict() }).strict(),
    z.object({ id, type: z.literal("code"), data: z.object({ text, language: id.optional() }).strict() }).strict(),
    z.object({ id, type: z.literal("quote"), data: z.object({ blocks: z.array(reportBlockWhitelist).max(deepReadLimits.maxBlocks) }).strict() }).strict(),
    z.object({ id, type: z.literal("list"), data: z.object({ ordered: z.boolean(), items: z.array(z.object({
        inlines: z.array(inline).max(100), blocks: z.array(reportBlockWhitelist).max(deepReadLimits.maxBlocks).optional(),
    }).strict()).max(deepReadLimits.maxBlocks) }).strict() }).strict(),
]));
export const reportBlockSchema = bounded(reportBlockWhitelist).superRefine((block, context) => {
    const parsed = contentBlockSchema.safeParse(block);
    if (!parsed.success) for (const issue of parsed.error.issues) {
        context.addIssue({ code: "custom", path: issue.path, message: issue.message });
    }
});
const evidence = evidenceRefSchema.extend({ entryId: id, entryRevisionId: id, representationVersion: positive, blockId: id.optional() }).strict();
const sectionFields = {
    heading: plainText(deepReadLimits.maxHeadingCharacters), kind: z.enum(["fact", "opinion"]),
    evidence: z.array(evidence).max(deepReadLimits.maxEvidencePerSection),
};
function factHasEvidence(value: { kind: string; evidence: unknown[] }): boolean {
    return value.kind !== "fact" || value.evidence.length > 0;
}
export const reportSectionInputSchema = bounded(z.object({
    ...sectionFields, blocks: z.array(blockInput).max(deepReadLimits.maxBlocks),
}).strict().refine(factHasEvidence, "Fact sections require evidence."));
export const reportSectionSchema = bounded(z.object({
    id: id.regex(/^s[1-8]$/), ...sectionFields, blocks: z.array(reportBlockSchema).max(deepReadLimits.maxBlocks),
}).strict().refine(factHasEvidence, "Fact sections require evidence."));
export const reportInputSchema = bounded(z.object({
    headline: plainText(deepReadLimits.maxHeadlineCharacters),
    sections: z.array(reportSectionInputSchema).min(1).max(deepReadLimits.maxSections),
}).strict());

export type ReportInlineInput = z.infer<typeof reportInlineInputSchema>;
export type ReportBlockInput = z.infer<typeof reportBlockInputSchema>;
export type ReportSectionInput = z.infer<typeof reportSectionInputSchema>;
export type ReportInput = z.infer<typeof reportInputSchema>;
export type ReportBlock = z.infer<typeof reportBlockSchema>;
export type ReportSection = z.infer<typeof reportSectionSchema>;
export type NormalizeReportResult = { success: true; data: { headline: string; sections: ReportSection[] } }
    | { success: false; errorCode: "malformed_payload"; issues: z.ZodIssue[] };

/** Assign stable section-local depth-first identities without mutating model output. */
export function normalizeReportInput(input: unknown): NormalizeReportResult {
    const parsed = reportInputSchema.safeParse(input);
    if (!parsed.success) return { success: false, errorCode: "malformed_payload", issues: parsed.error.issues };
    const sections = parsed.data.sections.map((section, sectionIndex) => {
        const sectionId = `s${sectionIndex + 1}`;
        let blockNumber = 0;
        const numberBlock = (block: ReportBlockInputShape): ReportBlockShape => {
            const blockId = `${sectionId}-b${++blockNumber}`;
            if (block.type === "quote") return { id: blockId, type: block.type, data: { blocks: block.data.blocks.map(numberBlock) } };
            if (block.type === "list") return { id: blockId, type: block.type, data: { ...block.data, items: block.data.items.map((item) => ({
                inlines: item.inlines, ...(item.blocks === undefined ? {} : { blocks: item.blocks.map(numberBlock) }),
            })) } };
            return { ...block, id: blockId };
        };
        return { ...section, id: sectionId, blocks: section.blocks.map(numberBlock) };
    });
    const validated = bounded(z.object({
        headline: plainText(deepReadLimits.maxHeadlineCharacters),
        sections: z.array(reportSectionSchema).max(deepReadLimits.maxSections),
    }).strict()).safeParse({ headline: parsed.data.headline, sections });
    if (!validated.success) return { success: false, errorCode: "malformed_payload", issues: validated.error.issues };
    return { success: true, data: validated.data };
}

export const inputProjectionSchema = z.object({
    storyRevisionId: id,
    sources: z.array(z.object({
        entryId: id, entryRevisionId: id, representationVersion: positive.nullable(),
        blockIds: z.array(id).max(contentInputBudget.maxBlocks).refine((ids) => new Set(ids).size === ids.length, "Duplicate block IDs."),
        includedCharacterCount: count.max(deepReadLimits.maxSourceCharacters),
        truncated: z.boolean(), omitted: z.boolean(), reason: z.enum(["unavailable", "no_usable_block", "budget"]).nullable(),
    }).strict().superRefine((source, context) => {
        if (source.omitted
            ? source.blockIds.length !== 0 || source.includedCharacterCount !== 0 || source.truncated || source.reason === null
            : source.representationVersion === null || source.blockIds.length === 0 || source.includedCharacterCount === 0 || (source.truncated ? source.reason !== "budget" : source.reason !== null)) {
            context.addIssue({ code: "custom", message: "Source coverage and omission flags disagree." });
        }
    })).max(deepReadLimits.maxSources),
    omittedSourceCount: count,
}).strict().superRefine((input, context) => {
    const characters = input.sources.reduce((sum, source) => sum + source.includedCharacterCount, 0);
    if (characters === 0 || characters > deepReadLimits.maxTotalCharacters
        || input.omittedSourceCount < input.sources.filter((source) => source.omitted).length) {
        context.addIssue({ code: "custom", message: "Invalid total source coverage." });
    }
});
export const sourceStatusSchema = z.enum(["current", "superseded", "unavailable"]);
export const deepReadErrorCodeSchema = z.enum(["timeout", "authentication_required", "rate_limited", "budget_exhausted",
    "invalid_configuration", "dependency_unavailable", "malformed_payload", "generation_failed"]);
export const deepReadGenerationRequestSchema = z.object({ modelId: id.optional() }).strict();
// This is the canonical hash input only; the application owns sha256 and default-model resolution.
export const deepReadRequestHashInputSchema = z.object({ storyId: id, modelId: id.nullable() }).strict();
const existingCost = agentInvocationOutputSchema.shape.cost.unwrap();
const cost = existingCost.extend({
    input: z.number().finite().nonnegative(), output: z.number().finite().nonnegative(), total: z.number().finite().nonnegative(),
    cacheWrite: z.number().finite().nonnegative().optional(), cacheRead: z.number().finite().nonnegative().optional(),
    currency: configuredModelSnapshotSchema.shape.currency.removeDefault(),
}).strict();
const usage = agentInvocationUsageSchema.extend({
    inputTokens: count, outputTokens: count, totalTokens: count,
    cacheWriteTokens: count.optional(), cacheReadTokens: count.optional(),
}).strict();
// Hashing belongs to the application: preserve the original request selection, including omission.
export type DeepReadRequestHashInput = z.infer<typeof deepReadRequestHashInputSchema>;

export const deepReadGenerationSchema = z.object({
    runId: id, storyId: id, status: z.enum(["queued", "running", "completed", "failed", "cancelled"]),
    modelId: id, provider: id.nullable(), model: id.nullable(), createdAt: z.string().datetime(),
    publishedRevision: positive.nullable(), errorCode: deepReadErrorCodeSchema.nullable(), cost: cost.optional(),
}).strict().superRefine((generation, context) => {
    if ((generation.status === "completed") !== (generation.publishedRevision !== null)
        || (generation.status !== "failed" && generation.errorCode !== null)
        || (generation.cost !== undefined && generation.publishedRevision === null)) {
        context.addIssue({ code: "custom", message: "Generation state disagrees with publication." });
    }
});
const summary = z.object({
    artifactId: id, storyId: id, workflowRunId: id, revision: positive,
    headline: plainText(deepReadLimits.maxHeadlineCharacters), producer: id, producerVersion: id, provider: id, model: id,
    createdAt: z.string().datetime(), contentHash: z.string().regex(/^[a-f0-9]{64}$/),
    sourceStatus: sourceStatusSchema, usage: usage.optional(), cost: cost.optional(),
}).strict();
export const revisionSummarySchema = summary;
export const revisionDetailSchema = bounded(summary.extend({
    sections: z.array(reportSectionSchema).min(1).max(deepReadLimits.maxSections), input: inputProjectionSchema,
}).strict());
export const artifactSnapshotSchema = z.object({
    id, storyId: id, kind: z.literal("story-deep-read"), generation: deepReadGenerationSchema.nullable(),
    revisions: z.array(revisionSummarySchema).max(deepReadLimits.maxRevisions), current: revisionDetailSchema.nullable(),
}).strict().superRefine((artifact, context) => {
    const revisions = artifact.revisions;
    if (revisions.some((revision, index) => revision.artifactId !== artifact.id || revision.storyId !== artifact.storyId
        || (index > 0 && revisions[index - 1]!.revision <= revision.revision))
        || (artifact.generation !== null && (artifact.generation.storyId !== artifact.storyId
            || !["queued", "running"].includes(artifact.generation.status)))
        || (artifact.current === null ? revisions.length !== 0 : revisions.length === 0
            || artifact.current.artifactId !== artifact.id || artifact.current.storyId !== artifact.storyId
            || artifact.current.revision !== revisions[0]?.revision)) {
        context.addIssue({ code: "custom", message: "Artifact ownership, order or active generation is invalid." });
    }
});
export const artifactReadSchema = z.union([
    z.object({ artifact: z.null() }).strict(), z.object({ artifact: artifactSnapshotSchema }).strict(),
]);
export type InputProjection = z.infer<typeof inputProjectionSchema>;
export type SourceStatus = z.infer<typeof sourceStatusSchema>;
export type DeepReadErrorCode = z.infer<typeof deepReadErrorCodeSchema>;
export type DeepReadGenerationRequest = z.infer<typeof deepReadGenerationRequestSchema>;
export type DeepReadGeneration = z.infer<typeof deepReadGenerationSchema>;
export type RevisionSummary = z.infer<typeof revisionSummarySchema>;
export type RevisionDetail = z.infer<typeof revisionDetailSchema>;
export type ArtifactSnapshot = z.infer<typeof artifactSnapshotSchema>;
export type ArtifactRead = z.infer<typeof artifactReadSchema>;
