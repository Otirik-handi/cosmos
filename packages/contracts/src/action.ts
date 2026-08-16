import { z, type ZodType } from "zod";

import {
    contentKindSchema,
    contentMetricsSchema,
    publisherSchema,
    sourceExecutionSnapshotSchema,
    temporalValueSchema,
} from "./base.js";

/** Stable categories used to describe the capability behind an Activity. */
export const actionKindSchema = z.enum([
    "connector",
    "transform",
    "library",
    "query",
    "control",
    "script",
    "agent",
    "artifact",
    "render",
    "delivery",
]);
export type ActionKind = z.infer<typeof actionKindSchema>;

export const executionPlacementSchema = z.enum([
    "host",
    "trusted_worker",
    "remote_worker",
]);
export type ExecutionPlacement = z.infer<typeof executionPlacementSchema>;

const actionSegment = "[a-z][a-z0-9-]*";
const actionRefPattern = new RegExp(
    "^" + actionSegment + "(?:\\." + actionSegment + ")+@[1-9][0-9]*$",
);

/**
 * A version is part of the Action identity. Keeping it in the ref makes
 * replay and manifest lookup unambiguous; bare refs are not executable.
 */
export const actionRefSchema = z.string().regex(
    actionRefPattern,
    "Action ref must look like namespace.operation@positive-integer-version.",
).refine((ref) => {
    const version = Number(ref.slice(ref.lastIndexOf("@") + 1));
    return Number.isSafeInteger(version);
}, "Action ref version must be a safe integer.");
export type ActionRef = z.infer<typeof actionRefSchema>;

export interface ParsedActionRef {
    baseRef: string;
    version: number;
}

export function parseActionRef(ref: string): ParsedActionRef {
    const canonicalRef = actionRefSchema.parse(ref);
    const separator = canonicalRef.lastIndexOf("@");
    return {
        baseRef: canonicalRef.slice(0, separator),
        version: Number(canonicalRef.slice(separator + 1)),
    };
}

export const actionErrorCodeSchema = z.enum([
    "dependency_unavailable",
    "authentication_required",
    "timeout",
    "rate_limited",
    "malformed_payload",
    "unsupported_version",
    "invalid_configuration",
    "invalid_action_ref",
    "invalid_input",
    "unknown_action",
    "internal_error",
]);
export type ActionErrorCode = z.infer<typeof actionErrorCodeSchema>;

/** Runtime-only schema marker. Schemas are executable and are not manifests. */
const runtimeSchema = z.custom<ZodType<unknown>>(
    (value) => {
        if (typeof value !== "object" || value === null || !("parse" in value)) {
            return false;
        }
        return typeof value.parse === "function";
    },
    { message: "expected a Zod schema" },
);

export const retryPolicySchema = z.object({
    maxAttempts: z.number().int().positive(),
    backoffMs: z.number().int().nonnegative(),
    retryableErrors: actionErrorCodeSchema.array().optional(),
});
export type RetryPolicy = z.infer<typeof retryPolicySchema>;

export const actionExecutionSchema = z.object({
    idempotent: z.boolean(),
    supportsCancellation: z.boolean(),
    timeoutMs: z.number().int().positive().nullable(),
    retryPolicy: retryPolicySchema.nullable(),
});
export type ActionExecution = z.infer<typeof actionExecutionSchema>;

/**
 * Executable definition used inside a trusted process. It deliberately
 * contains Zod schemas and therefore must never be persisted or sent as a
 * transport manifest.
 */
export const actionDefinitionSchema = z.object({
    ref: actionRefSchema,
    manifestHash: z.string().trim().min(1).optional(),
    kind: actionKindSchema,
    description: z.string().trim().min(1),
    capabilities: z.string().trim().min(1).array(),
    executionPlacement: executionPlacementSchema,
    inputSchema: runtimeSchema,
    outputSchema: runtimeSchema,
    execution: actionExecutionSchema,
});
export type ActionDefinition = z.infer<typeof actionDefinitionSchema>;

/** Serializable manifest projection without executable schema objects. */
export const actionDescriptorSchema = z.object({
    ref: actionRefSchema,
    version: z.number().int().positive(),
    manifestHash: z.string().trim().min(1).optional(),
    kind: actionKindSchema,
    description: z.string().trim().min(1),
    capabilities: z.string().trim().min(1).array(),
    executionPlacement: executionPlacementSchema,
    idempotent: z.boolean(),
    supportsCancellation: z.boolean(),
    timeoutMs: z.number().int().positive().nullable(),
    retryPolicy: retryPolicySchema.nullable(),
}).superRefine((value, context) => {
    const parsed = parseActionRef(value.ref);
    if (parsed.version !== value.version) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["version"],
            message: "Descriptor version must match the version in ref.",
        });
    }
});
export type ActionDescriptor = z.infer<typeof actionDescriptorSchema>;

/** Public name used by manifest/catalog consumers. */
export const actionManifestSchema = actionDescriptorSchema;
export type ActionManifest = ActionDescriptor;

export type JsonValue =
    | null
    | boolean
    | number
    | string
    | JsonValue[]
    | { [key: string]: JsonValue };

function isJsonValue(value: unknown): value is JsonValue {
    if (value === null || typeof value === "string" || typeof value === "boolean") {
        return true;
    }
    if (typeof value === "number") {
        return Number.isFinite(value);
    }
    if (Array.isArray(value)) {
        return value.every((item) => isJsonValue(item));
    }
    if (typeof value !== "object") {
        return false;
    }
    const prototype = Object.getPrototypeOf(value);
    if (prototype !== Object.prototype && prototype !== null) {
        return false;
    }
    return Object.values(value).every((item) => isJsonValue(item));
}

/** A content-addressed reference safe to persist in Workflow JSON state. */
export const blobRefSchema = z.object({
    key: z.string().trim().min(1),
    hash: z.string().trim().min(1),
    byteSize: z.number().int().nonnegative(),
    mediaType: z.string().trim().min(1),
}).strict();
export type BlobRef = z.infer<typeof blobRefSchema>;

/** JSON-safe normalized asset; raw bytes stay outside the Workflow contract. */
export const normalizedAssetInputSchema = z.object({
    kind: z.string().trim().min(1),
    sourceUrl: z.string().nullable(),
    status: z.enum(["saved", "metadata_only", "skipped", "failed"]),
    mimeType: z.string().nullable(),
    byteSize: z.number().int().nonnegative().nullable(),
    blobRef: blobRefSchema.nullable().optional(),
}).strict().superRefine((asset, context) => {
    if (asset.status !== "saved" && asset.blobRef !== undefined && asset.blobRef !== null) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["blobRef"],
            message: "Only saved assets may contain a BlobRef.",
        });
    }
});
export type NormalizedAssetInputContract = z.infer<typeof normalizedAssetInputSchema>;

/** Runtime boundary for the canonical output of a source-fetch Action. */
export const normalizedIngestItemSchema = z.object({
    externalId: z.string().trim().min(1).nullable().optional(),
    title: z.string().trim().min(1),
    summary: z.string().nullable(),
    contentText: z.string(),
    webUrl: z.string().nullable(),
    kind: contentKindSchema,
    publisher: publisherSchema.nullable(),
    metrics: contentMetricsSchema.nullable(),
    publishedAt: temporalValueSchema.nullable(),
    updatedAt: temporalValueSchema.nullable().optional(),
    sourceLocator: z.record(z.string(), z.custom<JsonValue>(isJsonValue, {
        message: "sourceLocator must contain JSON-safe values.",
    })),
    rawPayload: z.string(),
    rawPayloadMimeType: z.string().optional(),
    assets: normalizedAssetInputSchema.array(),
}).strict().superRefine((item, context) => {
    if (
        !item.externalId
        && !item.webUrl
        && Object.keys(item.sourceLocator).length === 0
    ) {
        context.addIssue({
            code: z.ZodIssueCode.custom,
            path: ["sourceLocator"],
            message: "Normalized item needs an external id, URL or source locator.",
        });
    }
});
export type NormalizedIngestItemContract = z.infer<typeof normalizedIngestItemSchema>;

export const sourceFetchInputSchema = z.object({
    source: sourceExecutionSnapshotSchema,
    cursor: z.string().nullable(),
}).strict();
export type SourceFetchInput = z.infer<typeof sourceFetchInputSchema>;

export const sourceFetchOutputSchema = z.object({
    items: normalizedIngestItemSchema.array(),
    nextCursor: z.string().nullable(),
}).strict();
export type SourceFetchOutput = z.infer<typeof sourceFetchOutputSchema>;

export const ingestTriggerKindSchema = z.enum(["manual", "schedule"]);
export type IngestTriggerKind = z.infer<typeof ingestTriggerKindSchema>;

export const libraryIngestInputSchema = z.object({
    sourceId: z.string().trim().min(1),
    triggerKind: ingestTriggerKindSchema,
    item: normalizedIngestItemSchema,
}).strict();
export type LibraryIngestInput = z.infer<typeof libraryIngestInputSchema>;

export const libraryIngestOutputSchema = z.object({
    createdEntry: z.boolean(),
    revisedEntry: z.boolean(),
    duplicateObservation: z.boolean(),
}).strict();
export type LibraryIngestOutput = z.infer<typeof libraryIngestOutputSchema>;

export const sourceCheckpointInputSchema = z.object({
    sourceId: z.string().trim().min(1),
    cursor: z.string().nullable(),
    expectedRevision: z.number().int().nonnegative(),
    itemCount: z.number().int().nonnegative(),
}).strict();
export type SourceCheckpointInput = z.infer<typeof sourceCheckpointInputSchema>;

export const sourceCheckpointOutputSchema = z.object({
    sourceId: z.string().trim().min(1),
    cursor: z.string().nullable(),
    revision: z.number().int().nonnegative(),
    committed: z.boolean(),
}).strict();
export type SourceCheckpointOutput = z.infer<typeof sourceCheckpointOutputSchema>;
